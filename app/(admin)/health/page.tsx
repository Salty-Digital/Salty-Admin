import Link from 'next/link'
import {
  HeartPulse, Database, Server, KeyRound, Boxes, Smartphone,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, ScanLine,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isConfigStatusConfigured, fetchMobileSecretStatus } from '@/lib/config-status'
import { HealthRefresher } from './health-refresher'

// A health page must reflect live state, never a cached render.
export const dynamic = 'force-dynamic'

type Status = 'ok' | 'warn' | 'down'
interface Check { name: string; status: Status; detail: string }

type Db = ReturnType<typeof createServiceClient>

// Key edge functions the admin panel and app depend on. We only check reachability
// (is it deployed and answering), never trigger real work — an empty body makes each
// one validate-and-return without side effects.
const EDGE_FUNCTIONS = ['sports-score-lookup', 'enrich-cast', 'setlist-lookup', 'geocode-venues', 'config-status']

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
  if (!url || !anon) return { name, status: 'warn', detail: 'Supabase URL / anon key not configured' }
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

async function loadSnapshot(db: Db) {
  const head = { count: 'exact' as const, head: true }
  const sinceH = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const [users, tickets, photos, pending, imports24, signups7d, approved24, rejected24] = await Promise.all([
    db.from('users').select('id', head),
    db.from('tickets').select('id', head),
    db.from('photos').select('id', head),
    db.from('pending_imports').select('id', head).eq('status', 'pending'),
    db.from('tickets').select('id', head).gte('imported_at', sinceH(24)),
    db.from('users').select('id', head).gte('created_at', sinceH(24 * 7)),
    db.from('pending_imports').select('id', head).eq('status', 'approved').gte('created_at', sinceH(24)),
    db.from('pending_imports').select('id', head).eq('status', 'rejected').gte('created_at', sinceH(24)),
  ])
  return {
    users: users.count ?? 0, tickets: tickets.count ?? 0, photos: photos.count ?? 0,
    pending: pending.count ?? 0, imports24: imports24.count ?? 0, signups7d: signups7d.count ?? 0,
    approved24: approved24.count ?? 0, rejected24: rejected24.count ?? 0,
  }
}

// Scan-run ingestion telemetry (last 7d): the funnel from listed → accepted, the outcome
// mix (most scheduled sweeps are no_connection/imap_connect_failed and expected), and the
// current enrichment backlog. Aggregated in JS — the window is a few hundred rows.
const OUTCOME_LABEL: Record<string, string> = {
  ok: 'OK', no_connection: 'No connection', imap_connect_failed: 'IMAP connect failed',
  error: 'Error', empty: 'Empty', partial: 'Partial',
}
async function loadIngestion(db: Db) {
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [runsRes, pendingRes, failedRes] = await Promise.all([
    db.from('scan_runs').select('outcome, listed, fetched, passed_filter, accepted, non_ticket, fetch_failed').gte('started_at', since7d).limit(5000),
    db.from('enrichment_jobs').select('ticket_id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('enrichment_jobs').select('ticket_id', { count: 'exact', head: true }).eq('status', 'failed'),
  ])
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
  }
}

// Import pipeline health from the last 24h of reviews. A high reject rate is a real signal
// (parser/classifier regressions); the pending backlog is shown but doesn't flip to warning.
function pipelineCheck(snap: { approved24: number; rejected24: number; pending: number }): Check {
  const reviewed = snap.approved24 + snap.rejected24
  const rejectRate = reviewed > 0 ? Math.round((snap.rejected24 / reviewed) * 100) : 0
  const detail = `${snap.approved24} approved / ${snap.rejected24} rejected (24h) · ${snap.pending.toLocaleString()} pending review`
  if (reviewed >= 10 && rejectRate > 60) return { name: 'Import pipeline', status: 'warn', detail: `${rejectRate}% rejected in 24h — ${detail}` }
  return { name: 'Import pipeline', status: 'ok', detail }
}

