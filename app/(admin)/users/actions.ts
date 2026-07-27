'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createAuthClient, createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString, assertEnum } from '@/lib/validate'
import { sendHtmlEmail } from '@/lib/email'
import { renderBrandedEmail } from '@/lib/emails/branded'

const VALID_TIERS = ['free', 'premium', 'family'] as const

export async function deleteUserAction(userId: string) {
  const admin = await requireAdmin(2)
  const uid = assertUUID(userId, 'User ID')
  const db = createServiceClient()

  // Verify the user actually exists before deleting
  const { data: user } = await db.from('users').select('id, email').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  // ticket_attendees.user_id and .added_by are FK'd to users.id with NO ACTION (not CASCADE) —
  // if this user was ever tagged as an attendee on *anyone's* ticket, those rows must be removed
  // first or the final `users` delete below fails with a foreign-key violation. Several other
  // tables (saved_events, followed_artists, imap_connections, photo_scan_jobs, sent_artist_alerts)
  // have no FK constraint on user_id at all, so they won't block deletion but would otherwise be
  // left as orphaned rows — including imap_connections.password, a residual plaintext credential
  // for a user who's supposed to be fully deleted.
  const results = await Promise.all([
    db.from('ticket_attendees').delete().eq('user_id', uid),
    db.from('ticket_attendees').delete().eq('added_by', uid),
    db.from('tickets').delete().eq('user_id', uid),
    db.from('pending_imports').delete().eq('user_id', uid),
    db.from('notifications').delete().eq('user_id', uid),
    db.from('notification_tokens').delete().eq('user_id', uid),
    db.from('friendships').delete().or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
    db.from('gmail_connections').delete().eq('user_id', uid),
    db.from('imap_connections').delete().eq('user_id', uid),
    db.from('saved_events').delete().eq('user_id', uid),
    db.from('followed_artists').delete().eq('user_id', uid),
    db.from('photo_scan_jobs').delete().eq('user_id', uid),
    db.from('sent_artist_alerts').delete().eq('user_id', uid),
    db.from('feedback').update({ user_id: null }).eq('user_id', uid),
    db.storage.from('avatars').remove([
      `${uid}/avatar.jpg`, `${uid}/avatar.jpeg`,
      `${uid}/avatar.png`, `${uid}/avatar.webp`,
    ]),
  ])

  const failed = results.find(r => 'error' in r && r.error)
  if (failed && 'error' in failed && failed.error) {
    throw new Error(`Failed to clean up related data: ${failed.error.message}`)
  }

  // If this same email is also registered as an admin (admin_users.email), guard against
  // breaking or accidentally removing admin access before we touch the shared auth account.
  const { data: matchingAdmin } = await db
    .from('admin_users')
    .select('id, email, access_level, is_active')
    .eq('email', user.email)
    .maybeSingle()

  if (matchingAdmin) {
    if (matchingAdmin.id === admin.id) {
      throw new Error('This email is your own admin account — you cannot delete it this way.')
    }
    if (matchingAdmin.access_level === 1 && matchingAdmin.is_active) {
      const { count } = await db
        .from('admin_users')
        .select('*', { count: 'exact', head: true })
        .eq('access_level', 1)
        .eq('is_active', true)
      if ((count ?? 0) <= 1) {
        throw new Error('This email is the last active Super Admin — cannot delete the underlying account.')
      }
    }
  }

  const { error: deleteErr } = await db.from('users').delete().eq('id', uid)
  if (deleteErr) throw new Error(`Failed to delete user: ${deleteErr.message}`)

  const { error: authErr } = await db.auth.admin.deleteUser(uid)
  if (authErr) throw new Error(`User row deleted but auth account removal failed: ${authErr.message}`)

  // Admin login checks its own password hash, but it still mints the session from a
  // magic-link OTP against the Supabase Auth account we just deleted — so if this email
  // also had an admin_users row, that admin can no longer authenticate at all. Remove the
  // row explicitly instead of leaving a dangling "Active" admin entry that's actually unusable.
  if (matchingAdmin) {
    await db.from('admin_users').delete().eq('id', matchingAdmin.id)
    await logAudit(admin.id, 'delete_admin_via_user_deletion', 'admin_user', matchingAdmin.id, {
      email: matchingAdmin.email,
      access_level: matchingAdmin.access_level,
    })
  }

  await logAudit(admin.id, 'delete_user', 'user', uid, { email: user.email })
  revalidatePath('/users')
  if (matchingAdmin) revalidatePath('/settings/admin-users')
}

