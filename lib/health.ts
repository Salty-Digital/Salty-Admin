import { createServiceClient } from '@/lib/supabase/server'
import { isConfigStatusConfigured, fetchMobileSecretStatus } from '@/lib/config-status'
import { countPendingImportUsers } from '@/lib/pending-imports'
import kbCorpus from '@/lib/kb/corpus.generated.json'

/**
 * The health checks, extracted from the /health page so the cron job
 * (/api/cron/health) runs exactly what the page renders. Two implementations would
 * drift, and a monitor that disagrees with the dashboard is worse than none.
 *
 * Everything here is read-only — no check mutates state or triggers real work.
 */

export type Status = 'ok' | 'warn' | 'down'

export interface Check {
  name: string
  status: Status
  detail: string
  /**
   * Advisory checks (env-var presence, mobile keys) can raise the overall status to
   * "degraded" but never to "down", and they never open an incident on their own —
   * a missing optional key is a to-do, not an outage.
   */
  advisory?: boolean
}

type Db = ReturnType<typeof createServiceClient>

// Key edge functions the admin panel and app depend on. We only check reachability
// (is it deployed and answering), never trigger real work — an empty body makes each
// one validate-and-return without side effects.
export const EDGE_FUNCTIONS = [
  'sports-score-lookup',
  'enrich-cast',
  'enrich-lineup',
  'setlist-lookup',
  'geocode-venues',
  'config-status',
]

// The admin panel's own environment.
const CRITICAL_ENV: { name: string; desc: string }[] = [
  { name: 'SUPABASE_SERVICE_KEY',       desc: 'Core data access (all server queries)' },
  { name: 'SUPABASE_SERVICE_ROLE_JWT',  desc: 'Edge-function invocation — Fetch cast / result' },
  { name: 'ANTHROPIC_API_KEY',          desc: 'AI lookup on Manual Edit' },
  { name: 'RESEND_API_KEY',             desc: 'Admin invites & user email' },
  { name: 'POSTHOG_API_KEY',            desc: 'Build Adoption & Engagement analytics' },
]

// The mobile app's integration keys, reported (presence only) by the config-status
// edge function in the mobile Supabase project. These power the app's enrichment.
const MOBILE_INTEGRATIONS: { name: string; desc: string }[] = [
  { name: 'TICKETMASTER_API_KEY', desc: 'Ticketmaster — event enrichment' },
  { name: 'THESPORTSDB_API_KEY',  desc: 'TheSportsDB — sports scores & metadata' },
  { name: 'SETLISTFM_API_KEY',    desc: 'setlist.fm — concert setlists' },
  { name: 'ANTHROPIC_API_KEY',    desc: 'Anthropic — import classifier / AI' },
  { name: 'GOOGLE_CLIENT_ID',     desc: 'Google OAuth — Gmail connect' },
]

async function checkDatabase(db: Db): Promise<Check> {
  const t0 = Date.now()
  const { error } = await db.from('users').select('id', { count: 'exact', head: true })
  const ms = Date.now() - t0
  if (error) return { name: 'Database (Postgres)', status: 'down', detail: error.message }
  return { name: 'Database (Postgres)', status: ms > 1200 ? 'warn' : 'ok', detail: `responded in ${ms} ms` }
}

async function checkAuth(db: Db): Promise<Check> {
  const t0 = Date.now()
  const { error } = await db.auth.admin.listUsers({ page: 1, perPage: 1 })
  const ms = Date.now() - t0
  if (error) return { name: 'Auth (GoTrue)', status: 'down', detail: error.message }
  return { name: 'Auth (GoTrue)', status: ms > 1500 ? 'warn' : 'ok', detail: `responded in ${ms} ms` }
}

