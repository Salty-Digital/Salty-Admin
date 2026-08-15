import Link from 'next/link'
import { Coins, AlertTriangle, Building2, Layers } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { loadLlmCalls, type LlmCallRow } from '@/lib/llm/log'
import { formatUsd, modelLabel } from '@/lib/llm/pricing'
import { fetchOrgUsage, isOrgUsageConfigured, type OrgUsage } from '@/lib/llm/anthropic-usage'

export const dynamic = 'force-dynamic'

const WINDOWS = [7, 30, 90] as const
type Window = (typeof WINDOWS)[number]

interface PageProps {
  searchParams: Promise<{ days?: string }>
}

function tokensOf(r: LlmCallRow) {
  return r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens
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

/** A cost bar sized against the largest row, so the biggest spender is obvious at a glance. */
function CostRow({ label, sub, cost, max, right }: { label: string; sub?: string; cost: number; max: number; right?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((cost / max) * 100)) : 0
  return (
    <div className="border-b border-salty-border px-5 py-3 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[12.5px] font-medium text-salty-text">{label}</span>
        <span className="shrink-0 font-sora text-[13px] font-bold text-salty-text">{formatUsd(cost)}</span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-stone">
        <div className="h-full rounded-full bg-ember" style={{ width: `${pct}%` }} />
      </div>
      {(sub || right) && (
        <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-salty-muted">
          <span className="truncate">{sub}</span>
          {right && <span className="shrink-0">{right}</span>}
        </div>
      )}
    </div>
  )
}

function DailyBars({ days }: { days: { date: string; costUsd: number }[] }) {
  const max = Math.max(...days.map((d) => d.costUsd), 0.000001)
  return (
    <div className="px-5 py-4">
      <div className="flex h-[90px] items-end gap-[3px]">
        {days.map((d) => (
          <div
            key={d.date}
            title={`${d.date} · ${formatUsd(d.costUsd)}`}
            className="flex-1 rounded-t-[2px] bg-ember/80 transition-colors hover:bg-ember"
            style={{ height: `${Math.max(2, (d.costUsd / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-salty-muted">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  )
}

export default async function LlmCostsPage({ searchParams }: PageProps) {
  await requireAdmin(2)
  const params = await searchParams
  const days: Window = (WINDOWS as readonly number[]).includes(Number(params.days))
    ? (Number(params.days) as Window)
    : 30

  const calls = await loadLlmCalls(days)

  // The org-wide panel is optional: it needs a separate Admin API key. A failure here
  // must not take the page down — the ledger below is the part we own.
  //
  // The Admin API caps 1d buckets at 31, so on the 90d tab this panel covers a shorter
  // window than the ledger above it. Carry the effective window through to the heading
  // rather than letting two different periods sit side by side looking comparable.
  const orgDays = Math.min(days, 31)
  let org: OrgUsage | null = null
  let orgError: string | null = null
  if (isOrgUsageConfigured()) {
    try {
      org = await fetchOrgUsage(orgDays)
    } catch (e) {
      orgError = (e as Error).message
    }
  }

  const totalCost = calls.reduce((sum, r) => sum + r.cost_usd, 0)
  const totalTokens = calls.reduce((sum, r) => sum + tokensOf(r), 0)
  const failures = calls.filter((r) => !r.ok)
  const dayMs = 86_400_000
  const last24h = calls.filter((r) => Date.now() - Date.parse(r.created_at) <= dayMs)
  const cost24h = last24h.reduce((sum, r) => sum + r.cost_usd, 0)

  // ── By feature — the attribution the provider's billing page can't give us ──
  const byOperation = new Map<string, { cost: number; calls: number; tokens: number }>()
  for (const r of calls) {
    const e = byOperation.get(r.operation) ?? { cost: 0, calls: 0, tokens: 0 }
    e.cost += r.cost_usd
    e.calls += 1
    e.tokens += tokensOf(r)
    byOperation.set(r.operation, e)
  }
  const operations = [...byOperation.entries()].sort((a, b) => b[1].cost - a[1].cost)
  const maxOpCost = operations[0]?.[1].cost ?? 0

  // ── By model ──
  const byModel = new Map<string, { cost: number; calls: number; provider: string }>()
  for (const r of calls) {
    const e = byModel.get(r.model) ?? { cost: 0, calls: 0, provider: r.provider }
    e.cost += r.cost_usd
    e.calls += 1
    byModel.set(r.model, e)
  }
  const models = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)
  const maxModelCost = models[0]?.[1].cost ?? 0

  // ── Daily trend from our own ledger ──
  const byDay = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    byDay.set(new Date(Date.now() - i * dayMs).toISOString().slice(0, 10), 0)
  }
  for (const r of calls) {
    const key = r.created_at.slice(0, 10)
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + r.cost_usd)
  }
  const dailySeries = [...byDay.entries()].map(([date, costUsd]) => ({ date, costUsd }))

  return (
    <div className="p-7 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
            <Coins className="h-5 w-5 text-ember" /> LLM Costs
          </h1>
          <p className="text-[13px] text-salty-muted">
            Token spend by feature, model, and day — measured from every model call the admin
            panel makes.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-salty-border bg-warm-white p-1">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/llm-costs?days=${w}`}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${
                w === days ? 'bg-ember-light text-ember' : 'text-salty-muted hover:text-salty-text'
              }`}
            >
              {w}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={`Spend · ${days}d`} value={formatUsd(totalCost)} sub={`${calls.length.toLocaleString()} calls`} accent="#E8581A" />
        <StatCard label="Spend · 24h" value={formatUsd(cost24h)} sub={`${last24h.length.toLocaleString()} calls`} accent="#C8A96E" />
        <StatCard label="Tokens" value={totalTokens.toLocaleString()} sub="input + output + cache" accent="#5A8FBF" />
        <StatCard
          label="Failed calls"
          value={failures.length.toLocaleString()}
          sub={calls.length ? `${Math.round((failures.length / calls.length) * 100)}% of calls` : '—'}
          accent={failures.length > 0 ? '#BF4A3A' : '#5A9E6F'}
        />
      </div>

      {calls.length === 0 && (
        <div className="rounded-[14px] border border-salty-border bg-warm-white px-5 py-8 text-center">
          <p className="text-[13px] text-salty-muted">
            No model calls recorded in this window. The ledger fills as AI features are used —
            the Manual Edit lookup, the Data Quality category check, and auto-remediation triage.
          </p>
        </div>
      )}

      {calls.length > 0 && (
        <>
          <Panel title="Daily spend" icon={Coins} sub="From the admin panel's own ledger.">
            <DailyBars days={dailySeries} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="By feature" icon={Layers} sub="Which part of the product is spending the money.">
              {operations.map(([op, e]) => (
                <CostRow
                  key={op}
                  label={op}
                  cost={e.cost}
                  max={maxOpCost}
                  sub={`${e.calls.toLocaleString()} calls · ${e.tokens.toLocaleString()} tokens`}
                  right={e.calls > 0 ? `${formatUsd(e.cost / e.calls)} / call` : undefined}
                />
              ))}
            </Panel>

            <Panel title="By model" icon={Layers}>
              {models.map(([model, e]) => (
                <CostRow
                  key={model}
                  label={modelLabel(model)}
                  cost={e.cost}
                  max={maxModelCost}
                  sub={`${e.provider} · ${model}`}
                  right={`${e.calls.toLocaleString()} calls`}
                />
              ))}
            </Panel>
          </div>
        </>
      )}

      {/* ── Organisation-wide (includes the mobile app's own Anthropic spend) ── */}
      <Panel
        title={`Whole Anthropic account · last ${orgDays}d`}
        icon={Building2}
        sub={
          orgDays < days
            ? `Includes spend from the mobile app's edge functions, which never pass through this codebase. The Admin API caps daily buckets at 31, so this covers ${orgDays} days — not the ${days} above.`
            : "Includes spend from the mobile app's edge functions, which never pass through this codebase."
        }
      >
        {!isOrgUsageConfigured() ? (
          <p className="px-5 py-5 text-[13px] text-salty-muted">
            Not connected. Set <code className="font-mono">ANTHROPIC_ADMIN_KEY</code> (an Admin
            API key, <code className="font-mono">sk-ant-admin…</code> — the regular API key is
            rejected by the organisation endpoints) to see account-wide usage here.
          </p>
        ) : orgError ? (
          <p className="px-5 py-5 text-[13px] text-[#BF4A3A]">Could not load org usage — {orgError}</p>
        ) : org && org.days.length > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-px border-b border-salty-border bg-salty-border sm:grid-cols-3">
              <div className="bg-warm-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Account spend</p>
                <p className="mt-1 font-sora text-[22px] font-bold text-salty-text">{formatUsd(org.totalCostUsd)}</p>
              </div>
              <div className="bg-warm-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Account tokens</p>
                <p className="mt-1 font-sora text-[22px] font-bold text-salty-text">{org.totalTokens.toLocaleString()}</p>
              </div>
              {/* Only meaningful when both figures cover the same window — otherwise this
                  would subtract a 90-day ledger from a 31-day account total. */}
              <div className="bg-warm-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Not from admin</p>
                {orgDays === days ? (
                  <>
                    <p className="mt-1 font-sora text-[22px] font-bold text-salty-text">
                      {formatUsd(Math.max(0, org.totalCostUsd - totalCost))}
                    </p>
                    <p className="mt-0.5 text-[11px] text-salty-muted">app + edge functions</p>
                  </>
                ) : (
                  <p className="mt-1 text-[12px] text-salty-muted">
                    Not comparable at {days}d — switch to 7d or 30d.
                  </p>
                )}
              </div>
            </div>
            <DailyBars days={org.days} />
            {org.models.map((m) => (
              <CostRow
                key={m.model}
                label={m.label}
                cost={m.costUsd}
                max={org.models[0].costUsd}
                sub={m.model}
                right={`${(m.inputTokens + m.outputTokens).toLocaleString()} tokens`}
              />
            ))}
            <p className="border-t border-salty-border bg-cream/40 px-5 py-2.5 text-[11.5px] text-salty-muted">
              Priced with the same rate table as the per-feature view above, so the two numbers are
              directly comparable.
            </p>
          </>
        ) : (
          <p className="px-5 py-5 text-[13px] text-salty-muted">No account usage in this window.</p>
        )}
      </Panel>

      {/* ── Failures ── */}
      {failures.length > 0 && (
        <Panel title="Recent failed calls" icon={AlertTriangle}>
          <div className="max-h-[320px] overflow-y-auto">
            {failures.slice(0, 40).map((r) => (
              <div key={r.id} className="border-b border-salty-border px-5 py-2.5 last:border-0">
                <p className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="font-mono font-medium text-salty-text">{r.operation}</span>
                  <span className="text-[11px] text-salty-muted">{new Date(r.created_at).toLocaleString()}</span>
                </p>
                <p className="truncate text-[11.5px] text-[#BF4A3A]">{r.error}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
