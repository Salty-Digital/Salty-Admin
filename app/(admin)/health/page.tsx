import Link from 'next/link'
import {
  HeartPulse, Database, Server, KeyRound, Boxes, Smartphone,
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, ScanLine,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { runHealthChecks, OUTCOME_LABEL, type Check, type Status } from '@/lib/health'
import { getOpenIncidents, getRecentIncidents, getAlertSettings, getAlertContacts } from '@/lib/alerts'
import { getRecentRemediations } from '@/lib/remediation'
import { HealthRefresher } from './health-refresher'
import { IncidentsPanel } from './incidents-panel'

// A health page must reflect live state, never a cached render.
export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  await requireAdmin(1)

  const [report, openIncidents, recentIncidents, remediations, settings, contacts] = await Promise.all([
    runHealthChecks(),
    getOpenIncidents(),
    getRecentIncidents(25),
    getRecentRemediations(12),
    getAlertSettings(),
    getAlertContacts(),
  ])

  const { overall, core, edge, env, mobile, snapshot: snap, ingestion } = report

  const overallCopy = {
    ok:   { title: 'All systems operational', sub: 'Every runtime check passed.' },
    warn: { title: 'Degraded — some checks need attention', sub: 'The project is up, but one or more checks are warning.' },
    down: { title: 'Outage — a core service is down', sub: 'At least one critical check failed.' },
  }[overall]

  const activeContacts = contacts.filter((c) => c.is_active)

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

      {/* Incidents, escalation state, and auto-fix log */}
      <IncidentsPanel
        open={openIncidents}
        recent={recentIncidents}
        remediations={remediations}
        notifyEnabled={settings.notify_enabled}
        contactCount={activeContacts.length}
      />

      <CheckSection icon={Database} title="Core services" checks={core} />
      <CheckSection icon={Server} title="Edge functions" checks={edge} />
      <CheckSection
        icon={KeyRound}
        title="Admin panel — environment"
        checks={env}
        footer={<>Presence only — secret values are never read. Full list on <Link href="/settings/config" className="font-medium text-ember hover:underline">Config Status</Link>.</>}
      />
      <CheckSection
        icon={Smartphone}
        title="Mobile app — integrations"
        checks={mobile}
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
            {
              label: 'Unreviewed events',
              value: snap.pending,
              sub: `across ${snap.pendingUsers.toLocaleString()} user${snap.pendingUsers === 1 ? '' : 's'}`,
            },
          ].map((s) => (
            <div key={s.label} className="bg-warm-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{s.label}</p>
              <p className="mt-1 font-sora text-[22px] font-bold text-salty-text">{s.value.toLocaleString()}</p>
              {s.sub && <p className="mt-0.5 text-[11px] text-salty-muted">{s.sub}</p>}
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
