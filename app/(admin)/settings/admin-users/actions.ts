'use server'

import { revalidatePath } from 'next/cache'
import bcrypt from 'bcryptjs'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertEmail, assertString, assertAccessLevel } from '@/lib/validate'
import { sendHtmlEmail } from '@/lib/email'
import { renderAdminInviteEmail } from '@/lib/emails/admin-invite'
import { generateInviteToken, inviteExpiryFromNow, acceptInviteUrl } from '@/lib/invite'
import { ADMIN_PAGES } from '@/lib/pages'

export async function inviteAdminAction(email: string, fullName: string, accessLevel: number) {
  const admin = await requireAdmin(1)
  const e     = assertEmail(email)
  const n     = assertString(fullName, 'Full Name', 100)
  const lvl   = assertAccessLevel(accessLevel)

  // Super admins cannot invite other super admins via UI
  if (lvl === 1) throw new Error('Cannot invite another Super Admin via this form.')

  const db = createServiceClient()

  // Check for duplicate entry in admin_users
  const { data: existing } = await db.from('admin_users').select('id').eq('email', e).single()
  if (existing) throw new Error('An admin with this email already exists.')

  const { raw, hash } = generateInviteToken()
  const inviteUrl = acceptInviteUrl(raw)
  const expiresAt = inviteExpiryFromNow()

  // Create Supabase auth user (auto-confirmed so they can log in after setting password)
  const { error: authErr } = await db.auth.admin.createUser({
    email: e,
    email_confirm: true,
    user_metadata: {
      full_name: n,
      // Migration 008's handle_new_user guard keys on this flag to skip app-user profile creation.
      created_via: 'admin_invite',
    },
  })

  if (authErr && !authErr.message.toLowerCase().includes('already')) {
    throw new Error(`Could not create auth account: ${authErr.message}`)
  }

  const { error: insertErr } = await db.from('admin_users').insert({
    email: e,
    full_name: n,
    access_level: lvl,
    invited_by: admin.id,
    is_active: true,
    invite_token_hash: hash,
    invite_token_expires_at: expiresAt,
  })
  if (insertErr) throw new Error(insertErr.message)

  const { subject, html } = renderAdminInviteEmail({
    fullName: n,
    inviterName: admin.full_name ?? admin.email,
    inviteUrl,
  })

  try {
    await sendHtmlEmail(e, subject, html)
  } catch (error) {
    revalidatePath('/settings/admin-users')
    throw error
  }

  await logAudit(admin.id, 'invite_admin', 'admin_user', undefined, { access_level: lvl, emailed: true })
  revalidatePath('/settings/admin-users')
  return { ok: true }
}

/**
 * Set another admin's admin-panel password (Super Admin only).
 *
 * This is the only way an admin gets a password now that loginAction no longer
 * falls back to Supabase auth — the hash written here is the sole credential the
 * admin panel accepts, and it is entirely separate from the app-user password in
 * auth.users, so setting it here cannot affect anyone's mobile-app login.
 */
