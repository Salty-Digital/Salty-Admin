import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { SignupsBarChart, CumulativeAreaChart } from '../beta-signups/charts'
import {
  Users, UserPlus, Activity, Bell, Mail, ShieldAlert, Ticket, Sparkles, Server, AlertTriangle, Zap,
} from 'lucide-react'

type DB = ReturnType<typeof createServiceClient>
interface Bucket { name: string; value: number }
const DAY = 86_400_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchAll<T>(db: DB, table: string, cols: string, since?: string): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  for (let p = 0; p < 60; p++) {
    let query = db.from(table).select(cols)
    if (since) query = query.gte('created_at', since)
    const { data, error } = await query.order('created_at', { ascending: false }).range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as T[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

function tally(values: (string | null | undefined)[]): Bucket[] {
  const m = new Map<string, number>()
  for (const v of values) {
    const k = v == null ? '' : String(v).trim()
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function dailyCounts(dates: (string | null | undefined)[], days: number): { day: string; count: number }[] {
  const byDay = new Map<string, number>()
  for (const d of dates) {
    if (!d) continue
    byDay.set(new Date(d).toISOString().slice(0, 10), (byDay.get(new Date(d).toISOString().slice(0, 10)) ?? 0) + 1)
  }
  const out: { day: string; count: number }[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const dd = new Date(today); dd.setUTCDate(today.getUTCDate() - i)
    const k = dd.toISOString().slice(0, 10)
    out.push({ day: k, count: byDay.get(k) ?? 0 })
  }
  return out
}

function cumulativeFrom(daily: { day: string; count: number }[], base: number): { day: string; total: number }[] {
  let run = base
  return daily.map(d => { run += d.count; return { day: d.day, total: run } })
}

const pct = (n: number) => `${Math.round(n * 100)}%`

// ─── Data ────────────────────────────────────────────────────────────────────

async function getMainAnalytics() {
  const db = createServiceClient()
  const since30 = new Date(Date.now() - 30 * DAY).toISOString()
  const now = Date.now()

  const [users, tickets, api, campaigns, suppressions, notifs, ai] = await Promise.all([
    fetchAll<{ created_at: string | null; tier: string | null; last_seen_at: string | null; zip_code: string | null }>(
      db, 'users', 'created_at, tier, last_seen_at, zip_code'),
    fetchAll<{ source: string | null; category: string | null; imported_at: string | null }>(
      db, 'tickets', 'source, category, imported_at'),
    fetchAll<{ external_api: string | null; model: string | null; success: boolean | null; latency_ms: number | null; created_at: string | null }>(
      db, 'api_usage_log', 'external_api, model, success, latency_ms, created_at', since30),
    fetchAll<{ recipient_count: number | null; sent_count: number | null; failed_count: number | null; created_at: string | null }>(
      db, 'email_campaigns', 'recipient_count, sent_count, failed_count, created_at'),
    fetchAll<{ reason: string | null }>(db, 'email_suppressions', 'reason'),
    fetchAll<{ read: boolean | null; source: string | null; created_at: string | null }>(db, 'notifications', 'read, source, created_at'),
    fetchAll<{ user_id: string | null; created_at: string | null }>(db, 'saved_ai_questions', 'user_id, created_at'),
  ]).catch(() => { throw new Error('query failed') })

  // Users & growth
  const totalUsers = users.length
  const newUsers = (ms: number) => users.filter(u => u.created_at && now - new Date(u.created_at).getTime() <= ms).length
  const usersDaily = dailyCounts(users.map(u => u.created_at), 30)
  const usersCumulative = cumulativeFrom(usersDaily, totalUsers - usersDaily.reduce((s, d) => s + d.count, 0))
  const activeWithin = (ms: number) => users.filter(u => u.last_seen_at && now - new Date(u.last_seen_at).getTime() <= ms).length

  // Tickets
  const ticketsDaily = dailyCounts(tickets.map(t => t.imported_at), 30)

  // API usage
  const apiCalls = api.length
  const apiErrors = api.filter(r => r.success === false).length
  const apiAvgLatency = apiCalls > 0 ? api.reduce((s, r) => s + (r.latency_ms || 0), 0) / apiCalls : 0
  const apiDaily = dailyCounts(api.map(r => r.created_at), 30)

  // Email
  const campaignsSent = campaigns.reduce((s, c) => s + (c.sent_count ?? 0), 0)
  const campaignsFailed = campaigns.reduce((s, c) => s + (c.failed_count ?? 0), 0)
  const campaignRecipients = campaigns.reduce((s, c) => s + (c.recipient_count ?? 0), 0)
  const sendSuccess = campaignsSent + campaignsFailed > 0 ? campaignsSent / (campaignsSent + campaignsFailed) : 0

  // Notifications
  const notifRead = notifs.filter(n => n.read).length
  const notifReadRate = notifs.length > 0 ? notifRead / notifs.length : 0

  // AI
  const aiLast7 = ai.filter(r => r.created_at && now - new Date(r.created_at).getTime() <= 7 * DAY).length
  const aiUsers = new Set(ai.map(r => r.user_id).filter(Boolean)).size

  return {
    users: {
      total: totalUsers, new7: newUsers(7 * DAY), new30: newUsers(30 * DAY),
      daily: usersDaily, cumulative: usersCumulative,
      dau: activeWithin(DAY), wau: activeWithin(7 * DAY), mau: activeWithin(30 * DAY),
      byTier: tally(users.map(u => u.tier ?? 'free')), byZip: tally(users.map(u => u.zip_code)),
    },
    tickets: { total: tickets.length, daily: ticketsDaily, bySource: tally(tickets.map(t => t.source)), byCategory: tally(tickets.map(t => t.category)) },
    api: {
      calls: apiCalls, errorRate: apiCalls > 0 ? apiErrors / apiCalls : 0, avgLatency: apiAvgLatency, daily: apiDaily,
      byApi: tally(api.map(r => r.external_api)), byModel: tally(api.map(r => r.model)),
    },
    email: {
      campaigns: campaigns.length, sent: campaignsSent, failed: campaignsFailed, recipients: campaignRecipients, sendSuccess,
      suppressed: suppressions.length, bySuppressReason: tally(suppressions.map(s => s.reason)),
    },
    notifs: { total: notifs.length, readRate: notifReadRate, bySource: tally(notifs.map(n => n.source)) },
    ai: { total: ai.length, last7: aiLast7, users: aiUsers },
  }
}

// ─── UI ──────────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent, sub }: {
  label: string; value: string | number; icon: React.ElementType; accent: string; sub?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[14px]" style={{ background: accent }} />
      <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: accent + '18', color: accent }}>
        <Icon className="h-[17px] w-[17px]" />
      </div>
      <p className="mb-1 text-[12px] font-medium text-salty-muted">{label}</p>
      <p className="font-sora text-[26px] font-bold leading-none tracking-tight text-salty-text">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-salty-muted">{sub}</p>}
    </div>
  )
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="border-b border-salty-border px-5 py-[15px]">
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {subtitle && <p className="text-[11px] text-salty-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-sora text-[15px] font-bold text-salty-text">{children}</h2>
}

function BreakdownList({ items, accent, max = 8 }: { items: Bucket[]; accent: string; max?: number }) {
  if (items.length === 0) return <p className="px-5 py-6 text-[13px] text-salty-muted">No data</p>
  const top = items.slice(0, max)
  const peak = top[0]?.value ?? 1
  return (
    <div className="space-y-2.5 px-5 py-4">
      {top.map(it => (
        <div key={it.name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
            <span className="truncate text-salty-secondary">{it.name}</span>
            <span className="shrink-0 font-semibold text-salty-text">{it.value.toLocaleString()}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-stone">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.round((it.value / peak) * 100))}%`, background: accent }} />
          </div>
        </div>
      ))}
      {items.length > max && <p className="pt-1 text-[11px] text-salty-muted">+{items.length - max} more</p>}
    </div>
  )
}

function TripleStat({ items }: { items: { label: string; value: string | number }[] }) {
  return (
    <div className="grid divide-x divide-salty-border" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map(s => (
        <div key={s.label} className="px-4 py-4 text-center">
          <p className="font-sora text-[24px] font-bold text-salty-text leading-none">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</p>
          <p className="mt-1 text-[12px] text-salty-muted">{s.label}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function V2AnalyticsPage() {
  await requireAdmin(3)

  let d: Awaited<ReturnType<typeof getMainAnalytics>>
  try {
    d = await getMainAnalytics()
  } catch (e) {
    return (
      <div className="p-7">
        <h1 className="mb-4 font-sora text-[20px] font-bold text-salty-text">V2 Analytics</h1>
        <div className="max-w-2xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] p-5 text-[13px] text-[#BF4A3A]">
          Couldn&apos;t load analytics: {(e as Error).message}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-7">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">V2 Analytics</h1>
        <p className="text-[13px] text-salty-muted">Deep product metrics from your main database · users, engagement, email &amp; API</p>
      </div>

      {/* Users & growth */}
      <SectionTitle>Users &amp; Growth</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total Users" value={d.users.total} icon={Users} accent="#E8581A" />
        <StatCard label="New (7d)" value={d.users.new7} icon={UserPlus} accent="#5A9E6F" />
        <StatCard label="New (30d)" value={d.users.new30} icon={UserPlus} accent="#5A8FBF" />
        <StatCard label="Tickets Stored" value={d.tickets.total} icon={Ticket} accent="#C8A96E" />
        <StatCard label="Active Today" value={d.users.dau} icon={Activity} accent="#7B44A8" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="New Users (30d)"><div className="px-4 pb-2 pt-4"><SignupsBarChart data={d.users.daily} label="New users" color="#5A9E6F" /></div></Panel>
        <Panel title="Cumulative Users"><div className="px-4 pb-2 pt-4"><CumulativeAreaChart data={d.users.cumulative} label="Total users" color="#E8581A" /></div></Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Active Users" subtitle="by last_seen_at">
          <TripleStat items={[{ label: 'Daily (24h)', value: d.users.dau }, { label: 'Weekly (7d)', value: d.users.wau }, { label: 'Monthly (30d)', value: d.users.mau }]} />
        </Panel>
        <Panel title="Tiers"><BreakdownList items={d.users.byTier} accent="#C8A96E" /></Panel>
        <Panel title="Top ZIP Codes"><BreakdownList items={d.users.byZip} accent="#5A8FBF" /></Panel>
      </div>

      {/* Engagement */}
      <SectionTitle>Engagement</SectionTitle>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Tickets Imported (30d)"><div className="px-4 pb-2 pt-4"><SignupsBarChart data={d.tickets.daily} label="Tickets" color="#5A8FBF" /></div></Panel>
        <Panel title="Tickets by Source"><BreakdownList items={d.tickets.bySource} accent="#C8A96E" /></Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Fan Memory AI" subtitle="saved_ai_questions">
          <TripleStat items={[{ label: 'Total', value: d.ai.total }, { label: 'Last 7d', value: d.ai.last7 }, { label: 'Users', value: d.ai.users }]} />
        </Panel>
        <Panel title="Notifications" subtitle={`${pct(d.notifs.readRate)} read`}><BreakdownList items={d.notifs.bySource} accent="#7B44A8" /></Panel>
        <Panel title="Ticket Categories"><BreakdownList items={d.tickets.byCategory} accent="#E8581A" /></Panel>
      </div>

      {/* Email & deliverability */}
      <SectionTitle>Email &amp; Deliverability</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Broadcasts" value={d.email.campaigns} icon={Mail} accent="#5A8FBF" />
        <StatCard label="Emails Sent" value={d.email.sent} icon={Mail} accent="#5A9E6F" />
        <StatCard label="Send Success" value={pct(d.email.sendSuccess)} icon={Mail} accent="#3E8A5A" sub={`${d.email.failed} failed`} />
        <StatCard label="Suppressed" value={d.email.suppressed} icon={ShieldAlert} accent="#BF4A3A" />
        <StatCard label="Notifs Read" value={pct(d.notifs.readRate)} icon={Bell} accent="#C8A96E" />
      </div>
      <Panel title="Suppressions by Reason" subtitle="bounces / complaints / manual blocks"><BreakdownList items={d.email.bySuppressReason} accent="#BF4A3A" /></Panel>

      {/* API usage */}
      <SectionTitle>API Usage</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="API Calls (30d)" value={d.api.calls} icon={Server} accent="#5A8FBF" />
        <StatCard label="Error Rate" value={pct(d.api.errorRate)} icon={AlertTriangle} accent="#BF4A3A" />
        <StatCard label="Avg Latency" value={`${Math.round(d.api.avgLatency)}ms`} icon={Zap} accent="#C8A96E" />
        <StatCard label="Fan Memory AI (7d)" value={d.ai.last7} icon={Sparkles} accent="#7B44A8" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Calls Per Day (30d)"><div className="px-4 pb-2 pt-4"><SignupsBarChart data={d.api.daily} label="API calls" color="#5A8FBF" /></div></Panel>
        <Panel title="By External API"><BreakdownList items={d.api.byApi} accent="#5A9E6F" /></Panel>
      </div>
      <Panel title="By Model"><BreakdownList items={d.api.byModel} accent="#7B44A8" /></Panel>
    </div>
  )
}
