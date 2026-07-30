import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { maskEmail } from '@/lib/privacy'
import { createServiceClient } from '@/lib/supabase/server'
import { createV2Client, isV2Configured, V2NotConfiguredError } from '@/lib/supabase/v2'
import { SignupsBarChart, CumulativeAreaChart } from './charts'
import {
  Users, UserCheck, Send, UserX, TrendingUp, TrendingDown, Rocket, Share2, AlertTriangle, Check, Clock,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SignupRow {
  email: string | null
  first_name: string | null
  last_name: string | null
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
type Scope = 'all' | 'external'
type Granularity = 'day' | 'week'
type Status = 'all' | 'signed' | 'unsigned'

// ─── Fetch ───────────────────────────────────────────────────────────────────

const SELECT_COLS = [
  'email', 'first_name', 'last_name', 'created_at', 'source_classification', 'is_active',
  'unsubscribed_at', 'invite_sent_at', 'utm_source', 'utm_medium', 'utm_campaign', 'device_type',
  'operating_system', 'events_per_year', 'primary_value', 'other_app', 'zip_code', 'fan_types',
  'tracking_methods', 'referral_count', 'referred_by',
].join(', ')

/** Fetch every beta_signups row from the v2 DB, paging past the 1000-row cap (capped at 60k). */
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

/** Map lowercased email → main-DB account (id + created_at). "Signed up" = present here. */
async function fetchMainAccounts(): Promise<Map<string, { id: string; created_at: string | null }>> {
  const map = new Map<string, { id: string; created_at: string | null }>()
  try {
    const db = createServiceClient()
    const PAGE = 1000
    for (let page = 0; page < 60; page++) {
      const { data, error } = await db.from('users').select('id, email, created_at').range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) break
      const rows = (data ?? []) as unknown as { id: string; email: string | null; created_at: string | null }[]
      for (const u of rows) if (u.email) map.set(u.email.trim().toLowerCase(), { id: u.id, created_at: u.created_at })
      if (rows.length < PAGE) break
    }
  } catch { /* main DB unreachable — funnel account/activation stages read 0 */ }
  return map
}

/** Set of main-DB user ids that own ≥1 ticket (i.e. activated). */
async function fetchMainTicketUserIds(): Promise<Set<string>> {
  const set = new Set<string>()
  try {
    const db = createServiceClient()
    const PAGE = 1000
    for (let page = 0; page < 60; page++) {
      const { data, error } = await db.from('tickets').select('user_id').range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) break
      const rows = (data ?? []) as unknown as { user_id: string | null }[]
      for (const r of rows) if (r.user_id) set.add(r.user_id)
      if (rows.length < PAGE) break
    }
  } catch { /* tickets unreachable — activation reads 0 */ }
  return set
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

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

/** Beta-page source: team = @saltydigital.ai email; anyone else on the waitlist = signup link.
 *  ("external" — not in beta_signups — can't occur on this page, since every row IS a signup.) */
function sourceOf(email: string | null): 'team' | 'signup link' {
  return email && email.trim().toLowerCase().endsWith('@saltydigital.ai') ? 'team' : 'signup link'
}

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10)

function weekStartKey(iso: string): string {
  const d = new Date(iso)
  const diff = (d.getUTCDay() + 6) % 7
  const ws = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff))
  return ws.toISOString().slice(0, 10)
}

function dailySeries(rows: SignupRow[], days: number): { day: string; count: number }[] {
  const byDay = new Map<string, number>()
  for (const r of rows) if (r.created_at) byDay.set(dayKey(r.created_at), (byDay.get(dayKey(r.created_at)) ?? 0) + 1)
  const out: { day: string; count: number }[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(today.getUTCDate() - i)
    const k = d.toISOString().slice(0, 10)
    out.push({ day: k, count: byDay.get(k) ?? 0 })
  }
  return out
}

function weeklySeries(rows: SignupRow[], weeks: number): { day: string; count: number }[] {
  const byWeek = new Map<string, number>()
  for (const r of rows) if (r.created_at) byWeek.set(weekStartKey(r.created_at), (byWeek.get(weekStartKey(r.created_at)) ?? 0) + 1)
  const out: { day: string; count: number }[] = []
  const now = new Date()
  const curDiff = (now.getUTCDay() + 6) % 7
  const curWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - curDiff))
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(curWeek); ws.setUTCDate(curWeek.getUTCDate() - i * 7)
    const k = ws.toISOString().slice(0, 10)
    out.push({ day: k, count: byWeek.get(k) ?? 0 })
  }
  return out
}

