import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { countPendingImportUsers } from '@/lib/pending-imports'
import { ImportsTable } from './imports-table'

const PAGE_SIZE = 50
// Real, server-sortable columns (the raw_data JSON fields aren't sortable here).
const PENDING_SORT_COLS: Record<string, string> = { confidence: 'confidence', submitted: 'created_at' }
const STATUSES = ['pending', 'approved', 'accepted', 'rejected'] as const
type ImportStatus = (typeof STATUSES)[number]
const LABELS: Record<ImportStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string; sort?: string; dir?: string }>
}

export default async function PendingImportsPage({ searchParams }: PageProps) {
  await requireAdmin(2)
  const db = createServiceClient()

  const params = await searchParams
  const status: ImportStatus = (STATUSES as readonly string[]).includes(params.status ?? '')
    ? (params.status as ImportStatus)
    : 'pending'
  const pageNum = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const offset = (pageNum - 1) * PAGE_SIZE
  const sort = params.sort ?? ''
  const dir = params.dir ?? ''
  const sortCol = PENDING_SORT_COLS[sort] ?? 'created_at'
  const ascending = PENDING_SORT_COLS[sort] ? dir === 'asc' : false

  // Accurate per-status totals (for the tab badges) — counted directly, not from a sample.
  const [[pendingCount, approvedCount, acceptedCount, rejectedCount], pendingUserCount] = await Promise.all([
    Promise.all(
      STATUSES.map((s) =>
        db
          .from('pending_imports')
          .select('*', { count: 'exact', head: true })
          .eq('status', s)
          .then((r) => r.count ?? 0),
      ),
    ),
    // Each row here is one EVENT awaiting its owner's approval, and a single user with a
    // linked inbox can account for dozens — so the total on its own reads as a user count
    // and badly overstates reach.
    countPendingImportUsers(db),
  ])
  const counts: Record<ImportStatus, number> = {
    pending: pendingCount,
    approved: approvedCount,
    accepted: acceptedCount,
    rejected: rejectedCount,
  }

  // Only the current tab's page of rows.
  const { data: rows } = await db
    .from('pending_imports')
    .select('id, user_id, source, status, confidence, raw_data, created_at')
    .eq('status', status)
    .order(sortCol, { ascending })
    .range(offset, offset + PAGE_SIZE - 1)

  const totalForStatus = counts[status]
  const totalPages = Math.max(1, Math.ceil(totalForStatus / PAGE_SIZE))

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pending Imports</h1>
          <p className="text-[13px] text-salty-muted">
            Events found in users’ inboxes, calendars and photos that the user hasn’t approved
            or rejected yet.
          </p>
        </div>
        <span className="text-right text-sm text-muted-foreground">
          {counts.pending.toLocaleString()} unreviewed event{counts.pending === 1 ? '' : 's'}
          <br />
          <span className="text-[12px]">
            across {pendingUserCount.toLocaleString()} user{pendingUserCount === 1 ? '' : 's'}
          </span>
        </span>
      </div>

      {/* URL-driven tabs so each status paginates independently */}
      <div className="flex flex-wrap gap-1 border-b border-salty-border">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/pending-imports?status=${s}`}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium transition-colors ${
              s === status
                ? 'border-ember text-ember'
                : 'border-transparent text-salty-muted hover:text-salty-text'
            }`}
          >
            {LABELS[s]} ({counts[s].toLocaleString()})
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <ImportsTable rows={rows ?? []} showActions={status === 'pending'} />
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-salty-muted">
          <span>
            Page {pageNum} of {totalPages.toLocaleString()} · {totalForStatus.toLocaleString()} total
          </span>
          <div className="flex gap-3">
            {pageNum > 1 && (
              <Link href={`/pending-imports?status=${status}&sort=${sort}&dir=${dir}&page=${pageNum - 1}`} className="hover:text-ember">
                ← Previous
              </Link>
            )}
            {pageNum < totalPages && (
              <Link href={`/pending-imports?status=${status}&sort=${sort}&dir=${dir}&page=${pageNum + 1}`} className="hover:text-ember">
                Next →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
