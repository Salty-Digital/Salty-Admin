'use server'

import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString, assertEnum } from '@/lib/validate'
import { sendBulkEmail, sendHtmlEmail } from '@/lib/email'
import { renderBrandedEmail } from '@/lib/emails/branded'
import { renderBetaInviteEmail } from '@/lib/emails/beta-invite'
import { renderBetaReminderEmail } from '@/lib/emails/beta-reminder'
import { unsubscribeUrl, oneClickUnsubscribeUrl, betaUnsubscribeUrl, betaOneClickUnsubscribeUrl } from '@/lib/unsubscribe'
import { createV2Client } from '@/lib/supabase/v2'

export type SegmentType = 'all' | 'tier' | 'active' | 'custom' | 'beta'
export type BetaStatus = 'all' | 'signed' | 'unsigned'
export interface Segment {
  type: SegmentType
  tier?: string
  activeDays?: number
  /** For type 'custom': the admin-entered recipient email addresses. */
  emails?: string[]
  /** For type 'beta': which slice of the v2 beta_signups waitlist to email. */
  betaStatus?: BetaStatus
}

const VALID_TIERS = ['free', 'premium', 'family'] as const
const MAX_CUSTOM_RECIPIENTS = 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Parse admin-entered recipients into a deduped list of lowercased, valid email addresses. */
function parseEmailList(raw: string[] | undefined): string[] {
  const seen = new Set<string>()
  for (const entry of raw ?? []) {
    if (typeof entry !== 'string') continue
    for (const piece of entry.split(/[\s,;]+/)) {
      const email = piece.trim().toLowerCase()
      if (email && EMAIL_RE.test(email)) seen.add(email)
    }
  }
  return [...seen]
}

/**
 * Drop any recipients whose address is on the bounce/complaint suppression list
 * (public.email_suppressions, populated by the Resend webhook). Fails open — if the
 * table is missing or the query errors, sends proceed rather than silently blocking.
 */
async function dropSuppressed<T extends { email: string }>(
  db: ReturnType<typeof createServiceClient>,
  recipients: T[],
): Promise<T[]> {
  if (recipients.length === 0) return recipients
  const emails = recipients.map(r => r.email.trim().toLowerCase())
  const { data, error } = await db.from('email_suppressions').select('email').in('email', emails)
  if (error) return recipients
  const suppressed = new Set((data ?? []).map(r => String(r.email).toLowerCase()))
  return recipients.filter(r => !suppressed.has(r.email.trim().toLowerCase()))
}

/** Resolve the list of recipient emails for a segment, excluding banned and unsubscribed users. */
async function resolveRecipients(
  segment: Segment,
): Promise<Array<{ id: string | null; email: string; betaId?: string; firstName?: string }>> {
  if (segment.type === 'custom') return resolveCustomRecipients(segment.emails)
  if (segment.type === 'beta') return resolveBetaRecipients(segment.betaStatus ?? 'all')

  const db = createServiceClient()
  let query = db.from('users').select('id, email, banned_until, unsubscribed_from_marketing')

  if (segment.type === 'tier' && segment.tier) {
    query = query.eq('tier', assertEnum(segment.tier, VALID_TIERS, 'Tier'))
  }
  if (segment.type === 'active' && segment.activeDays) {
    const cutoff = new Date(Date.now() - segment.activeDays * 86_400_000).toISOString()
    query = query.gte('last_seen_at', cutoff)
  }

  const { data } = await query
  const now = Date.now()
  const recipients: Array<{ id: string; email: string }> = []
  for (const user of data ?? []) {
    if (user.banned_until && new Date(user.banned_until).getTime() > now) continue
    if (user.unsubscribed_from_marketing === true) continue
    if (typeof user.id !== 'string') continue
    if (typeof user.email !== 'string' || !user.email.includes('@')) continue
    recipients.push({ id: user.id, email: user.email })
  }

  const byEmail = new Map<string, { id: string; email: string }>()
  for (const recipient of recipients) {
    const email = recipient.email.trim().toLowerCase()
    if (!byEmail.has(email)) byEmail.set(email, { id: recipient.id, email })
  }

  return dropSuppressed(db, [...byEmail.values()])
}

