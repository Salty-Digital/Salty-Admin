'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Sparkles, Loader2, Plus, X, Save, ExternalLink, Check, AlertTriangle,
  Trophy, Music, Users as UsersIcon, Tag as TagIcon, StickyNote, Ticket as TicketIcon,
} from 'lucide-react'
import { TICKET_CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'
import type { EventLookupResult } from '@/lib/anthropic'
import {
  saveTicketCoreAction, addTagAction, removeTagAction, addNoteAction, removeNoteAction,
  saveCastAction, fetchCastAction, saveSetlistAction, saveSportsAction, fetchSportsAction, aiLookupAction,
  verifyCategoryAction,
} from './actions'
import { QueueNav, type QueueNavData } from './queue-nav'

const STATUSES = ['active', 'archived', 'pending']

export interface TicketFull {
  id: string
  userId: string
  ownerEmail: string | null
  ownerName: string | null
  imageUrl: string | null
  core: {
    title: string; original_title: string; venue_name: string; date_str: string; time_str: string
    seat: string; section: string; category: string; price_paid: string; price_currency: string
    est_price: string; rating: string; status: string
  }
  tags: { id: string; tag_text: string }[]
  notes: { id: string; text: string; created_at: string }[]
  cast: { name: string; role: string }[]
  setlist: { songs: string[]; tour_name: string }
  sports: {
    home_team: string; away_team: string; home_score: string; away_score: string; status: string
    league: string; sport: string; venue: string; city: string; season: string; attendance: string
  } | null
}

type Core = TicketFull['core']
type Sports = NonNullable<TicketFull['sports']>
const EMPTY_SPORTS: Sports = {
  home_team: '', away_team: '', home_score: '', away_score: '', status: '',
  league: '', sport: '', venue: '', city: '', season: '', attendance: '',
}

const inputCls =
  'w-full rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none font-sans'
const labelCls = 'text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted'

function Section({ icon: Icon, title, children, hint }: { icon: React.ElementType; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex items-center gap-2 border-b border-salty-border px-5 py-3">
        <Icon className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {hint && <span className="text-[11.5px] text-salty-muted">· {hint}</span>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`mt-1 ${inputCls}`} />
    </label>
  )
}

function Status({ state }: { state: { kind: 'idle' | 'saved' | 'error'; msg?: string } }) {
  if (state.kind === 'saved') return <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3E8A5A]"><Check className="h-3.5 w-3.5" /> Saved</span>
  if (state.kind === 'error') return <span className="text-[12px] text-[#BF4A3A]">{state.msg}</span>
  return null
}

export function ManualEditClient({ ticket, queueNav }: { ticket: TicketFull; queueNav?: QueueNavData }) {
  const [core, setCore] = useState<Core>(ticket.core)
  const [tags, setTags] = useState(ticket.tags)
  const [notes, setNotes] = useState(ticket.notes)
  const [cast, setCast] = useState<{ name: string; role: string }[]>(ticket.cast)
  const [songsText, setSongsText] = useState(ticket.setlist.songs.join('\n'))
  const [tourName, setTourName] = useState(ticket.setlist.tour_name)
  const [sports, setSports] = useState<Sports>(ticket.sports ?? EMPTY_SPORTS)

  const setField = (k: keyof Core) => (v: string) => setCore((c) => ({ ...c, [k]: v }))
  const setSport = (k: keyof Sports) => (v: string) => setSports((s) => ({ ...s, [k]: v }))

  // Notes and tags have no batch "save" — they persist on add. So AI-applied ones are
  // written immediately (and reflected in local state) rather than staged in a form.
  const addAiNote = async (text: string) => {
    const t = text.trim()
    if (!t) return
    const res = await addNoteAction(ticket.id, t)
    if (res.ok) setNotes((n) => [...n, { id: res.id, text: t, created_at: res.created_at }])
  }
  const addAiTags = async (labels: string[]) => {
    for (const label of labels) {
      const t = label.trim()
      if (!t || tags.some((x) => x.tag_text.toLowerCase() === t.toLowerCase())) continue
      const res = await addTagAction(ticket.id, t)
      if (res.ok) setTags((prev) => [...prev, { id: res.id, tag_text: t }])
    }
  }

  const isTheater = core.category === 'theater'
  const isConcertish = ['concert', 'festival', 'edm'].includes(core.category)
  const isSports = core.category === 'sports'

  return (
    <div className="p-7 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/manual-edit" className="inline-flex items-center gap-1.5 text-[13px] text-salty-muted hover:text-ember transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to search
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {queueNav && <QueueNav currentId={ticket.id} nav={queueNav} />}
          <Link href={`/events/${ticket.id}`} className="inline-flex items-center gap-1.5 text-[13px] text-salty-muted hover:text-ember transition-colors">
            View details <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div>
        <h1 className="font-sora text-[22px] font-bold text-salty-text">{core.title || 'Untitled event'}</h1>
        <p className="text-[13px] text-salty-muted">
          {(ticket.ownerName || ticket.ownerEmail) ?? 'Unknown owner'}
          {ticket.ownerName && ticket.ownerEmail ? ` · ${ticket.ownerEmail}` : ''}
        </p>
      </div>

      <AiPanel ticket={ticket} core={core} setCore={setCore} setCast={setCast} setSports={setSports} addNote={addAiNote} addTags={addAiTags} />

      <CoreSection core={core} setField={setField} ticketId={ticket.id} />

      <TagsSection ticketId={ticket.id} tags={tags} setTags={setTags} />

      <NotesSection ticketId={ticket.id} notes={notes} setNotes={setNotes} />

      {isTheater && <CastSection ticketId={ticket.id} cast={cast} setCast={setCast} />}

      {isConcertish && (
        <SetlistSection ticketId={ticket.id} songsText={songsText} setSongsText={setSongsText} tourName={tourName} setTourName={setTourName} />
      )}

      {isSports && <SportsSection ticketId={ticket.id} sports={sports} setSport={setSport} setSports={setSports} />}
    </div>
  )
}

