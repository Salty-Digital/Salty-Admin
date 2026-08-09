import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { TicketActivityChart } from '@/components/charts/ticket-activity-chart'
import { CategoryDonutChart } from '@/components/charts/category-donut-chart'
import { CATEGORY_EMOJI } from '@/lib/categories'
import {
  Users, Ticket, MailOpen, Import, Wifi,
  TrendingUp, TrendingDown,
  UserPlus, AlertTriangle, ShieldAlert, Settings,
} from 'lucide-react'

// ─── Data helpers ──────────────────────────────────────────────────────────────

async function getActiveTodayCount(db: ReturnType<typeof createServiceClient>) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  let count = 0
  let page = 1
  while (page <= 5) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    const batch = data?.users ?? []
    count += batch.filter(u => u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() >= cutoff).length
    if (batch.length < 1000) break
    page++
  }
  return count
}

async function getDashboardData() {
  const db = createServiceClient()

  const SIX_MONTHS_AGO = new Date()
  SIX_MONTHS_AGO.setMonth(SIX_MONTHS_AGO.getMonth() - 6)
  const cutoff = SIX_MONTHS_AGO.toISOString()
  const nowIso = new Date().toISOString()

  const [
    { count: userCount },
    { count: ticketCount },
    { count: gmailCount },
    { count: imapCount },
    { count: pendingCount },
    { count: bannedCount },
    activeTodayCount,
    { data: recentTickets },
    { data: recentUsers },
    { data: pendingImports },
    { data: recentFeedback },
    { data: recentAuditLog },
  ] = await Promise.all([
    db.from('users').select('*', { count: 'exact', head: true }),
    db.from('tickets').select('*', { count: 'exact', head: true }),
    db.from('gmail_connections').select('*', { count: 'exact', head: true }),
    db.from('imap_connections').select('*', { count: 'exact', head: true }),
    db.from('pending_imports').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('users').select('*', { count: 'exact', head: true }).not('banned_until', 'is', null).gt('banned_until', nowIso),
    getActiveTodayCount(db),
    db.from('tickets').select('source, imported_at').gte('imported_at', cutoff),
    db.from('users').select('id, email, created_at').order('created_at', { ascending: false }).limit(6),
    db.from('pending_imports')
      .select('id, user_id, confidence, status, raw_data, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(3),
    db.from('feedback').select('id, category, rating, message, status, created_at')
      .order('created_at', { ascending: false }).limit(5),
    db.from('admin_audit_log').select('id, admin_id, action, target_type, created_at')
      .order('created_at', { ascending: false }).limit(5),
  ])

  // ── Ticket activity by month ─────────────────────────────────────────
  const byMonth: Record<string, { tickets: number; imports: number }> = {}
  for (const t of recentTickets ?? []) {
    const d = new Date(t.imported_at)
    const key = d.toLocaleString('en-US', { month: 'short' })
    if (!byMonth[key]) byMonth[key] = { tickets: 0, imports: 0 }
    byMonth[key].tickets++
    // "Imports" = auto-populated tickets (anything not hand-entered). Previously this
    // only counted gmail, which badly undercounts now that calendar is the top source.
    if (t.source !== 'manual') byMonth[key].imports++
  }

  const monthLabels: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }))
  }
  const activityData = monthLabels.map((m) => ({
    month: m,
    tickets: byMonth[m]?.tickets ?? 0,
    imports: byMonth[m]?.imports ?? 0,
  }))

  // ── Category breakdown ───────────────────────────────────────────────
  const { data: allTickets } = await db.from('tickets').select('category')
  const catMap: Record<string, number> = {}
  for (const t of allTickets ?? []) catMap[t.category] = (catMap[t.category] ?? 0) + 1
  const categoryData = Object.entries(catMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)

  // ── Platform health ──────────────────────────────────────────────────
  const { count: approvedCount } = await db
    .from('pending_imports').select('*', { count: 'exact', head: true }).eq('status', 'approved')
  const { count: rejectedCount } = await db
    .from('pending_imports').select('*', { count: 'exact', head: true }).eq('status', 'rejected')

  const totalReviewed = (approvedCount ?? 0) + (rejectedCount ?? 0)
  const approveRate = totalReviewed > 0 ? Math.round((approvedCount ?? 0) / totalReviewed * 100) : 0
  const emailConnectedCount = (gmailCount ?? 0) + (imapCount ?? 0)
  const emailAdoption = (userCount ?? 0) > 0 ? Math.round(emailConnectedCount / (userCount ?? 1) * 100) : 0
  const bannedPct = (userCount ?? 0) > 0 ? Math.round((bannedCount ?? 0) / (userCount ?? 1) * 100) : 0

  // Recent activity: combine recent users + feedback + admin actions into a single feed
  const activityFeed = [
    ...(recentUsers ?? []).slice(0, 2).map((u) => ({
      type: 'user' as const,
      title: 'New user signup',
      desc: u.email,
      time: new Date(u.created_at).toLocaleString(),
      ts: new Date(u.created_at).getTime(),
    })),
    ...(recentFeedback ?? []).slice(0, 2).map((f: { id: string; category: string; rating: number; message: string; status: string; created_at: string }) => ({
      type: 'feedback' as const,
      title: `${f.category} feedback`,
      desc: f.message.slice(0, 60) + (f.message.length > 60 ? '…' : ''),
      time: new Date(f.created_at).toLocaleString(),
      ts: new Date(f.created_at).getTime(),
    })),
    ...(recentAuditLog ?? []).map((a: { id: string; admin_id: string; action: string; target_type: string | null; created_at: string }) => ({
      type: 'admin' as const,
      title: a.action.replace(/_/g, ' '),
      desc: a.target_type ? `on ${a.target_type.replace(/_/g, ' ')}` : 'admin action',
      time: new Date(a.created_at).toLocaleString(),
      ts: new Date(a.created_at).getTime(),
    })),
  ].sort((a, b) => b.ts - a.ts).slice(0, 6)

  return {
    userCount: userCount ?? 0,
    ticketCount: ticketCount ?? 0,
    emailConnectedCount,
    pendingCount: pendingCount ?? 0,
    bannedCount: bannedCount ?? 0,
    bannedPct,
    activeTodayCount,
    activityData,
    categoryData,
    approveRate,
    emailAdoption,
    pendingImports: pendingImports ?? [],
    activityFeed,
    recentUsers: recentUsers ?? [],
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon: Icon, accent, trend,
}: {
  label: string
  value: number
  icon: React.ElementType
  accent: string
  trend?: { value: string; up: boolean }
}) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[14px]" style={{ background: accent }} />
      <div
        className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-[10px]"
        style={{ background: accent + '18', color: accent }}
      >
        <Icon className="h-[17px] w-[17px]" />
      </div>
      <p className="mb-1 text-[12px] font-medium text-salty-muted">{label}</p>
      <p className="font-sora text-[28px] font-bold leading-none tracking-tight text-salty-text">
        {value.toLocaleString()}
      </p>
      {trend && (
        <p className={`mt-1.5 flex items-center gap-1 text-[12px] ${trend.up ? 'text-[#3E8A5A]' : 'text-[#BF4A3A]'}`}>
          {trend.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {trend.value}
        </p>
      )}
    </div>
  )
}