export default async function HealthPage() {
  await requireAdmin(1)
  const db = createServiceClient()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const [dbCheck, authCheck, mobile, edgeChecks, snap, ingestion] = await Promise.all([
    checkDatabase(db),
    checkAuth(db),
    loadMobile(),
    Promise.all(EDGE_FUNCTIONS.map((n) => pingEdge(n, url, anon))),
    loadSnapshot(db),
    loadIngestion(db),
  ])

  const bridgeCheck: Check = !mobile.configured
    ? { name: 'Mobile config bridge', status: 'warn', detail: 'CONFIG_STATUS_SECRET not set — app secrets can’t be checked' }
    : mobile.error
      ? { name: 'Mobile config bridge', status: 'down', detail: mobile.error.slice(0, 100) }
      : { name: 'Mobile config bridge', status: 'ok', detail: `reporting ${Object.keys(mobile.known ?? {}).length} known secrets` }

  const bridgeUp = mobile.configured && !mobile.error && !!mobile.known
  const mobileChecks: Check[] = MOBILE_INTEGRATIONS.map((m) => {
    if (!mobile.configured) return { name: m.name, status: 'warn', detail: 'config bridge not set up' }
    if (!bridgeUp)          return { name: m.name, status: 'down', detail: 'config bridge unreachable' }
    const set = Boolean(mobile.known![m.name])
    return { name: m.name, status: set ? 'ok' : 'warn', detail: set ? m.desc : `not set — ${m.desc} unavailable` }
  })

  const envChecks: Check[] = CRITICAL_ENV.map((e) => ({
    name: e.name,
    status: process.env[e.name] ? 'ok' : 'warn',
    detail: process.env[e.name] ? e.desc : `not set — ${e.desc} unavailable`,
  }))

  const pipeline = pipelineCheck(snap)

  // Overall = worst of the runtime service checks; advisory warnings (env presence, and
  // mobile keys only when the bridge is up) can raise it to "degraded" but never "down".
  const runtime = [dbCheck, authCheck, pipeline, ...edgeChecks, bridgeCheck]
  const advisory = [...envChecks, ...(bridgeUp ? mobileChecks : [])]
  const overall: Status = runtime.some((c) => c.status === 'down') ? 'down'
    : runtime.some((c) => c.status === 'warn') || advisory.some((c) => c.status === 'warn') ? 'warn'
    : 'ok'

  const overallCopy = {
    ok:   { title: 'All systems operational', sub: 'Every runtime check passed.' },
    warn: { title: 'Degraded — some checks need attention', sub: 'The project is up, but one or more checks are warning.' },
    down: { title: 'Outage — a core service is down', sub: 'At least one critical check failed.' },
  }[overall]

  return (
    <div className="p-7 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
            <HeartPulse className="h-5 w-5 text-ember" /> Project Health
          </h1>
          <p className="text-[13px] text-salty-muted">Live status of the admin panel and the Salty app.</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-salty-muted">
            <RefreshCw className="h-3.5 w-3.5" /> {new Date().toLocaleTimeString()}
          </p>
          <HealthRefresher seconds={30} />
        </div>
      </div>

      {/* Overall banner */}
      <div className={`flex items-center gap-3 rounded-[14px] border p-4 ${BANNER[overall]}`}>
        <StatusIcon status={overall} className="h-6 w-6 shrink-0" />
        <div>
          <p className="font-sora text-[15px] font-bold">{overallCopy.title}</p>
          <p className="text-[12.5px] opacity-90">{overallCopy.sub}</p>
        </div>
      </div>

      <CheckSection icon={Database} title="Core services" checks={[dbCheck, authCheck, pipeline]} />
      <CheckSection icon={Server} title="Edge functions" checks={edgeChecks} />
      <CheckSection
        icon={KeyRound}
        title="Admin panel — environment"
        checks={envChecks}
        footer={<>Presence only — secret values are never read. Full list on <Link href="/settings/config" className="font-medium text-ember hover:underline">Config Status</Link>.</>}
      />
      <CheckSection
        icon={Smartphone}
        title="Mobile app — integrations"
        checks={[bridgeCheck, ...mobileChecks]}
        footer={<>App enrichment keys, reported by the mobile project’s config-status function (presence only).</>}
      />

      {/* App activity & data */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
          <Boxes className="h-4 w-4 text-ember" />
          <h2 className="font-sora text-[14px] font-bold text-salty-text">App activity &amp; data</h2>
        </div>
        <div className="grid grid-cols-2 gap-px bg-salty-border sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Users', value: snap.users },
            { label: 'Tickets', value: snap.tickets },
            { label: 'Photos', value: snap.photos },
            { label: 'Imports · 24h', value: snap.imports24 },
            { label: 'New signups · 7d', value: snap.signups7d },
            { label: 'Pending imports', value: snap.pending },
          ].map((s) => (
            <div key={s.label} className="bg-warm-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{s.label}</p>
              <p className="mt-1 font-sora text-[22px] font-bold text-salty-text">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Scan runs & ingestion */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
          <ScanLine className="h-4 w-4 text-ember" />
          <h2 className="font-sora text-[14px] font-bold text-salty-text">Scan runs &amp; ingestion</h2>
          <span className="text-[11.5px] text-salty-muted">· last 7 days · {ingestion.runCount.toLocaleString()} runs</span>
          <Link href="/enrichment?tab=pipeline" className="ml-auto text-[12px] font-medium text-ember hover:underline">Enrichment pipeline →</Link>
        </div>
        {/* Funnel: listed → accepted */}
        <div className="grid grid-cols-2 gap-px bg-salty-border sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Listed', value: ingestion.funnel.listed },
            { label: 'Fetched', value: ingestion.funnel.fetched },
            { label: 'Passed filter', value: ingestion.funnel.passed_filter },
            { label: 'Accepted', value: ingestion.funnel.accepted, tone: 'good' as const },
            { label: 'Non-ticket', value: ingestion.funnel.non_ticket },
            { label: 'Fetch failed', value: ingestion.funnel.fetch_failed, tone: ingestion.funnel.fetch_failed > 0 ? ('bad' as const) : undefined },
          ].map((s) => (
            <div key={s.label} className="bg-warm-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{s.label}</p>
              <p className={`mt-1 font-sora text-[20px] font-bold ${s.tone === 'bad' ? 'text-[#BF4A3A]' : s.tone === 'good' ? 'text-[#3E8A5A]' : 'text-salty-text'}`}>{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
        {/* Outcomes + enrichment backlog */}
        <div className="grid gap-px border-t border-salty-border bg-salty-border sm:grid-cols-2">
          <div className="bg-warm-white p-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Run outcomes</p>
            {ingestion.outcomes.length === 0 ? (
              <p className="text-[12.5px] text-salty-muted">No scan runs in the window.</p>
            ) : (
              <div className="space-y-1.5">
                {ingestion.outcomes.map(([o, n]) => (
                  <div key={o} className="flex items-center justify-between text-[12.5px]">
                    <span className={o === 'ok' ? 'font-medium text-[#3E8A5A]' : o === 'error' ? 'text-[#BF4A3A]' : 'text-salty-secondary'}>{OUTCOME_LABEL[o] ?? o}</span>
                    <span className="font-semibold tabular-nums text-salty-text">{n.toLocaleString()}</span>
                  </div>
                ))}
                <p className="pt-1.5 text-[11px] text-salty-muted">“No connection” / “IMAP connect failed” are scheduled sweeps for users without a linked inbox — expected, not errors.</p>
              </div>
            )}
          </div>
          <div className="bg-warm-white p-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Enrichment backlog</p>
            <div className="flex gap-8">
              <div>
                <p className="font-sora text-[22px] font-bold text-salty-text">{ingestion.enrichPending.toLocaleString()}</p>
                <p className="text-[11px] text-salty-muted">pending</p>
              </div>
              <div>
                <p className={`font-sora text-[22px] font-bold ${ingestion.enrichFailed > 0 ? 'text-[#BF4A3A]' : 'text-salty-text'}`}>{ingestion.enrichFailed.toLocaleString()}</p>
                <p className="text-[11px] text-salty-muted">failed</p>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] text-salty-muted">Retry failed jobs on the <Link href="/enrichment?tab=pipeline" className="font-medium text-ember hover:underline">pipeline</Link>.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── UI helpers ───────────────────────────────────────────────────────────────────
const BANNER: Record<Status, string> = {
  ok:   'border-[#B8D9C5] bg-[#EAF4EE] text-[#2F6B46]',
  warn: 'border-[#EAD9A6] bg-[#FFF8E6] text-[#8A6830]',
  down: 'border-[#EBB9B0] bg-[#FDEDED] text-[#A53D30]',
}
const PILL: Record<Status, string> = {
  ok:   'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]',
  warn: 'border-[#EAD9A6] bg-[#FFF8E6] text-[#8A6830]',
  down: 'border-[#EBB9B0] bg-[#FDEDED] text-[#BF4A3A]',
}
const LABEL: Record<Status, string> = { ok: 'Operational', warn: 'Warning', down: 'Down' }

function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const Icon = status === 'ok' ? CheckCircle2 : status === 'warn' ? AlertTriangle : XCircle
  return <Icon className={className} />
}

function CheckSection({ icon: Icon, title, checks, footer }: { icon: React.ElementType; title: string; checks: Check[]; footer?: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
        <Icon className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
      </div>
      {checks.map((c) => (
        <div key={c.name} className="flex items-center justify-between gap-4 border-b border-salty-border px-5 py-2.5 last:border-0">
          <div className="min-w-0">
            <p className="font-mono text-[12.5px] font-medium text-salty-text">{c.name}</p>
            <p className="truncate text-[11.5px] text-salty-muted">{c.detail}</p>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${PILL[c.status]}`}>
            <StatusIcon status={c.status} className="h-3 w-3" /> {LABEL[c.status]}
          </span>
        </div>
      ))}
      {footer && <p className="border-t border-salty-border bg-cream/40 px-5 py-2.5 text-[11.5px] text-salty-muted">{footer}</p>}
    </div>
  )
}
