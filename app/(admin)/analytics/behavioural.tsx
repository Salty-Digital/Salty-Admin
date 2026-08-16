import { TrendingUp, Filter, Zap, Clock3, Activity } from 'lucide-react'
import type {
  Activation, SourceEffectiveness, EnrichmentCoverage, TimeToFirstTicket, Engagement,
} from '@/lib/analytics'

/**
 * Behavioural analytics panels: activation, engagement, capture effectiveness, enrichment coverage,
 * and time-to-first-ticket. Server components — all data is fetched by the page.
 */

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

function Panel({ title, icon: Icon, sub, children }: {
  title: string; icon: React.ElementType; sub?: string; children: React.ReactNode
}) {
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

/**
 * The capture funnel. Each bar is a share of ALL users, not of the previous step — these stages are
 * not strictly sequential (a user can connect an inbox before adding a ticket), and drawing them as
 * a strict funnel would imply a drop-off that isn't real.
 */
export function ActivationFunnel({ a }: { a: Activation }) {
  const stages = [
    { label: 'Signed up', value: a.totalUsers, tone: '#5B6190' },
    { label: 'Connected an inbox', value: a.withInbox, tone: '#3A72A8' },
    { label: 'Ran a photo scan', value: a.withPhotoScan, tone: '#7C3AED' },
    { label: 'Has ≥1 ticket', value: a.withTicket, tone: '#E8581A' },
    { label: 'Has ≥2 tickets', value: a.with2Plus, tone: '#3E8A5A' },
  ]
  return (
    <Panel title="Activation" icon={Filter} sub="Share of all users reaching each stage. Capture is the product — a user with no tickets got no value.">
      <div className="space-y-2.5 px-5 py-4">
        {stages.map((s) => {
          const p = pct(s.value, a.totalUsers)
          return (
            <div key={s.label}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-salty-secondary">{s.label}</span>
                <span className="font-sora font-bold text-salty-text">
                  {s.value.toLocaleString()}
                  <span className="ml-1.5 text-[11px] font-normal text-salty-muted">{p}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone">
                <div className="h-full rounded-full" style={{ width: `${Math.max(1, p)}%`, background: s.tone }} />
              </div>
            </div>
          )
        })}
        <div className="grid grid-cols-2 gap-3 border-t border-salty-border pt-3">
          <div>
            <p className="font-sora text-[20px] font-bold text-salty-text">{a.avgTicketsPerActive}</p>
            <p className="text-[11px] text-salty-muted">avg tickets per activated user</p>
          </div>
          <div>
            <p className="font-sora text-[20px] font-bold text-salty-text">
              {pct(a.withTicket, a.totalUsers)}%
            </p>
            <p className="text-[11px] text-salty-muted">activation rate</p>
          </div>
        </div>
      </div>
    </Panel>
  )
}

/** DAU sparkline plus the WAU/MAU stickiness ratio. */
export function EngagementPanel({ e }: { e: Engagement }) {
  const max = Math.max(...e.daily.map((d) => d.users), 1)
  return (
    <Panel title="Engagement" icon={Activity} sub="Daily active users from app_opened, with WAU/MAU stickiness.">
      {!e.configured ? (
        <p className="px-5 py-8 text-center text-[13px] text-salty-muted">POSTHOG_API_KEY not set.</p>
      ) : e.error ? (
        <p className="px-5 py-8 text-center text-[13px] text-[#BF4A3A]">PostHog query failed: {e.error}</p>
      ) : e.daily.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-salty-muted">No app_opened events in the window.</p>
      ) : (
        <div className="px-5 py-4">
          <div className="grid grid-cols-3 gap-3 pb-3">
            <div>
              <p className="font-sora text-[22px] font-bold text-salty-text">{e.wau}</p>
              <p className="text-[11px] text-salty-muted">WAU</p>
            </div>
            <div>
              <p className="font-sora text-[22px] font-bold text-salty-text">{e.mau}</p>
              <p className="text-[11px] text-salty-muted">MAU</p>
            </div>
            <div>
              <p className="font-sora text-[22px] font-bold text-salty-text">
                {e.stickiness == null ? '—' : `${e.stickiness}%`}
              </p>
              <p className="text-[11px] text-salty-muted">stickiness</p>
            </div>
          </div>
          <div className="flex h-[70px] items-end gap-[3px] border-t border-salty-border pt-3">
            {e.daily.map((d) => (
              <div
                key={d.day}
                title={`${d.day} · ${d.users} active`}
                className="flex-1 rounded-t-[2px] bg-ember/80 transition-colors hover:bg-ember"
                style={{ height: `${Math.max(3, (d.users / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10.5px] text-salty-muted">
            <span>{e.daily[0]?.day}</span>
            <span>{e.daily[e.daily.length - 1]?.day}</span>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** Which capture path actually produces tickets — run counts alone hide a source that never lands. */
export function SourcePanel({ rows }: { rows: SourceEffectiveness[] }) {
  const max = Math.max(...rows.map((r) => r.tickets), 1)
  const total = rows.reduce((n, r) => n + r.tickets, 0)
  return (
    <Panel title="Capture effectiveness" icon={TrendingUp} sub={`Tickets actually produced per source · ${total.toLocaleString()} total.`}>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-salty-muted">No tickets yet.</p>
      ) : (
        <div className="divide-y divide-salty-border">
          {rows.map((r) => (
            <div key={r.source} className="px-5 py-2.5">
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="font-mono font-medium text-salty-text">{r.source}</span>
                <span className="font-sora font-bold text-salty-text">
                  {r.tickets.toLocaleString()}
                  <span className="ml-1.5 text-[11px] font-normal text-salty-muted">{pct(r.tickets, total)}%</span>
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-stone">
                <div className="h-full rounded-full bg-ember" style={{ width: `${Math.max(1, (r.tickets / max) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[11px] text-salty-muted">{r.usersReached} user{r.usersReached === 1 ? '' : 's'} reached</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** Enrichment coverage per kind. `exhausted` needs a data fix, not a retry — kept visible. */
export function EnrichmentPanel({ rows }: { rows: EnrichmentCoverage[] }) {
  return (
    <Panel title="Enrichment coverage" icon={Zap} sub="Share of queued jobs completed, per kind.">
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-salty-muted">No enrichment jobs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
                <th className="px-4 py-2.5">Kind</th>
                <th className="px-4 py-2.5 text-right">Done</th>
                <th className="px-4 py-2.5 text-right">Pending</th>
                <th className="px-4 py-2.5 text-right">Dead-lettered</th>
                <th className="px-4 py-2.5 text-right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind} className="border-b border-salty-border last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[12px] text-salty-text">{r.kind}</td>
                  <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-salty-secondary">{r.done}</td>
                  <td className="px-4 py-2.5 text-right text-[12.5px] tabular-nums text-salty-secondary">{r.pending || '—'}</td>
                  <td className={`px-4 py-2.5 text-right text-[12.5px] tabular-nums ${r.exhausted > 0 ? 'font-semibold text-[#BF4A3A]' : 'text-salty-muted'}`}>
                    {r.exhausted || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1 w-12 overflow-hidden rounded-full bg-stone">
                        <span className="block h-full rounded-full bg-[#3E8A5A]" style={{ width: `${r.pctDone}%` }} />
                      </span>
                      <span className="font-sora text-[12px] font-bold text-salty-text">{r.pctDone}%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** How fast a new user captures their first ticket — onboarding friction, in one chart. */
export function TimeToFirstTicketPanel({ rows }: { rows: TimeToFirstTicket[] }) {
  const total = rows.reduce((n, r) => n + r.users, 0)
  const max = Math.max(...rows.map((r) => r.users), 1)
  return (
    <Panel title="Time to first ticket" icon={Clock3} sub="From signup to first captured ticket.">
      {total === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-salty-muted">No activated users yet.</p>
      ) : (
        <div className="space-y-2.5 px-5 py-4">
          {rows.map((r) => (
            <div key={r.bucket}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-salty-secondary">{r.bucket}</span>
                <span className="font-sora font-bold text-salty-text">
                  {r.users}
                  <span className="ml-1.5 text-[11px] font-normal text-salty-muted">{pct(r.users, total)}%</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone">
                <div className="h-full rounded-full bg-gold" style={{ width: `${Math.max(1, (r.users / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
