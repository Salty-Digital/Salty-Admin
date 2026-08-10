import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { sanitizeOrFilterTerm } from '@/lib/validate'
import { CATEGORY_LABELS } from '@/lib/categories'
import { ManualEditClient, type TicketFull } from './manual-edit-client'
import { ManualEditFilters } from './manual-edit-filters'
import { Search, SquarePen } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ ticket?: string; q?: string; flag?: string; cat?: string; sort?: string; dir?: string }>
}

export default async function ManualEditPage({ searchParams }: PageProps) {
  await requireAdmin(2) // Super Admin + Admin only
  const { ticket: ticketId, q = '', flag = '', cat = '', sort = 'flags', dir = 'desc' } = await searchParams
  const db = createServiceClient()

  if (ticketId) {
    return <Editor ticketId={ticketId} />
  }

  // ── List view: default to an auto-populated queue of tickets that need edits;
  //    the search box narrows to a specific ticket. Filtering + sorting run in memory
  //    over the fetched candidates (both lists are capped). ──
  const searching = !!q.trim()
  let all: ListRow[] = []
  let needsReviewTotal = 0

  // Enrichment presence (small tables) — lets us flag tickets missing event details
  // (theatre cast, concert setlists, sports results), the same gap as the Broadway shows.
  const enrich = await loadEnrichment(db)

  if (searching) {
    const safe = sanitizeOrFilterTerm(q)
    const { data } = await db
      .from('tickets')
      .select(TICKET_COLS)
      .or(`title.ilike.%${safe}%,venue_name.ilike.%${safe}%`)
      .order('imported_at', { ascending: false })
      .limit(60)
    all = await toRows(db, (data ?? []) as TicketPick[], enrich)
  } else {
    // Candidates: core-field issues OR any enrichable-category ticket; enrichment gaps
    // are then computed in memory and only flagged rows are kept.
    const { data } = await db
      .from('tickets')
      .select(TICKET_COLS)
      .or(CANDIDATE_OR)
      .order('imported_at', { ascending: false })
      .limit(500)
    // Only past events (their date is strictly before today) — future and same-day are excluded.
    all = (await toRows(db, (data ?? []) as TicketPick[], enrich)).filter((r) => r.flags.length > 0 && r.isPast)
    needsReviewTotal = all.length
  }

  const rows = applyView(all, { flag, cat, sort, dir }).slice(0, 60)
  const emptyLabel = searching
    ? `No tickets match “${q}”.`
    : flag || cat
      ? 'No tickets match these filters.'
      : 'Nothing needs manual review right now. 🎉'

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
        <p className="text-[12.5px] text-salty-muted">
          <span className="font-semibold text-salty-text">{needsReviewTotal.toLocaleString()}</span> past event{needsReviewTotal === 1 ? '' : 's'} need review — missing core fields, uncategorised, low-confidence, pending, or missing event details (cast / setlist / result). Future and same-day events are excluded.
          {' '}Showing <span className="font-semibold text-salty-text">{rows.length}</span>.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-[14px] border border-salty-border bg-warm-white">
          <p className="px-4 py-10 text-center text-[13px] text-salty-muted">{emptyLabel}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <Link
              key={t.id}
              href={`/manual-edit?ticket=${t.id}`}
              className="flex items-start gap-3 rounded-[12px] border border-salty-border bg-warm-white px-4 py-3 transition-colors hover:border-salty-muted hover:bg-cream"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-salty-text">{t.title || 'Untitled'}</p>
                <p className="truncate text-[11.5px] text-salty-muted">
                  {[t.venue_name, t.date_str, t.email].filter(Boolean).join(' · ') || '—'}
                </p>
                {t.flags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {t.flags.map((fl) => (
                      <span key={fl} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${toneCls(fl)}`}>{fl}</span>
                    ))}
                  </div>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-stone px-2.5 py-0.5 text-[11px] font-medium capitalize text-salty-secondary">
                {CATEGORY_LABELS[t.category] ?? t.category}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// Conditions that mark a ticket as "needs manual editing". No user input → safe to inline.
const NEEDS_EDIT_OR = 'title.is.null,venue_name.is.null,date_str.is.null,category.eq.other,status.eq.pending,confidence.lt.0.5'
// Enrichable categories are also candidates — their event-details gaps are checked in memory.
const ENRICHABLE = 'category.in.(theater,concert,festival,edm,sports)'
const CANDIDATE_OR = `${NEEDS_EDIT_OR},${ENRICHABLE}`
const TICKET_COLS = 'id, title, venue_name, date_str, category, confidence, status, imported_at, user_id'

interface TicketPick {
  id: string; title: string | null; venue_name: string | null; date_str: string | null
  category: string; confidence: number | null; status: string | null; imported_at: string | null
  user_id: string
}

interface Enrich { cast: Set<string>; setlist: Set<string>; sports: Set<string> }

async function loadEnrichment(db: ReturnType<typeof createServiceClient>): Promise<Enrich> {
  const [c, s, sp] = await Promise.all([
    db.from('ticket_cast').select('ticket_id'),
    db.from('setlists').select('ticket_id'),
    db.from('sports_stats').select('ticket_id'),
  ])
  const ids = (rows: { ticket_id: string | null }[] | null) =>
    new Set((rows ?? []).map((r) => r.ticket_id).filter((x): x is string => !!x))
  return { cast: ids(c.data), setlist: ids(s.data), sports: ids(sp.data) }
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
  // Missing event-details data (mirrors the app: cast for theatre, setlist/result only
  // once the show/game is in the past).
  if (t.category === 'theater' && !enrich.cast.has(t.id)) f.push('No cast')
  if (isPast && ['concert', 'festival', 'edm'].includes(t.category) && !enrich.setlist.has(t.id)) f.push('No setlist')
  if (isPast && t.category === 'sports' && !enrich.sports.has(t.id)) f.push('No result')
  return f
}

const FLAG_TONE: Record<string, 'red' | 'gold' | 'blue' | 'purple'> = {
  'No title': 'red', 'No venue': 'red', 'No date': 'red',
  'Uncategorised': 'gold', 'Low confidence': 'gold', 'Pending': 'blue',
  'No cast': 'purple', 'No setlist': 'purple', 'No result': 'purple',
}
function toneCls(flag: string): string {
  const tone = FLAG_TONE[flag] ?? 'gold'
  if (tone === 'red') return 'bg-[#FDEDED] text-[#BF4A3A]'
  if (tone === 'blue') return 'bg-[#EBF2FA] text-[#3A72A8]'
  if (tone === 'purple') return 'bg-[#F3EBF8] text-[#7B44A8]'
  return 'bg-gold-light text-gold'
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

const FLAG_LABEL: Record<string, string> = {
  'no-title': 'No title', 'no-venue': 'No venue', 'no-date': 'No date',
  'uncategorised': 'Uncategorised', 'low-confidence': 'Low confidence', 'pending': 'Pending',
  'no-cast': 'No cast', 'no-setlist': 'No setlist', 'no-result': 'No result',
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

  return <ManualEditClient ticket={full} />
}
