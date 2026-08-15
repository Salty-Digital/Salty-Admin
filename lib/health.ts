import { createServiceClient } from '@/lib/supabase/server'
import { isConfigStatusConfigured, fetchMobileSecretStatus } from '@/lib/config-status'
import { countPendingImportUsers } from '@/lib/pending-imports'

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
  ranAt: string
}

/** Run every check. Safe to call from a request handler or a cron — nothing mutates. */
export async function runHealthChecks(): Promise<HealthReport> {
  const db = createServiceClient()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const [dbCheck, authCheck, mobile, edgeChecks, snapshot, ingestion] = await Promise.all([
    checkDatabase(db),
    checkAuth(db),
    loadMobile(),
    Promise.all(EDGE_FUNCTIONS.map((n) => pingEdge(n, url, anon))),
    loadSnapshot(db),
    loadIngestion(db),
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

  const envChecks: Check[] = CRITICAL_ENV.map((e) => ({
    name: e.name,
    status: process.env[e.name] ? 'ok' : 'warn',
    detail: process.env[e.name] ? e.desc : `not set — ${e.desc} unavailable`,
    advisory: true,
  }))

  const core = [dbCheck, authCheck, pipelineCheck(snapshot), enrichmentCheck(ingestion)]

  // Overall = worst of the runtime service checks; advisory warnings (env presence, and
  // mobile keys only when the bridge is up) can raise it to "degraded" but never "down".
  const runtime = [...core, ...edgeChecks, bridgeCheck]
  const advisory = [...envChecks, ...(bridgeUp ? mobileChecks : [])]
  const overall: Status = runtime.some((c) => c.status === 'down') ? 'down'
    : runtime.some((c) => c.status === 'warn') || advisory.some((c) => c.status === 'warn') ? 'warn'
    : 'ok'

  return {
    overall,
    checks: [...core, ...edgeChecks, bridgeCheck, ...envChecks, ...mobileChecks],
    core,
    edge: edgeChecks,
    env: envChecks,
    mobile: [bridgeCheck, ...mobileChecks],
    snapshot,
    ingestion,
    ranAt: new Date().toISOString(),
  }
}
