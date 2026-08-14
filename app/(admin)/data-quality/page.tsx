import Link from 'next/link'
import { GaugeCircle, ShieldCheck, Sparkles, PieChart, Fingerprint, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_LABELS } from '@/lib/categories'
import { isStrongKey } from '@/lib/events'
import { RunReconcileButton } from '../enrichment/pipeline-actions'
import { ResolveTicketButton, ClearStrongIdButton } from './integrity-buttons'

export const dynamic = 'force-dynamic'

// Same rule the Manual Edit queue uses: the event date lives only in free-text date_str.
function isPastDate(dateStr: string | null): boolean {
  if (!dateStr) return false
  const ms = Date.parse(dateStr)
  if (Number.isNaN(ms)) return false
  const d = new Date(ms)
  const now = new Date()
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) < Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
}

interface T { id: string; category: string; title: string | null; venue_name: string | null; date_str: string | null; confidence: number | null; event_id: string | null; status: string | null }
interface EventLite { id: string; name: string | null; event_key: string | null; merged_into: string | null; setlistfm_id: string | null; sport_api_id: string | null; phishnet_show_id: string | null }

export default async function DataQualityPage() {
  const admin = await requireAdmin(3)
  const canAct = admin.access_level <= 2
  const db = createServiceClient()

  const [ticketsRes, castRes, setlistRes, sportsRes, eventsRes, setlistArtistRes] = await Promise.all([
    db.from('tickets').select('id, category, title, venue_name, date_str, confidence, event_id, status').limit(20000),
    db.from('ticket_cast').select('ticket_id').limit(20000),
    db.from('setlists').select('ticket_id').limit(20000),
    db.from('sports_stats').select('ticket_id, status').limit(20000),
    db.from('events').select('id, name, event_key, merged_into, setlistfm_id, sport_api_id, phishnet_show_id').limit(50000),
    db.from('setlists').select('ticket_id, artist').not('artist', 'is', null).limit(20000),
  ])
  const tickets = (ticketsRes.data ?? []) as T[]
  const cast = new Set((castRes.data ?? []).map((r) => r.ticket_id))
  const setlist = new Set((setlistRes.data ?? []).map((r) => r.ticket_id))
  const sportsFinal = new Set((sportsRes.data ?? []).filter((r) => r.status === 'final').map((r) => r.ticket_id))

  const total = tickets.length || 1
  const identified = tickets.filter((t) => t.title?.trim() && t.venue_name && t.date_str).length
  const categorised = tickets.filter((t) => t.category !== 'other').length
  const confident = tickets.filter((t) => typeof t.confidence !== 'number' || t.confidence >= 0.5).length

  // Enrichment completeness. Cast applies to any theatre show; setlists/results only exist
  // after the event, so those are measured against PAST events only.
  const theater = tickets.filter((t) => t.category === 'theater')
  const pastConcertish = tickets.filter((t) => ['concert', 'festival', 'edm'].includes(t.category) && isPastDate(t.date_str))
  const pastSports = tickets.filter((t) => t.category === 'sports' && isPastDate(t.date_str))
  const enrichment = [
    { label: 'Theatre — cast', total: theater.length, done: theater.filter((t) => cast.has(t.id)).length, href: '/manual-edit?flag=no-cast' as string | null },
    { label: 'Concerts — setlist (past)', total: pastConcertish.length, done: pastConcertish.filter((t) => setlist.has(t.id)).length, href: null },
    { label: 'Sports — result (past)', total: pastSports.length, done: pastSports.filter((t) => sportsFinal.has(t.id)).length, href: '/manual-edit?flag=no-result' },
  ]

  // Confidence distribution.
  const conf = { high: 0, medium: 0, low: 0, unknown: 0 }
  for (const t of tickets) {
    if (typeof t.confidence !== 'number') conf.unknown++
    else if (t.confidence >= 0.8) conf.high++
    else if (t.confidence >= 0.5) conf.medium++
    else conf.low++
  }
  const confBars = [
    { label: 'High (≥ 80%)', value: conf.high, color: '#3E8A5A', href: undefined as string | undefined },
    { label: 'Medium (50–80%)', value: conf.medium, color: '#C8A96E', href: undefined },
    { label: 'Low (< 50%)', value: conf.low, color: '#E8581A', href: '/manual-edit?flag=low-confidence' },
    { label: 'Unknown', value: conf.unknown, color: '#9A8F82', href: undefined },
  ]

  // Category breakdown.
  const byCat = new Map<string, number>()
  for (const t of tickets) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1)
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1])

  // ── Identity integrity — the canonical-event layer ──
  const allEvents = (eventsRes.data ?? []) as EventLite[]
  const canonicalEvents = allEvents.filter((e) => !e.merged_into)
  const eventIdSet = new Set(allEvents.map((e) => e.id))

  // Corrupt strong ids — one strong id claimed by >1 canonical event (the false-merge bug).
  const STRONG_FIELDS = [
    { key: 'setlistfm_id' as const, label: 'setlist.fm' },
    { key: 'sport_api_id' as const, label: 'Sports API' },
    { key: 'phishnet_show_id' as const, label: 'Phish.net' },
  ]
  const corrupt: { field: string; label: string; value: string; events: EventLite[] }[] = []
  for (const { key, label } of STRONG_FIELDS) {
    const groups = new Map<string, EventLite[]>()
    for (const e of canonicalEvents) {
      const v = e[key]
      if (!v) continue
      const arr = groups.get(v) ?? []
      arr.push(e)
      groups.set(v, arr)
    }
    for (const [value, evs] of groups) if (evs.length > 1) corrupt.push({ field: key, label, value, events: evs })
  }
  const corruptEventCount = corrupt.reduce((n, c) => n + c.events.length, 0)

  // Reconcile candidates — a fuzzy event_key while a trusted strong id is already present.
  const reconcileCandidates = canonicalEvents.filter(
    (e) => !isStrongKey(e.event_key) && (e.setlistfm_id || e.sport_api_id || e.phishnet_show_id),
  )

  // Unresolved active tickets & dangling links.
  const unresolved = tickets.filter((t) => t.status === 'active' && !t.event_id)
  const dangling = tickets.filter((t) => t.event_id && !eventIdSet.has(t.event_id))
  const mergedCount = allEvents.length - canonicalEvents.length

  // Wrong-artist setlists — a setlist whose artist doesn't match its ticket title.
  // Grouped per ticket (a ticket can have several setlist rows). Multi-act tickets
  // (festivals) legitimately carry many non-matching artists, so those are dropped as
  // noise — a true wrong-attach is a single/dual-artist concert whose one setlist is off.
  const titleById = new Map(tickets.map((t) => [t.id, t.title]))
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)
  const wrongByTicket = new Map<string, { title: string; artists: Set<string> }>()
  for (const row of (setlistArtistRes.data ?? []) as { ticket_id: string; artist: string | null }[]) {
    const artist = row.artist?.trim()
    const title = titleById.get(row.ticket_id)
    if (!artist || !title) continue
    const nt = norm(title), na = norm(artist)
    if (!na || !nt || nt.includes(na) || na.includes(nt)) continue
    const tset = new Set(tokenize(title))
    if (tokenize(artist).some((w) => tset.has(w))) continue
    const e = wrongByTicket.get(row.ticket_id) ?? { title, artists: new Set<string>() }
    e.artists.add(artist)
    wrongByTicket.set(row.ticket_id, e)
  }
  const wrongArtist = [...wrongByTicket.entries()]
    .filter(([, e]) => e.artists.size <= 2)
    .map(([ticket_id, e]) => ({ ticket_id, title: e.title, artist: [...e.artists].join(', ') }))

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
          <GaugeCircle className="h-5 w-5 text-ember" /> Data Quality
        </h1>
        <p className="text-[13px] text-salty-muted">
          How complete and trustworthy the ticket data is across {tickets.length.toLocaleString()} tickets. Fix the gaps on{' '}
          <Link href="/manual-edit" className="font-medium text-ember hover:underline">Manual Edit</Link>.
        </p>
      </div>

      {/* Core quality */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QualityCard label="Fully identified" pct={pct(identified, total)} sub={`${identified.toLocaleString()} have title · venue · date`} />
        <QualityCard label="Categorised" pct={pct(categorised, total)} sub={`${(tickets.length - categorised).toLocaleString()} still “other”`} href="/manual-edit?flag=uncategorised" />
        <QualityCard label="Confident" pct={pct(confident, total)} sub={`${conf.low.toLocaleString()} below 50%`} />
        <QualityCard label="Tickets" raw={tickets.length} sub="total in the system" />
      </div>

      {/* Identity integrity — the canonical-event layer */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
          <Fingerprint className="h-4 w-4 text-ember" />
          <h2 className="font-sora text-[14px] font-bold text-salty-text">Identity integrity</h2>
          <span className="text-[11.5px] text-salty-muted">· the canonical-event layer tickets collapse into ({canonicalEvents.length.toLocaleString()} events)</span>
          {canAct && (corrupt.length > 0 || reconcileCandidates.length > 0) && <div className="ml-auto"><RunReconcileButton /></div>}
        </div>

        <IntegrityRow name="Corrupt strong IDs" desc="one strong id claimed by more than one canonical event — the false-merge bug" count={corruptEventCount} level={corrupt.length ? 'issue' : 'clean'}>
          {corrupt.length > 0 && (
            <div className="space-y-2">
              {corrupt.map((c) => (
                <div key={c.field + c.value} className="rounded-lg border border-salty-border bg-cream px-3 py-2">
                  <p className="text-[12px] text-salty-secondary"><span className="font-semibold text-salty-text">{c.label}</span> <span className="font-mono">{c.value}</span> shared by {c.events.length} events:</p>
                  <div className="mt-1.5 space-y-1">
                    {c.events.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2">
                        <Link href={`/events/canonical/${e.id}`} className="truncate text-[12px] text-salty-secondary hover:text-ember hover:underline">{e.name ?? e.id.slice(0, 8)}</Link>
                        {canAct && <ClearStrongIdButton eventId={e.id} field={c.field} />}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </IntegrityRow>

        <IntegrityRow name="Reconcile candidates" desc="a fuzzy title·date key while a trusted strong id already exists" count={reconcileCandidates.length} level={reconcileCandidates.length ? 'warn' : 'clean'} action={canAct && reconcileCandidates.length > 0 ? <RunReconcileButton /> : undefined}>
          {reconcileCandidates.length > 0 && (
            <ul className="space-y-1">
              {reconcileCandidates.slice(0, 10).map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <Link href={`/events/canonical/${e.id}`} className="truncate text-[12px] text-salty-secondary hover:text-ember hover:underline">{e.name ?? e.id.slice(0, 8)}</Link>
                  <span className="font-mono text-[11px] text-salty-muted">{e.event_key ?? 'no key'}</span>
                </li>
              ))}
            </ul>
          )}
        </IntegrityRow>

        <IntegrityRow name="Unresolved active tickets" desc="active tickets linked to no canonical event" count={unresolved.length} level={unresolved.length ? 'warn' : 'clean'}>
          {unresolved.length > 0 && (
            <div className="space-y-1">
              {unresolved.slice(0, 20).map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] text-salty-secondary">{t.title ?? t.id.slice(0, 8)}</span>
                  {canAct && <ResolveTicketButton ticketId={t.id} />}
                </div>
              ))}
            </div>
          )}
        </IntegrityRow>

        <IntegrityRow name="Dangling event links" desc="ticket.event_id points at a missing event — should be 0" count={dangling.length} level={dangling.length ? 'issue' : 'clean'} />

        <IntegrityRow name="Wrong-artist setlists" desc="a setlist whose artist doesn't match its ticket title" count={wrongArtist.length} level={wrongArtist.length ? 'warn' : 'clean'}>
          {wrongArtist.length > 0 && (
            <div className="space-y-1">
              {wrongArtist.slice(0, 20).map((w) => (
                <div key={w.ticket_id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate text-salty-secondary"><span className="font-medium text-salty-text">{w.artist}</span> on “{w.title}”</span>
                  <Link href={`/manual-edit?ticket=${w.ticket_id}`} className="shrink-0 text-ember hover:underline">Review</Link>
                </div>
              ))}
            </div>
          )}
        </IntegrityRow>

        <IntegrityRow name="Merged events" desc="duplicates folded into a survivor, kept for history" count={mergedCount} level="info" action={mergedCount > 0 ? <Link href="/events?merged=1" className="text-[12px] font-medium text-ember hover:underline">View survivors</Link> : undefined} />
      </div>

      <Panel icon={Sparkles} title="Enrichment completeness" hint="of the events that should have it">
        {enrichment.map((e) => (
          <Bar key={e.label} label={e.label} value={e.done} total={e.total} color="#7B44A8" href={e.href}
               right={`${e.done.toLocaleString()} / ${e.total.toLocaleString()} · ${pct(e.done, e.total)}%`} />
        ))}
      </Panel>

      <Panel icon={ShieldCheck} title="Import confidence" hint="distribution across all tickets">
        {confBars.map((b) => (
          <Bar key={b.label} label={b.label} value={b.value} total={tickets.length} color={b.color} href={b.href}
               right={`${b.value.toLocaleString()} · ${pct(b.value, total)}%`} />
        ))}
      </Panel>

      <Panel icon={PieChart} title="Tickets by category">
        <div className="grid grid-cols-2 gap-px bg-salty-border sm:grid-cols-3 lg:grid-cols-5">
          {cats.map(([c, n]) => (
            <Link key={c} href={`/tickets?category=${c}`} className="block bg-warm-white p-3.5 transition-colors hover:bg-cream" title={`View all ${CATEGORY_LABELS[c] ?? c} tickets`}>
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{CATEGORY_LABELS[c] ?? c}</p>
              <p className="mt-0.5 font-sora text-[19px] font-bold text-salty-text">{n.toLocaleString()}</p>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function QualityCard({ label, pct, raw, sub, href }: { label: string; pct?: number; raw?: number; sub: string; href?: string }) {
  const val = raw != null ? raw.toLocaleString() : `${pct}%`
  const color = raw != null ? 'text-salty-text' : (pct ?? 0) >= 80 ? 'text-[#3E8A5A]' : (pct ?? 0) >= 50 ? 'text-gold' : 'text-ember'
  const cls = 'block rounded-[14px] border border-salty-border bg-warm-white p-4'
  const content = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{label}</p>
      <p className={`mt-1 font-sora text-[26px] font-bold ${color}`}>{val}</p>
      <p className="mt-0.5 text-[11.5px] text-salty-muted">{sub}</p>
    </>
  )
  return href
    ? <Link href={href} className={`${cls} transition-colors hover:border-salty-muted`}>{content}</Link>
    : <div className={cls}>{content}</div>
}

function Panel({ icon: Icon, title, hint, children }: { icon: React.ElementType; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
        <Icon className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {hint && <span className="text-[11.5px] text-salty-muted">· {hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Bar({ label, value, total, color, right, href }: { label: string; value: number; total: number; color: string; right: string; href?: string | null }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  const cls = 'flex items-center gap-4 border-b border-salty-border px-5 py-3 last:border-0'
  const content = (
    <>
      <span className="w-48 shrink-0 text-[13px] text-salty-secondary">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-40 shrink-0 text-right text-[12px] tabular-nums text-salty-muted">{right}</span>
    </>
  )
  return href
    ? <Link href={href} className={`${cls} transition-colors hover:bg-cream`}>{content}</Link>
    : <div className={cls}>{content}</div>
}

type IntegrityLevel = 'clean' | 'warn' | 'issue' | 'info'
const INTEGRITY_META: Record<IntegrityLevel, { pill: string; icon: React.ElementType | null; label: string }> = {
  clean: { pill: 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]', icon: CheckCircle2, label: 'Clean' },
  warn:  { pill: 'border-[#EAD9A6] bg-[#FFF8E6] text-[#8A6830]', icon: AlertTriangle, label: 'Review' },
  issue: { pill: 'border-[#EBB9B0] bg-[#FDEDED] text-[#BF4A3A]', icon: XCircle, label: 'Issue' },
  info:  { pill: 'border-salty-border bg-stone text-salty-secondary', icon: null, label: 'Info' },
}

function IntegrityRow({ name, desc, count, level, action, children }: { name: string; desc: string; count: number; level: IntegrityLevel; action?: React.ReactNode; children?: React.ReactNode }) {
  const meta = INTEGRITY_META[level]
  const Icon = meta.icon
  return (
    <div className="border-b border-salty-border px-5 py-3 last:border-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-salty-text">{name}</p>
          <p className="text-[11.5px] text-salty-muted">{desc}</p>
        </div>
        <span className="font-sora text-[16px] font-bold tabular-nums text-salty-text">{count.toLocaleString()}</span>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.pill}`}>
          {Icon && <Icon className="h-3 w-3" />} {meta.label}
        </span>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-2.5">{children}</div>}
    </div>
  )
}