/**
 * Resolve a pasted custom recipient list. Every valid address becomes a recipient — including
 * ones that aren't Salty users (e.g. a mail-tester.com inbox), so admins can send test or
 * one-off mail. Addresses that DO belong to a user carry that user's id (for the personal
 * unsubscribe link) and are dropped if that user is banned or unsubscribed from marketing.
 */
async function resolveCustomRecipients(
  raw: string[] | undefined,
): Promise<Array<{ id: string | null; email: string }>> {
  const wanted = parseEmailList(raw).slice(0, MAX_CUSTOM_RECIPIENTS)
  if (wanted.length === 0) return []

  // Supabase Auth stores emails lowercased, so a lowercased `.in()` is an exact user match.
  const db = createServiceClient()
  const { data } = await db
    .from('users')
    .select('id, email, banned_until, unsubscribed_from_marketing')
    .in('email', wanted)

  const now = Date.now()
  const userByEmail = new Map<string, { id: string; suppressed: boolean }>()
  for (const user of data ?? []) {
    if (typeof user.id !== 'string' || typeof user.email !== 'string') continue
    const banned = !!(user.banned_until && new Date(user.banned_until).getTime() > now)
    const unsubscribed = user.unsubscribed_from_marketing === true
    userByEmail.set(user.email.trim().toLowerCase(), { id: user.id, suppressed: banned || unsubscribed })
  }

  const recipients: Array<{ id: string | null; email: string }> = []
  for (const email of wanted) {
    const match = userByEmail.get(email)
    if (match) {
      if (match.suppressed) continue // honor banned / unsubscribed for real users
      recipients.push({ id: match.id, email })
    } else {
      recipients.push({ id: null, email }) // arbitrary address (test inbox, non-user, etc.)
    }
  }
  return dropSuppressed(db, recipients)
}

/**
 * Resolve recipients from the v2 beta_signups waitlist, sliced by whether the address has become a
 * real account in the MAIN DB `users` table ("signed up"). Beta-unsubscribed addresses are always
 * skipped; signed-up users additionally honor their main-DB ban / marketing-unsubscribe. Requires
 * the v2 database to be configured (throws V2NotConfiguredError otherwise).
 */
async function resolveBetaRecipients(status: BetaStatus): Promise<Array<{ id: string | null; email: string; betaId?: string; firstName?: string }>> {
  const PAGE = 1000

  // 1) Pull the (non-unsubscribed) beta signups from the v2 database, keeping each row's id
  //    (so waitlist recipients get a working unsubscribe link) and first name (for a
  //    personalized greeting in the beta invite).
  const v2 = createV2Client()
  const betaByEmail = new Map<string, { id: string; firstName?: string }>() // email → beta_signups row
  for (let page = 0; page < 60; page++) {
    const { data, error } = await v2.from('beta_signups').select('id, email, first_name, unsubscribed_at').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as { id: string; email: string | null; first_name: string | null; unsubscribed_at: string | null }[]
    for (const r of rows) {
      if (r.unsubscribed_at) continue
      if (r.email && r.email.includes('@') && typeof r.id === 'string') {
        betaByEmail.set(r.email.trim().toLowerCase(), { id: r.id, firstName: r.first_name?.trim() || undefined })
      }
    }
    if (rows.length < PAGE) break
  }
  if (betaByEmail.size === 0) return []

  // 2) Map against MAIN DB users to determine "signed up".
  const db = createServiceClient()
  const userByEmail = new Map<string, { id: string; suppressed: boolean }>()
  const now = Date.now()
  for (let page = 0; page < 60; page++) {
    const { data, error } = await db.from('users').select('id, email, banned_until, unsubscribed_from_marketing').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) break
    const rows = (data ?? []) as unknown as { id: string; email: string | null; banned_until: string | null; unsubscribed_from_marketing: boolean | null }[]
    for (const u of rows) {
      if (!u.email) continue
      const banned = !!(u.banned_until && new Date(u.banned_until).getTime() > now)
      userByEmail.set(u.email.trim().toLowerCase(), { id: u.id, suppressed: banned || u.unsubscribed_from_marketing === true })
    }
    if (rows.length < PAGE) break
  }

  // 3) Build recipients. Signed-up users use their main-account unsubscribe; waitlist-only
  //    recipients carry their beta_signups id so they get a beta unsubscribe link instead.
  //    The beta first name rides along for a personalized greeting.
  const recipients: Array<{ id: string | null; email: string; betaId?: string; firstName?: string }> = []
  for (const [email, beta] of betaByEmail) {
    const user = userByEmail.get(email)
    if (status === 'signed' && !user) continue
    if (status === 'unsigned' && user) continue
    if (user) {
      if (user.suppressed) continue
      recipients.push({ id: user.id, email, firstName: beta.firstName })
    } else {
      recipients.push({ id: null, email, betaId: beta.id, firstName: beta.firstName })
    }
  }
  return dropSuppressed(db, recipients)
}

