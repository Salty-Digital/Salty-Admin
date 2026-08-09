'use server'

import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString, assertEnum } from '@/lib/validate'
import { TICKET_CATEGORIES } from '@/lib/categories'

// Simple in-process broadcast rate limit: one broadcast per 5 minutes per process.
// (Stateless/serverless — use Redis for multi-instance deployments.)
let lastBroadcastAt = 0
const BROADCAST_COOLDOWN_MS = 5 * 60 * 1000

async function callNotifFn(userId: string, title: string, body: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    // source: 'admin' tags notifications.source so the admin Recent Notifications
    // tab can filter admin-triggered pushes out of the noise of system automations.
    body: JSON.stringify({ userId, title, body, source: 'admin' }),
  })
  if (!res.ok) throw new Error(`Notification delivery failed for user ${userId.slice(0, 8)}.`)
}

export async function sendToUserAction(
  userId: string,
  title: string,
  body: string,
  screen?: string,
) {
  const admin = await requireAdmin(3)
  const uid   = assertUUID(userId, 'User ID')
  const t     = assertString(title, 'Title', 200)
  const b     = assertString(body, 'Body', 1000)

  // Validate optional screen deep-link against allowlist
  const VALID_SCREENS = ['', 'tickets', 'friends', 'settings', 'feedback'] as const
  const s = screen ? assertEnum(screen, VALID_SCREENS, 'Screen') : undefined

  const db = createServiceClient()
  const { data: user } = await db.from('users').select('id').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  await callNotifFn(uid, t, b)
  await logAudit(admin.id, 'send_notification', 'user', uid, { title: t, screen: s })
  return { ok: true }
}

export async function broadcastAction(title: string, body: string, filterCategory?: string) {
  const admin = await requireAdmin(2)

  // Rate limit broadcasts
  const now = Date.now()
  if (now - lastBroadcastAt < BROADCAST_COOLDOWN_MS) {
    const wait = Math.ceil((BROADCAST_COOLDOWN_MS - (now - lastBroadcastAt)) / 1000)
    throw new Error(`Broadcast cooldown: please wait ${wait}s before the next broadcast.`)
  }

  const t = assertString(title, 'Title', 200)
  const b = assertString(body, 'Body', 1000)

  if (filterCategory) {
    assertEnum(filterCategory, TICKET_CATEGORIES, 'Filter category')
  }

  const db = createServiceClient()

  let userIds: string[]
  if (filterCategory) {
    const { data } = await db.from('tickets').select('user_id').eq('category', filterCategory)
    userIds = [...new Set((data ?? []).map(r => r.user_id))]
  } else {
    const { data } = await db.from('users').select('id')
    userIds = (data ?? []).map(r => r.id)
  }

  lastBroadcastAt = Date.now()

  // Batch of 20 concurrent calls
  const BATCH = 20
  for (let i = 0; i < userIds.length; i += BATCH) {
    await Promise.allSettled(
      userIds.slice(i, i + BATCH).map(uid => callNotifFn(uid, t, b)),
    )
  }

  await logAudit(admin.id, 'broadcast_notification', undefined, undefined, {
    title: t,
    filter: filterCategory ?? 'all',
    recipient_count: userIds.length,
  })
  return { ok: true, count: userIds.length }
}
