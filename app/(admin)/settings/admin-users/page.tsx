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
  const { data: history } = await db
    .from('admin_login_history')
    .select('id, admin_id, ip_address, user_agent, created_at')
    .order('created_at', { ascending: false })
    .limit(40)
  const loginRows = (history ?? []).map(h => ({
    id: h.id,
    admin_email: emailById.get(h.admin_id) ?? 'Unknown / removed',
    ip_address: h.ip_address,
    user_agent: h.user_agent,
    created_at: h.created_at,
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
