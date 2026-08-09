import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { TicketsClient } from './tickets-client'
import { Download } from 'lucide-react'

interface PageProps {
  searchParams: Promise<{ q?: string; category?: string; source?: string; status?: string; page?: string; sort?: string; dir?: string }>
}

const PAGE_SIZE = 50

// Server-sortable columns → DB columns (User/email is resolved post-query, so not here).
const TICKET_SORT_COLS: Record<string, string> = {
  title: 'title',
  venue: 'venue_name',
  date: 'date_str',
  category: 'category',
  source: 'source',
  price: 'price_paid',
}

export default async function TicketsPage({ searchParams }: PageProps) {
  const admin = await requireAdmin(3)
  const { q = '', category = '', source = '', status = '', page = '1', sort = '', dir = '' } = await searchParams
  const pageNum = Math.max(1, parseInt(page))
  const offset = (pageNum - 1) * PAGE_SIZE
  const sortCol = TICKET_SORT_COLS[sort] ?? 'imported_at'
  const ascending = TICKET_SORT_COLS[sort] ? dir === 'asc' : false
  const db = createServiceClient()

  // Build query
  let query = db
    .from('tickets')
    .select('id, user_id, title, venue_name, date_str, time_str, category, source, status, confidence, price_paid, price_currency, imported_at', { count: 'exact' })
    .order(sortCol, { ascending })
    .range(offset, offset + PAGE_SIZE - 1)

  if (category) query = query.eq('category', category)
  if (source)   query = query.eq('source', source)
  if (status)   query = query.eq('status', status)

  const { data: tickets, count } = await query

  // Resolve user emails
  const userIds = [...new Set((tickets ?? []).map(t => t.user_id))]
  const { data: users } = userIds.length > 0
    ? await db.from('users').select('id, email').in('id', userIds)
    : { data: [] }

  const emailMap: Record<string, string> = {}
  for (const u of users ?? []) emailMap[u.id] = u.email

  // Search filter on title/venue/email (post-filter since Supabase text search is limited)
  let enriched = (tickets ?? []).map(t => ({
    ...t,
    user_email: emailMap[t.user_id] ?? '—',
  }))

  if (q) {
    const lower = q.toLowerCase()
    enriched = enriched.filter(
      t => t.title?.toLowerCase().includes(lower)
        || t.venue_name?.toLowerCase().includes(lower)
        || t.user_email.toLowerCase().includes(lower),
    )
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="p-7 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-sora text-[20px] font-bold text-salty-text">Tickets</h1>
          <p className="text-[13px] text-salty-muted">{count?.toLocaleString()} total tickets across all users</p>
        </div>
        {admin.access_level <= 1 && (
          <a
            href={`/api/export/tickets?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&source=${encodeURIComponent(source)}&status=${encodeURIComponent(status)}`}
            className="flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-2 text-[12px] font-medium text-salty-secondary hover:bg-cream transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </a>
        )}
      </div>

      <TicketsClient
        tickets={enriched}
        filters={{ q, category, source, status }}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-salty-muted">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-3">
            {pageNum > 1 && (
              <Link href={`/tickets?q=${q}&category=${category}&source=${source}&status=${status}&sort=${sort}&dir=${dir}&page=${pageNum - 1}`}
                className="hover:text-ember">← Previous</Link>
            )}
            {pageNum < totalPages && (
              <Link href={`/tickets?q=${q}&category=${category}&source=${source}&status=${status}&sort=${sort}&dir=${dir}&page=${pageNum + 1}`}
                className="hover:text-ember">Next →</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
