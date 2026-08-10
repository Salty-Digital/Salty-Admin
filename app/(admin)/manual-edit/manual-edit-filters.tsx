'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { TICKET_CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'

const FLAGS: [string, string][] = [
  ['', 'All issues'],
  ['no-title', 'No title'],
  ['no-venue', 'No venue'],
  ['no-date', 'No date'],
  ['uncategorised', 'Uncategorised'],
  ['low-confidence', 'Low confidence'],
  ['pending', 'Pending'],
  ['no-cast', 'No cast'],
  ['no-result', 'No result'],
]

const SORTS: [string, string][] = [
  ['flags', 'Most issues'],
  ['imported', 'Imported'],
  ['title', 'Title'],
  ['category', 'Category'],
  ['confidence', 'Confidence'],
]

const sel =
  'rounded-lg border border-salty-border bg-cream px-3 py-[7px] text-[13px] text-salty-text focus:border-ember focus:outline-none font-sans'

export function ManualEditFilters({
  flag, cat, sort, dir, searching,
}: {
  flag: string; cat: string; sort: string; dir: string; searching: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function set(key: string, val: string) {
    const p = new URLSearchParams(params.toString())
    if (val) p.set(key, val)
    else p.delete(key)
    router.push(`${pathname}?${p.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!searching && (
        <select value={flag} onChange={(e) => set('flag', e.target.value)} className={sel}>
          {FLAGS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      )}
      <select value={cat} onChange={(e) => set('cat', e.target.value)} className={sel}>
        <option value="">All categories</option>
        {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
      </select>
      <div className="ml-auto flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Sort</span>
        <select value={sort} onChange={(e) => set('sort', e.target.value)} className={sel}>
          {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => set('dir', dir === 'asc' ? 'desc' : 'asc')}
          title={dir === 'asc' ? 'Ascending' : 'Descending'}
          className="rounded-lg border border-salty-border bg-cream p-[7px] text-salty-secondary hover:bg-stone transition-colors"
        >
          {dir === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