async function pingEdge(name: string, url?: string, anon?: string): Promise<Check> {
  if (!url || !anon) return { name, status: 'warn', detail: 'Supabase URL / anon key not configured', advisory: true }
  const t0 = Date.now()
  try {
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: '{}',
      signal: AbortSignal.timeout(6000),
    })
    const ms = Date.now() - t0
    // Any HTTP answer other than 404 means the function is deployed and responding — a
    // 400/401 from validating our empty body is still "up". Only 404 = not deployed.
    if (res.status === 404) return { name, status: 'down', detail: 'not deployed (404)' }
    return { name, status: 'ok', detail: `reachable · HTTP ${res.status} · ${ms} ms` }
  } catch {
    return { name, status: 'down', detail: 'unreachable / timed out' }
  }
}

// One trip to the mobile config-status bridge, reused for the bridge check and the
// per-integration rows below.
async function loadMobile(): Promise<{ configured: boolean; known: Record<string, boolean> | null; error: string | null }> {
  if (!isConfigStatusConfigured()) return { configured: false, known: null, error: null }
  try {
    const { known } = await fetchMobileSecretStatus()
    return { configured: true, known, error: null }
  } catch (e) {
    return { configured: true, known: null, error: (e as Error).message }
  }
}

export interface Snapshot {
  users: number
  tickets: number
  photos: number
  pending: number
  /** Distinct users who have at least one unreviewed import. */
  pendingUsers: number
  imports24: number
  signups7d: number
  approved24: number
  rejected24: number
}

async function loadSnapshot(db: Db): Promise<Snapshot> {
  const head = { count: 'exact' as const, head: true }
  const sinceH = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const [users, tickets, photos, pending, pendingUsers, imports24, signups7d, approved24, rejected24] = await Promise.all([
    db.from('users').select('id', head),
    db.from('tickets').select('id', head),
    db.from('photos').select('id', head),
    db.from('pending_imports').select('id', head).eq('status', 'pending'),
    countPendingImportUsers(db),
    db.from('tickets').select('id', head).gte('imported_at', sinceH(24)),
    db.from('users').select('id', head).gte('created_at', sinceH(24 * 7)),
    db.from('pending_imports').select('id', head).eq('status', 'approved').gte('created_at', sinceH(24)),
    db.from('pending_imports').select('id', head).eq('status', 'rejected').gte('created_at', sinceH(24)),
  ])
  return {
    users: users.count ?? 0, tickets: tickets.count ?? 0, photos: photos.count ?? 0,
    pending: pending.count ?? 0, pendingUsers, imports24: imports24.count ?? 0,
    signups7d: signups7d.count ?? 0,
    approved24: approved24.count ?? 0, rejected24: rejected24.count ?? 0,
  }
}

// Scan-run ingestion telemetry (last 7d): the funnel from listed → accepted, the outcome
// mix (most scheduled sweeps are no_connection/imap_connect_failed and expected), and the
// current enrichment backlog. Aggregated in JS — the window is a few hundred rows.
export const OUTCOME_LABEL: Record<string, string> = {
  ok: 'OK', no_connection: 'No connection', imap_connect_failed: 'IMAP connect failed',
  error: 'Error', empty: 'Empty', partial: 'Partial',
}

/**
 * Per-source scan health, straight from the `scan_cron_health` view.
 *
 * The view exists precisely because the scan cron was once silently down for ~3 weeks and the
 * aggregate funnel below could not show it — a source that stops running contributes nothing, and
 * "nothing" looks identical to "quiet". It separates the two states that matter:
 *
 *   cron_silent        no run of ANY outcome in 1h  → the scheduler isn't reaching this source
 *   no_recent_success  no `ok` run in 2h            → running, but not completing successfully
 *
 * Only `cron_silent` drives the check. `no_recent_success` is expected whenever nobody has a linked
 * inbox — the dispatcher still records a `no_connection` run per sweep, so the source is healthy
 * while never producing an `ok`. Treating that as an incident would keep the alert permanently on.
 */
