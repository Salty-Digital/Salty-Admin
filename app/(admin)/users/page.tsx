import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { createV2Client, isV2Configured } from '@/lib/supabase/v2'
import { maskEmail } from '@/lib/privacy'
import { sanitizeOrFilterTerm } from '@/lib/validate'
import { Badge } from '@/components/ui/badge'
import { UserSearch } from './user-search'
import { SortLink } from '@/components/ui/sortable'
import { ExternalLink, Download } from 'lucide-react'

interface PageProps {
  searchParams: Promise<{ q?: string; zip?: string; tier?: string; page?: string; sort?: string; dir?: string }>
}

// Server-sortable columns → real DB columns (derived columns like Tickets aren't here).
const USER_SORT_COLS: Record<string, string> = {
  user: 'email',
  username: 'username',
  tier: 'tier',
  zip: 'zip_code',
  joined: 'created_at',
}

const PAGE_SIZE = 50
const TIERS = ['free', 'premium', 'family']
const TIER_COLORS: Record<string, string> = {
  free:    'bg-stone text-salty-muted',
  premium: 'bg-gold-light text-gold',
  family:  'bg-ember-light text-ember',
}

/** Source: team (@saltydigital.ai) / signup link (in v2 beta_signups) / external. `—` when v2 is off. */
function sourceBadge(src: 'team' | 'signup link' | 'external' | null) {
  if (!src) return <span className="text-[12px] text-salty-muted">—</span>
  const style = src === 'team' ? 'bg-[#EBF2FA] text-[#3A72A8]'
    : src === 'signup link' ? 'bg-[#EAF4EE] text-[#3E8A5A]'
      : 'bg-[#FFF8E6] text-[#8A6830]'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>{src}</span>
}