/** Send a one-off email to a single user (by id) from the Email Users page. */
export async function sendSingleEmailAction(
  userId: string,
  subjectRaw: string,
  bodyRaw: string,
): Promise<{ ok: true }> {
  const admin = await requireAdmin(2)
  const uid = assertUUID(userId, 'User ID')
  const subject = assertString(subjectRaw, 'Subject', 200)
  const body = assertString(bodyRaw, 'Body', 20_000)

  const db = createServiceClient()
  const { data: user } = await db.from('users').select('id, email').eq('id', uid).single()
  if (!user) throw new Error('User not found.')
  if (!user.email) throw new Error('This user has no email address.')

  const { subject: subj, html, text } = renderBrandedEmail({
    subject,
    body,
    pillLabel: 'MESSAGE',
  })
  await sendHtmlEmail(user.email, subj, html, { text })

  try {
    await db.from('email_campaigns').insert({
      admin_id: admin.id,
      subject,
      body,
      segment: { type: 'user', user_id: uid },
      recipient_count: 1,
      sent_count: 1,
      failed_count: 0,
    })
  } catch {
    // email_campaigns table not present — skip logging, the send already happened.
  }

  await logAudit(admin.id, 'send_user_email', 'user', uid, { subject })
  return { ok: true }
}

/** Live recipient count for the composer preview. */
export async function countRecipientsAction(segment: Segment): Promise<number> {
  await requireAdmin(2)
  const recipients = await resolveRecipients(segment)
  return recipients.length
}

export async function sendBroadcastAction(
  subjectRaw: string,
  bodyRaw: string,
  segment: Segment,
): Promise<{ sent: number; failed: number; recipients: number }> {
  const admin = await requireAdmin(2)
  const subject = assertString(subjectRaw, 'Subject', 200)
  const body = assertString(bodyRaw, 'Body', 20_000)
  assertEnum(segment.type, ['all', 'tier', 'active', 'custom', 'beta'] as const, 'Segment')

  const recipients = await resolveRecipients(segment)
  if (recipients.length === 0) throw new Error('No recipients match this segment.')

  // Don't persist the full pasted address list on the campaign/audit rows — record the count.
  const storedSegment =
    segment.type === 'custom' ? { type: 'custom', emailCount: recipients.length }
      : segment.type === 'beta' ? { type: 'beta', betaStatus: segment.betaStatus ?? 'all', recipientCount: recipients.length }
        : segment

  const pillLabel = segment.type === 'custom' ? 'MESSAGE' : 'PRODUCT UPDATE'
  const reasonLine = segment.type === 'beta'
    ? "You're receiving this because you joined the Salty beta waitlist."
    : undefined
  const messages = recipients.map(recipient => {
    // Prefer the main-account unsubscribe. Waitlist-only recipients (no account) get a beta
    // unsubscribe keyed by their beta_signups id. Bare custom addresses get neither.
    const unsub = recipient.id ? unsubscribeUrl(recipient.id)
      : recipient.betaId ? betaUnsubscribeUrl(recipient.betaId)
        : undefined
    const listUnsub = recipient.id ? oneClickUnsubscribeUrl(recipient.id)
      : recipient.betaId ? betaOneClickUnsubscribeUrl(recipient.betaId)
        : undefined
    const rendered = renderBrandedEmail({ subject, body, pillLabel, unsubscribeUrl: unsub, reasonLine })
    return {
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(listUnsub ? { listUnsubscribeUrl: listUnsub } : {}),
    }
  })

  const { sent, failed, error } = await sendBulkEmail(messages)

  // Log the campaign — tolerate the table not existing yet (migration 007 not applied).
  const db = createServiceClient()
  try {
    await db.from('email_campaigns').insert({
      admin_id: admin.id,
      subject,
      body,
      segment: storedSegment,
      recipient_count: recipients.length,
      sent_count: sent,
      failed_count: failed,
    })
  } catch {
    // email_campaigns table not present — skip logging, the send already happened.
  }

  await logAudit(admin.id, 'send_email_broadcast', 'email_campaign', undefined, {
    subject,
    segment: storedSegment,
    recipients: recipients.length,
    sent,
    failed,
  })

  // Everything failed — surface the real reason (e.g. bad Resend key) instead of a silent "0 sent".
  if (sent === 0 && failed > 0) {
    throw new Error(`All ${failed} emails failed to send${error ? ` — Resend: ${error}` : ''}. Check RESEND_API_KEY and the Resend dashboard.`)
  }

  return { sent, failed, recipients: recipients.length }
}

