import { requireAdmin } from '@/lib/auth'
import { maskEmail } from '@/lib/privacy'
import { createV2Client, isV2Configured, V2NotConfiguredError } from '@/lib/supabase/v2'
import { SignupsBarChart, CumulativeAreaChart } from './charts'
import {
  Users, UserCheck, Send, UserX, TrendingUp, TrendingDown, Rocket, Share2, AlertTriangle,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignupRow {
  created_at: string | null
  source_classification: string | null
  is_active: boolean | null
  unsubscribed_at: string | null
  invite_sent_at: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  device_type: string | null
  operating_system: string | null
  events_per_year: string | null
  primary_value: string | null
  other_app: string | null
  zip_code: string | null
  fan_types: string[] | null
  tracking_methods: string[] | null
  referral_count: number | null
  referred_by: string | null
}

interface Bucket { name: string; value: number }

// ─── Data ────────────────────────────────────────────────────────────────────

const SELECT_COLS = [
  'created_at', 'source_classification', 'is_active', 'unsubscribed_at', 'invite_sent_at',
  'utm_source', 'utm_medium', 'utm_campaign', 'device_type', 'operating_system',
  'events_per_year', 'primary_value', 'other_app', 'zip_code', 'fan_types',
  'tracking_methods', 'referral_count', 'referred_by',
].join(', ')

/** Fetch every beta_signups row, paging past PostgREST's 1000-row cap (safety-capped at 60k). */
async function fetchAllSignups(db: ReturnType<typeof createV2Client>): Promise<SignupRow[]> {
  const PAGE = 1000
  const all: SignupRow[] = []
  for (let page = 0; page < 60; page++) {
    const { data, error } = await db
      .from('beta_signups')
      .select(SELECT_COLS)
      .order('created_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as SignupRow[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

function countBy(rows: SignupRow[], key: (r: SignupRow) => string | null | undefined): Bucket[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const raw = key(r)
    const k = raw == null ? '' : String(raw).trim()
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function countByArray(rows: SignupRow[], key: (r: SignupRow) => string[] | null | undefined): Bucket[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const arr = key(r)
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      const k = item == null ? '' : String(item).trim()
      if (!k) continue
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10)

function dailySeries(rows: SignupRow[], days: number): { day: string; count: number }[] {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (!r.created_at) continue
    const k = dayKey(r.created_at)
    byDay.set(k, (byDay.get(k) ?? 0) + 1)
  }
  const out: { day: string; count: number }[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    const k = d.toISOString().slice(0, 10)
    out.push({ day: k, count: byDay.get(k) ?? 0 })
  }
  return out
}

function cumulativeSeries(rows: SignupRow[], daily: { day: string; count: number }[]): { day: string; total: number }[] {
  const windowStart = daily[0]?.day ?? ''
  const base = windowStart
    ? rows.filter(r => r.created_at && dayKey(r.created_at) < windowStart).length
    : 0
  let run = base
  return daily.map(d => { run += d.count; return { day: d.day, total: run } })
}

async function getBetaData(days = 90) {
  const db = createV2Client()
  const rows = await fetchAllSignups(db)

  const { data: recentData } = await db
    .from('beta_signups')
    .select('first_name, last_name, email, source_classification, referred_by, created_at')
    .order('created_at', { ascending: false })
    .limit(12)
  const recent = (recentData ?? []) as unknown as Array<{
    first_name: string | null; last_name: string | null; email: string | null
    source_classification: string | null; referred_by: string | null; created_at: string | null
  }>

  const now = Date.now()
  const DAY = 86_400_000
  const inLast = (r: SignupRow, from: number, to: number) => {
    if (!r.created_at) return false
    const age = now - new Date(r.created_at).getTime()
    return age > from && age <= to
  }

  const total = rows.length
  const unsubscribed = rows.filter(r => r.unsubscribed_at).length
  const active = rows.filter(r => r.is_active && !r.unsubscribed_at).length
  const invitesSent = rows.filter(r => r.invite_sent_at).length
  const external = rows.filter(r => r.source_classification === 'external').length
  const referred = rows.filter(r => r.referred_by).length

  const thisWeek = rows.filter(r => inLast(r, -1, 7 * DAY)).length
  const lastWeek = rows.filter(r => inLast(r, 7 * DAY, 14 * DAY)).length
  const weekGrowth = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0)

  const daily = dailySeries(rows, days)
  const cumulative = cumulativeSeries(rows, daily)

  return {
    total, active, unsubscribed, invitesSent, external, referred,
    thisWeek, weekGrowth,
    daily, cumulative,
    bySource: countBy(rows, r => r.source_classification),
    byUtmSource: countBy(rows, r => r.utm_source),
    byUtmMedium: countBy(rows, r => r.utm_medium),
    byUtmCampaign: countBy(rows, r => r.utm_campaign),
    byDevice: countBy(rows, r => r.device_type),
    byOS: countBy(rows, r => r.operating_system),
    byEventsPerYear: countBy(rows, r => r.events_per_year),
    byPrimaryValue: countBy(rows, r => r.primary_value),
    byOtherApp: countBy(rows, r => r.other_app),
    byZip: countBy(rows, r => r.zip_code),
    byReferrer: countBy(rows, r => r.referred_by),
    byFanType: countByArray(rows, r => r.fan_types),
    byTracking: countByArray(rows, r => r.tracking_methods),
    recent,
  }
}

// ─── Presentational ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent, trend }: {
  label: string; value: number; icon: React.ElementType; accent: string
  trend?: { value: string; up: boolean }
}) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[14px]" style={{ background: accent }} />
      <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: accent + '18', color: accent }}>
        <Icon className="h-[17px] w-[17px]" />
      </div>
      <p className="mb-1 text-[12px] font-medium text-salty-muted">{label}</p>
      <p className="font-sora text-[28px] font-bold leading-none tracking-tight text-salty-text">{value.toLocaleString()}</p>
      {trend && (
        <p className={`mt-1.5 flex items-center gap-1 text-[12px] ${trend.up ? 'text-[#3E8A5A]' : 'text-[#BF4A3A]'}`}>
          {trend.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {trend.value}
        </p>
      )}
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

function BreakdownList({ items, total, accent, max = 7 }: {
  items: Bucket[]; total: number; accent: string; max?: number
}) {
  if (items.length === 0) return <p className="px-5 py-6 text-[13px] text-salty-muted">No data</p>
  const top = items.slice(0, max)
  const peak = top[0]?.value ?? 1
  return (
    <div className="space-y-2.5 px-5 py-4">
      {top.map(it => (
        <div key={it.name}>
          <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
            <span className="truncate text-salty-secondary">{it.name}</span>
            <span className="shrink-0 font-semibold text-salty-text">
              {it.value.toLocaleString()}
              {total > 0 && <span className="text-salty-muted"> · {Math.round((it.value / total) * 100)}%</span>}
            </span>
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

const SOURCE_STYLE: Record<string, string> = {
  external: 'bg-[#EAF4EE] text-[#3E8A5A]',
  team: 'bg-[#EBF2FA] text-[#3A72A8]',
  family: 'bg-[#F3EBF8] text-[#7B44A8]',
  flagged: 'bg-[#FFF8E6] text-[#8A6830]',
  test: 'bg-stone text-salty-secondary',
}

function SourceBadge({ value }: { value: string | null }) {
  const key = value ?? 'external'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${SOURCE_STYLE[key] ?? 'bg-stone text-salty-secondary'}`}>
      {key}
    </span>
  )
}

function NotConfigured() {
  return (
    <div className="p-7">
      <div className="mb-6">
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Beta Signups</h1>
        <p className="text-[13px] text-salty-muted">Analytics from the v2 database&apos;s <code>beta_signups</code> table</p>
      </div>
      <div className="max-w-2xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] p-6">
        <div className="mb-2 flex items-center gap-2 font-sora text-[15px] font-bold text-[#BF4A3A]">
          <AlertTriangle className="h-4 w-4" /> v2 database not connected
        </div>
        <p className="text-[13px] text-[#8a4a3f]">
          Add the v2 project&apos;s credentials so this page can read <code>beta_signups</code>. In
          your admin panel&apos;s environment (<code>.env.local</code> and Vercel):
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[#F0C4C4] bg-white/70 p-3 text-[12px] text-[#5a3a34]">
{`V2_SUPABASE_URL=https://<v2-ref>.supabase.co
V2_SUPABASE_SERVICE_KEY=<v2 service-role or read-only key>`}
        </pre>
        <p className="mt-3 text-[12px] text-[#8a4a3f]">
          Grab both from the v2 project → Settings → API. Redeploy after adding them on Vercel.
        </p>
      </div>
    </div>
  )
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="p-7">
      <h1 className="mb-4 font-sora text-[20px] font-bold text-salty-text">Beta Signups</h1>
      <div className="max-w-2xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] p-5 text-[13px] text-[#BF4A3A]">
        Couldn&apos;t load from the v2 database: {message}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function BetaSignupsPage() {
  const admin = await requireAdmin(3)

  if (!isV2Configured()) return <NotConfigured />

  let d: Awaited<ReturnType<typeof getBetaData>>
  try {
    d = await getBetaData()
  } catch (e) {
    if (e instanceof V2NotConfiguredError) return <NotConfigured />
    return <LoadError message={(e as Error).message} />
  }

  const kpis = [
    { label: 'Total Signups', value: d.total, icon: Users, accent: '#E8581A' },
    { label: 'Active', value: d.active, icon: UserCheck, accent: '#5A9E6F' },
    { label: 'Invites Sent', value: d.invitesSent, icon: Send, accent: '#5A8FBF' },
    { label: 'Unsubscribed', value: d.unsubscribed, icon: UserX, accent: '#BF4A3A' },
    {
      label: 'New This Week', value: d.thisWeek, icon: Rocket, accent: '#7B44A8',
      trend: { value: `${d.weekGrowth >= 0 ? '+' : ''}${d.weekGrowth}% vs last week`, up: d.weekGrowth >= 0 },
    },
  ]

  const breakdowns: Array<{ title: string; subtitle?: string; items: Bucket[]; accent: string }> = [
    { title: 'Signup Source', subtitle: 'source_classification', items: d.bySource, accent: '#E8581A' },
    { title: 'UTM Source', items: d.byUtmSource, accent: '#5A8FBF' },
    { title: 'UTM Medium', items: d.byUtmMedium, accent: '#5A8FBF' },
    { title: 'UTM Campaign', items: d.byUtmCampaign, accent: '#5A8FBF' },
    { title: 'Device Type', items: d.byDevice, accent: '#7B44A8' },
    { title: 'Operating System', items: d.byOS, accent: '#7B44A8' },
    { title: 'Events / Year', items: d.byEventsPerYear, accent: '#C8A96E' },
    { title: 'Primary Value', items: d.byPrimaryValue, accent: '#C8A96E' },
    { title: 'Fan Types', subtitle: 'multi-select', items: d.byFanType, accent: '#5A9E6F' },
    { title: 'Tracking Methods', subtitle: 'multi-select', items: d.byTracking, accent: '#5A9E6F' },
    { title: 'Other Apps Used', items: d.byOtherApp, accent: '#E8581A' },
    { title: 'Top ZIP Codes', items: d.byZip, accent: '#5A8FBF' },
    { title: 'Top Referrers', subtitle: 'referred_by code', items: d.byReferrer, accent: '#5A9E6F' },
  ]

  return (
    <div className="space-y-6 p-7">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Beta Signups</h1>
        <p className="text-[13px] text-salty-muted">
          Live analytics from the v2 database · {d.external.toLocaleString()} external · {d.referred.toLocaleString()} referred
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map(k => <StatCard key={k.label} {...k} />)}
      </div>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Signups Over Time" subtitle="Last 90 days">
          <div className="px-4 pb-2 pt-4">
            {d.total > 0 ? <SignupsBarChart data={d.daily} /> : <p className="py-10 text-center text-[13px] text-salty-muted">No signups yet</p>}
          </div>
        </Panel>
        <Panel title="Cumulative Growth" subtitle="Running total, last 90 days">
          <div className="px-4 pb-2 pt-4">
            {d.total > 0 ? <CumulativeAreaChart data={d.cumulative} /> : <p className="py-10 text-center text-[13px] text-salty-muted">No signups yet</p>}
          </div>
        </Panel>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {breakdowns.map(b => (
          <Panel key={b.title} title={b.title} subtitle={b.subtitle}>
            <BreakdownList items={b.items} total={d.total} accent={b.accent} />
          </Panel>
        ))}
      </div>

      {/* Recent signups */}
      <Panel title="Recent Signups">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                {['Name', 'Email', 'Source', 'Referred by', 'When'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.recent.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-[13px] text-salty-muted">No signups yet</td></tr>
              ) : (
                d.recent.map((r, i) => {
                  const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—'
                  const email = r.email ? (admin.access_level <= 2 ? r.email : maskEmail(r.email)) : '—'
                  return (
                    <tr key={i} className="border-b border-salty-border last:border-0 hover:bg-cream">
                      <td className="px-5 py-3 text-[13px] font-medium text-salty-text">{name}</td>
                      <td className="px-5 py-3 text-[13px] text-salty-secondary">{email}</td>
                      <td className="px-5 py-3"><SourceBadge value={r.source_classification} /></td>
                      <td className="px-5 py-3 text-[12px] text-salty-secondary">
                        {r.referred_by ? <span className="inline-flex items-center gap-1"><Share2 className="h-3 w-3" />{r.referred_by}</span> : '—'}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap text-[12px] text-salty-secondary">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