// ── AI lookup panel ─────────────────────────────────────────────────────────────
function AiPanel({
  ticket, core, setCore, setCast, setSports, addNote, addTags,
}: {
  ticket: TicketFull
  core: Core
  setCore: React.Dispatch<React.SetStateAction<Core>>
  setCast: React.Dispatch<React.SetStateAction<{ name: string; role: string }[]>>
  setSports: React.Dispatch<React.SetStateAction<Sports>>
  addNote: (text: string) => void
  addTags: (labels: string[]) => void
}) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<EventLookupResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  function run() {
    setErr(null)
    setResult(null)
    start(async () => {
      const res = await aiLookupAction({ title: core.title, date: core.date_str, venue: core.venue_name, category: core.category })
      if (res.ok) setResult(res.data)
      else setErr(res.error)
    })
  }

  const suggestions: { label: string; value: string; apply: () => void }[] = []
  if (result) {
    const add = (label: string, value: string, apply: () => void) => { if (value) suggestions.push({ label, value, apply }) }
    add('Title', result.title, () => setCore((c) => ({ ...c, title: result.title })))
    add('Performer → title', result.performer, () => setCore((c) => ({ ...c, title: result.performer })))
    add('Venue', result.venue_name, () => setCore((c) => ({ ...c, venue_name: result.venue_name })))
    add('City → venue', result.city, () => setCore((c) => ({ ...c, venue_name: [c.venue_name, result.city].filter(Boolean).join(', ') })))
    add('Date', result.date_str, () => setCore((c) => ({ ...c, date_str: result.date_str })))
    add('Time', result.time_str, () => setCore((c) => ({ ...c, time_str: result.time_str })))
    if (result.category && (TICKET_CATEGORIES as readonly string[]).includes(result.category)) {
      add('Category', CATEGORY_LABELS[result.category] ?? result.category, () => setCore((c) => ({ ...c, category: result.category })))
    }
    add('Est. price', result.price_estimate, () => setCore((c) => ({ ...c, est_price: result.price_estimate })))
    add('Description → note', result.description, () => addNote(result.description))
    if (result.tags.length > 0) add('Tags', result.tags.join(', '), () => addTags(result.tags))
    if (result.sports) {
      const sp = result.sports
      const score = sp.away_score || sp.home_score ? ` ${sp.away_score || '–'}–${sp.home_score || '–'}` : ''
      const matchup = [sp.away_team, sp.home_team].filter(Boolean).join(' @ ')
      const extras = [sp.sport, sp.league, sp.venue, sp.city, sp.season].filter(Boolean).join(' · ')
      add('Game result → sports', [(matchup + score).trim(), extras].filter(Boolean).join('  —  '), () =>
        setSports((s) => ({
          ...s,
          home_team: sp.home_team || s.home_team,
          away_team: sp.away_team || s.away_team,
          home_score: sp.home_score || s.home_score,
          away_score: sp.away_score || s.away_score,
          league: sp.league || s.league,
          status: sp.status || s.status,
          sport: sp.sport || s.sport,
          venue: sp.venue || s.venue,
          city: sp.city || s.city,
          season: sp.season || s.season,
          attendance: sp.attendance || s.attendance,
        })),
      )
    }
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#E6D9F2] bg-[#FAF6FF]">
      <div className="flex items-center gap-2 border-b border-[#E6D9F2] px-5 py-3">
        <Sparkles className="h-4 w-4 text-[#7B44A8]" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">AI lookup</h2>
        <span className="text-[11.5px] text-salty-muted">· fill fields from the event name</span>
        <button
          onClick={run}
          disabled={pending || !core.title.trim()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#7B44A8] px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#6a3a92] disabled:opacity-50 transition-colors"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {pending ? 'Searching…' : 'AI search'}
        </button>
      </div>
      <div className="p-5">
        {err && <p className="text-[12.5px] text-[#BF4A3A]">{err}</p>}
        {!err && !result && <p className="text-[12.5px] text-salty-muted">Uses the title, date and venue above to look up the real event. Nothing is saved until you Apply a suggestion and then save the section.</p>}
        {result && !result.known && suggestions.length === 0 && (
          <p className="text-[12.5px] text-salty-muted">The model couldn&apos;t confidently identify this event.</p>
        )}
        {result && suggestions.length > 0 && (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border border-salty-border bg-warm-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{s.label}</p>
                  <p className="text-[13px] text-salty-text">{s.value}</p>
                </div>
                <button onClick={s.apply} className="shrink-0 rounded-md border border-salty-border bg-cream px-2.5 py-1 text-[11.5px] font-medium text-salty-secondary hover:bg-stone transition-colors">
                  Apply
                </button>
              </div>
            ))}
            {result.notable_people.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-salty-border bg-warm-white px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-salty-muted">People / cast ({result.notable_people.length})</p>
                  <p className="text-[12.5px] text-salty-secondary">{result.notable_people.map((p) => p.name).join(', ')}</p>
                </div>
                <button
                  onClick={() => setCast(result.notable_people.map((p) => ({ name: p.name, role: p.role })))}
                  className="shrink-0 rounded-md border border-salty-border bg-cream px-2.5 py-1 text-[11.5px] font-medium text-salty-secondary hover:bg-stone transition-colors"
                >
                  Use as cast
                </button>
              </div>
            )}
            <p className="pt-1 text-[11px] text-salty-muted">Applied values fill the form — remember to save each section.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Core fields ─────────────────────────────────────────────────────────────────
