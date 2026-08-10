import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminUsersClient } from './admin-users-client'

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

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Admin Users</h1>
        <p className="text-[13px] text-salty-muted">Manage who has access to this admin panel</p>
      </div>
      <AdminUsersClient rows={rows} currentAdminId={admin.id} />
    </div>
  )
}
