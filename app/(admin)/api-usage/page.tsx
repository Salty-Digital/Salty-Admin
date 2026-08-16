import Link from 'next/link'
import { Plug, AlertTriangle, Layers, Activity } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import {
  loadProviderUsage,
  loadFunctionUsage,
  loadDailyUsage,
  loadRecentFailures,
  PROVIDER_LABEL,
} from '@/lib/api-usage'

export const dynamic = 'force-dynamic'

const WINDOWS = [1, 7, 30] as const
type Window = (typeof WINDOWS)[number]

interface PageProps {
  searchParams: Promise<{ days?: string }>
}

const label = (slug: string) => PROVIDER_LABEL[slug] ?? slug
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))
const ms = (v: number | null) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`)

function relative(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[14px]" style={{ background: accent }} />
      <p className="text-[12px] font-medium text-salty-muted">{label}</p>
      <p className="mt-1 font-sora text-[26px] font-bold leading-none text-salty-text">{value}</p>
      {sub && <p className="mt-1.5 text-[11.5px] text-salty-muted">{sub}</p>}
    </div>
  )
}

function Panel({ title, icon: Icon, sub, children }: { title: string; icon: React.ElementType; sub?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="border-b border-salty-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-sora text-[14px] font-bold text-salty-text">
          <Icon className="h-4 w-4 text-ember" /> {title}
        </h2>
        {sub && <p className="mt-0.5 text-[12px] text-salty-muted">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

/** Call-volume bar sized against the busiest provider, with the failed share overlaid in red. */
function ProviderRow({
  name, calls, failures, max, successRate, p50, p95, lastSeen,
}: {
  name: string; calls: number; failures: number; max: number
  successRate: number | null; p50: number | null; p95: number | null; lastSeen: string
}) {
  const pct = max > 0 ? Math.max(2, Math.round((calls / max) * 100)) : 0
  const failPct = calls > 0 ? (failures / calls) * 100 : 0
  const degraded = successRate != null && successRate < 95
  return (
    <div className="border-b border-salty-border px-5 py-3 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] font-semibold text-salty-text">{name}</span>
        <span className="shrink-0 font-sora text-[13px] font-bold text-salty-text">{compact(calls)}</span>
      </div>
      <div className="mt-1.5 flex h-1 w-full overflow-hidden rounded-full bg-stone" style={{ width: `${pct}%`, minWidth: '2%' }}>
        <div className="h-full bg-ember" style={{ width: `${100 - failPct}%` }} />
        <div className="h-full bg-[#BF4A3A]" style={{ width: `${failPct}%` }} />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-salty-muted">
        <span className="truncate">
          <span className={degraded ? 'font-semibold text-[#BF4A3A]' : undefined}>
            {successRate == null ? '—' : `${successRate}% ok`}
          </span>
          {failures > 0 && ` · ${failures} failed`}
          {` · p50 ${ms(p50)} · p95 ${ms(p95)}`}
        </span>
        <span className="shrink-0">{relative(lastSeen)}</span>
      </div>
    </div>
  )
}

/** Calls per day, failures stacked on top in red so an outage day is visible without reading numbers. */
function DailyBars({ days }: { days: { day: string; calls: number; failures: number }[] }) {
  const max = Math.max(...days.map((d) => d.calls), 1)
  return (
    <div className="px-5 py-4">
      <div className="flex h-[90px] items-end gap-[3px]">
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day} · ${d.calls} calls${d.failures ? ` · ${d.failures} failed` : ''}`}
            className="flex flex-1 flex-col justify-end"
            style={{ height: '100%' }}
          >
            <div
              className="w-full rounded-t-[2px] bg-[#BF4A3A]"
              style={{ height: `${(d.failures / max) * 100}%` }}
            />
            <div
              className="w-full bg-ember/80 transition-colors hover:bg-ember"
              style={{ height: `${Math.max(d.calls > 0 ? 2 : 0, ((d.calls - d.failures) / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-salty-muted">
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </div>
  )
}

export default async function ApiUsagePage({ searchParams }: PageProps) {
  await requireAdmin(2)
  const params = await searchParams
  const days: Window = (WINDOWS as readonly number[]).includes(Number(params.days))
    ? (Number(params.days) as Window)
    : 7

  const [providers, functions, daily, failures] = await Promise.all([
    loadProviderUsage(days),
    loadFunctionUsage(days),
    loadDailyUsage(days),
    loadRecentFailures(days),
  ])

  const totalCalls = providers.reduce((n, p) => n + p.calls, 0)
  const totalFailures = providers.reduce((n, p) => n + p.failures, 0)
  const okRate = totalCalls > 0 ? (100 * (totalCalls - totalFailures)) / totalCalls : null
  const maxCalls = providers[0]?.calls ?? 0
  const maxFnCalls = functions[0]?.calls ?? 0
  // Anything below 95% is worth a name at the top of the page rather than a row buried in a list.
  const degraded = providers.filter((p) => p.success_rate != null && p.success_rate < 95)

  return (
    <div className="p-7 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
            <Plug className="h-5 w-5 text-ember" /> External API Usage
          </h1>
          <p className="text-[13px] text-salty-muted">
            Every outbound provider call the edge functions make — volume, failure rate and latency,
            attributed to the function that spent it.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-salty-border bg-warm-white p-1">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/api-usage?days=${w}`}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${
                w === days ? 'bg-ember-light text-ember' : 'text-salty-muted hover:text-salty-text'
              }`}
            >
              {w === 1 ? '24h' : `${w}d`}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Calls" value={compact(totalCalls)} sub={`across ${providers.length} providers`} accent="#E8581A" />
        <StatCard
          label="Success rate"
          value={okRate == null ? '—' : `${okRate.toFixed(1)}%`}
          sub={totalFailures > 0 ? `${totalFailures} failed` : 'no failures'}
          accent={okRate != null && okRate < 95 ? '#BF4A3A' : '#3E8A5A'}
        />
        <StatCard
          label="Degraded providers"
          value={String(degraded.length)}
          sub={degraded.length ? degraded.map((p) => label(p.external_api)).join(', ') : 'all above 95%'}
          accent={degraded.length ? '#BF4A3A' : '#3E8A5A'}
        />
        <StatCard label="Busiest" value={providers[0] ? label(providers[0].external_api) : '—'} sub={providers[0] ? `${compact(providers[0].calls)} calls` : undefined} accent="#C8A96E" />
      </div>

      <Panel title="Calls per day" icon={Activity} sub="Failures stacked in red.">
        <DailyBars days={daily} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="By provider" icon={Plug} sub="Volume, reliability and latency per external API.">
          {providers.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-salty-muted">
              No provider calls recorded in this window.
            </p>
          ) : (
            providers.map((p) => (
              <ProviderRow
                key={p.external_api}
                name={label(p.external_api)}
                calls={p.calls}
                failures={p.failures}
                max={maxCalls}
                successRate={p.success_rate}
                p50={p.p50_ms}
                p95={p.p95_ms}
                lastSeen={p.last_seen}
              />
            ))
          )}
        </Panel>

        <Panel title="By function" icon={Layers} sub="Which edge function is driving each provider.">
          {functions.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-salty-muted">Nothing recorded in this window.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-salty-border bg-cream">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Function</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Provider</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Calls</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Failed</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">p95</th>
                  </tr>
                </thead>
                <tbody>
                  {functions.map((f) => (
                    <tr key={`${f.function_name}:${f.external_api}`} className="border-b border-salty-border last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[12px] text-salty-text">{f.function_name}</td>
                      <td className="px-4 py-2.5 text-[12.5px] text-salty-secondary">{label(f.external_api)}</td>
                      <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-salty-text">
                        <span className="inline-block h-1 rounded-full bg-ember/30 align-middle" style={{ width: `${maxFnCalls > 0 ? Math.max(4, (f.calls / maxFnCalls) * 48) : 0}px` }} />
                        <span className="ml-2">{compact(f.calls)}</span>
                      </td>
                      <td className={`px-4 py-2.5 text-right text-[12.5px] tabular-nums ${f.failures > 0 ? 'font-semibold text-[#BF4A3A]' : 'text-salty-muted'}`}>
                        {f.failures || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-salty-secondary">{ms(f.p95_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Recent failures" icon={AlertTriangle} sub="Newest first, capped at 40.">
        {failures.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-salty-muted">
            No failed calls in this window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-salty-border bg-cream">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">When</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Function</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Provider</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Error</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Latency</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id} className="border-b border-salty-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-salty-muted">{relative(f.created_at)}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-salty-text">{f.function_name}</td>
                    <td className="px-4 py-2.5 text-[12.5px] text-salty-secondary">{label(f.external_api)}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-[#BF4A3A]">{f.error_message ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-salty-secondary">{ms(f.latency_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[11.5px] text-salty-muted">
        Written by the <code className="font-mono">trackedFetch</code> wrapper in{' '}
        <code className="font-mono">supabase/functions/_shared/apiUsage.ts</code>. Provider URLs are
        never stored — Ticketmaster and others carry the API key in the query string, so error text
        is URL-stripped before it is written.
      </p>
    </div>
  )
}
