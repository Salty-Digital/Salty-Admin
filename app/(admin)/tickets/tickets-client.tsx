'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Pencil, Trash2, Check, X, Loader2, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { editTicketAction, deleteTicketAction } from './actions'
import { useAccessLevel } from '@/components/admin-provider'
import { formatPrice } from '@/lib/format'
import { TICKET_CATEGORIES, TICKET_SOURCES, CATEGORY_LABELS } from '@/lib/categories'
import { SortLink } from '@/components/ui/sortable'

const STATUSES = ['active', 'archived', 'pending']

interface Ticket {
  id: string
  user_id: string
  user_email: string
  title: string | null
  venue_name: string | null
  date_str: string | null
  time_str: string | null
  category: string
  source: string
  status: string
  confidence: number
  price_paid: number | null
  price_currency: string | null
  imported_at: string
}

interface Filters {
  q: string
  category: string
  source: string
  status: string
}

function FilterBar({ filters }: { filters: Filters }) {
  const router = useRouter()
  const pathname = usePathname()
  const [, start] = useTransition()

  function set(key: string, val: string) {
    start(() => {
      const p = new URLSearchParams(window.location.search)
      if (val) p.set(key, val); else p.delete(key)
      p.delete('page')
      router.push(`${pathname}?${p.toString()}`)
    })
  }

  const sel = 'rounded-lg border border-salty-border bg-cream px-3 py-[7px] text-[13px] text-salty-text focus:border-ember focus:outline-none font-sans'

  return (
    <div className="flex flex-wrap gap-2">
      <input
        defaultValue={filters.q}
        onChange={(e) => set('q', e.target.value)}
        placeholder="Search title, venue, email…"
        className="rounded-lg border border-salty-border bg-cream px-3 py-[7px] text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none w-64 font-sans"
      />
      <select defaultValue={filters.category} onChange={(e) => set('category', e.target.value)} className={sel}>
        <option value="">All categories</option>
        {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
      </select>
      <select defaultValue={filters.source} onChange={(e) => set('source', e.target.value)} className={sel}>
        <option value="">All sources</option>
        {TICKET_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select defaultValue={filters.status} onChange={(e) => set('status', e.target.value)} className={sel}>
        <option value="">All statuses</option>
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  )
}

function TicketRow({ ticket, canEdit, canDelete }: { ticket: Ticket; canEdit: boolean; canDelete: boolean }) {
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pending, startTransition] = useTransition()
  const [fields, setFields] = useState({
    title: ticket.title ?? '',
    venue_name: ticket.venue_name ?? '',
    date_str: ticket.date_str ?? '',
    category: ticket.category,
  })

  function saveEdit() {
    startTransition(async () => {
      await editTicketAction(ticket.id, fields)
      setEditing(false)
    })
  }

  function confirmDelete() {
    startTransition(async () => {
      await deleteTicketAction(ticket.id)
    })
  }

  const srcColor: Record<string, string> = {
    gmail:    'bg-[#EBF2FA] text-[#3A72A8]',
    calendar: 'bg-[#EAF4EE] text-[#3E8A5A]',
    wallet:   'bg-gold-light text-gold',
    photo:    'bg-[#F3EBF8] text-[#7B44A8]',
    manual:   'bg-stone text-salty-secondary',
  }

  const inp = 'rounded border border-salty-border bg-cream px-2 py-0.5 text-[12px] text-salty-text focus:border-ember focus:outline-none w-full'

  if (editing) {
    return (
      <tr className="border-b border-salty-border bg-ember-light/30">
        <td className="px-4 py-2"><input className={inp} value={fields.title} onChange={e => setFields(f => ({...f, title: e.target.value}))} placeholder="Title" /></td>
        <td className="px-4 py-2"><input className={inp} value={fields.venue_name} onChange={e => setFields(f => ({...f, venue_name: e.target.value}))} placeholder="Venue" /></td>
        <td className="px-4 py-2"><input className={inp} value={fields.date_str} onChange={e => setFields(f => ({...f, date_str: e.target.value}))} placeholder="Date" /></td>
        <td className="px-4 py-2">
          <select className={inp} value={fields.category} onChange={e => setFields(f => ({...f, category: e.target.value}))}>
            {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
          </select>
        </td>
        <td className="px-4 py-2 text-[12px] text-salty-secondary">{ticket.source}</td>
        <td className="px-4 py-2 text-[12px] text-salty-secondary">{formatPrice(ticket.price_paid, ticket.price_currency)}</td>
        <td className="px-4 py-2 text-[12px] text-salty-secondary">{ticket.user_email}</td>
        <td className="px-4 py-2">
          <div className="flex gap-1">
            <button onClick={saveEdit} disabled={pending} className="flex items-center gap-1 rounded-md bg-[#EAF4EE] px-2 py-1 text-[11px] font-semibold text-[#3E8A5A] hover:bg-[#C9E8D6]">
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save
            </button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1 rounded-md bg-stone px-2 py-1 text-[11px] text-salty-secondary hover:bg-salty-border">
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </td>
      </tr>
    )
  }

  if (deleting) {
    return (
      <tr className="border-b border-salty-border bg-[#FDEDED]/40">
        <td colSpan={8} className="px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-[#BF4A3A]">Delete <strong>{ticket.title ?? 'this ticket'}</strong>? This cannot be undone.</span>
            <button onClick={confirmDelete} disabled={pending} className="flex items-center gap-1 rounded-md bg-[#FDEDED] px-2.5 py-1 text-[11px] font-semibold text-[#BF4A3A] border border-[#F0C4C4] hover:bg-[#F5D0D0]">
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete
            </button>
            <button onClick={() => setDeleting(false)} className="text-[11px] text-salty-muted hover:text-salty-text">Cancel</button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-b border-salty-border transition-colors hover:bg-cream cursor-default">
      <td className="px-4 py-3 text-[13px] font-medium text-salty-text max-w-[200px]">
        <p className="truncate">{ticket.title ?? '—'}</p>
      </td>
      <td className="px-4 py-3 text-[12px] text-salty-secondary max-w-[160px]">
        <p className="truncate">{ticket.venue_name ?? '—'}</p>
      </td>
      <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">{ticket.date_str ?? '—'}</td>
      <td className="px-4 py-3">
        <span className="rounded-full bg-stone px-2.5 py-0.5 text-[11px] font-medium capitalize text-salty-secondary">
          {ticket.category}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${srcColor[ticket.source] ?? 'bg-stone text-salty-secondary'}`}>
          {ticket.source}
        </span>
      </td>
      <td className="px-4 py-3 text-[12px] font-medium text-salty-text whitespace-nowrap">{formatPrice(ticket.price_paid, ticket.price_currency)}</td>
      <td className="px-4 py-3 text-[12px] text-salty-secondary">
        <Link href={`/users/${ticket.user_id}`} className="flex items-center gap-1 hover:text-ember hover:underline">
          <span className="truncate max-w-[140px]">{ticket.user_email}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {canEdit && (
            <button onClick={() => setEditing(true)} className="rounded-md p-1.5 text-salty-muted hover:bg-stone hover:text-salty-text transition-colors" title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {canDelete && (
            <button onClick={() => setDeleting(true)} className="rounded-md p-1.5 text-salty-muted hover:bg-[#FDEDED] hover:text-[#BF4A3A] transition-colors" title="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

export function TicketsClient({ tickets, filters }: { tickets: Ticket[]; filters: Filters }) {
  const level = useAccessLevel()
  const canEdit = level <= 3
  const canDelete = level <= 2

  return (
    <div className="space-y-4">
      <FilterBar filters={filters} />
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                <SortLink label="Title" sortKey="title" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Venue" sortKey="venue" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Date" sortKey="date" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Category" sortKey="category" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Source" sortKey="source" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Price" sortKey="price" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">User</th>
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[13px] text-salty-muted">No tickets found</td></tr>
              ) : (
                tickets.map(t => <TicketRow key={t.id} ticket={t} canEdit={canEdit} canDelete={canDelete} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