function ActivityIcon({ type }: { type: string }) {
  const map: Record<string, { bg: string; color: string; icon: React.ElementType }> = {
    user:     { bg: '#EBF2FA', color: '#3A72A8', icon: UserPlus },
    ticket:   { bg: '#FDF0EA', color: '#E8581A', icon: Ticket },
    feedback: { bg: '#FFF8E6', color: '#C87A10', icon: AlertTriangle },
    import:   { bg: '#EAF4EE', color: '#3E8A5A', icon: MailOpen },
    admin:    { bg: '#F3EBF8', color: '#7B44A8', icon: Settings },
  }
  const { bg, color, icon: Icon } = map[type] ?? map.ticket
  return (
    <div
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
      style={{ background: bg, color }}
    >
      <Icon className="h-[14px] w-[14px]" />
    </div>
  )
}

function Panel({ title, action, children }: {
  title: string
  action?: { label: string; href: string }
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2.5 border-b border-salty-border px-5 py-[18px]">
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {action && (
          <Link
            href={action.href}
            className="ml-auto rounded-md border border-ember-mid bg-ember-light px-2.5 py-1 text-[12px] font-semibold text-ember transition-colors hover:bg-ember-mid"
          >
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}

function HealthBar({ label, pct, color, sub }: { label: string; pct: number; color: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-salty-border px-5 py-3 last:border-0">
      <div className="flex-1 mr-3">
        <p className="text-[13px] text-salty-secondary">{label}</p>
        {sub && <p className="text-[11px] text-salty-muted">{sub}</p>}
        <div className="mt-1.5 h-1 w-40 overflow-hidden rounded-full bg-stone">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
      <span className="font-sora text-[15px] font-bold text-salty-text">{pct}%</span>
    </div>
  )
}

const CONF_COLOR = (c: number) => c >= 0.8 ? '#3E8A5A' : c >= 0.6 ? '#C8A96E' : '#E8581A'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  await requireAdmin()
  const d = await getDashboardData()

  const kpis = [
    { label: 'Total Users',      value: d.userCount,           icon: Users,       accent: '#E8581A' },
    { label: 'Tickets Stored',   value: d.ticketCount,         icon: Ticket,      accent: '#C8A96E' },
    { label: 'Email Connected',  value: d.emailConnectedCount, icon: MailOpen,    accent: '#5A9E6F' },
    { label: 'Active Today',     value: d.activeTodayCount,    icon: Wifi,        accent: '#5A8FBF' },
    { label: 'Pending Review',   value: d.pendingCount,        icon: Import,      accent: '#7B44A8' },
  ]

  return (
    <div className="p-7 space-y-6">

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((k) => <StatCard key={k.label} {...k} />)}
      </div>

      {/* ── Chart + Activity ── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 360px' }}>
        <Panel title="Ticket Activity">
          <div className="px-5 pt-5 pb-1">
            <TicketActivityChart data={d.activityData} />
          </div>
        </Panel>

        <Panel title="Live Activity" action={{ label: 'Audit log', href: '/settings/audit-log' }}>
          <div>
            {d.activityFeed.length === 0 ? (
              <p className="px-5 py-6 text-sm text-salty-muted">No recent activity</p>
            ) : (
              d.activityFeed.map((item, i) => (
                <div
                  key={i}
                  className="flex gap-3 border-b border-salty-border px-5 py-3 last:border-0"
                >
                  <ActivityIcon type={item.type} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] font-medium capitalize text-salty-text">{item.title}</p>
                    <p className="truncate text-[12px] text-salty-secondary">{item.desc}</p>
                    <p className="mt-0.5 text-[11px] text-salty-muted">{item.time}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* ── Users preview ── */}
      <Panel title="Recent Users" action={{ label: 'View all', href: '/users' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                {['User', 'Joined', ''].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.recentUsers.map((u: { id: string; email: string; created_at: string }, idx) => {
                const initials = u.email.slice(0, 2).toUpperCase()
                const bgColors = ['#FBEAF0','#FDF0EA','#EBF2FA','#FBF6ED','#EAF4EE','#F3EBF8']
                const txtColors= ['#993356','#E8581A','#3A72A8','#8A6830','#3E8A5A','#7B44A8']
                return (
                  <tr key={u.id} className="border-b border-salty-border transition-colors last:border-0 hover:bg-cream cursor-pointer">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                          style={{ background: bgColors[idx % 6], color: txtColors[idx % 6] }}
                        >
                          {initials}
                        </div>
                        <span className="text-[13px] font-medium text-salty-text">{u.email}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-salty-secondary">
                      {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/users/${u.id}`} className="text-[12px] font-medium text-ember hover:underline">
                        Manage
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Bottom 3-col ── */}
      <div className="grid grid-cols-3 gap-5">

        {/* Pending imports preview */}
        <Panel title="Pending Imports" action={{ label: 'View all', href: '/pending-imports' }}>
          {d.pendingImports.length === 0 ? (
            <p className="px-5 py-6 text-sm text-salty-muted">No pending imports</p>
          ) : (
            d.pendingImports.map((imp: {
              id: string
              user_id: string
              confidence: number
              status: string
              raw_data: { title?: string | null; venue?: string | null; category?: string; subject?: string }
              created_at: string
            }) => {
              const catEmoji = CATEGORY_EMOJI
              const cat = imp.raw_data?.category ?? 'other'
              const conf = imp.confidence
              return (
                <div key={imp.id} className="flex items-center gap-3 border-b border-salty-border px-5 py-3.5 last:border-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-salty-border bg-cream text-base">
                    {catEmoji[cat] ?? '📋'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-salty-text">
                      {imp.raw_data?.title ?? imp.raw_data?.subject ?? '—'}
                    </p>
                    <p className="text-[11px] text-salty-muted capitalize">{cat}</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Link href="/pending-imports" className="rounded-md border border-[#B8D9C5] bg-[#EAF4EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#3E8A5A] transition-colors hover:bg-[#C9E8D6]">
                        Approve
                      </Link>
                      <Link href="/pending-imports" className="rounded-md border border-[#F0C4C4] bg-[#FDEDED] px-2.5 py-0.5 text-[11px] font-semibold text-[#BF4A3A] transition-colors hover:bg-[#F5D0D0]">
                        Reject
                      </Link>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[12px] font-bold text-salty-text">{Math.round(conf * 100)}%</span>
                    <div className="h-1 w-14 overflow-hidden rounded-full bg-stone">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.round(conf * 100)}%`, background: CONF_COLOR(conf) }}
                      />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </Panel>

        {/* Category donut */}
        <Panel title="Ticket Categories">
          {d.categoryData.length > 0 ? (
            <CategoryDonutChart data={d.categoryData} />
          ) : (
            <p className="px-5 py-6 text-sm text-salty-muted">No tickets yet</p>
          )}
        </Panel>

        {/* Platform health */}
        <Panel title="Platform Health" action={{ label: 'Photos', href: '/photos' }}>
          <HealthBar label="Email Adoption" pct={d.emailAdoption}
            color={d.emailAdoption >= 50 ? '#3E8A5A' : d.emailAdoption >= 25 ? '#C8A96E' : '#E8581A'} />
          <HealthBar label="Import Approval Rate" pct={d.approveRate}
            color={d.approveRate >= 70 ? '#3E8A5A' : d.approveRate >= 40 ? '#C8A96E' : '#E8581A'} />
          <div className="flex items-center justify-between border-b border-salty-border px-5 py-3 last:border-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-3.5 w-3.5 text-[#BF4A3A]" />
              <span className="text-[13px] text-salty-secondary">Banned Users</span>
            </div>
            <span className="font-sora text-[15px] font-bold text-salty-text">{d.bannedCount}</span>
          </div>
        </Panel>

      </div>
    </div>
  )
}
