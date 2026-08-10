import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/format'
import { CATEGORY_LABELS, CATEGORY_COLORS, CATEGORY_EMOJI } from '@/lib/categories'
import { MediaGallery, type MediaItem } from './media-gallery'
import { CastPanel } from './cast-panel'
import { BackButton } from './back-button'
import {
  MapPin, CalendarDays, Ticket as TicketIcon, Star, User as UserIcon,
  ExternalLink, ShieldCheck, Music, Users as UsersIcon, StickyNote, Tag as TagIcon, Trophy, SquarePen,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

interface Attendee {
  id: string
  user_id: string | null
  child_id: string | null
  role: string | null
  status: string | null
}
interface SetlistRow {
  id: string
  artist: string | null
  position: number | null
  songs: unknown
  source: string | null
  tour_name: string | null
  set_time: string | null
}
interface CastRow { id: string; name: string | null; role: string | null }
interface SportsStats {
  home_team: string | null; away_team: string | null
  home_team_logo: string | null; away_team_logo: string | null
  home_score: number | null; away_score: number | null
  status: string | null; venue: string | null; city: string | null
  attendance: number | null; league: string | null; season: string | null
  sport: string | null; poster_url: string | null; highlights: unknown
  user_team: string | null; user_team_won: boolean | null
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function Section({ icon: Icon, title, extra, children }: { icon: React.ElementType; title: string; extra?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
        <Icon className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {extra && <span className="text-[12px] text-salty-muted">· {extra}</span>}
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

export default async function EventDetailsPage({ params }: PageProps) {
  await requireAdmin(2) // Super Admin + Admin only
  const { id } = await params
  const db = createServiceClient()

  const { data: ticket } = await db
    .from('tickets')
    .select('id, user_id, title, original_title, venue_name, date_str, time_str, seat, section, category, price_paid, price_currency, est_price, signals, rating, image_url, scan_image_url, status, source, confidence, imported_at, is_past')
    .eq('id', id)
    .single()
  if (!ticket) notFound()

  const [attendeesRes, tagsRes, notesRes, photosRes, setlistsRes, sportsRes, castRes] = await Promise.all([
    db.from('ticket_attendees').select('id, user_id, child_id, role, status').eq('ticket_id', id),
    db.from('ticket_tags').select('id, tag_text, created_at').eq('ticket_id', id).order('created_at', { ascending: true }),
    db.from('ticket_notes').select('id, user_id, text, created_at').eq('ticket_id', id).order('created_at', { ascending: true }),
    db.from('photos').select('id, storage_url, media_type, taken_at, match_method').eq('ticket_id', id).order('taken_at', { ascending: false }),
    db.from('setlists').select('id, artist, position, songs, source, tour_name, set_time').eq('ticket_id', id).order('position', { ascending: true }),
    db.from('sports_stats').select('*').eq('ticket_id', id).maybeSingle(),
    db.from('ticket_cast').select('id, name, role').eq('ticket_id', id).order('created_at', { ascending: true }),
  ])

  const attendees = (attendeesRes.data ?? []) as Attendee[]
  const notes = (notesRes.data ?? []) as { id: string; user_id: string | null; text: string; created_at: string }[]

  // Resolve people (owner + attendees + note authors) and children — service role, no RLS.
  const userIds = [...new Set([ticket.user_id, ...attendees.map((a) => a.user_id), ...notes.map((n) => n.user_id)].filter(Boolean))] as string[]
  const childIds = [...new Set(attendees.map((a) => a.child_id).filter(Boolean))] as string[]
  const [usersRes, childrenRes] = await Promise.all([
    userIds.length ? db.from('users').select('id, email, display_name, username, avatar_url').in('id', userIds) : Promise.resolve({ data: [] as { id: string; email: string; display_name: string | null; username: string | null; avatar_url: string | null }[] }),
    childIds.length ? db.from('child_profiles').select('id, name, avatar_url').in('id', childIds) : Promise.resolve({ data: [] as { id: string; name: string | null; avatar_url: string | null }[] }),
  ])
  const userMap = new Map((usersRes.data ?? []).map((u) => [u.id, u]))
  const childMap = new Map((childrenRes.data ?? []).map((c) => [c.id, c]))
  const owner = userMap.get(ticket.user_id)

  const cat = ticket.category ?? 'other'
  const isConcertish = ['concert', 'festival', 'edm'].includes(cat)
  const catLabel = CATEGORY_LABELS[cat] ?? cat
  const catColor = CATEGORY_COLORS[cat] ?? '#5B6190'
  const hasPrice = ticket.price_paid != null
  const signals = Array.isArray(ticket.signals) ? (ticket.signals as string[]) : []
  const sports = sportsRes.data as SportsStats | null
  const cast = (castRes.data ?? []) as CastRow[]
  const setlists = (setlistsRes.data ?? []) as SetlistRow[]
  const tags = (tagsRes.data ?? []) as { id: string; tag_text: string }[]
  const media = (photosRes.data ?? []).map((p): MediaItem => ({
    id: p.id,
    url: p.storage_url,
    media_type: p.media_type ?? 'photo',
    taken_at: p.taken_at,
    match_method: p.match_method,
  }))

  const personName = (uid: string | null) => {
    if (!uid) return 'Unknown'
    const u = userMap.get(uid)
    return u?.display_name || u?.username || u?.email || uid.slice(0, 8)
  }

  return (
    <div className="p-7 space-y-5">
      <div className="flex items-center justify-between">
        <BackButton fallback="/tickets" />
        <Link href={`/manual-edit?ticket=${ticket.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[12.5px] font-medium text-salty-secondary hover:bg-cream hover:text-ember transition-colors">
          <SquarePen className="h-3.5 w-3.5" /> Edit
        </Link>
      </div>

      {/* Header / cover */}
      <div className="overflow-hidden rounded-[16px] border border-salty-border bg-warm-white">
        {ticket.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ticket.image_url} alt="" className="h-52 w-full object-cover" />
        ) : (
          <div className="flex h-52 w-full items-center justify-center text-5xl" style={{ background: catColor + '22' }}>
            {CATEGORY_EMOJI[cat] ?? '✨'}
          </div>
        )}
        <div className="p-5">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: catColor + '1a', color: catColor }}>
            {CATEGORY_EMOJI[cat] ?? '✨'} {catLabel}
          </span>
          <h1 className="mt-2 font-sora text-[24px] font-bold text-salty-text">{ticket.title ?? 'Untitled event'}</h1>
          {ticket.original_title && ticket.original_title !== ticket.title && (
            <p className="mt-1 text-[12.5px] text-salty-muted">Renamed from “{ticket.original_title}”</p>
          )}
          {owner && (
            <div className="mt-3 flex items-center gap-2 text-[13px]">
              <UserIcon className="h-4 w-4 text-salty-muted" />
              <span className="text-salty-secondary">Owner:</span>
              <Link href={`/users/${owner.id}`} className="inline-flex items-center gap-1 font-medium text-salty-text hover:text-ember">
                {owner.display_name || owner.email}
                <ExternalLink className="h-3 w-3" />
              </Link>
              {owner.display_name && <span className="text-salty-muted">· {owner.email}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Ticket stub */}
      <Section icon={TicketIcon} title="Ticket">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Venue" value={<span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-salty-muted" />{ticket.venue_name || 'TBD'}</span>} />
          <Stat label="Date" value={<span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-salty-muted" />{ticket.date_str || 'TBD'}{ticket.time_str ? ` · ${ticket.time_str}` : ''}</span>} />
          <Stat label="Seat" value={[ticket.section, ticket.seat].filter(Boolean).join(' · ') || 'General Admission'} />
          <Stat label={hasPrice ? 'Price' : 'Est. price'} value={hasPrice ? formatPrice(ticket.price_paid, ticket.price_currency) : (ticket.est_price || '—')} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {ticket.rating != null && (
            <div className="flex items-center gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted mr-1">Rating</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={`h-4 w-4 ${n <= (ticket.rating ?? 0) ? 'fill-gold text-gold' : 'text-stone'}`} />
              ))}
            </div>
          )}
          {ticket.is_past && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF4EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#3E8A5A]">
              <MapPin className="h-3 w-3" /> Attended
            </span>
          )}
          {ticket.scan_image_url && (
            <a href={ticket.scan_image_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-salty-border bg-cream px-2 py-1.5 hover:bg-stone transition-colors">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ticket.scan_image_url} alt="ticket scan" className="h-10 w-8 rounded object-cover" />
              <span className="text-[12px] font-medium text-salty-secondary">Original scan</span>
            </a>
          )}
        </div>
      </Section>

      {/* Attendees */}
      {attendees.length > 0 && (
        <Section icon={UsersIcon} title={ticket.is_past ? 'Who was there' : "Who's going"} extra={String(attendees.length)}>
          <div className="flex flex-wrap gap-4">
            {attendees.map((a) => {
              const isChild = !!a.child_id
              const name = isChild ? (childMap.get(a.child_id!)?.name ?? 'Child') : personName(a.user_id)
              const avatar = isChild ? childMap.get(a.child_id!)?.avatar_url : userMap.get(a.user_id ?? '')?.avatar_url
              const pending = a.status === 'pending'
              const inner = (
                <div className={`flex flex-col items-center gap-1.5 ${pending ? 'opacity-60' : ''}`}>
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt="" className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-cream">
                      <UserIcon className="h-5 w-5 text-salty-muted" />
                    </div>
                  )}
                  <span className="max-w-[80px] truncate text-[12px] text-salty-text">{pending ? 'Invited' : name.split(' ')[0]}</span>
                  {a.role === 'host' && <span className="rounded-full bg-ember-light px-1.5 text-[9px] font-bold text-ember">HOST</span>}
                </div>
              )
              return isChild || !a.user_id ? (
                <div key={a.id}>{inner}</div>
              ) : (
                <Link key={a.id} href={`/users/${a.user_id}`} title={personName(a.user_id)}>{inner}</Link>
              )
            })}
          </div>
        </Section>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <Section icon={TagIcon} title="Tags">
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span key={t.id} className="rounded-full border border-salty-border bg-cream px-3 py-1 text-[12.5px] text-salty-text">{t.tag_text}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Notes */}
      {notes.length > 0 && (
        <Section icon={StickyNote} title="Notes" extra={String(notes.length)}>
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-salty-border bg-cream px-3 py-2.5">
                <p className="whitespace-pre-wrap text-[13px] text-salty-text">{n.text}</p>
                <p className="mt-1.5 text-[11px] text-salty-muted">{personName(n.user_id)} · {fmtDateTime(n.created_at)}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Setlist */}
      {setlists.length > 0 ? (
        <Section icon={Music} title={setlists.length > 1 ? 'Setlists' : 'Setlist'}>
          <div className="space-y-4">
            {setlists.map((row) => {
              const songs = Array.isArray(row.songs) ? (row.songs as { song?: string; set?: string }[]) : []
              return (
                <div key={row.id}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="font-sora text-[14px] font-bold text-salty-text">{row.artist || 'Headliner'}</p>
                    {row.source && (
                      <span className="rounded-full bg-stone px-2 py-0.5 text-[10px] font-semibold text-salty-muted">
                        {row.source === 'ai' ? 'predicted' : row.source}
                      </span>
                    )}
                    {row.set_time && <span className="text-[11px] text-salty-muted">· {row.set_time}</span>}
                    {row.tour_name && <span className="text-[11px] text-salty-muted">· {row.tour_name}</span>}
                  </div>
                  {songs.length > 0 ? (
                    <ol className="list-inside list-decimal space-y-0.5 text-[13px] text-salty-secondary">
                      {songs.map((s, i) => <li key={i}>{s.song ?? String(s)}</li>)}
                    </ol>
                  ) : (
                    <p className="text-[12.5px] text-salty-muted">No songs listed.</p>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      ) : isConcertish ? (
        <Section icon={Music} title="Setlist">
          <p className="text-[13px] text-salty-muted">
            Not enriched yet — the setlist is pulled from setlist.fm (or AI-predicted) when the ticket owner opens the show in the app. It can’t be triggered from here because that lookup runs as the user.
          </p>
        </Section>
      ) : null}

      {/* Cast — theatre shows enrich cast lazily on first app view; offer to fetch when empty. */}
      {(cat === 'theater' || cast.length > 0) && (
        <Section icon={UsersIcon} title="Cast" extra={cast.length > 0 ? String(cast.length) : undefined}>
          <CastPanel
            ticketId={ticket.id}
            initialCast={cast.map((c) => ({ name: c.name ?? '', role: c.role })).filter((c) => c.name)}
          />
        </Section>
      )}

      {/* Sports */}
      {sports && (
        <Section icon={Trophy} title="Result" extra={sports.league ?? sports.sport ?? undefined}>
          <div className="flex items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-1.5">
              {sports.away_team_logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sports.away_team_logo} alt="" className="h-12 w-12 object-contain" />
              )}
              <span className="text-[13px] font-semibold text-salty-text">{sports.away_team ?? 'Away'}</span>
            </div>
            <div className="text-center">
              <p className="font-sora text-[30px] font-bold text-salty-text leading-none">
                {sports.away_score ?? '–'} <span className="text-salty-muted">·</span> {sports.home_score ?? '–'}
              </p>
              {sports.status && <p className="mt-1 text-[11px] font-semibold uppercase text-salty-muted">{sports.status}</p>}
            </div>
            <div className="flex flex-col items-center gap-1.5">
              {sports.home_team_logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sports.home_team_logo} alt="" className="h-12 w-12 object-contain" />
              )}
              <span className="text-[13px] font-semibold text-salty-text">{sports.home_team ?? 'Home'}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-[12px] text-salty-muted">
            {(sports.venue || sports.city) && <span>{[sports.venue, sports.city].filter(Boolean).join(', ')}</span>}
            {sports.attendance != null && <span>{sports.attendance.toLocaleString()} attendance</span>}
            {sports.season && <span>{sports.season} season</span>}
          </div>
        </Section>
      )}

      {/* Photos */}
      <Section icon={TicketIcon} title="Photos & videos" extra={String(media.length)}>
        <MediaGallery items={media} />
      </Section>

      {/* Meta */}
      <Section icon={ShieldCheck} title="Details">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Source" value={ticket.source ?? '—'} />
          <Stat label="Status" value={ticket.status ?? '—'} />
          <Stat label="Confidence" value={ticket.confidence != null ? `${Math.round(ticket.confidence * 100)}%` : '—'} />
          <Stat label="Imported" value={ticket.imported_at ? new Date(ticket.imported_at).toLocaleDateString() : '—'} />
        </div>
        {signals.length > 0 && (
          <div className="mt-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted mb-1.5">Signals</p>
            <div className="flex flex-wrap gap-1.5">
              {signals.map((s, i) => (
                <span key={i} className="rounded-md bg-stone px-2 py-0.5 font-mono text-[11px] text-salty-secondary">{s}</span>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 font-mono text-[11px] text-salty-muted">{ticket.id}</p>
      </Section>
    </div>
  )
}