function cumulative(rows: SignupRow[], series: { day: string; count: number }[]): { day: string; total: number }[] {
  const start = series[0]?.day ?? ''
  let run = start ? rows.filter(r => r.created_at && dayKey(r.created_at) < start).length : 0
  return series.map(s => { run += s.count; return { day: s.day, total: run } })
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

interface ListRow { name: string; email: string | null; source: string | null; created_at: string | null; signedUp: boolean }

async function getBetaData(scope: Scope, granularity: Granularity, status: Status) {
  const db = createV2Client()
  const allRows = await fetchAllSignups(db)
  const rows = scope === 'external' ? allRows.filter(r => sourceOf(r.email) !== 'team') : allRows

  const [accounts, ticketUserIds] = await Promise.all([fetchMainAccounts(), fetchMainTicketUserIds()])

  const now = Date.now()
  const DAY = 86_400_000
  const ageOK = (r: SignupRow, from: number, to: number) => {
    if (!r.created_at) return false
    const age = now - new Date(r.created_at).getTime()
    return age > from && age <= to
  }

  const total = rows.length
  const unsubscribed = rows.filter(r => r.unsubscribed_at).length
  const invited = rows.filter(r => r.invite_sent_at).length
  const teamCount = rows.filter(r => sourceOf(r.email) === 'team').length
  const signupCount = total - teamCount

  // ── Signed-up matching against the MAIN DB users ──
  let accountCreated = 0
  let activated = 0
  const timeToAccountDays: number[] = []
  for (const r of rows) {
    if (!r.email) continue
    const acct = accounts.get(r.email.trim().toLowerCase())
    if (!acct) continue
    accountCreated++
    if (ticketUserIds.has(acct.id)) activated++
    if (r.created_at && acct.created_at) {
      const diff = new Date(acct.created_at).getTime() - new Date(r.created_at).getTime()
      if (diff >= 0) timeToAccountDays.push(diff / DAY)
    }
  }
  const notSignedUp = total - accountCreated
  const medianTimeToAccount = median(timeToAccountDays)

  // ── Referral / virality ──
  const referred = rows.filter(r => r.referred_by).length
  const organic = total - referred
  const totalReferralsDriven = rows.reduce((s, r) => s + (r.referral_count ?? 0), 0)
  const viralCoefficient = total > 0 ? totalReferralsDriven / total : 0

  // ── Growth ──
  const thisWeek = rows.filter(r => ageOK(r, -1, 7 * DAY)).length
  const lastWeek = rows.filter(r => ageOK(r, 7 * DAY, 14 * DAY)).length
  const weekGrowth = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0)

  const series = granularity === 'week' ? weeklySeries(rows, 26) : dailySeries(rows, 90)

  // ── Signed-up / not list (filterable) ──
  const withStatus: ListRow[] = rows.map(r => ({
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '—',
    email: r.email,
    source: sourceOf(r.email),
    created_at: r.created_at,
    signedUp: r.email ? accounts.has(r.email.trim().toLowerCase()) : false,
  }))
  const filtered = status === 'signed' ? withStatus.filter(x => x.signedUp)
    : status === 'unsigned' ? withStatus.filter(x => !x.signedUp)
      : withStatus
  const list = [...filtered]
    .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
    .slice(0, 60)

  return {
    total, invited, unsubscribed, teamCount, signupCount, thisWeek, weekGrowth,
    accountCreated, notSignedUp, activated, medianTimeToAccount,
    referred, organic, totalReferralsDriven, viralCoefficient,
    series, cumulative: cumulative(rows, series),
    bySource: countBy(rows, r => sourceOf(r.email)),
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
    list,
  }
}

// ─── Presentational ──────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, accent, trend }: {
  label: string; value: number; icon: React.ElementType; accent: string; trend?: { value: string; up: boolean }
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