/**
 * Send the pre-designed Salty beta invite (the full TestFlight + Google Play onboarding
 * email) to a segment — typically Beta signups → "not signed up yet". Unlike the broadcast,
 * there's no admin-typed body: the HTML is fixed and each recipient's first name (from the
 * beta_signups waitlist) is merged into the greeting. Only the subject is editable.
 */
export type BetaTemplate = 'invite' | 'reminder'

export async function sendBetaInviteAction(
  subjectRaw: string,
  segment: Segment,
  template: BetaTemplate = 'invite',
): Promise<{ sent: number; failed: number; recipients: number }> {
  const admin = await requireAdmin(2)
  const subject = assertString(subjectRaw, 'Subject', 200)
  assertEnum(segment.type, ['all', 'tier', 'active', 'custom', 'beta'] as const, 'Segment')
  assertEnum(template, ['invite', 'reminder'] as const, 'Template')
  // 'invite' is the onboarding email a NEW signup also gets automatically from the database
  // trigger; 'reminder' is the shorter nudge for people already on the list who never
  // installed. Same recipients, unsubscribe handling and logging either way.
  const render = template === 'reminder' ? renderBetaReminderEmail : renderBetaInviteEmail

  const recipients = await resolveRecipients(segment)
  if (recipients.length === 0) throw new Error('No recipients match this segment.')

  const messages = recipients.map(recipient => {
    // Prefer the main-account unsubscribe; waitlist-only recipients get a beta unsubscribe
    // keyed by their beta_signups id. Bare custom addresses get neither.
    const unsub = recipient.id ? unsubscribeUrl(recipient.id)
      : recipient.betaId ? betaUnsubscribeUrl(recipient.betaId)
        : undefined
    const listUnsub = recipient.id ? oneClickUnsubscribeUrl(recipient.id)
      : recipient.betaId ? betaOneClickUnsubscribeUrl(recipient.betaId)
        : undefined
    const rendered = render({ subject, firstName: recipient.firstName, unsubscribeUrl: unsub })
    return {
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(listUnsub ? { listUnsubscribeUrl: listUnsub } : {}),
    }
  })

  const { sent, failed, error } = await sendBulkEmail(messages)

  const storedSegment =
    segment.type === 'custom' ? { type: 'custom', emailCount: recipients.length, template: `beta-${template}` }
      : segment.type === 'beta' ? { type: 'beta', betaStatus: segment.betaStatus ?? 'all', recipientCount: recipients.length, template: `beta-${template}` }
        : { ...segment, template: `beta-${template}` }

  const db = createServiceClient()
  try {
    await db.from('email_campaigns').insert({
      admin_id: admin.id,
      subject,
      body: `(Beta ${template} — pre-designed HTML template)`,
      segment: storedSegment,
      recipient_count: recipients.length,
      sent_count: sent,
      failed_count: failed,
    })
  } catch {
    // email_campaigns table not present — skip logging, the send already happened.
  }

  await logAudit(admin.id, 'send_beta_invite', 'email_campaign', undefined, {
    subject,
    segment: storedSegment,
    recipients: recipients.length,
    sent,
    failed,
  })

  // Everything failed — surface the real reason (e.g. bad Resend key) instead of a silent "0 sent".
  if (sent === 0 && failed > 0) {
    throw new Error(`All ${failed} emails failed to send${error ? ` — Resend: ${error}` : ''}. Check RESEND_API_KEY and the Resend dashboard.`)
  }

  return { sent, failed, recipients: recipients.length }
}
