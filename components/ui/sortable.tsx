'use client'

import { useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: string
  dir: SortDir
}

type Accessor<T> = (row: T) => string | number | null | undefined
export type Accessors<T> = Record<string, Accessor<T>>

/**
 * Lightweight client-side table sorting for tables whose full dataset is already in the
 * client. `accessors` maps a sort key to a value getter. Nulls always sort last; strings
 * compare with numeric-aware locale compare. Click a header to toggle asc → desc.
 */
export function useSort<T>(rows: T[], accessors: Accessors<T>, initial?: SortState) {
  const [sortState, setSortState] = useState<SortState | null>(initial ?? null)

  let sorted = rows
  if (sortState && accessors[sortState.key]) {
    const acc = accessors[sortState.key]
    const m = sortState.dir === 'asc' ? 1 : -1
    sorted = [...rows].sort((a, b) => {
      const x = acc(a)
      const y = acc(b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * m
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * m
    })
  }

  const requestSort = (key: string) =>
    setSortState((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  return { sorted, sortState, requestSort }
}

/** A clickable `<th>` that toggles sorting on its column. */
export function SortHeader({
  label,
  sortKey,
  sortState,
  onSort,
  className,
}: {
  label: string
  sortKey: string
  sortState: SortState | null
  onSort: (key: string) => void
  className?: string
}) {
  const active = sortState?.key === sortKey
  const Icon = !active ? ChevronsUpDown : sortState!.dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex select-none items-center gap-1 transition-colors hover:text-salty-text ${active ? 'text-salty-text' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? 'text-ember' : 'opacity-40'}`} />
      </button>
    </th>
  )
}

/**
 * A clickable `<th>` for SERVER-paginated tables: toggles `?sort=<key>&dir=asc|desc` in
 * the URL (resetting `page`) so the server re-queries the whole dataset in order. Drop it
 * into any table header — it's a client component, so it works inside server-rendered pages.
 */
export function SortLink({ label, sortKey, className }: { label: string; sortKey: string; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const active = params.get('sort') === sortKey
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc'
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown

  function toggle() {
    const p = new URLSearchParams(params.toString())
    p.set('sort', sortKey)
    p.set('dir', active && dir === 'asc' ? 'desc' : 'asc')
    p.delete('page')
    router.push(`${pathname}?${p.toString()}`)
  }

  return (
    <th className={className}>
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex select-none items-center gap-1 transition-colors hover:text-salty-text ${active ? 'text-salty-text' : ''}`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? 'text-ember' : 'opacity-40'}`} />
      </button>
    </th>
  )
}
