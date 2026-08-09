import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ActionFilter } from './action-filter'
import { SortLink } from '@/components/ui/sortable'

interface PageProps {
  searchParams: Promise<{ page?: string; action?: string; sort?: string; dir?: string }>
}

const PAGE_SIZE = 50
const AUDIT_SORT_COLS: Record<string, string> = { action: 'action', target: 'target_type', time: 'created_at' }

const ACTION_COLOR: Record<string, string> = {
  delete_user:             'bg-[#FDEDED] text-[#BF4A3A]',
  delete_ticket:           'bg-[#FDEDED] text-[#BF4A3A]',
  deactivate_admin:        'bg-[#FDEDED] text-[#BF4A3A]',
  reject_import:           'bg-[#FFF8E6] text-[#C87A10]',
  edit_ticket:             'bg-[#EBF2FA] text-[#3A72A8]',
  send_notification:       'bg-[#EBF2FA] text-[#3A72A8]',
  broadcast_notification:  'bg-[#EBF2FA] text-[#3A72A8]',
  approve_import:          'bg-[#EAF4EE] text-[#3E8A5A]',
  invite_admin:            'bg-[#EAF4EE] text-[#3E8A5A]',
  reactivate_admin:        'bg-[#EAF4EE] text-[#3E8A5A]',
  change_tier:             'bg-gold-light text-gold',
  change_access_level:     'bg-gold-light text-gold',
  feedback_read:           'bg-stone text-salty-muted',
  feedback_actioned:       'bg-[#EAF4EE] text-[#3E8A5A]',
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requireAdmin(1)
  const { page = '1', action: filterAction = '', sort = '', dir = '' } = await searchParams
  const pageNum = Math.max(1, parseInt(page))
  const offset  = (pageNum - 1) * PAGE_SIZE
  const sortCol = AUDIT_SORT_COLS[sort] ?? 'created_at'
  const ascending = AUDIT_SORT_COLS[sort] ? dir === 'asc' : false
  const db      = createServiceClient()

  let query = db
    .from('admin_audit_log')
    .select('id, admin_id, action, target_type, target_id, metadata, created_at', { count: 'exact' })
    .order(sortCol, { ascending })
    .range(offset, offset + PAGE_SIZE - 1)

  if (filterAction) query = query.eq('action', filterAction)

  const { data: logs, count } = await query

  // Resolve admin names
  const adminIds = [...new Set((logs ?? []).map(l => l.admin_id))]
  const { data: admins } = adminIds.length > 0
    ? await db.from('admin_users').select('id, email, full_name').in('id', adminIds)
    : { data: [] }

  const adminMap: Record<string, string> = {}
  for (const a of admins ?? []) adminMap[a.id] = a.full_name ?? a.email

  // All distinct actions for the filter dropdown
  const { data: allActions } = await db.from('admin_audit_log').select('action').limit(500)
  const uniqueActions = [...new Set((allActions ?? []).map(r => r.action))].sort()

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-7 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-sora text-[20px] font-bold text-salty-text">Audit Log</h1>
          <p className="text-[13px] text-salty-muted">{(count ?? 0).toLocaleString()} events recorded</p>
        </div>
        <ActionFilter actions={uniqueActions} current={filterAction} />
      </div>

      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-salty-border bg-cream">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Admin</th>
              <SortLink label="Action" sortKey="action" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
              <SortLink label="Target" sortKey="target" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Details</th>
              <SortLink label="Time" sortKey="time" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-salty-muted">No events</td></tr>
            ) : (
              (logs ?? []).map(log => (
                <tr key={log.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                  <td className="px-4 py-3 text-[13px] font-medium text-salty-text">
                    {adminMap[log.admin_id] ?? log.admin_id?.slice(0, 8) + '…'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ACTION_COLOR[log.action] ?? 'bg-stone text-salty-muted'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-salty-secondary">
                    {log.target_type ?? '—'}
                    {log.target_id ? <span className="ml-1 text-salty-muted font-mono">{log.target_id.slice(0, 8)}…</span> : null}
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    {log.metadata ? (
                      <p className="truncate text-[11px] font-mono text-salty-muted">
                        {JSON.stringify(log.metadata)}
                      </p>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-salty-muted">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-3">
            {pageNum > 1 && (
              <Link href={`/settings/audit-log?action=${filterAction}&sort=${sort}&dir=${dir}&page=${pageNum - 1}`} className="hover:text-ember">← Previous</Link>
            )}
            {pageNum < totalPages && (
              <Link href={`/settings/audit-log?action=${filterAction}&sort=${sort}&dir=${dir}&page=${pageNum + 1}`} className="hover:text-ember">Next →</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