export async function setAdminPasswordAction(targetAdminId: string, newPassword: string) {
  const admin = await requireAdmin(1)
  const tid   = assertUUID(targetAdminId, 'Admin ID')
  const pass  = assertString(newPassword, 'Password', 128)
  if (pass.length < 8) throw new Error('Password must be at least 8 characters.')

  // Own password goes through the profile page, which requires the current one —
  // letting a Super Admin rotate their own password here would skip that check.
  if (tid === admin.id) throw new Error('Use your profile page to change your own password.')

  const db = createServiceClient()
  const { data: target } = await db.from('admin_users').select('id, email').eq('id', tid).single()
  if (!target) throw new Error('Admin not found.')

  const hash = await bcrypt.hash(pass, 12)

  const { error } = await db
    .from('admin_users')
    .update({
      admin_password_hash: hash,
      password_last_updated_at: new Date().toISOString(),
      // A freshly-set password shouldn't land on an account still serving a lockout.
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq('id', tid)
  if (error) throw new Error('Failed to set password.')

  await logAudit(admin.id, 'set_admin_password', 'admin_user', tid, { email: target.email })
  revalidatePath('/settings/admin-users')
  return { ok: true }
}

export async function changeAccessLevelAction(targetAdminId: string, newLevel: number) {
  const admin = await requireAdmin(1)
  const tid   = assertUUID(targetAdminId, 'Admin ID')
  const lvl   = assertAccessLevel(newLevel)

  if (tid === admin.id) throw new Error('You cannot change your own access level.')

  const db = createServiceClient()
  const { data: target } = await db.from('admin_users').select('id, email, access_level').eq('id', tid).single()
  if (!target) throw new Error('Admin not found.')

  await db.from('admin_users').update({ access_level: lvl }).eq('id', tid)
  await logAudit(admin.id, 'change_access_level', 'admin_user', tid, {
    from: target.access_level,
    to: lvl,
  })
  revalidatePath('/settings/admin-users')
}

/**
 * Set (or clear) a target admin's page allowlist.
 *
 * `pages = null` clears the restriction — that admin reverts to plain level rules. An empty array
 * is a deliberate "no pages" and is allowed.
 *
 * Two guards worth keeping:
 *  - Only hrefs in ADMIN_PAGES are stored, so a typo or a stale page can't linger as a permission.
 *  - You cannot restrict yourself, and level-1 admins cannot be restricted at all — the allowlist is
 *    bypassed for them by canAccessPage(), so storing one would be a lie in the UI.
 */
export async function setAllowedPagesAction(targetAdminId: string, pages: string[] | null) {
  const admin = await requireAdmin(1)
  const tid = assertUUID(targetAdminId, 'Admin ID')

  if (tid === admin.id) throw new Error('You cannot change your own page access.')

  const db = createServiceClient()
  const { data: target } = await db
    .from('admin_users')
    .select('id, email, access_level, allowed_pages')
    .eq('id', tid)
    .single()
  if (!target) throw new Error('Admin not found.')
  if (target.access_level <= 1) {
    throw new Error('Super Admins always have access to every page — restrict their level instead.')
  }

  // Drop anything not in the registry, so a typo or a removed page can't linger as a permission.
  // Pages ABOVE the target's level are kept: an explicit allowlist overrides the level, which is
  // how a single System page gets granted without promoting someone to Super Admin. Capability is
  // still bounded — each page's own actions call requireAdmin(n) independently.
  const clean = pages === null
    ? null
    : [...new Set(pages)].filter((href) => ADMIN_PAGES.some((p) => p.href === href))

  await db.from('admin_users').update({ allowed_pages: clean }).eq('id', tid)
  await logAudit(admin.id, 'set_admin_page_access', 'admin_user', tid, {
    email: target.email,
    from: target.allowed_pages ?? null,
    to: clean,
    count: clean?.length ?? null,
  })
  revalidatePath('/settings/admin-users')
}

export async function toggleActiveAction(targetAdminId: string, active: boolean) {
  const admin = await requireAdmin(1)
  const tid   = assertUUID(targetAdminId, 'Admin ID')

  if (tid === admin.id) throw new Error('You cannot deactivate yourself.')
  if (typeof active !== 'boolean') throw new Error('Invalid active value.')

  const db = createServiceClient()
  const { data: target } = await db.from('admin_users').select('id, email').eq('id', tid).single()
  if (!target) throw new Error('Admin not found.')

  await db.from('admin_users').update({ is_active: active }).eq('id', tid)

  // Revoke their live Supabase auth session immediately on deactivation
  if (!active) {
    const { data: authUsers } = await db.auth.admin.listUsers()
    const authUser = authUsers?.users?.find(u => u.email === target.email)
    if (authUser) {
      await db.auth.admin.signOut(authUser.id, 'global')
    }
  }

  await logAudit(
    admin.id,
    active ? 'reactivate_admin' : 'deactivate_admin',
    'admin_user',
    tid,
  )
  revalidatePath('/settings/admin-users')
}

interface DeleteAdminResult {
  ok: true
}
interface DeleteAdminBlocked {
  ok: false
  requiresForce: true
  auditCount: number
}

export async function deleteAdminAction(
  targetAdminId: string,
  force = false,
): Promise<DeleteAdminResult | DeleteAdminBlocked> {
  const admin = await requireAdmin(1)
  const tid   = assertUUID(targetAdminId, 'Admin ID')

  if (tid === admin.id) throw new Error('You cannot delete your own admin account.')

  const db = createServiceClient()
  const { data: target } = await db.from('admin_users').select('id, email, access_level').eq('id', tid).single()
  if (!target) throw new Error('Admin not found.')

  // Never let the last active Super Admin be removed — that would lock everyone
  // out of /settings/admin-users, since it requires access_level 1. Not overridable by force.
  if (target.access_level === 1) {
    const { count } = await db
      .from('admin_users')
      .select('*', { count: 'exact', head: true })
      .eq('access_level', 1)
      .eq('is_active', true)
    if ((count ?? 0) <= 1) throw new Error('Cannot delete the last active Super Admin.')
  }

  // admin_audit_log.admin_id is a NOT NULL, NO ACTION (not CASCADE) foreign key — if this
  // admin has ever performed a logged action, deleting the admin_users row below would fail
  // with a foreign-key violation unless those audit rows are removed first. That's a real
  // destructive step (it erases this admin's history), so it only happens when the caller
  // explicitly passes force=true after being told exactly how many rows are at stake.
  const { count: auditCount } = await db
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('admin_id', tid)

  if ((auditCount ?? 0) > 0 && !force) {
    return { ok: false, requiresForce: true, auditCount: auditCount ?? 0 }
  }

  if (force && (auditCount ?? 0) > 0) {
    const { error: purgeErr } = await db.from('admin_audit_log').delete().eq('admin_id', tid)
    if (purgeErr) throw new Error(`Failed to purge audit history: ${purgeErr.message}`)
  }

  // admin_users.invited_by is also NO ACTION — sever that link first. Unlike audit log rows,
  // this is just "who invited them" metadata, safe to null out unconditionally.
  const { error: inviteUnlinkErr } = await db
    .from('admin_users')
    .update({ invited_by: null })
    .eq('invited_by', tid)
  if (inviteUnlinkErr) throw new Error(`Failed to update invited-by references: ${inviteUnlinkErr.message}`)

  // Remove their Supabase auth account too, so they lose all access immediately —
  // not just the admin_users row.
  const { data: authUsers } = await db.auth.admin.listUsers()
  const authUser = authUsers?.users?.find(u => u.email === target.email)
  if (authUser) {
    const { error: authErr } = await db.auth.admin.deleteUser(authUser.id)
    if (authErr) throw new Error(`Failed to delete auth account: ${authErr.message}`)
  }

  const { error: deleteErr } = await db.from('admin_users').delete().eq('id', tid)
  if (deleteErr) throw new Error(`Failed to delete admin: ${deleteErr.message}`)

  // Logged under the ACTING admin — the target's own audit history may have just been purged,
  // so this is the only remaining record that a forced deletion happened and what it cost.
  await logAudit(admin.id, (auditCount ?? 0) > 0 ? 'force_delete_admin' : 'delete_admin', 'admin_user', tid, {
    email: target.email,
    access_level: target.access_level,
    audit_entries_purged: force ? (auditCount ?? 0) : 0,
  })
  revalidatePath('/settings/admin-users')
  return { ok: true }
}