function CoreSection({ core, setField, ticketId }: { core: Core; setField: (k: keyof Core) => (v: string) => void; ticketId: string }) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<{ kind: 'idle' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' })

  function save() {
    setState({ kind: 'idle' })
    start(async () => {
      const res = await saveTicketCoreAction(ticketId, core)
      setState(res.ok ? { kind: 'saved' } : { kind: 'error', msg: res.error })
    })
  }

  const [checking, startCheck] = useTransition()
  const [catCheck, setCatCheck] = useState<{ suggested: string; matches: boolean; confident: boolean; reason: string } | null>(null)
  const [catErr, setCatErr] = useState<string | null>(null)

  function verifyCategory() {
    setCatErr(null); setCatCheck(null)
    startCheck(async () => {
      const res = await verifyCategoryAction({ title: core.title, venue: core.venue_name, date: core.date_str, category: core.category })
      if (res.ok) setCatCheck({ suggested: res.suggested, matches: res.matches, confident: res.confident, reason: res.reason })
      else setCatErr(res.error)
    })
  }

  return (
    <Section icon={TicketIcon} title="Event details">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Title" value={core.title} onChange={setField('title')} /></div>
        <Field label="Renamed from (original title)" value={core.original_title} onChange={setField('original_title')} placeholder="—" />
        <Field label="Venue" value={core.venue_name} onChange={setField('venue_name')} />
        <Field label="Date" value={core.date_str} onChange={setField('date_str')} placeholder="e.g. Jun 4, 2026" />
        <Field label="Time" value={core.time_str} onChange={setField('time_str')} placeholder="e.g. 7:30 PM" />
        <Field label="Section" value={core.section} onChange={setField('section')} />
        <Field label="Seat" value={core.seat} onChange={setField('seat')} />
        <label className="block">
          <span className={labelCls}>Category</span>
          <select value={core.category} onChange={(e) => setField('category')(e.target.value)} className={`mt-1 ${inputCls}`}>
            {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Status</span>
          <select value={core.status} onChange={(e) => setField('status')(e.target.value)} className={`mt-1 ${inputCls}`}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Field label="Price paid" value={core.price_paid} onChange={setField('price_paid')} type="number" placeholder="e.g. 120" />
        <Field label="Currency" value={core.price_currency} onChange={setField('price_currency')} placeholder="USD" />
        <Field label="Est. price" value={core.est_price} onChange={setField('est_price')} placeholder="e.g. $80–$150" />
        <Field label="Rating (1–5)" value={core.rating} onChange={setField('rating')} type="number" placeholder="—" />
      </div>
      <div className="mt-4 rounded-lg border border-salty-border bg-cream/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            onClick={verifyCategory}
            disabled={checking || !core.title.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#E6D9F2] bg-[#FAF6FF] px-3 py-1.5 text-[12.5px] font-semibold text-[#7B44A8] transition-colors hover:bg-[#F3EBF8] disabled:opacity-50"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Verify category with AI
          </button>
          {catErr && <span className="text-[12px] text-[#BF4A3A]">{catErr}</span>}
          {catCheck && catCheck.matches && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#3E8A5A]">
              <Check className="h-4 w-4 shrink-0" /> Looks right — {CATEGORY_LABELS[catCheck.suggested] ?? catCheck.suggested}.{catCheck.reason ? ` ${catCheck.reason}` : ''}
            </span>
          )}
          {catCheck && !catCheck.matches && (
            <span className="inline-flex flex-wrap items-center gap-2 text-[12.5px] text-[#8A6830]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Should be <b>{CATEGORY_LABELS[catCheck.suggested] ?? catCheck.suggested}</b>{catCheck.confident ? '' : ' (low confidence)'}{catCheck.reason ? ` — ${catCheck.reason}` : ''}</span>
              <button
                onClick={() => { setField('category')(catCheck.suggested); setCatCheck({ ...catCheck, matches: true }) }}
                className="shrink-0 rounded-md border border-salty-border bg-warm-white px-2 py-0.5 text-[11.5px] font-medium text-salty-secondary hover:bg-cream"
              >
                Apply — then Save
              </button>
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-ember/90 disabled:opacity-60 transition-colors">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save details
        </button>
        <Status state={state} />
      </div>
    </Section>
  )
}

// ── Tags ────────────────────────────────────────────────────────────────────────
function TagsSection({ ticketId, tags, setTags }: { ticketId: string; tags: { id: string; tag_text: string }[]; setTags: React.Dispatch<React.SetStateAction<{ id: string; tag_text: string }[]>> }) {
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function add() {
    const t = text.trim()
    if (!t) return
    setErr(null)
    start(async () => {
      const res = await addTagAction(ticketId, t)
      if (res.ok) { setTags((prev) => [...prev, { id: res.id, tag_text: t }]); setText('') }
      else setErr(res.error)
    })
  }
  function remove(id: string) {
    start(async () => {
      const res = await removeTagAction(ticketId, id)
      if (res.ok) setTags((prev) => prev.filter((x) => x.id !== id))
      else setErr(res.error)
    })
  }

  return (
    <Section icon={TagIcon} title="Tags">
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-salty-border bg-cream py-1 pl-3 pr-1.5 text-[12.5px] text-salty-text">
            {t.tag_text}
            <button onClick={() => remove(t.id)} disabled={pending} className="rounded-full p-0.5 text-salty-muted hover:bg-stone hover:text-[#BF4A3A]"><X className="h-3 w-3" /></button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[12.5px] text-salty-muted">No tags.</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Add a tag…" className={inputCls} />
        <button onClick={add} disabled={pending || !text.trim()} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] font-medium text-salty-secondary hover:bg-stone disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {err && <p className="mt-2 text-[12px] text-[#BF4A3A]">{err}</p>}
    </Section>
  )
}

// ── Notes ───────────────────────────────────────────────────────────────────────
function NotesSection({ ticketId, notes, setNotes }: { ticketId: string; notes: { id: string; text: string; created_at: string }[]; setNotes: React.Dispatch<React.SetStateAction<{ id: string; text: string; created_at: string }[]>> }) {
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function add() {
    const t = text.trim()
    if (!t) return
    setErr(null)
    start(async () => {
      const res = await addNoteAction(ticketId, t)
      if (res.ok) { setNotes((prev) => [...prev, { id: res.id, text: t, created_at: res.created_at }]); setText('') }
      else setErr(res.error)
    })
  }
  function remove(id: string) {
    start(async () => {
      const res = await removeNoteAction(ticketId, id)
      if (res.ok) setNotes((prev) => prev.filter((x) => x.id !== id))
      else setErr(res.error)
    })
  }

  return (
    <Section icon={StickyNote} title="Notes" hint={String(notes.length)}>
      <div className="space-y-2">
        {notes.map((n) => (
          <div key={n.id} className="flex items-start gap-3 rounded-lg border border-salty-border bg-cream px-3 py-2">
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13px] text-salty-text">{n.text}</p>
            {!n.id.startsWith('tmp-') && (
              <button onClick={() => remove(n.id)} disabled={pending} className="shrink-0 rounded-md p-1 text-salty-muted hover:bg-stone hover:text-[#BF4A3A]"><X className="h-3.5 w-3.5" /></button>
            )}
          </div>
        ))}
        {notes.length === 0 && <p className="text-[12.5px] text-salty-muted">No notes.</p>}
      </div>
      <div className="mt-3 flex gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Add a note…" className={`${inputCls} resize-y`} />
        <button onClick={add} disabled={pending || !text.trim()} className="inline-flex h-fit shrink-0 items-center gap-1 rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] font-medium text-salty-secondary hover:bg-stone disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      {err && <p className="mt-2 text-[12px] text-[#BF4A3A]">{err}</p>}
    </Section>
  )
}

// ── Cast ────────────────────────────────────────────────────────────────────────
function CastSection({ ticketId, cast, setCast }: { ticketId: string; cast: { name: string; role: string }[]; setCast: React.Dispatch<React.SetStateAction<{ name: string; role: string }[]>> }) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<{ kind: 'idle' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' })
  const [fetching, startFetch] = useTransition()
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const setRow = (i: number, k: 'name' | 'role', v: string) => setCast((prev) => prev.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))

  function save() {
    setState({ kind: 'idle' })
    start(async () => {
      const res = await saveCastAction(ticketId, cast)
      setState(res.ok ? { kind: 'saved' } : { kind: 'error', msg: res.error })
    })
  }

  function fetchCast() {
    setFetchMsg(null)
    startFetch(async () => {
      const res = await fetchCastAction(ticketId)
      if (!res.ok) setFetchMsg(res.error)
      else if (res.cast.length === 0) setFetchMsg('No cast found for this show (it may not be a play, or isn’t in Wikidata).')
      else {
        setCast(res.cast)
        setFetchMsg(`Fetched ${res.cast.length} cast member${res.cast.length === 1 ? '' : 's'} from Wikidata + AI — already saved. Edit and Save to adjust.`)
      }
    })
  }

  return (
    <Section icon={UsersIcon} title="Cast" hint="fetch from Wikidata + AI, or edit by hand">
      <div className="space-y-2">
        {cast.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input value={c.name} onChange={(e) => setRow(i, 'name', e.target.value)} placeholder="Name" className={inputCls} />
            <input value={c.role} onChange={(e) => setRow(i, 'role', e.target.value)} placeholder="Role" className={inputCls} />
            <button onClick={() => setCast((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 rounded-lg border border-salty-border bg-cream px-2 text-salty-muted hover:text-[#BF4A3A]"><X className="h-4 w-4" /></button>
          </div>
        ))}
        {cast.length === 0 && <p className="text-[12.5px] text-salty-muted">No cast yet.</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={fetchCast} disabled={fetching} className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] font-medium text-salty-secondary hover:bg-stone disabled:opacity-60 transition-colors">
          {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-ember" />} Fetch cast
        </button>
        <button onClick={() => setCast((prev) => [...prev, { name: '', role: '' }])} className="inline-flex items-center gap-1 rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] font-medium text-salty-secondary hover:bg-stone">
          <Plus className="h-4 w-4" /> Add person
        </button>
        <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-ember/90 disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save cast
        </button>
        <Status state={state} />
        {fetchMsg && <span className="text-[12px] text-salty-muted">{fetchMsg}</span>}
      </div>
    </Section>
  )
}

// ── Setlist ─────────────────────────────────────────────────────────────────────
function SetlistSection({ ticketId, songsText, setSongsText, tourName, setTourName }: { ticketId: string; songsText: string; setSongsText: (v: string) => void; tourName: string; setTourName: (v: string) => void }) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<{ kind: 'idle' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' })

  function save() {
    setState({ kind: 'idle' })
    const songs = songsText.split('\n').map((s) => s.trim()).filter(Boolean)
    start(async () => {
      const res = await saveSetlistAction(ticketId, songs, tourName)
      setState(res.ok ? { kind: 'saved' } : { kind: 'error', msg: res.error })
    })
  }

  return (
    <Section icon={Music} title="Setlist" hint="headliner · one song per line">
      <div className="space-y-3">
        <label className="block">
          <span className={labelCls}>Tour name (optional)</span>
          <input value={tourName} onChange={(e) => setTourName(e.target.value)} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block">
          <span className={labelCls}>Songs</span>
          <textarea value={songsText} onChange={(e) => setSongsText(e.target.value)} rows={8} placeholder={'One song per line'} className={`mt-1 ${inputCls} resize-y font-mono text-[12.5px]`} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-ember/90 disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save setlist
        </button>
        <Status state={state} />
      </div>
    </Section>
  )
}

// ── Sports ──────────────────────────────────────────────────────────────────────
function SportsSection({ ticketId, sports, setSport, setSports }: { ticketId: string; sports: Sports; setSport: (k: keyof Sports) => (v: string) => void; setSports: React.Dispatch<React.SetStateAction<Sports>> }) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<{ kind: 'idle' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' })
  const [fetching, startFetch] = useTransition()
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)

  function save() {
    setState({ kind: 'idle' })
    start(async () => {
      const res = await saveSportsAction(ticketId, sports)
      setState(res.ok ? { kind: 'saved' } : { kind: 'error', msg: res.error })
    })
  }

  function fetchResult() {
    setFetchMsg(null)
    startFetch(async () => {
      const res = await fetchSportsAction(ticketId)
      if (!res.ok) setFetchMsg(res.error)
      else if (!res.found) setFetchMsg('No game found. Double-check the date is the actual game day (the usual cause) and that the title names the team(s). Some tickets — stadium tours, off-season dates, amateur games — simply have no result to fetch.')
      else {
        setSports((s) => ({ ...s, ...res.sports! }))
        setFetchMsg('Fetched the exact result from sports data — it has been saved.')
      }
    })
  }

  return (
    <Section icon={Trophy} title="Sports result" hint="fetch the exact score, or edit by hand">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Away team" value={sports.away_team} onChange={setSport('away_team')} />
        <Field label="Away score" value={sports.away_score} onChange={setSport('away_score')} type="number" />
        <Field label="Home team" value={sports.home_team} onChange={setSport('home_team')} />
        <Field label="Home score" value={sports.home_score} onChange={setSport('home_score')} type="number" />
        <Field label="League" value={sports.league} onChange={setSport('league')} />
        <Field label="Sport" value={sports.sport} onChange={setSport('sport')} />
        <Field label="Status" value={sports.status} onChange={setSport('status')} placeholder="Final" />
        <Field label="Season" value={sports.season} onChange={setSport('season')} />
        <Field label="Venue" value={sports.venue} onChange={setSport('venue')} />
        <Field label="City" value={sports.city} onChange={setSport('city')} />
        <Field label="Attendance" value={sports.attendance} onChange={setSport('attendance')} type="number" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={fetchResult} disabled={fetching} className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] font-medium text-salty-secondary hover:bg-stone disabled:opacity-60 transition-colors">
          {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-ember" />} Fetch exact result
        </button>
        <button onClick={save} disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-ember/90 disabled:opacity-60">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save result
        </button>
        <Status state={state} />
        {fetchMsg && <span className="text-[12px] text-salty-muted">{fetchMsg}</span>}
      </div>
    </Section>
  )
}
