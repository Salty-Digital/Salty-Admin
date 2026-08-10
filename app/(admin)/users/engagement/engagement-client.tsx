'use client'

import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useSort, SortHeader } from '@/components/ui/sortable'
import { ClickableRow } from '@/components/ui/clickable-row'

export type Classification = 'real-active' | 'dormant' | 'team'

export interface EngagementRow {
  id: string
  email: string
  displayName: string | null
  username: string | null
  tier: string
  tickets: number
  activeDays: number | null
  lastSignIn: string | null
  returned: boolean
  banned: boolean
  classification: Classification
}

interface Summary {
  total: number
  realActive: number
  dormant: number
  team: number
  imported: number
  returned: number
}

const TIER_COLORS: Record<string, string> = {
  free: 'bg-stone text-salty-muted',
  premium: 'bg-gold-light text-gold',
  family: 'bg-ember-light text-ember',
}

const CLASS_META: Record<Classification, { label: string; badge: string; dot: string }> = {
  'real-active': { label: 'Real-active', badge: 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]', dot: 'bg-[#3E8A5A]' },
  dormant:       { label: 'Dormant',     badge: 'border-salty-border bg-cream text-salty-secondary', dot: 'bg-salty-muted' },
  team:          { label: 'Team',        badge: 'border-[#CFE2F5] bg-[#EBF2FA] text-[#3A72A8]', dot: 'bg-[#3A72A8]' },
}

type Filter = 'all' | Classification

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function EngagementClient({
  rows,
  summary,
  windowDays,
}: {
  rows: EngagementRow[]
  summary: Summary
  windowDays: number
}) {
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.classification === filter)),
    [rows, filter],
  )

  const { sorted, sortState, requestSort } = useSort(filtered, {
    user: (r) => r.email.toLowerCase(),
    tier: (r) => r.tier,
    tickets: (r) => r.tickets,
    activeDays: (r) => r.activeDays,
    lastSignIn: (r) => (r.lastSignIn ? Date.parse(r.lastSignIn) : null),
    status: (r) => r.classification,
  })

  return (
    <div className="space-y-5">
      {/* Summary tiles (click to filter) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Total accounts" value={summary.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <Tile label="Real-active" value={summary.realActive} tone="real-active" active={filter === 'real-active'} onClick={() => setFilter('real-active')} />
        <Tile label="Dormant" value={summary.dormant} tone="dormant" active={filter === 'dormant'} onClick={() => setFilter('dormant')} />
        <Tile label="Team" value={summary.team} tone="team" active={filter === 'team'} onClick={() => setFilter('team')} />
      </div>

      {/* Funnel line */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border border-salty-border bg-warm-white px-4 py-3 text-[12.5px] text-salty-secondary">
        <span className="font-semibold text-salty-text">{summary.total}</span> accounts
        <span className="text-salty-muted">→</span>
        <span className="font-semibold text-salty-text">{summary.imported}</span> imported ≥1 ticket
        <span className="text-salty-muted">→</span>
        <span className="font-semibold text-salty-text">{summary.returned}</span> returned a 2nd day
        <span className="ml-auto text-[11px] text-salty-muted">engagement over last {windowDays} days</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
                <SortHeader label="User" sortKey="user" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
                <SortHeader label="Tier" sortKey="tier" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
                <SortHeader label="Tickets" sortKey="tickets" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
                <SortHeader label="Active days" sortKey="activeDays" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
                <SortHeader label="Last sign-in" sortKey="lastSignIn" sortState={sortState} onSort={requestSort} className="px-4 py-3 whitespace-nowrap" />
                <SortHeader label="Status" sortKey="status" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-salty-muted">No users in this group</td>
                </tr>
              ) : (
                sorted.map((r) => {
                  const meta = CLASS_META[r.classification]
                  return (
                    <ClickableRow key={r.id} href={`/users/${r.id}`} ariaLabel={`View ${r.email} profile`} className="group border-b border-salty-border last:border-0 transition-colors hover:bg-cream">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-medium text-salty-text">{r.email}</p>
                          {r.banned && (
                            <span className="rounded-full bg-[#FDEDED] px-2 py-0.5 text-[10px] font-semibold text-[#BF4A3A]">Banned</span>
                          )}
                        </div>
                        {(r.displayName || r.username) && (
                          <p className="text-[11px] text-salty-muted">{r.displayName ?? r.username}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${TIER_COLORS[r.tier] ?? 'bg-stone text-salty-muted'}`}>
                          {r.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] font-medium text-salty-text">{r.tickets}</td>
                      <td className="px-4 py-3 text-[13px] text-salty-secondary">
                        {r.activeDays === null ? <span className="text-salty-muted">—</span> : r.activeDays}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">{fmtDate(r.lastSignIn)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-salty-muted transition-colors group-hover:text-ember" />
                      </td>
                    </ClickableRow>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Tile({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  tone?: Classification
  active: boolean
  onClick: () => void
}) {
  const dot = tone ? CLASS_META[tone].dot : null
  return (
    <button
      onClick={onClick}
      className={`rounded-[14px] border bg-warm-white p-4 text-left transition-colors ${
        active ? 'border-ember ring-2 ring-ember/20' : 'border-salty-border hover:border-salty-muted'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{label}</p>
      </div>
      <p className="mt-1 font-sora text-[24px] font-bold text-salty-text">{value}</p>
    </button>
  )
}
