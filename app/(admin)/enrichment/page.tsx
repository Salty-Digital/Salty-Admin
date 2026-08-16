import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ClickableRow } from '@/components/ui/clickable-row'
import { TriggerWorkerButton, RunReconcileButton, RetryKindButton, RetryJobButton } from './pipeline-actions'
import { ENRICHMENT_KINDS } from './kinds'
import { Activity, ListChecks, AlertTriangle, Clock, RefreshCw, Cog } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface SportsStat { ticket_id: string; league: string | null; sport: string | null; status: string | null; last_fetched_at: string | null }
interface Setlist { ticket_id: string; songs: unknown }
interface Job {
  ticket_id: string; kind: string; status: string
  attempts: number | null; max_attempts: number | null; next_attempt_at: string | null; last_error: string | null; updated_at: string | null
}

const KIND_LABEL: Record<string, string> = {
  geocode: 'Geocode', sports_result: 'Sports result', cast: 'Cast', setlist: 'Setlist', verify: 'Verify',
  lineup: 'Lineup', roster: 'Roster',
}
const STATUS_COLOR: Record<string, string> = { pending: '#C8A96E', done: '#3E8A5A', failed: '#BF4A3A' }

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

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - Date.parse(iso)
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

export default async function EnrichmentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin(3)
  const canViewEvent = admin.access_level <= 2
  const canAct = admin.access_level <= 2
  const { tab = 'coverage' } = await searchParams
  const active = tab === 'pipeline' ? 'pipeline' : 'coverage'
  const db = createServiceClient()

  return (
    <div className="p-7 space-y-6">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Enrichment</h1>
        <p className="text-[13px] text-salty-muted">Setlists, sports & cast coverage — plus the job queue and worker that produce them.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-salty-border">
        <TabLink href="/enrichment" label="Coverage" icon={ListChecks} active={active === 'coverage'} />
        <TabLink href="/enrichment?tab=pipeline" label="Pipeline" icon={Cog} active={active === 'pipeline'} />
      </div>

      {active === 'pipeline'
        ? await renderPipeline(db, canAct)
        : await renderCoverage(db, canViewEvent)}
    </div>
  )
}

function TabLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <Link
      href={href}
      className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13.5px] font-medium transition-colors ${
        active ? 'border-ember text-ember' : 'border-transparent text-salty-secondary hover:text-salty-text'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </Link>
  )
}

// ─────────────────────────────────────────── Pipeline tab ───────────────────────────────────────────

