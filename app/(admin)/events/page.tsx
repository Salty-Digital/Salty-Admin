import Link from 'next/link'
import { CalendarClock, Users as UsersIcon, GitMerge, Fingerprint } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_LABELS, CATEGORY_EMOJI } from '@/lib/categories'
import { classifyEventKey, isStrongKey, fmtEventDate } from '@/lib/events'
import { ClickableRow } from '@/components/ui/clickable-row'
import { EventsFilters } from './events-filters'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ category?: string; key?: string; multi?: string; merged?: string; page?: string }>
}

interface EventRow {
  id: string
  name: string | null
  category: string | null
  event_date: string | null
  event_key: string | null
  venue_id: string | null
}

const PAGE_SIZE = 50

export default async function EventsPage({ searchParams }: PageProps) {
  await requireAdmin(3) // Moderator and above
  const { category = '', key = '', multi = '', merged = '', page = '1' } = await searchParams
  const pageNum = Math.max(1, parseInt(page) || 1)
  const db = createServiceClient()

  // One canonical row per real event, plus every linked ticket so we can count
  // attendance (tickets) and cross-user convergence (distinct users) in JS — the
  // same in-memory-aggregate pattern Data-Quality uses. Both sets are small.
  const [{ data: eventsRaw }, { data: ticketsRaw }, { data: mergedRaw }] = await Promise.all([
    db.from('events').select('id, name, category, event_date, event_key, venue_id').is('merged_into', null).limit(50000),
    db.from('tickets').select('event_id, user_id').not('event_id', 'is', null).limit(50000),
    db.from('events').select('id, merged_into').not('merged_into', 'is', null).limit(50000),
  ])

  const events = (eventsRaw ?? []) as EventRow[]
  const tickets = (ticketsRaw ?? []) as { event_id: string; user_id: string | null }[]

  // Aggregate per canonical event.
  const ticketCount = new Map<string, number>()
  const userSets = new Map<string, Set<string>>()
  for (const t of tickets) {
    ticketCount.set(t.event_id, (ticketCount.get(t.event_id) ?? 0) + 1)
    if (t.user_id) {
      const s = userSets.get(t.event_id) ?? new Set<string>()
      s.add(t.user_id)
      userSets.set(t.event_id, s)
    }
  }
  const mergeCount = new Map<string, number>()
  for (const m of (mergedRaw ?? []) as { merged_into: string | null }[]) {
    if (m.merged_into) mergeCount.set(m.merged_into, (mergeCount.get(m.merged_into) ?? 0) + 1)
  }

  const enriched = events.map((e) => {
    const users = userSets.get(e.id)?.size ?? 0
    return {
      ...e,
      tickets: ticketCount.get(e.id) ?? 0,
      users,
      merges: mergeCount.get(e.id) ?? 0,
      strong: isStrongKey(e.event_key),
    }
  })

  // ── Headline counts (over ALL canonical events, before filtering) ──
  const totalCanonical = enriched.length
  const keyedCount = enriched.filter((e) => e.strong).length
  const multiAttendee = enriched.filter((e) => e.users > 1).length
  const withMerges = enriched.filter((e) => e.merges > 0).length

  // ── Filters ──
  let rows = enriched
  if (category) rows = rows.filter((e) => (e.category ?? 'other') === category)
  if (key === 'keyed') rows = rows.filter((e) => e.strong)
  else if (key === 'fuzzy') rows = rows.filter((e) => !e.strong)
  if (multi === '1') rows = rows.filter((e) => e.users > 1)
  if (merged === '1') rows = rows.filter((e) => e.merges > 0)

  // Most-attended first — cross-user events are the whole point of this view.
  rows.sort((a, b) => b.users - a.users || b.tickets - a.tickets || Date.parse(b.event_date ?? '0') - Date.parse(a.event_date ?? '0'))

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const clamped = Math.min(pageNum, totalPages)
  const pageRows = rows.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE)

  // Resolve venue names only for the visible page.
  const venueIds = [...new Set(pageRows.map((r) => r.venue_id).filter(Boolean))] as string[]
  const { data: venues } = venueIds.length
    ? await db.from('venues').select('id, name, city').in('id', venueIds)
    : { data: [] as { id: string; name: string | null; city: string | null }[] }
  const venueMap = new Map((venues ?? []).map((v) => [v.id, v]))

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ category, key, multi, merged, ...over })
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k)
    return p.toString()
  }

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
          <CalendarClock className="h-5 w-5 text-ember" /> Canonical Events
        </h1>
        <p className="text-[13px] text-salty-muted">
          One row per real-world event that tickets across users collapse into. Click through to see who&apos;s converging on it,
          the shared enrichment, and merge history.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={CalendarClock} label="Canonical events" value={totalCanonical.toLocaleString()} sub={`${tickets.length.toLocaleString()} tickets linked`} accent="#5B6190" />
        <StatCard icon={Fingerprint} label="Strong-ID keyed" value={keyedCount.toLocaleString()} sub={`${totalCanonical - keyedCount} fuzzy title·date`} accent="#5A8FBF" />
        <StatCard icon={UsersIcon} label="Multi-attendee" value={multiAttendee.toLocaleString()} sub="≥ 2 distinct users" accent="#3E8A5A" />
        <StatCard icon={GitMerge} label="Absorbed a merge" value={withMerges.toLocaleString()} sub="canonical winners" accent="#C8A96E" />
      </div>

      <EventsFilters filters={{ category, key, multi, merged }} />

      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                {['Event', 'Category', 'Date', 'Tickets', 'Attendees', 'Identity', 'Merges'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-[13px] text-salty-muted">No events match these filters.</td></tr>
              ) : (
                pageRows.map((e) => {
                  const badge = classifyEventKey(e.event_key)
                  const cat = e.category ?? 'other'
                  const venue = e.venue_id ? venueMap.get(e.venue_id) : null
                  return (
                    <ClickableRow
                      key={e.id}
                      href={`/events/canonical/${e.id}`}
                      ariaLabel={`View ${e.name ?? 'event'} details`}
                      className="border-b border-salty-border last:border-0 hover:bg-cream"
                    >
                      <td className="px-4 py-3 max-w-[280px]">
                        <p className="truncate text-[13px] font-medium text-salty-text">{e.name ?? 'Untitled event'}</p>
                        {venue && <p className="truncate text-[11.5px] text-salty-muted">{[venue.name, venue.city].filter(Boolean).join(' · ')}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-stone px-2.5 py-0.5 text-[11px] font-medium text-salty-secondary">
                          {CATEGORY_EMOJI[cat] ?? '✨'} {CATEGORY_LABELS[cat] ?? cat}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-[12px] text-salty-secondary">{fmtEventDate(e.event_date)}</td>
                      <td className="px-4 py-3 text-[13px] font-semibold text-salty-text tabular-nums">{e.tickets}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[13px] font-semibold tabular-nums ${e.users > 1 ? 'text-[#3E8A5A]' : 'text-salty-text'}`}>{e.users}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: badge.color + '1a', color: badge.color }}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] text-salty-secondary tabular-nums">{e.merges > 0 ? e.merges : '—'}</td>
                    </ClickableRow>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-[13px] text-salty-muted">
        <span>
          {rows.length.toLocaleString()} event{rows.length === 1 ? '' : 's'}
          {rows.length !== totalCanonical && ` (of ${totalCanonical.toLocaleString()})`} · page {clamped} of {totalPages}
        </span>
        <div className="flex gap-3">
          {clamped > 1 && <Link href={`/events?${qs({ page: String(clamped - 1) })}`} className="hover:text-ember">← Previous</Link>}
          {clamped < totalPages && <Link href={`/events?${qs({ page: String(clamped + 1) })}`} className="hover:text-ember">Next →</Link>}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, accent }: { icon: React.ElementType; label: string; value: string; sub?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="absolute bottom-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
      <div className="flex items-center gap-1.5 text-salty-muted">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[12px] font-medium">{label}</p>
      </div>
      <p className="mt-1 font-sora text-[28px] font-bold text-salty-text leading-none">{value}</p>
      {sub && <p className="mt-1.5 text-[11px] text-salty-muted">{sub}</p>}
    </div>
  )
}
