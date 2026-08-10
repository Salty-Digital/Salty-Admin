import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ClickableRow } from '@/components/ui/clickable-row'

interface SportsStat {
  ticket_id: string
  league: string | null
  sport: string | null
  status: string | null
  last_fetched_at: string | null
}

interface Setlist {
  ticket_id: string
  songs: unknown
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[14px]" style={{ background: accent }} />
      <p className="text-[12px] font-medium text-salty-muted">{label}</p>
      <p className="mt-1 font-sora text-[28px] font-bold text-salty-text leading-none">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-salty-muted">{sub}</p>}
    </div>
  )
}

export default async function EnrichmentPage() {
  const admin = await requireAdmin(3)
  const canViewEvent = admin.access_level <= 2 // /events/[id] requires level <= 2
  const db = createServiceClient()

  const THIRTY_DAYS_AGO = Date.now() - 30 * 86_400_000

  const [
    { count: sportsTickets },
    { count: concertTickets },
    { data: statsRaw },
    { data: setlistsRaw },
  ] = await Promise.all([
    db.from('tickets').select('*', { count: 'exact', head: true }).eq('category', 'sports'),
    db.from('tickets').select('*', { count: 'exact', head: true }).in('category', ['concert', 'festival']),
    db.from('sports_stats').select('ticket_id, league, sport, status, last_fetched_at'),
    db.from('setlists').select('ticket_id, songs'),
  ])

  const stats = (statsRaw ?? []) as SportsStat[]
  const setlists = (setlistsRaw ?? []) as Setlist[]

  // ── Sports coverage ──
  const sportsCoverage = sportsTickets ? Math.round(stats.length / sportsTickets * 100) : 0
  const missingLeague = stats.filter(s => !s.league)
  const missingSport = stats.filter(s => !s.sport)
  const missingEither = stats.filter(s => !s.league || !s.sport)
  const staleStats = stats.filter(s => s.last_fetched_at && new Date(s.last_fetched_at).getTime() < THIRTY_DAYS_AGO)
  const statusCounts: Record<string, number> = {}
  for (const s of stats) statusCounts[s.status ?? 'unknown'] = (statusCounts[s.status ?? 'unknown'] ?? 0) + 1

  // ── Setlist coverage ──
  const setlistCoverage = concertTickets ? Math.round(setlists.length / concertTickets * 100) : 0
  const emptySetlists = setlists.filter(s => !Array.isArray(s.songs) || (s.songs as unknown[]).length === 0)

  // Resolve ticket titles for the problem rows (sports missing league/sport, or stale)
  const problemStats = [...new Set([...missingEither, ...staleStats])].slice(0, 50)
  const problemIds = problemStats.map(s => s.ticket_id)
  const { data: problemTickets } = problemIds.length > 0
    ? await db.from('tickets').select('id, title, user_id').in('id', problemIds)
    : { data: [] }
  const ticketMap: Record<string, { title: string | null; user_id: string }> = {}
  for (const t of problemTickets ?? []) ticketMap[t.id] = { title: t.title, user_id: t.user_id }

  return (
    <div className="p-7 space-y-6">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Enrichment</h1>
        <p className="text-[13px] text-salty-muted">Sports stats and setlist data-quality across all tickets</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sports Coverage" value={`${sportsCoverage}%`} sub={`${stats.length} of ${sportsTickets ?? 0} sports tickets`} accent="#5A8FBF" />
        <StatCard label="Missing League / Sport" value={missingEither.length} sub={`${missingLeague.length} league · ${missingSport.length} sport`} accent="#BF4A3A" />
        <StatCard label="Stale Stats (>30d)" value={staleStats.length} accent="#C8A96E" />
        <StatCard label="Setlist Coverage" value={`${setlistCoverage}%`} sub={`${setlists.length} of ${concertTickets ?? 0} concert/festival`} accent="#7B44A8" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <div className="border-b border-salty-border px-5 py-4"><h2 className="font-sora text-[14px] font-bold text-salty-text">Sports Game Status</h2></div>
          {Object.keys(statusCounts).length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-salty-muted">No sports stats yet</p>
          ) : (
            Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between border-b border-salty-border px-5 py-3 last:border-0">
                <span className="text-[13px] capitalize text-salty-secondary">{status}</span>
                <span className="font-sora text-[15px] font-bold text-salty-text">{count}</span>
              </div>
            ))
          )}
        </div>

        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <div className="border-b border-salty-border px-5 py-4"><h2 className="font-sora text-[14px] font-bold text-salty-text">Setlists</h2></div>
          <div className="flex items-center justify-between border-b border-salty-border px-5 py-3"><span className="text-[13px] text-salty-secondary">Total setlists</span><span className="font-sora text-[15px] font-bold text-salty-text">{setlists.length}</span></div>
          <div className="flex items-center justify-between border-b border-salty-border px-5 py-3"><span className="text-[13px] text-salty-secondary">Empty (no songs)</span><span className="font-sora text-[15px] font-bold text-salty-text">{emptySetlists.length}</span></div>
          <div className="flex items-center justify-between px-5 py-3"><span className="text-[13px] text-salty-secondary">Concert/festival tickets without a setlist</span><span className="font-sora text-[15px] font-bold text-salty-text">{Math.max(0, (concertTickets ?? 0) - setlists.length)}</span></div>
        </div>
      </div>

      <div>
        <h2 className="font-sora text-[15px] font-bold text-salty-text mb-3">Sports Stats Needing Attention</h2>
        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-salty-border bg-cream">
                  {['Ticket', 'League', 'Sport', 'Status', 'Last Fetched', 'User'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {problemStats.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-salty-muted">All sports stats look healthy</td></tr>
                ) : (
                  problemStats.map(s => {
                    const t = ticketMap[s.ticket_id]
                    const cells = (
                      <>
                        <td className="px-4 py-3 text-[13px] font-medium text-salty-text max-w-[220px]"><p className="truncate">{t?.title ?? s.ticket_id.slice(0, 8)}</p></td>
                        <td className="px-4 py-3 text-[12px]">{s.league ?? <span className="text-[#BF4A3A]">missing</span>}</td>
                        <td className="px-4 py-3 text-[12px]">{s.sport ?? <span className="text-[#BF4A3A]">missing</span>}</td>
                        <td className="px-4 py-3 text-[12px] capitalize text-salty-secondary">{s.status ?? '—'}</td>
                        <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">{s.last_fetched_at ? new Date(s.last_fetched_at).toLocaleDateString() : 'never'}</td>
                        <td className="px-4 py-3 text-[12px]">
                          {t?.user_id ? <Link href={`/users/${t.user_id}`} className="text-salty-secondary hover:text-ember hover:underline">View</Link> : '—'}
                        </td>
                      </>
                    )
                    return canViewEvent ? (
                      <ClickableRow key={s.ticket_id} href={`/events/${s.ticket_id}`} ariaLabel={`View ${t?.title ?? 'event'} details`} className="border-b border-salty-border last:border-0 hover:bg-cream">
                        {cells}
                      </ClickableRow>
                    ) : (
                      <tr key={s.ticket_id} className="border-b border-salty-border last:border-0 hover:bg-cream">{cells}</tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