async function renderPipeline(db: ReturnType<typeof createServiceClient>, canAct: boolean) {
  const [{ data: jobsRaw }, { data: runsRaw }] = await Promise.all([
    db.from('enrichment_jobs').select('ticket_id, kind, status, attempts, max_attempts, next_attempt_at, last_error, updated_at').limit(50000),
    db.rpc('get_enrichment_worker_runs', { p_limit: 12 }),
  ])
  const jobs = (jobsRaw ?? []) as Job[]
  const now = Date.now()

  // (kind × status) matrix
  const matrix = new Map<string, Record<string, number>>()
  for (const k of ENRICHMENT_KINDS) matrix.set(k, { pending: 0, done: 0, failed: 0 })
  let totalPending = 0, totalFailed = 0, totalDone = 0
  for (const j of jobs) {
    const row = matrix.get(j.kind) ?? { pending: 0, done: 0, failed: 0 }
    row[j.status] = (row[j.status] ?? 0) + 1
    matrix.set(j.kind, row)
    if (j.status === 'pending') totalPending++
    else if (j.status === 'failed') totalFailed++
    else if (j.status === 'done') totalDone++
  }

  const failed = jobs.filter((j) => j.status === 'failed')
  const pending = jobs.filter((j) => j.status === 'pending')
  const dueNow = pending.filter((j) => !j.next_attempt_at || Date.parse(j.next_attempt_at) <= now)
  const scheduled = pending.filter((j) => j.next_attempt_at && Date.parse(j.next_attempt_at) > now)
  const stuck = scheduled.filter((j) => Date.parse(j.next_attempt_at!) > now + 3600_000) // >1h out
  const lastActivity = jobs.reduce<string | null>((max, j) => (j.updated_at && (!max || j.updated_at > max) ? j.updated_at : max), null)

  const failedByKind = new Map<string, number>()
  for (const j of failed) failedByKind.set(j.kind, (failedByKind.get(j.kind) ?? 0) + 1)

  // Resolve ticket titles for the drill-down rows (failed + stuck)
  const drillIds = [...new Set([...failed, ...stuck].map((j) => j.ticket_id))].slice(0, 200)
  const { data: dt } = drillIds.length ? await db.from('tickets').select('id, title, user_id').in('id', drillIds) : { data: [] }
  const titleMap = new Map((dt ?? []).map((t) => [t.id, t]))

  // Parse worker runs
  const runs = ((runsRaw ?? []) as { id: number; status_code: number | null; content: string; created: string }[]).map((r) => {
    let s: Record<string, { claimed?: number; found?: number; copied?: number; improved?: number; retried?: number; rekeyed?: number; merged?: number }> | null = null
    try { s = JSON.parse(r.content) } catch { s = null }
    // Read the kind list from the shared constant — this used to be a second hardcoded copy, so a
    // new kind silently went uncounted in the run totals until someone noticed the mismatch.
    const claimed = s ? ENRICHMENT_KINDS.reduce((n, k) => n + (s![k]?.claimed ?? 0), 0) : 0
    const copied = s ? ENRICHMENT_KINDS.reduce((n, k) => n + (s![k]?.copied ?? 0) + (s![k]?.improved ?? 0), 0) : 0
    return { id: r.id, status_code: r.status_code, created: r.created, claimed, copied, reconcile: s?.reconcile ?? null }
  })
  const lastReconcile = runs.find((r) => r.reconcile)?.reconcile ?? null

  return (
    <div className="space-y-6">
      {/* Heartbeat + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-[12.5px] text-salty-muted">
          <Activity className="h-4 w-4 text-ember" /> Worker cadence <span className="font-mono text-salty-secondary">*/10 min</span> · last job update {relTime(lastActivity)}
        </p>
        {canAct && (
          <div className="flex flex-wrap items-center gap-2">
            <TriggerWorkerButton />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending" value={totalPending} sub={`${dueNow.length} due now · ${scheduled.length} scheduled`} accent="#C8A96E" />
        <StatCard label="Failed" value={totalFailed} sub="need a retry or a fix" accent="#BF4A3A" />
        <StatCard label="Done" value={totalDone} sub="completed jobs" accent="#3E8A5A" />
        <StatCard label="Stuck (>1h out)" value={stuck.length} sub="scheduled far in the future" accent="#5A8FBF" />
      </div>

      {/* Queue matrix */}
      <Panel icon={ListChecks} title="Queue by kind × status">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Kind</th>
                {['pending', 'done', 'failed'].map((s) => (
                  <th key={s} className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] capitalize" style={{ color: STATUS_COLOR[s] }}>{s}</th>
                ))}
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Total</th>
              </tr>
            </thead>
            <tbody>
              {ENRICHMENT_KINDS.map((k) => {
                const row = matrix.get(k)!
                const total = row.pending + row.done + row.failed
                return (
                  <tr key={k} className="border-b border-salty-border last:border-0">
                    <td className="px-4 py-2.5 text-[13px] font-medium text-salty-text">{KIND_LABEL[k] ?? k}</td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-salty-secondary">{row.pending || <span className="text-salty-muted">—</span>}</td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-salty-secondary">{row.done || <span className="text-salty-muted">—</span>}</td>
                    <td className={`px-4 py-2.5 text-right text-[13px] font-semibold tabular-nums ${row.failed ? 'text-[#BF4A3A]' : 'text-salty-muted'}`}>{row.failed || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-[13px] font-semibold tabular-nums text-salty-text">{total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Reconcile */}
      <Panel icon={RefreshCw} title="Strong-ID reconcile" hint="re-key fuzzy events that gained a trusted id, merge the duplicates">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-[13px] text-salty-secondary">
            {lastReconcile
              ? <>Last worker pass: <span className="font-semibold text-salty-text">{lastReconcile.rekeyed ?? 0}</span> rekeyed · <span className="font-semibold text-salty-text">{lastReconcile.merged ?? 0}</span> merged.</>
              : 'No reconcile result in the recent worker runs.'}
          </p>
          {canAct && <RunReconcileButton />}
        </div>
      </Panel>

      {/* Failed jobs */}
      <Panel icon={AlertTriangle} title="Failed jobs" hint={`${failed.length} total`}>
        {failed.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-salty-muted">No failed jobs — the queue is clean.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-salty-border px-5 py-3">
              {[...failedByKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <span key={k} className="inline-flex items-center gap-2 rounded-lg bg-cream px-2.5 py-1">
                  <span className="text-[12px] font-medium text-salty-secondary">{KIND_LABEL[k] ?? k}: {n}</span>
                  {canAct && <RetryKindButton kind={k} count={n} />}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-salty-border bg-cream">
                    {['Ticket', 'Kind', 'Attempts', 'Last error', canAct ? '' : null].filter((h) => h !== null).map((h, i) => (
                      <th key={i} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {failed.slice(0, 100).map((j) => {
                    const t = titleMap.get(j.ticket_id)
                    return (
                      <tr key={`${j.ticket_id}-${j.kind}`} className="border-b border-salty-border last:border-0 hover:bg-cream">
                        <td className="px-4 py-2.5 max-w-[220px]"><p className="truncate text-[13px] font-medium text-salty-text">{t?.title ?? j.ticket_id.slice(0, 8)}</p></td>
                        <td className="px-4 py-2.5 text-[12px] text-salty-secondary">{KIND_LABEL[j.kind] ?? j.kind}</td>
                        <td className="px-4 py-2.5 text-[12px] tabular-nums text-salty-secondary">{j.attempts ?? 0}/{j.max_attempts ?? '—'}</td>
                        <td className="px-4 py-2.5 max-w-[280px]"><p className="truncate text-[11.5px] text-[#BF4A3A]" title={j.last_error ?? ''}>{j.last_error ?? '—'}</p></td>
                        {canAct && <td className="px-4 py-2.5 text-right"><RetryJobButton ticketId={j.ticket_id} kind={j.kind} /></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {/* Worker runs */}
      <Panel icon={Clock} title="Recent worker runs" hint="from the */10 enrichment-worker cron">
        {runs.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-salty-muted">No worker responses captured yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-salty-border bg-cream">
                  {['When', 'Status', 'Claimed', 'Copied/improved', 'Reconcile'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-salty-border last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[12.5px] text-salty-text" title={new Date(r.created).toLocaleString()}>{relTime(r.created)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${r.status_code === 200 ? 'bg-[#EAF4EE] text-[#3E8A5A]' : 'bg-[#FDEDED] text-[#BF4A3A]'}`}>{r.status_code ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] tabular-nums text-salty-secondary">{r.claimed}</td>
                    <td className={`px-4 py-2.5 text-[12.5px] tabular-nums ${r.copied > 0 ? 'font-semibold text-[#3E8A5A]' : 'text-salty-muted'}`}>{r.copied}</td>
                    <td className="px-4 py-2.5 text-[12px] text-salty-secondary">{r.reconcile ? `${r.reconcile.rekeyed ?? 0} rekeyed · ${r.reconcile.merged ?? 0} merged` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function Panel({ icon: Icon, title, hint, children }: { icon: React.ElementType; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
        <Icon className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {hint && <span className="text-[11.5px] text-salty-muted">· {hint}</span>}
      </div>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────── Coverage tab (existing) ───────────────────────────────────────────

async function renderCoverage(db: ReturnType<typeof createServiceClient>, canViewEvent: boolean) {
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

  const sportsCoverage = sportsTickets ? Math.round(stats.length / sportsTickets * 100) : 0
  const missingLeague = stats.filter((s) => !s.league)
  const missingSport = stats.filter((s) => !s.sport)
  const missingEither = stats.filter((s) => !s.league || !s.sport)
  const staleStats = stats.filter((s) => s.last_fetched_at && new Date(s.last_fetched_at).getTime() < THIRTY_DAYS_AGO)
  const statusCounts: Record<string, number> = {}
  for (const s of stats) statusCounts[s.status ?? 'unknown'] = (statusCounts[s.status ?? 'unknown'] ?? 0) + 1

  const setlistCoverage = concertTickets ? Math.round(setlists.length / concertTickets * 100) : 0
  const emptySetlists = setlists.filter((s) => !Array.isArray(s.songs) || (s.songs as unknown[]).length === 0)

  const problemStats = [...new Set([...missingEither, ...staleStats])].slice(0, 50)
  const problemIds = problemStats.map((s) => s.ticket_id)
  const { data: problemTickets } = problemIds.length > 0
    ? await db.from('tickets').select('id, title, user_id').in('id', problemIds)
    : { data: [] }
  const ticketMap: Record<string, { title: string | null; user_id: string }> = {}
  for (const t of problemTickets ?? []) ticketMap[t.id] = { title: t.title, user_id: t.user_id }

  return (
    <div className="space-y-6">
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
                  {['Ticket', 'League', 'Sport', 'Status', 'Last Fetched', 'User'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {problemStats.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-[13px] text-salty-muted">All sports stats look healthy</td></tr>
                ) : (
                  problemStats.map((s) => {
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
