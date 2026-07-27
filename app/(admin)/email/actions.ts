'use server'

import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString, assertEnum } from '@/lib/validate'
import { sendBulkEmail, sendHtmlEmail } from '@/lib/email'
import { renderBrandedEmail } from '@/lib/emails/branded'
import { unsubscribeUrl, oneClickUnsubscribeUrl } from '@/lib/unsubscribe'

export type SegmentType = 'all' | 'tier' | 'active'
export interface Segment {
  type: SegmentType
  tier?: string
  activeDays?: number
}

const VALID_TIERS = ['free', 'premium', 'family'] as const

/** Resolve the list of recipient emails for a segment, excluding banned and unsubscribed users. */
async function resolveRecipients(segment: Segment): Promise<Array<{ id: string; email: string }>> {
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

  return [...byEmail.values()]
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
  assertEnum(segment.type, ['all', 'tier', 'active'] as const, 'Segment')

  const recipients = await resolveRecipients(segment)
  if (recipients.length === 0) throw new Error('No recipients match this segment.')

  const messages = recipients.map(recipient => {
    const rendered = renderBrandedEmail({
      subject,
      body,
      pillLabel: 'PRODUCT UPDATE',
      unsubscribeUrl: unsubscribeUrl(recipient.id),
    })
    return {
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      listUnsubscribeUrl: oneClickUnsubscribeUrl(recipient.id),
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
      segment,
      recipient_count: recipients.length,
      sent_count: sent,
      failed_count: failed,
    })
  } catch {
    // email_campaigns table not present — skip logging, the send already happened.
  }

  await logAudit(admin.id, 'send_email_broadcast', 'email_campaign', undefined, {
    subject,
    segment,
    recipients: recipients.length,
    sent,
    failed,
  })

  return { sent, failed, recipients: recipients.length }
}
