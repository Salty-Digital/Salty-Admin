'use client'

import { useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { TICKET_CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'

interface Filters {
  category: string
  key: string
  multi: string
  merged: string
}

export function EventsFilters({ filters }: { filters: Filters }) {
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
  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-[7px] text-[13px] font-medium transition-colors ${
      active ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-cream text-salty-secondary hover:text-salty-text'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select defaultValue={filters.category} onChange={(e) => set('category', e.target.value)} className={sel} aria-label="Category">
        <option value="">All categories</option>
        {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
      </select>
      <select defaultValue={filters.key} onChange={(e) => set('key', e.target.value)} className={sel} aria-label="Identity">
        <option value="">Any identity</option>
        <option value="keyed">Strong-ID keyed</option>
        <option value="fuzzy">Fuzzy (title·date)</option>
      </select>
      <button type="button" onClick={() => set('multi', filters.multi === '1' ? '' : '1')} className={chip(filters.multi === '1')}>
        Multi-attendee
      </button>
      <button type="button" onClick={() => set('merged', filters.merged === '1' ? '' : '1')} className={chip(filters.merged === '1')}>
        Has merges
      </button>
      {(filters.category || filters.key || filters.multi || filters.merged) && (
        <button
          type="button"
          onClick={() => start(() => router.push(pathname))}
          className="px-2 py-[7px] text-[12.5px] text-salty-muted hover:text-salty-text"
        >
          Clear
        </button>
      )}
    </div>
  )
}
