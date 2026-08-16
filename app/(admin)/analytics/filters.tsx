'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { SlidersHorizontal, X, Loader2 } from 'lucide-react'

/**
 * Analytics filters — window, category and source.
 *
 * State lives in the URL (?days=&category=&source=) rather than component state, matching
 * /llm-costs and /api-usage. That makes a filtered view linkable, survives a refresh, and keeps the
 * page a server component that simply reads its params.
 */

export const WINDOWS = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
  { value: '', label: 'All time' },
] as const

export interface FilterOption { value: string; n: number }

export function AnalyticsFilters({ categories, sources }: {
  categories: FilterOption[]
  sources: FilterOption[]
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, start] = useTransition()

  const days = params.get('days') ?? '30'
  const category = params.get('category') ?? ''
  const source = params.get('source') ?? ''

  const apply = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    start(() => router.push(`/analytics?${next.toString()}`))
  }

  const active = (category ? 1 : 0) + (source ? 1 : 0)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-salty-border bg-warm-white px-4 py-3">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-salty-muted">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
      </span>

      <div className="flex gap-1 rounded-lg border border-salty-border bg-cream p-1">
        {WINDOWS.map((w) => (
          <button
            key={w.label}
            onClick={() => apply({ days: w.value })}
            disabled={pending}
            className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors disabled:opacity-60 ${
              days === w.value ? 'bg-warm-white text-ember shadow-sm' : 'text-salty-muted hover:text-salty-text'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      <select
        value={category}
        onChange={(e) => apply({ category: e.target.value })}
        disabled={pending}
        aria-label="Category"
        className="rounded-lg border border-salty-border bg-cream px-2.5 py-1.5 text-[12.5px] text-salty-text focus:border-ember focus:outline-none disabled:opacity-60"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.value} value={c.value}>{c.value} ({c.n})</option>
        ))}
      </select>

      <select
        value={source}
        onChange={(e) => apply({ source: e.target.value })}
        disabled={pending}
        aria-label="Source"
        className="rounded-lg border border-salty-border bg-cream px-2.5 py-1.5 text-[12.5px] text-salty-text focus:border-ember focus:outline-none disabled:opacity-60"
      >
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s.value} value={s.value}>{s.value} ({s.n})</option>
        ))}
      </select>

      {active > 0 && (
        <button
          onClick={() => apply({ category: '', source: '' })}
          disabled={pending}
          className="flex items-center gap-1 text-[12px] font-medium text-ember hover:underline disabled:opacity-60"
        >
          <X className="h-3 w-3" /> Clear {active} filter{active === 1 ? '' : 's'}
        </button>
      )}

      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-salty-muted" />}

      <span className="ml-auto text-[11.5px] text-salty-muted">
        {/* Said explicitly because a windowed activation number is a different measurement, not the
            same number over a shorter period — without this the drop looks like a regression. */}
        {days
          ? `Activation reflects users who signed up in the last ${days} days`
          : 'Activation reflects all users'}
      </span>
    </div>
  )
}
