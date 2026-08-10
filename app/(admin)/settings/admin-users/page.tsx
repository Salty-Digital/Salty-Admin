import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminUsersClient } from './admin-users-client'
import { LoginHistory } from './login-history'

export default async function AdminUsersPage() {
  const admin = await requireAdmin(1)
  const db = createServiceClient()

  const { data: admins } = await db
    .from('admin_users')
    .select('id, email, full_name, access_level, is_active, last_login_at, last_active_at, created_at, invited_by')
    .order('created_at', { ascending: true })

  // Resolve invited_by emails
  const inviterIds = [...new Set((admins ?? []).map(a => a.invited_by).filter(Boolean))]
  const { data: inviters } = inviterIds.length > 0
    ? await db.from('admin_users').select('id, email').in('id', inviterIds)
    : { data: [] }

  const inviterMap: Record<string, string> = {}
  for (const i of inviters ?? []) inviterMap[i.id] = i.email

  const rows = (admins ?? []).map(a => ({
    ...a,
    invited_by_email: a.invited_by ? inviterMap[a.invited_by] : undefined,
  }))

  // Recent login history — surfaces the ip/user-agent captured on every login (a security view).
  const emailById = new Map((admins ?? []).map(a => [a.id, a.email]))
  // Pull the whole history (admin logins are few) so the "new IP" flag is computed against
  // all of it, then display only the most recent.
  const { data: history } = await db
    .from('admin_login_history')
    .select('id, admin_id, ip_address, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)

  // A login is flagged "New IP" when it's the FIRST time that admin signed in from that IP,
  // excluding their very first login ever (that one isn't notable). Highlights an admin
  // appearing from an IP/location they hadn't used before.
  const firstSeen = new Map<string, { id: string; adminId: string; ts: number }>() // (admin|ip) -> earliest
  const adminEarliest = new Map<string, number>()                                  // admin -> earliest login ts
  for (const h of history ?? []) {
    const ts = Date.parse(h.created_at)
    const key = `${h.admin_id}|${h.ip_address ?? ''}`
    const seen = firstSeen.get(key)
    if (!seen || ts < seen.ts) firstSeen.set(key, { id: h.id, adminId: h.admin_id, ts })
    const ae = adminEarliest.get(h.admin_id)
    if (ae === undefined || ts < ae) adminEarliest.set(h.admin_id, ts)
  }
  const newIpIds = new Set(
    [...firstSeen.values()]
      .filter(v => v.ts > (adminEarliest.get(v.adminId) ?? 0))
      .map(v => v.id),
  )

  const loginRows = (history ?? []).slice(0, 40).map(h => ({
    id: h.id,
    admin_email: emailById.get(h.admin_id) ?? 'Unknown / removed',
    ip_address: h.ip_address,
    user_agent: h.user_agent,
    created_at: h.created_at,
    isNewIp: newIpIds.has(h.id),
  }))

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Admin Users</h1>
        <p className="text-[13px] text-salty-muted">Manage who has access to this admin panel</p>
      </div>
      <AdminUsersClient rows={rows} currentAdminId={admin.id} />

      <LoginHistory rows={loginRows} />
    </div>
  )
}
