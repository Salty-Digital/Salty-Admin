'use server'

import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString, assertEnum } from '@/lib/validate'
import { sendBulkEmail, sendHtmlEmail } from '@/lib/email'
import { renderBrandedEmail } from '@/lib/emails/branded'
import { unsubscribeUrl, oneClickUnsubscribeUrl } from '@/lib/unsubscribe'

export type SegmentType = 'all' | 'tier' | 'active' | 'custom'
export interface Segment {
  type: SegmentType
  tier?: string
  activeDays?: number
  /** For type 'custom': the admin-entered recipient email addresses. */
  emails?: string[]
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
): Promise<Array<{ id: string | null; email: string }>> {
  if (segment.type === 'custom') return resolveCustomRecipients(segment.emails)

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
  assertEnum(segment.type, ['all', 'tier', 'active', 'custom'] as const, 'Segment')

  const recipients = await resolveRecipients(segment)
  if (recipients.length === 0) throw new Error('No recipients match this segment.')

  // Don't persist the full pasted address list on the campaign/audit rows — record the count.
  const storedSegment =
    segment.type === 'custom' ? { type: 'custom', emailCount: recipients.length } : segment

  const pillLabel = segment.type === 'custom' ? 'MESSAGE' : 'PRODUCT UPDATE'
  const messages = recipients.map(recipient => {
    const rendered = renderBrandedEmail({
      subject,
      body,
      pillLabel,
      // Non-user addresses (e.g. a test inbox) have no id, so no personalized unsubscribe link.
      unsubscribeUrl: recipient.id ? unsubscribeUrl(recipient.id) : undefined,
    })
    return {
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      ...(recipient.id ? { listUnsubscribeUrl: oneClickUnsubscribeUrl(recipient.id) } : {}),
    }
  })

  const { sent, failed } = await sendBulkEmail(messages)

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

  return { sent, failed, recipients: recipients.length }
}
