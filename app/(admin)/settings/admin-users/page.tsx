import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminUsersClient } from './admin-users-client'
import { RecentActivity } from './recent-activity'

export default async function AdminUsersPage() {
  const admin = await requireAdmin(1)
  const db = createServiceClient()

  const { data: admins } = await db
    .from('admin_users')
    .select('id, email, full_name, access_level, allowed_pages, is_active, last_login_at, last_active_at, created_at, invited_by')
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

  // Login history is still read, but no longer as the panel's subject — it now only supplies the
  // IP / device context for each admin's row. Pull the whole history (admin logins are few) so the
  // "new IP" flag is computed against all of it.
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

  // Most recent login per admin — `history` is already newest-first, so the first hit wins.
  const latestLogin = new Map<string, { id: string; ip_address: string | null; user_agent: string | null }>()
  for (const h of history ?? []) {
    if (!latestLogin.has(h.admin_id)) {
      latestLogin.set(h.admin_id, { id: h.id, ip_address: h.ip_address, user_agent: h.user_agent })
    }
  }

  // One row per admin, ordered by real activity. Admins who have never been active sort last
  // rather than being dropped — "never active" is itself worth seeing on an access-review page.
  const activityRows = rows
    .map(a => {
      const login = latestLogin.get(a.id)
      return {
        id: a.id,
        admin_email: a.email,
        full_name: a.full_name,
        last_active_at: a.last_active_at,
        last_login_at: a.last_login_at,
        ip_address: login?.ip_address ?? null,
        user_agent: login?.user_agent ?? null,
        isNewIp: login ? newIpIds.has(login.id) : false,
        is_active: a.is_active,
      }
    })
    .sort((x, y) => (y.last_active_at ? Date.parse(y.last_active_at) : 0) - (x.last_active_at ? Date.parse(x.last_active_at) : 0))

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Admin Users</h1>
        <p className="text-[13px] text-salty-muted">Manage who has access to this admin panel</p>
      </div>
      <AdminUsersClient rows={rows} currentAdminId={admin.id} />

      <RecentActivity rows={activityRows} />
    </div>
  )
}
