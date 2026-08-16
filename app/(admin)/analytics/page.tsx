import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { CategoryDonutChart } from '@/components/charts/category-donut-chart'
import { TicketActivityChart } from '@/components/charts/ticket-activity-chart'
import { NewUsersChart } from '@/components/charts/new-users-chart'
import { TicketSourceChart } from '@/components/charts/ticket-source-chart'
import { formatPrice } from '@/lib/format'
import {
  loadActivation, loadEngagement, loadSourceEffectiveness,
  loadEnrichmentCoverage, loadTimeToFirstTicket, loadFilterOptions, parseFilters,
} from '@/lib/analytics'
import {
  ActivationFunnel, EngagementPanel, SourcePanel, EnrichmentPanel, TimeToFirstTicketPanel,
} from './behavioural'
import { AnalyticsFilters } from './filters'

function Panel({ title, action, children }: { title: string; action?: { label: string; href: string }; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2.5 border-b border-salty-border px-5 py-4">
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

function StatRow({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-salty-border px-5 py-3 last:border-0">
      <div>
        <p className="text-[13px] text-salty-secondary">{label}</p>
        {sub && <p className="text-[11px] text-salty-muted">{sub}</p>}
      </div>
      <span className="font-sora text-[17px] font-bold text-salty-text">{value}</span>
    </div>
  )
}

async function getActiveUserCounts(db: ReturnType<typeof createServiceClient>) {
  type AuthUser = { last_sign_in_at?: string | null }
  const authUsers: AuthUser[] = []
  let page = 1
  while (page <= 5) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    const batch = (data?.users ?? []) as AuthUser[]
    authUsers.push(...batch)
    if (batch.length < 1000) break
    page++
  }

  const now = Date.now()
  const within = (ms: number) => authUsers.filter(
    u => u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() <= ms,
  ).length

  return {
    dau: within(24 * 60 * 60 * 1000),
    wau: within(7 * 24 * 60 * 60 * 1000),
    mau: within(30 * 24 * 60 * 60 * 1000),
  }
}

interface AnalyticsPageProps {
  searchParams: Promise<{ days?: string; category?: string; source?: string }>
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  await requireAdmin()

  // Options first: parseFilters validates the incoming params against values that actually exist,
  // so a hand-crafted ?category= can never reach SQL as a novel string.
  const filterOptions = await loadFilterOptions()
  const filters = parseFilters(
    await searchParams,
    filterOptions.categories.map((c) => c.value),
    filterOptions.sources.map((s) => s.value),
  )
  const db = createServiceClient()

  const SIX_MONTHS_AGO = new Date()
  SIX_MONTHS_AGO.setMonth(SIX_MONTHS_AGO.getMonth() - 6)
  const cutoff = SIX_MONTHS_AGO.toISOString()

  const THIRTY_DAYS_AGO = new Date()
  THIRTY_DAYS_AGO.setDate(THIRTY_DAYS_AGO.getDate() - 30)
  const nowIso = new Date().toISOString()
  const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalUsers },
    { count: totalTickets },
    { count: gmailConnected },
    { count: imapConnected },
    { count: bannedCount },
    { data: friendships },
    { data: tickets6m },
    { data: allTickets },
    { data: allImports },
    { data: pricedTickets },
    { data: newUsersRaw },
    { data: tierRows },
    { count: photoCount },
    { count: noteCount },
    { count: tagCount },
    { count: auditTotal },
    { data: auditWeek },
    { data: aiQuestions },
    activeUsers,
    activation,
    engagement,
    sourceEffectiveness,
    enrichmentCoverage,
    timeToFirst,
  ] = await Promise.all([
    db.from('users').select('*', { count: 'exact', head: true }),
    db.from('tickets').select('*', { count: 'exact', head: true }),
    db.from('gmail_connections').select('*', { count: 'exact', head: true }),
    db.from('imap_connections').select('*', { count: 'exact', head: true }),
    db.from('users').select('*', { count: 'exact', head: true }).not('banned_until', 'is', null).gt('banned_until', nowIso),
    db.from('friendships').select('status'),
    db.from('tickets').select('source, category, imported_at').gte('imported_at', cutoff),
    db.from('tickets').select('category, venue_name, source'),
    db.from('pending_imports').select('status'),
    db.from('tickets').select('price_paid, price_currency, category').not('price_paid', 'is', null),
    db.from('users').select('created_at').gte('created_at', THIRTY_DAYS_AGO.toISOString()),
    db.from('users').select('tier'),
    db.from('photos').select('*', { count: 'exact', head: true }),
    db.from('ticket_notes').select('*', { count: 'exact', head: true }),
    db.from('ticket_tags').select('*', { count: 'exact', head: true }),
    db.from('admin_audit_log').select('*', { count: 'exact', head: true }),
    db.from('admin_audit_log').select('admin_id').gte('created_at', SEVEN_DAYS_AGO),
    // Fan Memory AI (ask-memory edge function → saved_ai_questions). Same source
    // the /ai-usage page reads from — this panel is the top-line summary.
    db.from('saved_ai_questions').select('id, user_id, created_at'),
    getActiveUserCounts(db),
    // Behavioural aggregates, all computed in Postgres (migration 020). loadEngagement never
    // throws — a PostHog outage degrades that one panel rather than the whole page.
    loadActivation(filters),
    // Engagement is event-based and has no category/source dimension, so only the window applies.
    loadEngagement(filters.days ?? 90),
    loadSourceEffectiveness(filters),
    loadEnrichmentCoverage(filters),
    loadTimeToFirstTicket(filters),
  ])

  // ── Ticket activity by month ─────────────────────────────────────────
  const monthLabels: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }))
  }
  const byMonth: Record<string, { tickets: number; imports: number }> = {}
  for (const t of tickets6m ?? []) {
    const m = new Date(t.imported_at).toLocaleString('en-US', { month: 'short' })
    if (!byMonth[m]) byMonth[m] = { tickets: 0, imports: 0 }
    byMonth[m].tickets++
    if (t.source === 'gmail') byMonth[m].imports++
  }
  const activityData = monthLabels.map(m => ({ month: m, tickets: byMonth[m]?.tickets ?? 0, imports: byMonth[m]?.imports ?? 0 }))

  // ── Category distribution ────────────────────────────────────────────
  const catMap: Record<string, number> = {}
  for (const t of allTickets ?? []) catMap[t.category] = (catMap[t.category] ?? 0) + 1
  const categoryData = Object.entries(catMap).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value)

  // ── Top venues ───────────────────────────────────────────────────────
  const venueMap: Record<string, number> = {}
  for (const t of allTickets ?? []) {
    if (t.venue_name) venueMap[t.venue_name] = (venueMap[t.venue_name] ?? 0) + 1
  }
  const topVenues = Object.entries(venueMap).sort((a,b) => b[1]-a[1]).slice(0, 10)

  // ── Friendship stats ─────────────────────────────────────────────────
  const accepted = (friendships ?? []).filter(f => f.status === 'accepted').length
  const pendingFriends = (friendships ?? []).filter(f => f.status === 'pending').length
  const avgFriends = totalUsers ? (accepted * 2 / totalUsers).toFixed(1) : '0'

  // ── Import stats ─────────────────────────────────────────────────────
  const approvedImports = (allImports ?? []).filter(i => i.status === 'approved').length
  const rejectedImports = (allImports ?? []).filter(i => i.status === 'rejected').length
  const totalReviewed = approvedImports + rejectedImports
  const approvalRate = totalReviewed > 0 ? Math.round(approvedImports / totalReviewed * 100) : 0
  const emailConnectedCount = (gmailConnected ?? 0) + (imapConnected ?? 0)
  const emailRate = totalUsers ? Math.round(emailConnectedCount / totalUsers * 100) : 0

  // ── Spend (tickets with a recorded price) ────────────────────────────
  const pricedRows = (pricedTickets ?? []).filter(t => typeof t.price_paid === 'number')
  const totalSpend = pricedRows.reduce((s, t) => s + Number(t.price_paid), 0)
  const avgPrice = pricedRows.length > 0 ? totalSpend / pricedRows.length : 0
  const spendCurrency = pricedRows[0]?.price_currency ?? 'USD'
  const spendByCat: Record<string, number> = {}
  for (const t of pricedRows) spendByCat[t.category] = (spendByCat[t.category] ?? 0) + Number(t.price_paid)
  const topSpendCats = Object.entries(spendByCat).sort((a, b) => b[1] - a[1]).slice(0, 6)

  // ── New users per day (last 30 days) ─────────────────────────────────
  const dayMap: Record<string, number> = {}
  for (const u of newUsersRaw ?? []) {
    const day = u.created_at.slice(0, 10)
    dayMap[day] = (dayMap[day] ?? 0) + 1
  }
  const newUsersData: { day: string; count: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    newUsersData.push({ day: key, count: dayMap[key] ?? 0 })
  }

  // ── Ticket source distribution ────────────────────────────────────────
  const srcMap: Record<string, number> = {}
  for (const t of allTickets ?? []) srcMap[t.source] = (srcMap[t.source] ?? 0) + 1
  const sourceData = Object.entries(srcMap).map(([source, count]) => ({ source, count }))

  // ── Tier distribution ───────────────────────────────────────────────
  const tierMap: Record<string, number> = { free: 0, premium: 0, family: 0 }
  for (const u of tierRows ?? []) {
    const t = u.tier ?? 'free'
    tierMap[t] = (tierMap[t] ?? 0) + 1
  }

  // ── Admin activity ──────────────────────────────────────────────────
  const adminCountMap: Record<string, number> = {}
  for (const a of auditWeek ?? []) adminCountMap[a.admin_id] = (adminCountMap[a.admin_id] ?? 0) + 1
  const topAdminId = Object.entries(adminCountMap).sort((a, b) => b[1] - a[1])[0]
  let topAdminLabel = '—'
  if (topAdminId) {
    const { data: topAdmin } = await db.from('admin_users').select('email, full_name').eq('id', topAdminId[0]).maybeSingle()
    topAdminLabel = topAdmin?.full_name ?? topAdmin?.email ?? '—'
  }

  const bannedPct = totalUsers ? Math.round((bannedCount ?? 0) / totalUsers * 100) : 0

  // ── Claude AI (Fan Memory) ─────────────────────────────────────────
  type AiRow = { user_id?: string | null; created_at?: string | null }
  const aiRows: AiRow[] = (aiQuestions ?? []) as AiRow[]
  const aiTotal = aiRows.length
  const aiUsers = new Set(aiRows.map(q => q.user_id).filter((v): v is string => !!v)).size
  const aiLast7 = aiRows.filter(q => q.created_at && Date.now() - new Date(q.created_at).getTime() <= 7 * 86_400_000).length
  const aiAvgPerUser = aiUsers > 0 ? (aiTotal / aiUsers).toFixed(1) : '0'

  return (
    <div className="p-7 space-y-6">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Analytics</h1>
        <p className="text-[13px] text-salty-muted">Platform metrics and usage trends</p>
      </div>

      <AnalyticsFilters categories={filterOptions.categories} sources={filterOptions.sources} />

      {/* Behavioural analytics. Placed above the count panels on purpose: "how many tickets exist"
          is a description, "are users activating and coming back" is a decision.
          These four honour the filters; the count panels below are still all-time. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ActivationFunnel a={activation} />
        <EngagementPanel e={engagement} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <SourcePanel rows={sourceEffectiveness} />
        <TimeToFirstTicketPanel rows={timeToFirst} />
      </div>
      <EnrichmentPanel rows={enrichmentCoverage} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: 'Total Users',       value: (totalUsers ?? 0).toLocaleString(),   accent: '#E8581A' },
          { label: 'Total Tickets',     value: (totalTickets ?? 0).toLocaleString(), accent: '#C8A96E' },
          { label: 'Email Adoption',    value: `${emailRate}%`,                       accent: '#5A9E6F' },
          { label: 'Import Approval',   value: `${approvalRate}%`,                    accent: '#5A8FBF' },
          { label: 'Banned Users',      value: (bannedCount ?? 0).toLocaleString(),  accent: '#BF4A3A' },
        ].map(c => (
          <div key={c.label} className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
            <div className="absolute bottom-0 left-0 right-0 h-[3px] rounded-b-[14px]" style={{ background: c.accent }} />
            <p className="text-[12px] font-medium text-salty-muted">{c.label}</p>
            <p className="mt-1 font-sora text-[28px] font-bold text-salty-text leading-none">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Active users */}
      <Panel title="Active Users" action={{ label: 'View list', href: '/users/active' }}>
        <div className="grid grid-cols-3 divide-x divide-salty-border">
          {[
            { label: 'Daily Active (24h)',  value: activeUsers.dau },
            { label: 'Weekly Active (7d)',   value: activeUsers.wau },
            { label: 'Monthly Active (30d)', value: activeUsers.mau },
          ].map(s => (
            <div key={s.label} className="px-5 py-4 text-center">
              <p className="font-sora text-[26px] font-bold text-salty-text">{s.value}</p>
              <p className="mt-0.5 text-[12px] text-salty-muted">{s.label}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Ticket activity + Category */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Ticket Activity (Last 6 Months)">
          <div className="px-5 pt-5 pb-3">
            <TicketActivityChart data={activityData} />
          </div>
        </Panel>
        <Panel title="Ticket Category Distribution">
          {categoryData.length > 0 ? (
            <CategoryDonutChart data={categoryData} />
          ) : (
            <p className="px-5 py-6 text-[13px] text-salty-muted">No tickets yet</p>
          )}
        </Panel>
      </div>

      {/* New users + Ticket source */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="New Users (Last 30 Days)">
          <div className="px-5 pt-5 pb-3">
            <NewUsersChart data={newUsersData} />
          </div>
        </Panel>
        <Panel title="Tickets by Source">
          {sourceData.length > 0 ? (
            <div className="px-5 pt-5 pb-3">
              <TicketSourceChart data={sourceData} />
            </div>
          ) : (
            <p className="px-5 py-6 text-[13px] text-salty-muted">No ticket data</p>
          )}
        </Panel>
      </div>

      {/* Top venues + Platform stats */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Top Venues by Ticket Count">
          {topVenues.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-salty-muted">No venue data</p>
          ) : (
            topVenues.map(([venue, count]) => {
              const pct = Math.round(count / (totalTickets || 1) * 100)
              return (
                <div key={venue} className="flex items-center gap-3 border-b border-salty-border px-5 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-salty-text">{venue}</p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone">
                      <div className="h-full rounded-full bg-ember" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="font-sora text-[14px] font-bold text-salty-text shrink-0">{count}</span>
                </div>
              )
            })
          )}
        </Panel>

        <Panel title="Platform Health">
          <StatRow label="Email Adoption" value={`${emailRate}%`} sub={`${emailConnectedCount} of ${totalUsers} users (Gmail + IMAP)`} />
          <StatRow label="Import Approval Rate" value={`${approvalRate}%`} sub={`${approvedImports} approved / ${rejectedImports} rejected`} />
          <StatRow label="Avg Friends per User" value={avgFriends} sub={`${accepted} accepted · ${pendingFriends} pending`} />
          <StatRow label="Banned Users" value={`${bannedPct}%`} sub={`${bannedCount ?? 0} of ${totalUsers} users`} />
        </Panel>
      </div>

      {/* Spend */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Ticket Spend" action={{ label: 'View tickets', href: '/tickets' }}>
          <StatRow label="Total Recorded Spend" value={formatPrice(totalSpend, spendCurrency)} sub={`${pricedRows.length} ticket${pricedRows.length !== 1 ? 's' : ''} with a price`} />
          <StatRow label="Average Ticket Price" value={formatPrice(avgPrice, spendCurrency)} />
          <StatRow label="Tickets Missing Price" value={((totalTickets ?? 0) - pricedRows.length).toLocaleString()} sub={totalTickets ? `${Math.round((1 - pricedRows.length / totalTickets) * 100)}% of tickets` : undefined} />
        </Panel>

        <Panel title="Spend by Category">
          {topSpendCats.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-salty-muted">No priced tickets yet</p>
          ) : (
            topSpendCats.map(([cat, amount]) => {
              const pct = totalSpend > 0 ? Math.round(amount / totalSpend * 100) : 0
              return (
                <div key={cat} className="flex items-center gap-3 border-b border-salty-border px-5 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium capitalize text-salty-text">{cat}</p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="font-sora text-[14px] font-bold text-salty-text shrink-0">{formatPrice(amount, spendCurrency)}</span>
                </div>
              )
            })
          )}
        </Panel>
      </div>

      {/* Claude AI (Fan Memory) */}
      <Panel title="Claude AI Usage" action={{ label: 'View details', href: '/ai-usage' }}>
        <div className="grid grid-cols-2 divide-x divide-salty-border lg:grid-cols-4">
          {[
            { label: 'Total Questions', value: aiTotal.toLocaleString() },
            { label: 'Unique Users',    value: aiUsers.toLocaleString() },
            { label: 'Last 7 Days',     value: aiLast7.toLocaleString() },
            { label: 'Avg / User',      value: aiAvgPerUser },
          ].map(s => (
            <div key={s.label} className="px-5 py-4 text-center">
              <p className="font-sora text-[26px] font-bold text-salty-text">{s.value}</p>
              <p className="mt-0.5 text-[12px] text-salty-muted">{s.label}</p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Tiers + Photos + Admin activity */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="User Tiers" action={{ label: 'View users', href: '/users' }}>
          <StatRow label="Free" value={tierMap.free} sub={totalUsers ? `${Math.round(tierMap.free / totalUsers * 100)}%` : undefined} />
          <StatRow label="Premium" value={tierMap.premium} sub={totalUsers ? `${Math.round(tierMap.premium / totalUsers * 100)}%` : undefined} />
          <StatRow label="Family" value={tierMap.family} sub={totalUsers ? `${Math.round(tierMap.family / totalUsers * 100)}%` : undefined} />
        </Panel>

        <Panel title="Photos" action={{ label: 'Review', href: '/photos' }}>
          <StatRow label="Photos" value={photoCount ?? 0} />
          <StatRow label="Ticket Notes" value={noteCount ?? 0} />
          <StatRow label="Ticket Tags" value={tagCount ?? 0} />
        </Panel>

        <Panel title="Admin Activity" action={{ label: 'Audit log', href: '/settings/audit-log' }}>
          <StatRow label="Total Events Logged" value={(auditTotal ?? 0).toLocaleString()} />
          <StatRow label="Events (Last 7 Days)" value={(auditWeek ?? []).length} />
          <StatRow label="Most Active Admin" value={topAdminLabel} sub="last 7 days" />
        </Panel>
      </div>
    </div>
  )
}