export async function sendNotificationAction(userId: string, title: string, body: string) {
  const admin = await requireAdmin(3)
  const uid   = assertUUID(userId, 'User ID')
  const t     = assertString(title, 'Title', 200)
  const b     = assertString(body, 'Body', 1000)

  // Verify user exists
  const db = createServiceClient()
  const { data: user } = await db.from('users').select('id').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY!

  const res = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ userId: uid, title: t, body: b, source: 'admin' }),
  })
  if (!res.ok) throw new Error('Failed to send notification.')

  await logAudit(admin.id, 'send_notification', 'user', uid, { title: t })
  return { ok: true }
}

export async function sendUserEmailAction(userId: string, subject: string, body: string) {
  const admin = await requireAdmin(2)
  const uid   = assertUUID(userId, 'User ID')
  const s     = assertString(subject, 'Subject', 200)
  const b     = assertString(body, 'Body', 20_000)

  const db = createServiceClient()
  const { data: user } = await db.from('users').select('id, email, banned_until').eq('id', uid).single()
  if (!user) throw new Error('User not found.')
  if (!user.email) throw new Error('This user has no email address.')

  const { subject: subj, html, text } = renderBrandedEmail({
    subject: s,
    body: b,
    pillLabel: 'MESSAGE',
  })
  await sendHtmlEmail(user.email, subj, html, { text })

  try {
    await db.from('email_campaigns').insert({
      admin_id: admin.id,
      subject: s,
      body: b,
      segment: { type: 'user', user_id: uid },
      recipient_count: 1,
      sent_count: 1,
      failed_count: 0,
    })
  } catch {
    // email_campaigns table not present — skip logging, the send already happened.
  }

  await logAudit(admin.id, 'send_user_email', 'user', uid, { subject: s })
  return { ok: true }
}

export async function sendPasswordResetAction(userId: string) {
  const admin = await requireAdmin(2)
  const uid   = assertUUID(userId, 'User ID')
  const db    = createServiceClient()

  const { data: user } = await db.from('users').select('id, email').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  // auth.admin.generateLink() only generates a token, it never sends an email — it must be
  // paired with resetPasswordForEmail() on the anon-key client, which triggers Supabase's
  // actual "Reset Password" email template and delivery.
  const authClient = await createAuthClient()
  const { error } = await authClient.auth.resetPasswordForEmail(user.email)
  if (error) throw new Error('Failed to send password reset email.')

  await logAudit(admin.id, 'password_reset_sent', 'user', uid)
}

export async function forceSignOutAction(userId: string) {
  const admin = await requireAdmin(2)
  const uid   = assertUUID(userId, 'User ID')
  const db    = createServiceClient()

  const { data: user } = await db.from('users').select('id').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  const { error } = await db.auth.admin.signOut(uid, 'global')
  if (error) throw new Error('Failed to sign out user.')

  await logAudit(admin.id, 'force_sign_out', 'user', uid)
}

export async function changeTierAction(userId: string, tier: string) {
  const admin = await requireAdmin(2)
  const uid   = assertUUID(userId, 'User ID')
  const t     = assertEnum(tier, VALID_TIERS, 'Tier')
  const db    = createServiceClient()

  const { data: user } = await db.from('users').select('id, tier').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  await db.from('users').update({ tier: t }).eq('id', uid)
  await logAudit(admin.id, 'change_tier', 'user', uid, { from: user.tier, to: t })
  revalidatePath(`/users/${uid}`)
}

export async function banUserAction(userId: string, bannedUntil: string | null) {
  const admin = await requireAdmin(2)
  const uid   = assertUUID(userId, 'User ID')
  const db    = createServiceClient()

  const { data: user } = await db.from('users').select('id').eq('id', uid).single()
  if (!user) throw new Error('User not found.')

  await db.from('users').update({ banned_until: bannedUntil }).eq('id', uid)
  await logAudit(admin.id, bannedUntil ? 'ban_user' : 'unban_user', 'user', uid, bannedUntil ? { banned_until: bannedUntil } : undefined)
  revalidatePath(`/users/${uid}`)
  revalidatePath('/users')
}
