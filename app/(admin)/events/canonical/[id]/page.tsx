import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_LABELS, CATEGORY_COLORS, CATEGORY_EMOJI } from '@/lib/categories'
import { classifyEventKey, fmtEventDate } from '@/lib/events'
import { MergePanel } from './merge-panel'
import {
  ArrowLeft, CalendarDays, MapPin, Users as UsersIcon, Ticket as TicketIcon, Music,
  Fingerprint, GitMerge, User as UserIcon, ExternalLink, ImageIcon, Trophy,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps { params: Promise<{ id: string }> }

interface EventRow {
  id: string; name: string | null; category: string | null; event_date: string | null
  event_key: string | null; venue_id: string | null; merged_into: string | null
  sport_api_id: string | null; setlistfm_id: string | null; phishnet_show_id: string | null; wikidata_qid: string | null
  source: string | null
}
interface TicketRow {
  id: string; user_id: string; title: string | null; date_str: string | null
  venue_name: string | null; category: string | null; status: string | null; is_past: boolean | null; source: string | null
}
interface SetlistRow { id: string; artist: string | null; position: number | null; songs: unknown; source: string | null; tour_name: string | null; set_time: string | null }

function Section({ icon: Icon, title, extra, action, children }: { icon: React.ElementType; title: string; extra?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
        <Icon className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {extra && <span className="text-[12px] text-salty-muted">· {extra}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{label}</p>
      <p className="mt-0.5 text-[14px] font-medium text-salty-text">{value}</p>
    </div>
  )
}

export default async function CanonicalEventPage({ params }: PageProps) {
  const admin = await requireAdmin(3) // Moderator+ to view
  const canAct = admin.access_level <= 2 // Admin+ to merge
  const canViewTicket = admin.access_level <= 2 // per-ticket /events/[id] requires level <= 2
  const { id } = await params
  const db = createServiceClient()

  const { data: eventRaw } = await db
    .from('events')
    .select('id, name, category, event_date, event_key, venue_id, merged_into, sport_api_id, setlistfm_id, phishnet_show_id, wikidata_qid, source')
    .eq('id', id)
    .single()
  if (!eventRaw) notFound()
  const event = eventRaw as EventRow

  const [{ data: ticketsRaw }, { data: mergedInRaw }, { data: winnerRaw }, { data: venue }] = await Promise.all([
    db.from('tickets').select('id, user_id, title, date_str, venue_name, category, status, is_past, source').eq('event_id', id).order('is_past', { ascending: true }).limit(2000),
    db.from('events').select('id, name, event_key, event_date').eq('merged_into', id).limit(500),
    event.merged_into ? db.from('events').select('id, name').eq('id', event.merged_into).maybeSingle() : Promise.resolve({ data: null }),
    event.venue_id ? db.from('venues').select('name, city, country, capacity').eq('id', event.venue_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const tickets = (ticketsRaw ?? []) as TicketRow[]
  const ticketIds = tickets.map((t) => t.id)
  const ownerIds = [...new Set(tickets.map((t) => t.user_id).filter(Boolean))]

  const [{ data: owners }, { count: attendeeCount }, { count: photoCount }, { data: allSetlists }, { data: allCast }] = await Promise.all([
    ownerIds.length ? db.from('users').select('id, email, display_name, username, avatar_url').in('id', ownerIds) : Promise.resolve({ data: [] as { id: string; email: string; display_name: string | null; username: string | null; avatar_url: string | null }[] }),
    ticketIds.length ? db.from('ticket_attendees').select('id', { count: 'exact', head: true }).in('ticket_id', ticketIds) : Promise.resolve({ count: 0 }),
    ticketIds.length ? db.from('photos').select('id', { count: 'exact', head: true }).in('ticket_id', ticketIds) : Promise.resolve({ count: 0 }),
    // NB: the app's get_event_setlist/get_event_cast are auth.uid()-scoped (they `return`
    // when auth.uid() is null), so they yield nothing for the admin's service role. Read the
    // underlying tables directly across every ticket on the event — the admin sees them all.
    ticketIds.length ? db.from('setlists').select('id, ticket_id, artist, position, songs, source, tour_name, set_time').in('ticket_id', ticketIds).order('position', { ascending: true }) : Promise.resolve({ data: [] }),
    ticketIds.length ? db.from('ticket_cast').select('id, ticket_id, name, role').in('ticket_id', ticketIds).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
  ])

  const ownerMap = new Map((owners ?? []).map((u) => [u.id, u]))

  // Pool the setlist across the event: show the fullest ticket's set (mirrors the app's
  // "best source" pick) instead of repeating the same setlist once per attendee.
  const setlistsByTicket = new Map<string, SetlistRow[]>()
  for (const s of (allSetlists ?? []) as (SetlistRow & { ticket_id: string })[]) {
    const arr = setlistsByTicket.get(s.ticket_id) ?? []
    arr.push(s)
    setlistsByTicket.set(s.ticket_id, arr)
  }
  const setlists = [...setlistsByTicket.values()].sort((a, b) => b.length - a.length)[0] ?? []
  const setlistTicketCount = setlistsByTicket.size

  // Pool cast: distinct people (by name) across every ticket at the event.
  const castByName = new Map<string, { name: string; role: string | null }>()
  for (const c of (allCast ?? []) as { name: string | null; role: string | null }[]) {
    if (c.name?.trim()) castByName.set(c.name.trim().toLowerCase(), { name: c.name.trim(), role: c.role })
  }
  const cast = [...castByName.values()]
  const mergedIn = (mergedInRaw ?? []) as { id: string; name: string | null; event_key: string | null; event_date: string | null }[]
  const winner = winnerRaw as { id: string; name: string | null } | null

  const cat = event.category ?? 'other'
  const catColor = CATEGORY_COLORS[cat] ?? '#5B6190'
  const badge = classifyEventKey(event.event_key)
  const strongIds = [
    { label: 'sport_api_id', value: event.sport_api_id },
    { label: 'setlistfm_id', value: event.setlistfm_id },
    { label: 'phishnet_show_id', value: event.phishnet_show_id },
    { label: 'wikidata_qid', value: event.wikidata_qid },
  ].filter((s) => s.value)

  const ownerName = (uid: string) => {
    const u = ownerMap.get(uid)
    return u?.display_name || u?.username || u?.email || uid.slice(0, 8)
  }

  return (
    <div className="p-7 space-y-5">
      <Link href="/events" className="inline-flex items-center gap-1.5 text-[13px] text-salty-muted hover:text-salty-text transition-colors">
        <ArrowLeft className="h-4 w-4" /> All events
      </Link>

      {winner && (
        <div className="flex items-center gap-2 rounded-[12px] border border-[#EAD9A6] bg-[#FFF8E6] px-4 py-3 text-[13px] text-[#8A6830]">
          <GitMerge className="h-4 w-4 shrink-0" />
          This event was merged into{' '}
          <Link href={`/events/canonical/${winner.id}`} className="font-semibold underline">{winner.name ?? 'another event'}</Link>. It&apos;s kept for history.
        </div>
      )}

      {/* Header */}
      <div className="overflow-hidden rounded-[16px] border border-salty-border bg-warm-white">
        <div className="flex h-28 w-full items-center justify-center text-4xl" style={{ background: catColor + '18' }}>
          {CATEGORY_EMOJI[cat] ?? '✨'}
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: catColor + '1a', color: catColor }}>
              {CATEGORY_EMOJI[cat] ?? '✨'} {CATEGORY_LABELS[cat] ?? cat}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: badge.color + '1a', color: badge.color }}>
              <Fingerprint className="h-3 w-3" /> {badge.label}
            </span>
          </div>
          <h1 className="mt-2 font-sora text-[24px] font-bold text-salty-text">{event.name ?? 'Untitled event'}</h1>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-salty-secondary">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-salty-muted" />{fmtEventDate(event.event_date)}</span>
            {venue && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4 text-salty-muted" />{[venue.name, venue.city].filter(Boolean).join(', ') || 'Venue on file'}</span>}
          </div>
          <p className="mt-3 font-mono text-[11px] text-salty-muted">
            {event.event_key ?? 'no event_key'} <span className="mx-1 text-salty-border">|</span> {event.id}
          </p>
        </div>
      </div>

      {/* Convergence stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Tickets</p>
          <p className="mt-1 font-sora text-[26px] font-bold text-salty-text">{tickets.length}</p>
        </div>
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Distinct users</p>
          <p className={`mt-1 font-sora text-[26px] font-bold ${ownerIds.length > 1 ? 'text-[#3E8A5A]' : 'text-salty-text'}`}>{ownerIds.length}</p>
        </div>
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Attendees tagged</p>
          <p className="mt-1 font-sora text-[26px] font-bold text-salty-text">{attendeeCount ?? 0}</p>
        </div>
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Merged in</p>
          <p className="mt-1 font-sora text-[26px] font-bold text-salty-text">{mergedIn.length}</p>
        </div>
      </div>

      {/* Strong ids */}
      {strongIds.length > 0 && (
        <Section icon={Fingerprint} title="Identity">
          <div className="flex flex-wrap gap-2">
            {strongIds.map((s) => (
              <span key={s.label} className="rounded-md bg-stone px-2.5 py-1 font-mono text-[11.5px] text-salty-secondary">
                <span className="text-salty-muted">{s.label}:</span> {s.value}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Tickets across users */}
      <Section icon={TicketIcon} title="Tickets at this event" extra={`${tickets.length} across ${ownerIds.length} user${ownerIds.length === 1 ? '' : 's'}`}>
        {tickets.length === 0 ? (
          <p className="text-[13px] text-salty-muted">No tickets are linked to this event.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-salty-border">
                  {['Ticket', 'Owner', 'Date', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                    <td className="px-3 py-2.5 max-w-[240px]"><p className="truncate text-[13px] font-medium text-salty-text">{t.title ?? '—'}</p></td>
                    <td className="px-3 py-2.5 text-[12.5px]">
                      <Link href={`/users/${t.user_id}`} className="inline-flex items-center gap-1 text-salty-secondary hover:text-ember hover:underline">
                        <span className="max-w-[160px] truncate">{ownerName(t.user_id)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[12px] text-salty-secondary">{t.date_str ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-stone px-2 py-0.5 text-[11px] font-medium capitalize text-salty-secondary">{t.status ?? '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {canViewTicket && <Link href={`/events/${t.id}`} className="text-[12px] font-medium text-ember hover:underline">Detail</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Who's converging */}
      {ownerIds.length > 0 && (
        <Section icon={UsersIcon} title="Who's converging here" extra={`${ownerIds.length} user${ownerIds.length === 1 ? '' : 's'}`}>
          <div className="flex flex-wrap gap-4">
            {ownerIds.map((uid) => {
              const u = ownerMap.get(uid)
              return (
                <Link key={uid} href={`/users/${uid}`} className="flex flex-col items-center gap-1.5" title={ownerName(uid)}>
                  {u?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-cream"><UserIcon className="h-5 w-5 text-salty-muted" /></div>
                  )}
                  <span className="max-w-[80px] truncate text-[12px] text-salty-text">{ownerName(uid).split(' ')[0]}</span>
                </Link>
              )
            })}
          </div>
        </Section>
      )}

      {/* Shared enrichment: setlist */}
      {setlists.length > 0 && (
        <Section icon={Music} title={setlists.length > 1 ? 'Shared setlists' : 'Shared setlist'} extra={`${setlistTicketCount} of ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} enriched`}>
          <div className="space-y-4">
            {setlists.map((row) => {
              const songs = Array.isArray(row.songs) ? (row.songs as { song?: string }[]) : []
              return (
                <div key={row.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="font-sora text-[14px] font-bold text-salty-text">{row.artist || 'Headliner'}</p>
                    {row.source && <span className="rounded-full bg-stone px-2 py-0.5 text-[10px] font-semibold text-salty-muted">{row.source === 'ai' ? 'predicted' : row.source}</span>}
                    {row.tour_name && <span className="text-[11px] text-salty-muted">· {row.tour_name}</span>}
                  </div>
                  {songs.length > 0 ? (
                    <ol className="list-inside list-decimal space-y-0.5 text-[13px] text-salty-secondary">
                      {songs.map((s, i) => <li key={i}>{s.song ?? String(s)}</li>)}
                    </ol>
                  ) : <p className="text-[12.5px] text-salty-muted">No songs listed.</p>}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Shared enrichment: cast */}
      {cast.length > 0 && (
        <Section icon={UsersIcon} title="Shared cast" extra={`${cast.length} across the event`}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
            {cast.map((c, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="font-medium text-salty-text">{c.name}</span>
                {c.role && <span className="text-[11.5px] text-salty-muted">{c.role}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Pooled photos (count only) */}
      <Section icon={ImageIcon} title="Photos & videos" extra={String(photoCount ?? 0)}>
        {(photoCount ?? 0) === 0
          ? <p className="text-[13px] text-salty-muted">No media across any ticket at this event.</p>
          : <p className="text-[13px] text-salty-text"><span className="font-semibold">{photoCount}</span> item{photoCount === 1 ? '' : 's'} pooled across {tickets.length} ticket{tickets.length === 1 ? '' : 's'} <span className="text-salty-muted">— hidden to protect users&apos; privacy</span></p>}
      </Section>

      {/* Merge history */}
      {mergedIn.length > 0 && (
        <Section icon={GitMerge} title="Merge history" extra={`${mergedIn.length} folded in`}>
          <div className="space-y-2">
            {mergedIn.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-salty-border bg-cream px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-salty-text">{m.name ?? 'Untitled event'}</p>
                  <p className="font-mono text-[11px] text-salty-muted">{m.event_key ?? 'no key'} · {fmtEventDate(m.event_date)}</p>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-salty-muted">merged →</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Sports category hint if no enrichment and it's a game */}
      {cat === 'sports' && setlists.length === 0 && cast.length === 0 && (
        <Section icon={Trophy} title="Result">
          <p className="text-[13px] text-salty-muted">Per-game result lives on each ticket&apos;s detail page. Open a ticket above to see the box score.</p>
        </Section>
      )}

      {/* Actions — Admin+ only */}
      {canAct && !event.merged_into && (
        <Section icon={GitMerge} title="Merge duplicates">
          <MergePanel winnerId={event.id} />
        </Section>
      )}
    </div>
  )
}