export interface ScanSource {
  source: string
  total_runs: number
  ok_runs: number
  last_ok_at: string | null
  last_run_at: string | null
  cron_silent: boolean
  no_recent_success: boolean
}

async function loadScanSources(db: Db): Promise<ScanSource[]> {
  // One row per source — far below any row cap, so a plain select is safe here.
  const { data } = await db
    .from('scan_cron_health')
    .select('source, total_runs, ok_runs, last_ok_at, last_run_at, cron_silent, no_recent_success')
  return ((data ?? []) as ScanSource[]).sort((a, b) => a.source.localeCompare(b.source))
}

/** "12m ago" / "8h ago" / "8d ago" / "never". Exported so the check detail and the page render the
 *  same string — this file's whole premise is that the monitor and the dashboard cannot drift. */
export const sinceText = (iso: string | null): string => {
  if (!iso) return 'never'
  const hrs = (Date.now() - Date.parse(iso)) / 3_600_000
  if (hrs < 1) return `${Math.max(1, Math.round(hrs * 60))}m ago`
  if (hrs < 48) return `${Math.round(hrs)}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/**
 * A scan source whose scheduler has gone quiet. This is the check the 3-week outage needed.
 *
 * `warn`, not `down`: this is one ingestion source rather than a hard service failure, and the
 * remediation is a human looking at a connection, not a restart. The detail names the source and
 * how long it has been silent so the judgement can be made without opening SQL.
 */
function scanCronCheck(sources: ScanSource[]): Check {
  if (sources.length === 0) {
    return { name: 'Scan cron', status: 'warn', detail: 'no scan_runs rows at all — the dispatcher has never recorded a run' }
  }
  const silent = sources.filter((s) => s.cron_silent)
  const detail = sources
    .map((s) => `${s.source}: last run ${sinceText(s.last_run_at)}, last ok ${sinceText(s.last_ok_at)}`)
    .join(' · ')
  if (silent.length > 0) {
    const names = silent.map((s) => `${s.source} (silent ${sinceText(s.last_run_at)})`).join(', ')
    return { name: 'Scan cron', status: 'warn', detail: `${names} — scheduler not reaching this source. ${detail}` }
  }
  return { name: 'Scan cron', status: 'ok', detail }
}

/**
 * Knowledge-base corpus freshness.
 *
 * The assistant answers from a snapshot committed by `npm run kb:index`. A stale snapshot fails
 * silently and confidently — it describes a system that has moved on — which is the exact failure
 * mode everything else on this page exists to catch, so it gets a check of its own.
 *
 * Advisory: an out-of-date doc corpus is a to-do, not an outage, and must never open an incident.
 */
function corpusCheck(): Check {
  const generatedAt = (kbCorpus as { generatedAt?: string }).generatedAt
  if (!generatedAt) {
    return { name: 'KB corpus', status: 'warn', detail: 'no corpus committed — run npm run kb:index', advisory: true }
  }
  const days = Math.floor((Date.now() - Date.parse(generatedAt)) / 86_400_000)
  const detail = `indexed ${days === 0 ? 'today' : `${days}d ago`} · ${(kbCorpus as { edgeFunctions: unknown[] }).edgeFunctions.length} edge functions`
  // 30 days: long enough not to nag through a quiet month, short enough that a refactor-heavy
  // stretch surfaces before the assistant starts answering from a system that no longer exists.
  if (days >= 30) {
    return { name: 'KB corpus', status: 'warn', detail: `${detail} — stale, run npm run kb:index`, advisory: true }
  }
  return { name: 'KB corpus', status: 'ok', detail, advisory: true }
}

export interface Ingestion {
  runCount: number
  outcomes: [string, number][]
  funnel: { listed: number; fetched: number; passed_filter: number; accepted: number; non_ticket: number; fetch_failed: number }
  enrichPending: number
  enrichFailed: number
  /** Failed jobs that still have retries left — the ones a retry can actually help. */
  enrichRetryable: number
  /**
   * Failed jobs past `max_attempts`. These are dead-lettered: the input itself is bad
   * (an unresolvable venue string, a URL where a venue name should be), so retrying
   * produces the identical failure forever. They need a data fix, not a retry.
   */
  enrichExhausted: number
}

async function loadIngestion(db: Db): Promise<Ingestion> {
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [runsRes, pendingRes, failedRes] = await Promise.all([
    db.from('scan_runs').select('outcome, listed, fetched, passed_filter, accepted, non_ticket, fetch_failed').gte('started_at', since7d).limit(5000),
    db.from('enrichment_jobs').select('ticket_id', { count: 'exact', head: true }).eq('status', 'pending'),
    // Rows rather than a head count: the retryable/exhausted split below is what decides
    // whether this is an incident or a standing data-quality backlog.
    db.from('enrichment_jobs').select('attempts, max_attempts', { count: 'exact' }).eq('status', 'failed').limit(1000),
  ])
  const failedRows = (failedRes.data ?? []) as { attempts: number | null; max_attempts: number | null }[]
  const enrichRetryable = failedRows.filter((r) => (r.attempts ?? 0) < (r.max_attempts ?? 0)).length
  const enrichExhausted = failedRows.length - enrichRetryable
  const rows = (runsRes.data ?? []) as { outcome: string | null; listed: number | null; fetched: number | null; passed_filter: number | null; accepted: number | null; non_ticket: number | null; fetch_failed: number | null }[]
  const outcomes = new Map<string, number>()
  const funnel = { listed: 0, fetched: 0, passed_filter: 0, accepted: 0, non_ticket: 0, fetch_failed: 0 }
  for (const r of rows) {
    outcomes.set(r.outcome ?? 'unknown', (outcomes.get(r.outcome ?? 'unknown') ?? 0) + 1)
    funnel.listed += r.listed ?? 0
    funnel.fetched += r.fetched ?? 0
    funnel.passed_filter += r.passed_filter ?? 0
    funnel.accepted += r.accepted ?? 0
    funnel.non_ticket += r.non_ticket ?? 0
    funnel.fetch_failed += r.fetch_failed ?? 0
  }
  return {
    runCount: rows.length,
    outcomes: [...outcomes.entries()].sort((a, b) => b[1] - a[1]),
    funnel,
    enrichPending: pendingRes.count ?? 0,
    enrichFailed: failedRes.count ?? 0,
    enrichRetryable,
    enrichExhausted,
  }
}

// Import pipeline health from the last 24h of reviews. A high reject rate is a real signal
// (parser/classifier regressions); the pending backlog is shown but doesn't flip to warning.
function pipelineCheck(snap: Snapshot): Check {
  const reviewed = snap.approved24 + snap.rejected24
  const rejectRate = reviewed > 0 ? Math.round((snap.rejected24 / reviewed) * 100) : 0
  const detail = `${snap.approved24} approved / ${snap.rejected24} rejected (24h) · ${snap.pending.toLocaleString()} unreviewed events`
  if (reviewed >= 10 && rejectRate > 60) return { name: 'Import pipeline', status: 'warn', detail: `${rejectRate}% rejected in 24h — ${detail}` }
  return { name: 'Import pipeline', status: 'ok', detail }
}

// The enrichment worker's failed-job backlog.
//
// Only RETRYABLE failures drive the alert. Jobs past max_attempts are dead-lettered — their
// input is bad, so they fail identically forever, and counting them would keep the incident
// permanently open and re-fire it after every retry. They're reported in the detail line so
// they stay visible as a data-quality backlog without pretending to be an outage.
function enrichmentCheck(ing: Ingestion): Check {
  const parts = [`${ing.enrichPending.toLocaleString()} pending`]
  if (ing.enrichRetryable) parts.push(`${ing.enrichRetryable.toLocaleString()} failed (retryable)`)
  if (ing.enrichExhausted) parts.push(`${ing.enrichExhausted.toLocaleString()} dead-lettered — needs a data fix, not a retry`)
  if (!ing.enrichRetryable && !ing.enrichExhausted) parts.push('0 failed')
  const detail = parts.join(' · ')
  if (ing.enrichRetryable >= 25) return { name: 'Enrichment backlog', status: 'warn', detail }
  return { name: 'Enrichment backlog', status: 'ok', detail }
}

export interface HealthReport {
  overall: Status
  /** Everything, in display order. */
  checks: Check[]
  core: Check[]
  edge: Check[]
  env: Check[]
  mobile: Check[]
  snapshot: Snapshot
  ingestion: Ingestion
  scanSources: ScanSource[]
  ranAt: string
}

/** Run every check. Safe to call from a request handler or a cron — nothing mutates. */
export async function runHealthChecks(): Promise<HealthReport> {
  const db = createServiceClient()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const [dbCheck, authCheck, mobile, edgeChecks, snapshot, ingestion, scanSources] = await Promise.all([
    checkDatabase(db),
    checkAuth(db),
    loadMobile(),
    Promise.all(EDGE_FUNCTIONS.map((n) => pingEdge(n, url, anon))),
    loadSnapshot(db),
    loadIngestion(db),
    loadScanSources(db),
  ])

  const bridgeCheck: Check = !mobile.configured
    ? { name: 'Mobile config bridge', status: 'warn', detail: 'CONFIG_STATUS_SECRET not set — app secrets can’t be checked', advisory: true }
    : mobile.error
      ? { name: 'Mobile config bridge', status: 'down', detail: mobile.error.slice(0, 200) }
      : { name: 'Mobile config bridge', status: 'ok', detail: `reporting ${Object.keys(mobile.known ?? {}).length} known secrets` }

  const bridgeUp = mobile.configured && !mobile.error && !!mobile.known
  const mobileChecks: Check[] = MOBILE_INTEGRATIONS.map((m) => {
    if (!mobile.configured) return { name: m.name, status: 'warn', detail: 'config bridge not set up', advisory: true }
    if (!bridgeUp)          return { name: m.name, status: 'down', detail: 'config bridge unreachable', advisory: true }
    const set = Boolean(mobile.known![m.name])
    return { name: m.name, status: set ? 'ok' : 'warn', detail: set ? m.desc : `not set — ${m.desc} unavailable`, advisory: true }
  })

  const corpus = corpusCheck()

  const envChecks: Check[] = CRITICAL_ENV.map((e) => ({
    name: e.name,
    status: process.env[e.name] ? 'ok' : 'warn',
    detail: process.env[e.name] ? e.desc : `not set — ${e.desc} unavailable`,
    advisory: true,
  }))

  const core = [dbCheck, authCheck, scanCronCheck(scanSources), pipelineCheck(snapshot), enrichmentCheck(ingestion)]

  // Overall = worst of the runtime service checks; advisory warnings (env presence, and
  // mobile keys only when the bridge is up) can raise it to "degraded" but never "down".
  const runtime = [...core, ...edgeChecks, bridgeCheck]
  const advisory = [...envChecks, corpus, ...(bridgeUp ? mobileChecks : [])]
  const overall: Status = runtime.some((c) => c.status === 'down') ? 'down'
    : runtime.some((c) => c.status === 'warn') || advisory.some((c) => c.status === 'warn') ? 'warn'
    : 'ok'

  return {
    overall,
    checks: [...core, ...edgeChecks, bridgeCheck, ...envChecks, corpus, ...mobileChecks],
    core,
    edge: edgeChecks,
    env: [...envChecks, corpus],
    mobile: [bridgeCheck, ...mobileChecks],
    snapshot,
    ingestion,
    scanSources,
    ranAt: new Date().toISOString(),
  }
}
