import Link from 'next/link'
import { GaugeCircle, ShieldCheck, Sparkles, PieChart } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_LABELS } from '@/lib/categories'

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

interface T { id: string; category: string; title: string | null; venue_name: string | null; date_str: string | null; confidence: number | null }

export default async function DataQualityPage() {
  await requireAdmin(3)
  const db = createServiceClient()

  const [ticketsRes, castRes, setlistRes, sportsRes] = await Promise.all([
    db.from('tickets').select('id, category, title, venue_name, date_str, confidence').limit(20000),
    db.from('ticket_cast').select('ticket_id').limit(20000),
    db.from('setlists').select('ticket_id').limit(20000),
    db.from('sports_stats').select('ticket_id, status').limit(20000),
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
            <div key={c} className="bg-warm-white p-3.5">
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{CATEGORY_LABELS[c] ?? c}</p>
              <p className="mt-0.5 font-sora text-[19px] font-bold text-salty-text">{n.toLocaleString()}</p>
            </div>
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
