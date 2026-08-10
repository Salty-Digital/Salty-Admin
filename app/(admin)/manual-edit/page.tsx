import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { sanitizeOrFilterTerm } from '@/lib/validate'
import { CATEGORY_LABELS } from '@/lib/categories'
import { ManualEditClient, type TicketFull } from './manual-edit-client'
import { ManualEditFilters } from './manual-edit-filters'
import { QueueCard } from './queue-card'
import { BulkActions } from './bulk-actions'
import { Search, SquarePen } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ ticket?: string; q?: string; flag?: string; cat?: string; sort?: string; dir?: string; view?: string; bucket?: string }>
}

export default async function ManualEditPage({ searchParams }: PageProps) {
  await requireAdmin(2) // Super Admin + Admin only
  const { ticket: ticketId, q = '', flag = '', cat = '', sort = 'flags', dir = 'desc', view: viewParam = '', bucket = '' } = await searchParams
  const db = createServiceClient()

  if (ticketId) {
    return <Editor ticketId={ticketId} />
  }

  // ── Queue view: auto-populated past events that need edits, split into Pending vs
  //    Done (admin_ticket_reviews). Search narrows to a specific ticket. Filtering +
  //    sorting run in memory over the fetched candidates. ──
  const searching = !!q.trim()
  const view = viewParam === 'done' ? 'done' : 'pending'
  const enrich = await loadEnrichment(db)

  // Which tickets an admin has marked "done".
  const { data: reviews } = await db.from('admin_ticket_reviews').select('ticket_id')
  const reviewedSet = new Set((reviews ?? []).map((r) => r.ticket_id as string))
  const doneCount = reviewedSet.size

  // Pending = flagged + past + not yet done. Always computed — it drives the count cards.
  const { data: candData } = await db
    .from('tickets').select(TICKET_COLS).or(CANDIDATE_OR).order('imported_at', { ascending: false }).limit(500)
  const pendingAll = (await toRows(db, (candData ?? []) as TicketPick[], enrich))
    .filter((r) => r.flags.length > 0 && r.isPast && !reviewedSet.has(r.id))
  const pendingCount = pendingAll.length
  const catCount = new Map<string, number>()
  for (const r of pendingAll) catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1)

  // Split pending by data quality. "No proper data" = the import itself is unreliable or
  // incomplete (missing a core field, low-confidence, or couldn't be categorised) — those
  // usually can't be fixed by hand. The rest have solid data and just miss a detail
  // (a category is fine; they're only flagged for missing enrichment: cast/setlist/result).
  const isBroken = (r: ListRow) =>
    r.flags.some((f) => f === 'No title' || f === 'No venue' || f === 'No date' || f === 'Uncategorised' || f === 'Low confidence')
  const brokenCount = pendingAll.filter(isBroken).length
  const missingCount = pendingCount - brokenCount

  // The list to display for the current view.
  let all: ListRow[]
  if (searching) {
    const safe = sanitizeOrFilterTerm(q)
    const { data } = await db
      .from('tickets').select(TICKET_COLS).or(`title.ilike.%${safe}%,venue_name.ilike.%${safe}%`).order('imported_at', { ascending: false }).limit(60)
    all = await toRows(db, (data ?? []) as TicketPick[], enrich)
  } else if (view === 'done') {
    const ids = [...reviewedSet]
    const { data } = ids.length
      ? await db.from('tickets').select(TICKET_COLS).in('id', ids).order('imported_at', { ascending: false }).limit(500)
      : { data: [] as TicketPick[] }
    all = await toRows(db, (data ?? []) as TicketPick[], enrich)
  } else {
    all = bucket === 'broken' ? pendingAll.filter(isBroken)
        : bucket === 'missing' ? pendingAll.filter((r) => !isBroken(r))
        : pendingAll
  }

  const filtered = applyView(all, { flag, cat, sort, dir })
  const rows = filtered.slice(0, 60)
  const emptyLabel = searching
    ? `No tickets match “${q}”.`
    : view === 'done'
      ? 'No tickets marked done yet.'
      : flag || cat
        ? 'No tickets match these filters.'
        : 'Nothing needs manual review right now. 🎉'

  // Build a href that preserves the current filters/sort/view, with overrides.
  const qhref = (over: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      flag, cat, sort: sort === 'flags' ? undefined : sort, dir: dir === 'desc' ? undefined : dir,
      view: view === 'pending' ? undefined : view, bucket: bucket || undefined, ...over,
    }
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    const s = p.toString()
    return '/manual-edit' + (s ? `?${s}` : '')
  }

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
          <SquarePen className="h-5 w-5 text-ember" /> Manual Edit
        </h1>
        <p className="text-[13px] text-salty-muted">
          Tickets that need attention are listed below. Pick one to correct its details — everything you
          change is written straight to the user&apos;s data and shows in the app, and AI lookup can help fill
          the fields. Or search for a specific ticket.
        </p>
      </div>

      <form className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-salty-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by title or venue…"
            className="w-full rounded-lg border border-salty-border bg-cream py-2 pl-9 pr-3 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none font-sans"
          />
        </div>
        <button className="rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-ember/90 transition-colors">
          Search
        </button>
        {searching && (
          <Link href="/manual-edit" className="flex items-center rounded-lg border border-salty-border bg-warm-white px-3 py-2 text-[13px] text-salty-secondary hover:bg-cream transition-colors">
            Clear
          </Link>
        )}
      </form>

      <ManualEditFilters flag={flag} cat={cat} sort={sort} dir={dir} searching={searching} />

      {!searching && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Pending" value={pendingCount} href={qhref({ view: undefined, bucket: undefined, cat: undefined, flag: undefined })} active={view === 'pending' && !bucket} tone="ember" />
            <StatCard label="Missing a detail" hint="good data · needs enrichment" value={missingCount} href={qhref({ view: undefined, bucket: bucket === 'missing' ? undefined : 'missing' })} active={view === 'pending' && bucket === 'missing'} tone="warn" />
            <StatCard label="No proper data" hint="low-confidence / uncategorised" value={brokenCount} href={qhref({ view: undefined, bucket: bucket === 'broken' ? undefined : 'broken' })} active={view === 'pending' && bucket === 'broken'} tone="bad" />
            <StatCard label="Done" value={doneCount} href={qhref({ view: 'done', bucket: undefined, cat: undefined, flag: undefined })} active={view === 'done'} tone="good" />
          </div>

          {view === 'pending' && catCount.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...catCount.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => {
                const on = cat === c
                return (
                  <Link
                    key={c}
                    href={qhref({ cat: on ? undefined : c })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors ${on ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-warm-white text-salty-secondary hover:bg-cream'}`}
                  >
                    {CATEGORY_LABELS[c] ?? c}
                    <span className="font-bold">{n}</span>
                  </Link>
                )
              })}
            </div>
          )}

          <p className="text-[12.5px] text-salty-muted">
            {view === 'done' ? (
              <>Showing <span className="font-semibold text-salty-text">{rows.length}</span> ticket{rows.length === 1 ? '' : 's'} marked done.</>
            ) : bucket === 'missing' ? (
              <>Showing <span className="font-semibold text-salty-text">{rows.length}</span> of <span className="font-semibold text-salty-text">{missingCount}</span> with solid data — the event is right, it just needs a detail (cast / result) fetched.</>
            ) : bucket === 'broken' ? (
              <>Showing <span className="font-semibold text-salty-text">{rows.length}</span> of <span className="font-semibold text-salty-text">{brokenCount}</span> with no proper data — low-confidence, uncategorised, or missing core fields; these often can&apos;t be fixed by hand.</>
            ) : (
              <>Showing <span className="font-semibold text-salty-text">{rows.length}</span> of <span className="font-semibold text-salty-text">{pendingCount}</span> pending — past events missing core fields, category, confidence, or admin-fetchable details (cast / result). Setlists fill automatically in-app and aren&apos;t listed.</>
            )}
          </p>

          {view === 'pending' && filtered.length > 0 && (
            <BulkActions rows={filtered.map((r) => ({ id: r.id, category: r.category, flags: r.flags }))} />
          )}
        </>
      )}

      {rows.length === 0 ? (
        <div className="rounded-[14px] border border-salty-border bg-warm-white">
          <p className="px-4 py-10 text-center text-[13px] text-salty-muted">{emptyLabel}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <QueueCard key={t.id} row={t} done={reviewedSet.has(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, href, active, tone, hint }: { label: string; value: number; href: string; active: boolean; tone: 'ember' | 'good' | 'warn' | 'bad'; hint?: string }) {
  const color = tone === 'good' ? 'text-[#3E8A5A]' : tone === 'warn' ? 'text-gold' : tone === 'bad' ? 'text-[#BF4A3A]' : 'text-ember'
  return (
    <Link
      href={href}
      className={`rounded-[14px] border bg-warm-white p-4 transition-colors ${active ? 'border-ember ring-2 ring-ember/20' : 'border-salty-border hover:border-salty-muted'}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{label}</p>
      <p className={`mt-1 font-sora text-[24px] font-bold ${color}`}>{value.toLocaleString()}</p>
      {hint && <p className="text-[10.5px] text-salty-muted">{hint}</p>}
    </Link>
  )
}

// Conditions that mark a ticket as "needs manual editing". No user input → safe to inline.
const NEEDS_EDIT_OR = 'title.is.null,venue_name.is.null,date_str.is.null,category.eq.other,status.eq.pending,confidence.lt.0.5'
// Only categories whose enrichment an admin can actually trigger from this page: theater
// (Fetch cast) and sports (Fetch exact result). Concert/festival/edm setlists are omitted
// on purpose — setlist-lookup needs the real signed-in user, so it can't be admin-triggered
// and only fills in-app; flagging those here would just pad the queue with un-actionable rows.
const ENRICHABLE = 'category.in.(theater,sports)'
const CANDIDATE_OR = `${NEEDS_EDIT_OR},${ENRICHABLE}`
const TICKET_COLS = 'id, title, venue_name, date_str, category, confidence, status, imported_at, user_id'

interface TicketPick {
  id: string; title: string | null; venue_name: string | null; date_str: string | null
  category: string; confidence: number | null; status: string | null; imported_at: string | null
  user_id: string
}

interface Enrich { cast: Set<string>; sports: Set<string> }

async function loadEnrichment(db: ReturnType<typeof createServiceClient>): Promise<Enrich> {
  const [c, sp] = await Promise.all([
    db.from('ticket_cast').select('ticket_id'),
    db.from('sports_stats').select('ticket_id'),
  ])
  const ids = (rows: { ticket_id: string | null }[] | null) =>
    new Set((rows ?? []).map((r) => r.ticket_id).filter((x): x is string => !!x))
  return { cast: ids(c.data), sports: ids(sp.data) }
}
interface ListRow {
  id: string; title: string | null; venue_name: string | null; date_str: string | null
  category: string; email: string | null; flags: string[]; imported: number; confidence: number | null
  isPast: boolean
}

// The `is_past` column is unreliable, and there's no real date column — the event
// date lives only in free-text `date_str`. Parse it and compare to the start of today:
// strictly before today counts as past (same-day and future do not; unparseable → not past).
function isPastDate(dateStr: string | null): boolean {
  if (!dateStr) return false
  const ms = Date.parse(dateStr)
  if (Number.isNaN(ms)) return false
  const d = new Date(ms)
  const now = new Date()
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

function flagsFor(t: TicketPick, enrich: Enrich, isPast: boolean): string[] {
  const f: string[] = []
  if (!t.title || !t.title.trim()) f.push('No title')
  if (!t.venue_name) f.push('No venue')
  if (!t.date_str) f.push('No date')
  if (t.category === 'other') f.push('Uncategorised')
  if (typeof t.confidence === 'number' && t.confidence < 0.5) f.push('Low confidence')
  if (t.status === 'pending') f.push('Pending')
  // Missing event-details data that an admin can actually trigger from this page: cast for
  // theatre, result once the game is past. (Setlists are intentionally not flagged — see
  // ENRICHABLE: setlist-lookup can't be admin-triggered, so it would be un-actionable noise.)
  if (t.category === 'theater' && !enrich.cast.has(t.id)) f.push('No cast')
  if (isPast && t.category === 'sports' && !enrich.sports.has(t.id)) f.push('No result')
  return f
}

async function toRows(db: ReturnType<typeof createServiceClient>, data: TicketPick[], enrich: Enrich): Promise<ListRow[]> {
  const uids = [...new Set(data.map((t) => t.user_id).filter(Boolean))]
  const { data: users } = uids.length
    ? await db.from('users').select('id, email').in('id', uids)
    : { data: [] as { id: string; email: string | null }[] }
  const emailById = new Map((users ?? []).map((u) => [u.id, u.email]))
  return data.map((t) => {
    const isPast = isPastDate(t.date_str)
    return {
      id: t.id, title: t.title, venue_name: t.venue_name, date_str: t.date_str, category: t.category,
      email: emailById.get(t.user_id) ?? null, flags: flagsFor(t, enrich, isPast),
      imported: t.imported_at ? Date.parse(t.imported_at) : 0,
      confidence: t.confidence, isPast,
    }
  })
}

// The ordered pending queue (default view) — lets the editor offer Prev / Next / Done-&-next
// without bouncing back to the list. Mirrors the queue: flagged + past + not reviewed, sorted
// by most issues first.
async function loadPendingOrder(db: ReturnType<typeof createServiceClient>): Promise<string[]> {
  const enrich = await loadEnrichment(db)
  const { data: reviews } = await db.from('admin_ticket_reviews').select('ticket_id')
  const reviewedSet = new Set((reviews ?? []).map((r) => r.ticket_id as string))
  const { data: candData } = await db
    .from('tickets').select(TICKET_COLS).or(CANDIDATE_OR).order('imported_at', { ascending: false }).limit(500)
  const pendingAll = (await toRows(db, (candData ?? []) as TicketPick[], enrich))
    .filter((r) => r.flags.length > 0 && r.isPast && !reviewedSet.has(r.id))
  return applyView(pendingAll, { flag: '', cat: '', sort: 'flags', dir: 'desc' }).map((r) => r.id)
}

const FLAG_LABEL: Record<string, string> = {
  'no-title': 'No title', 'no-venue': 'No venue', 'no-date': 'No date',
  'uncategorised': 'Uncategorised', 'low-confidence': 'Low confidence', 'pending': 'Pending',
  'no-cast': 'No cast', 'no-result': 'No result',
}

/** In-memory filter + sort over the fetched candidates (driven by URL params). */
function applyView(rows: ListRow[], v: { flag: string; cat: string; sort: string; dir: string }): ListRow[] {
  let out = rows
  const label = FLAG_LABEL[v.flag]
  if (label) out = out.filter((r) => r.flags.includes(label))
  if (v.cat) out = out.filter((r) => r.category === v.cat)
  const m = v.dir === 'asc' ? 1 : -1
  return out.slice().sort((a, b) => {
    switch (v.sort) {
      case 'title': return m * (a.title ?? '').localeCompare(b.title ?? '', undefined, { numeric: true })
      case 'category': return m * a.category.localeCompare(b.category)
      case 'imported': return m * (a.imported - b.imported)
      case 'confidence':
        if (a.confidence == null && b.confidence == null) return 0
        if (a.confidence == null) return 1
        if (b.confidence == null) return -1
        return m * (a.confidence - b.confidence)
      case 'flags':
      default: return m * (a.flags.length - b.flags.length)
    }
  })
}

async function Editor({ ticketId }: { ticketId: string }) {
  const db = createServiceClient()

  const { data: ticket } = await db
    .from('tickets')
    .select('id, user_id, title, original_title, venue_name, date_str, time_str, seat, section, category, price_paid, price_currency, est_price, rating, status, image_url')
    .eq('id', ticketId)
    .single()

  if (!ticket) {
    return (
      <div className="p-7">
        <Link href="/manual-edit" className="text-[13px] text-ember hover:underline">← Back to search</Link>
        <p className="mt-6 text-[14px] text-salty-muted">Ticket not found.</p>
      </div>
    )
  }

  const [ownerRes, tagsRes, notesRes, castRes, setlistRes, sportsRes] = await Promise.all([
    db.from('users').select('email, display_name').eq('id', ticket.user_id).maybeSingle(),
    db.from('ticket_tags').select('id, tag_text').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
    db.from('ticket_notes').select('id, text, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
    db.from('ticket_cast').select('name, role').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
    db.from('setlists').select('songs, tour_name').eq('ticket_id', ticketId).is('artist', null).maybeSingle(),
    db.from('sports_stats').select('home_team, away_team, home_score, away_score, status, league, sport, venue, city, season, attendance').eq('ticket_id', ticketId).maybeSingle(),
  ])

  const songs = Array.isArray(setlistRes.data?.songs)
    ? (setlistRes.data!.songs as { song?: string }[]).map((s) => (typeof s === 'string' ? s : s?.song ?? '')).filter(Boolean)
    : []

  const full: TicketFull = {
    id: ticket.id,
    userId: ticket.user_id,
    ownerEmail: ownerRes.data?.email ?? null,
    ownerName: ownerRes.data?.display_name ?? null,
    imageUrl: ticket.image_url ?? null,
    core: {
      title: ticket.title ?? '',
      original_title: ticket.original_title ?? '',
      venue_name: ticket.venue_name ?? '',
      date_str: ticket.date_str ?? '',
      time_str: ticket.time_str ?? '',
      seat: ticket.seat ?? '',
      section: ticket.section ?? '',
      category: ticket.category ?? 'other',
      price_paid: ticket.price_paid != null ? String(ticket.price_paid) : '',
      price_currency: ticket.price_currency ?? '',
      est_price: ticket.est_price ?? '',
      rating: ticket.rating != null ? String(ticket.rating) : '',
      status: ticket.status ?? 'active',
    },
    tags: (tagsRes.data ?? []).map((t) => ({ id: t.id, tag_text: t.tag_text })),
    notes: (notesRes.data ?? []).map((n) => ({ id: n.id, text: n.text, created_at: n.created_at })),
    cast: (castRes.data ?? []).map((c) => ({ name: c.name ?? '', role: c.role ?? '' })),
    setlist: { songs, tour_name: setlistRes.data?.tour_name ?? '' },
    sports: sportsRes.data
      ? {
          home_team: sportsRes.data.home_team ?? '',
          away_team: sportsRes.data.away_team ?? '',
          home_score: sportsRes.data.home_score != null ? String(sportsRes.data.home_score) : '',
          away_score: sportsRes.data.away_score != null ? String(sportsRes.data.away_score) : '',
          status: sportsRes.data.status ?? '',
          league: sportsRes.data.league ?? '',
          sport: sportsRes.data.sport ?? '',
          venue: sportsRes.data.venue ?? '',
          city: sportsRes.data.city ?? '',
          season: sportsRes.data.season ?? '',
          attendance: sportsRes.data.attendance != null ? String(sportsRes.data.attendance) : '',
        }
      : null,
  }

  // Position in the pending queue → drives Prev / Next / Done-&-next. If the current ticket
  // isn't pending (already resolved or reviewed), offer the top of the queue as "next".
  const order = await loadPendingOrder(db)
  const idx = order.indexOf(ticketId)
  const queueNav = {
    total: order.length,
    position: idx >= 0 ? idx + 1 : null,
    prevId: idx > 0 ? order[idx - 1] : null,
    nextId: idx >= 0 ? (idx < order.length - 1 ? order[idx + 1] : null) : (order[0] ?? null),
  }

  return <ManualEditClient ticket={full} queueNav={queueNav} />
}