function BreakdownList({ items, total, accent, max = 7 }: { items: Bucket[]; total: number; accent: string; max?: number }) {
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
              {it.value.toLocaleString()}{total > 0 && <span className="text-salty-muted"> · {Math.round((it.value / total) * 100)}%</span>}
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

const FUNNEL_COLORS = ['#E8581A', '#C8A96E', '#5A8FBF', '#5A9E6F']

function Funnel({ stages, total }: { stages: { label: string; value: number }[]; total: number }) {
  return (
    <div className="space-y-3 px-5 py-5">
      {stages.map((s, i) => {
        const pctOfTotal = total > 0 ? Math.round((s.value / total) * 100) : 0
        const prev = i > 0 ? stages[i - 1].value : s.value
        const stepPct = prev > 0 ? Math.round((s.value / prev) * 100) : 0
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-center justify-between text-[12px]">
              <span className="font-medium text-salty-secondary">{s.label}</span>
              <span className="font-semibold text-salty-text">
                {s.value.toLocaleString()} <span className="text-salty-muted">· {pctOfTotal}%</span>
                {i > 0 && <span className="ml-1 text-[11px] text-salty-muted">({stepPct}% of prev)</span>}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-stone">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, pctOfTotal)}%`, background: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const SOURCE_STYLE: Record<string, string> = {
  team: 'bg-[#EBF2FA] text-[#3A72A8]',
  'signup link': 'bg-[#EAF4EE] text-[#3E8A5A]',
  external: 'bg-[#FFF8E6] text-[#8A6830]',
}
function SourceBadge({ value }: { value: string | null }) {
  const key = value ?? 'signup link'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${SOURCE_STYLE[key] ?? 'bg-stone text-salty-secondary'}`}>{key}</span>
}

function Tabs({ options, active }: { options: { label: string; href: string; key: string }[]; active: string }) {
  return (
    <div className="inline-flex gap-1 rounded-lg border border-salty-border bg-cream p-0.5">
      {options.map(o => (
        <Link key={o.key} href={o.href}
          className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${o.key === active ? 'bg-warm-white text-ember shadow-sm' : 'text-salty-secondary hover:text-salty-text'}`}>
          {o.label}
        </Link>
      ))}
    </div>
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
        <div className="mb-2 flex items-center gap-2 font-sora text-[15px] font-bold text-[#BF4A3A]"><AlertTriangle className="h-4 w-4" /> v2 database not connected</div>
        <p className="text-[13px] text-[#8a4a3f]">Add the v2 project&apos;s credentials to your environment (<code>.env.local</code> and Vercel):</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[#F0C4C4] bg-white/70 p-3 text-[12px] text-[#5a3a34]">
{`V2_SUPABASE_URL=https://<v2-ref>.supabase.co
V2_SUPABASE_SERVICE_KEY=<v2 service-role or read-only key>`}
        </pre>
      </div>
    </div>
  )
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="p-7">
      <h1 className="mb-4 font-sora text-[20px] font-bold text-salty-text">Beta Signups</h1>
      <div className="max-w-2xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] p-5 text-[13px] text-[#BF4A3A]">Couldn&apos;t load from the v2 database: {message}</div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function BetaSignupsPage({ searchParams }: { searchParams: Promise<{ scope?: string; bucket?: string; status?: string }> }) {
  const admin = await requireAdmin(3)
  if (!isV2Configured()) return <NotConfigured />

  const sp = await searchParams
  const scope: Scope = sp.scope === 'external' ? 'external' : 'all'
  const granularity: Granularity = sp.bucket === 'week' ? 'week' : 'day'
  const status: Status = sp.status === 'signed' ? 'signed' : sp.status === 'unsigned' ? 'unsigned' : 'all'

  let d: Awaited<ReturnType<typeof getBetaData>>
  try {
    d = await getBetaData(scope, granularity, status)
  } catch (e) {
    if (e instanceof V2NotConfiguredError) return <NotConfigured />
    return <LoadError message={(e as Error).message} />
  }

  const q = (s: Scope, b: Granularity, st: Status) => `/beta-signups?scope=${s}&bucket=${b}&status=${st}`
  const conversionPct = d.total > 0 ? Math.round((d.accountCreated / d.total) * 100) : 0

  const kpis = [
    { label: 'Total Signups', value: d.total, icon: Users, accent: '#E8581A' },
    { label: 'Signed Up', value: d.accountCreated, icon: UserCheck, accent: '#5A9E6F' },
    { label: 'Not Signed Up', value: d.notSignedUp, icon: Clock, accent: '#C8A96E' },
    { label: 'Unsubscribed', value: d.unsubscribed, icon: UserX, accent: '#BF4A3A' },
    { label: 'New This Week', value: d.thisWeek, icon: Rocket, accent: '#7B44A8', trend: { value: `${d.weekGrowth >= 0 ? '+' : ''}${d.weekGrowth}% vs last week`, up: d.weekGrowth >= 0 } },
  ]

  const breakdowns: Array<{ title: string; subtitle?: string; items: Bucket[]; accent: string }> = [
    { title: 'Source', subtitle: 'team vs signup link', items: d.bySource, accent: '#E8581A' },
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
  ]

  return (
    <div className="space-y-6 p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sora text-[20px] font-bold text-salty-text">Beta Signups</h1>
          <p className="text-[13px] text-salty-muted">Waitlist from the v2 DB · signed-up matched against your main DB · {d.signupCount.toLocaleString()} signup link · {d.teamCount.toLocaleString()} team</p>
        </div>
        <Tabs active={scope} options={[{ key: 'all', label: 'All', href: q('all', granularity, status) }, { key: 'external', label: 'Exclude team', href: q('external', granularity, status) }]} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map(k => <StatCard key={k.label} {...k} />)}
      </div>

      {/* Funnel + Virality */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Conversion Funnel" subtitle={`${conversionPct}% of signups signed up${d.medianTimeToAccount != null ? ` · median ${d.medianTimeToAccount.toFixed(1)}d to account` : ''}`}>
          <Funnel total={d.total} stages={[
            { label: 'Signed up (waitlist)', value: d.total },
            { label: 'Invited', value: d.invited },
            { label: 'Created account (main DB)', value: d.accountCreated },
            { label: 'Activated (first ticket)', value: d.activated },
          ]} />
          {d.accountCreated === 0 && <p className="px-5 pb-4 text-[11px] text-salty-muted">No beta emails match a user in your main DB yet.</p>}
        </Panel>

        <Panel title="Referral & Virality" subtitle="Word-of-mouth growth">
          <div className="grid grid-cols-3 divide-x divide-salty-border border-b border-salty-border">
            {[
              { label: 'Referred', value: `${d.total > 0 ? Math.round((d.referred / d.total) * 100) : 0}%`, sub: `${d.referred.toLocaleString()} of ${d.total.toLocaleString()}` },
              { label: 'Viral coeff.', value: d.viralCoefficient.toFixed(2), sub: `${d.totalReferralsDriven.toLocaleString()} referrals` },
              { label: 'Organic', value: d.organic.toLocaleString(), sub: 'no referrer' },
            ].map(s => (
              <div key={s.label} className="px-4 py-4 text-center">
                <p className="font-sora text-[22px] font-bold text-salty-text leading-none">{s.value}</p>
                <p className="mt-1 text-[11px] font-medium text-salty-secondary">{s.label}</p>
                <p className="text-[10px] text-salty-muted">{s.sub}</p>
              </div>
            ))}
          </div>
          <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Top referrers</div>
          <BreakdownList items={d.byReferrer} total={d.total} accent="#5A9E6F" max={6} />
        </Panel>
      </div>

      {/* Time series */}
      <div className="flex items-center justify-between">
        <h2 className="font-sora text-[15px] font-bold text-salty-text">Growth</h2>
        <Tabs active={granularity} options={[{ key: 'day', label: 'Daily (90d)', href: q(scope, 'day', status) }, { key: 'week', label: 'Weekly (26w)', href: q(scope, 'week', status) }]} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Signups Over Time"><div className="px-4 pb-2 pt-4">{d.total > 0 ? <SignupsBarChart data={d.series} /> : <p className="py-10 text-center text-[13px] text-salty-muted">No signups yet</p>}</div></Panel>
        <Panel title="Cumulative Growth"><div className="px-4 pb-2 pt-4">{d.total > 0 ? <CumulativeAreaChart data={d.cumulative} /> : <p className="py-10 text-center text-[13px] text-salty-muted">No signups yet</p>}</div></Panel>
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {breakdowns.map(b => <Panel key={b.title} title={b.title} subtitle={b.subtitle}><BreakdownList items={b.items} total={d.total} accent={b.accent} /></Panel>)}
      </div>

      {/* Signed-up / not list */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-sora text-[15px] font-bold text-salty-text">Signups · who&apos;s signed up</h2>
        <Tabs active={status} options={[
          { key: 'all', label: `All (${d.total})`, href: q(scope, granularity, 'all') },
          { key: 'signed', label: `Signed up (${d.accountCreated})`, href: q(scope, granularity, 'signed') },
          { key: 'unsigned', label: `Not yet (${d.notSignedUp})`, href: q(scope, granularity, 'unsigned') },
        ]} />
      </div>
      <Panel title="" subtitle={`Showing up to 60 · ${status === 'signed' ? 'signed up' : status === 'unsigned' ? 'not yet signed up' : 'all'}`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                {['Name', 'Email', 'Status', 'Source', 'When'].map(h => <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.list.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-[13px] text-salty-muted">No matching signups</td></tr>
              ) : (
                d.list.map((r, i) => {
                  const email = r.email ? (admin.access_level <= 2 ? r.email : maskEmail(r.email)) : '—'
                  return (
                    <tr key={i} className="border-b border-salty-border last:border-0 hover:bg-cream">
                      <td className="px-5 py-3 text-[13px] font-medium text-salty-text">{r.name}</td>
                      <td className="px-5 py-3 text-[13px] text-salty-secondary">{email}</td>
                      <td className="px-5 py-3">
                        {r.signedUp
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF4EE] px-2 py-0.5 text-[11px] font-semibold text-[#3E8A5A]"><Check className="h-3 w-3" />Signed up</span>
                          : <span className="inline-flex items-center gap-1 rounded-full bg-stone px-2 py-0.5 text-[11px] font-semibold text-salty-secondary"><Clock className="h-3 w-3" />Not yet</span>}
                      </td>
                      <td className="px-5 py-3"><SourceBadge value={r.source} /></td>
                      <td className="px-5 py-3 whitespace-nowrap text-[12px] text-salty-secondary">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
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