export default async function UsersPage({ searchParams }: PageProps) {
  const admin = await requireAdmin()
  const { q = '', zip = '', tier = '', page = '1', sort = '', dir = '' } = await searchParams
  const pageNum = Math.max(1, parseInt(page))
  const offset  = (pageNum - 1) * PAGE_SIZE
  const sortCol = USER_SORT_COLS[sort] ?? 'created_at'
  const ascending = USER_SORT_COLS[sort] ? dir === 'asc' : false

  const db = createServiceClient()

  let query = db
    .from('users')
    .select('id, email, username, display_name, tier, zip_code, created_at, banned_until', { count: 'exact' })
    .order(sortCol, { ascending })
    .range(offset, offset + PAGE_SIZE - 1)

  if (q) {
    const safeQ = sanitizeOrFilterTerm(q)
    if (safeQ) query = query.or(`email.ilike.%${safeQ}%,username.ilike.%${safeQ}%,display_name.ilike.%${safeQ}%`)
  }
  if (zip)  query = query.ilike('zip_code', `%${zip}%`)
  if (tier) query = query.eq('tier', tier)

  const { data: users, count } = await query
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  // Ticket counts + connection status
  // NOTE: only ever select user_id/provider here — gmail_connections.access_token/refresh_token
  // and imap_connections.password/imap_host are credentials and must never be queried in a list view.
  const ids = (users ?? []).map(u => u.id)
  const [{ data: ticketCounts }, { data: gmailConns }, { data: imapConns }] = await Promise.all([
    ids.length > 0 ? db.from('tickets').select('user_id') .in('user_id', ids) : Promise.resolve({ data: [] }),
    ids.length > 0 ? db.from('gmail_connections').select('user_id').in('user_id', ids) : Promise.resolve({ data: [] }),
    ids.length > 0 ? db.from('imap_connections').select('user_id, provider').in('user_id', ids) : Promise.resolve({ data: [] }),
  ])

  const ticketMap: Record<string, number> = {}
  for (const t of ticketCounts ?? []) ticketMap[t.user_id] = (ticketMap[t.user_id] ?? 0) + 1
  const gmailSet = new Set((gmailConns ?? []).map((g: { user_id: string }) => g.user_id))
  const imapMap = new Map((imapConns ?? []).map((c: { user_id: string; provider: string }) => [c.user_id, c.provider]))

  // Source classification — cross-reference this page's emails against the v2 beta_signups waitlist.
  // Assumes beta_signups.email is stored lowercased (typical); only queries the ~50 users shown.
  const pageEmails = (users ?? []).map(u => (u.email ?? '').trim().toLowerCase()).filter(Boolean)
  let betaSet: Set<string> | null = null
  if (isV2Configured() && pageEmails.length > 0) {
    try {
      const v2 = createV2Client()
      const { data, error } = await v2.from('beta_signups').select('email').in('email', pageEmails)
      if (!error) betaSet = new Set((data ?? []).map((r: { email: string | null }) => (r.email ?? '').trim().toLowerCase()).filter(Boolean))
    } catch { betaSet = null }
  }
  const classify = (email: string | null): 'team' | 'signup link' | 'external' | null => {
    const e = (email ?? '').trim().toLowerCase()
    if (!e) return null
    if (e.endsWith('@saltydigital.ai')) return 'team'
    if (!betaSet) return null
    return betaSet.has(e) ? 'signup link' : 'external'
  }

  return (
    <div className="p-7 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-sora text-[20px] font-bold text-salty-text">Users</h1>
          <p className="text-[13px] text-salty-muted">{count?.toLocaleString()} total users</p>
        </div>
        {admin.access_level <= 1 && (
          <a
            href={`/api/export/users?q=${encodeURIComponent(q)}&zip=${encodeURIComponent(zip)}&tier=${encodeURIComponent(tier)}`}
            className="flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-2 text-[12px] font-medium text-salty-secondary hover:bg-cream transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </a>
        )}
      </div>

      {/* Search + filters */}
      <UserSearch defaultQ={q} defaultZip={zip} defaultTier={tier} tiers={TIERS} />

      {/* Table */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                <SortLink label="User" sortKey="user" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Username" sortKey="username" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Tier" sortKey="tier" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Source</th>
                <SortLink label="Zip" sortKey="zip" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Tickets</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Connection</th>
                <SortLink label="Joined" sortKey="joined" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
              </tr>
            </thead>
            <tbody>
              {(users ?? []).length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-[13px] text-salty-muted">No users found</td></tr>
              ) : (
                (users ?? []).map(u => (
                  <tr key={u.id} className="border-b border-salty-border last:border-0 transition-colors hover:bg-cream cursor-default">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[13px] font-medium text-salty-text">{admin.access_level <= 2 ? u.email : maskEmail(u.email)}</p>
                        {u.banned_until && new Date(u.banned_until) > new Date() && (
                          <span className="rounded-full bg-[#FDEDED] px-2 py-0.5 text-[10px] font-semibold text-[#BF4A3A]">Banned</span>
                        )}
                      </div>
                      {u.display_name && <p className="text-[11px] text-salty-muted">{u.display_name}</p>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary">{u.username ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${TIER_COLORS[u.tier ?? 'free'] ?? 'bg-stone text-salty-muted'}`}>
                        {u.tier ?? 'free'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{sourceBadge(classify(u.email))}</td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary">{u.zip_code ?? '—'}</td>
                    <td className="px-4 py-3 text-[13px] text-salty-text font-medium">{ticketMap[u.id] ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {gmailSet.has(u.id) && (
                          <span className="rounded-full bg-[#EBF2FA] px-2 py-0.5 text-[10px] font-semibold text-[#3A72A8]">Gmail</span>
                        )}
                        {imapMap.has(u.id) && (
                          <span className="rounded-full bg-gold-light px-2 py-0.5 text-[10px] font-semibold capitalize text-gold">
                            {imapMap.get(u.id)}
                          </span>
                        )}
                        {!gmailSet.has(u.id) && !imapMap.has(u.id) && (
                          <span className="text-[12px] text-salty-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/users/${u.id}`} className="text-salty-muted hover:text-ember transition-colors">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-salty-muted">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-3">
            {pageNum > 1 && <Link href={`/users?q=${q}&zip=${zip}&tier=${tier}&sort=${sort}&dir=${dir}&page=${pageNum-1}`} className="hover:text-ember">← Previous</Link>}
            {pageNum < totalPages && <Link href={`/users?q=${q}&zip=${zip}&tier=${tier}&sort=${sort}&dir=${dir}&page=${pageNum+1}`} className="hover:text-ember">Next →</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
