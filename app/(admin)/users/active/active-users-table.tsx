'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { useSort, SortHeader } from '@/components/ui/sortable'

export interface ActiveRow {
  id: string
  email: string
  username: string | null
  displayName: string | null
  tier: string
  banned: boolean
  lastSeen: number
  daysActive: number
  totalSeconds: number
  sessions: number
  online: boolean
}

const TIER_COLORS: Record<string, string> = {
  free: 'bg-stone text-salty-muted',
  premium: 'bg-gold-light text-gold',
  family: 'bg-ember-light text-ember',
}

function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m > 0 ? `${m}m` : ''}`.trim()
  if (m > 0) return `${m}m`
  return `${Math.round(seconds)}s`
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ActiveUsersTable({ rows, emptyLabel }: { rows: ActiveRow[]; emptyLabel: string }) {
  const { sorted, sortState, requestSort } = useSort(rows, {
    user: (r) => r.email.toLowerCase(),
    tier: (r) => r.tier,
    daysActive: (r) => r.daysActive,
    totalTime: (r) => r.totalSeconds,
    sessions: (r) => r.sessions,
    lastSeen: (r) => r.lastSeen,
  })

  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
              <SortHeader label="User" sortKey="user" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Tier" sortKey="tier" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Days active" sortKey="daysActive" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Total time" sortKey="totalTime" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Sessions" sortKey="sessions" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Last seen" sortKey="lastSeen" sortState={sortState} onSort={requestSort} className="px-4 py-3 whitespace-nowrap" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-salty-muted">{emptyLabel}</td>
              </tr>
            ) : (
              sorted.map((u) => (
                <tr key={u.id} className="border-b border-salty-border last:border-0 transition-colors hover:bg-cream">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {u.online && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF4EE] px-1.5 py-0.5 text-[10px] font-semibold text-[#3E8A5A]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#3E8A5A]" /> Online
                        </span>
                      )}
                      <p className="text-[13px] font-medium text-salty-text">{u.email}</p>
                      {u.banned && (
                        <span className="rounded-full bg-[#FDEDED] px-2 py-0.5 text-[10px] font-semibold text-[#BF4A3A]">Banned</span>
                      )}
                    </div>
                    {(u.displayName || u.username) && (
                      <p className="text-[11px] text-salty-muted">{u.displayName ?? u.username}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${TIER_COLORS[u.tier] ?? 'bg-stone text-salty-muted'}`}>
                      {u.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] font-medium text-salty-text">{u.daysActive}</td>
                  <td className="px-4 py-3 text-[13px] text-salty-secondary whitespace-nowrap">{fmtDuration(u.totalSeconds)}</td>
                  <td className="px-4 py-3 text-[13px] text-salty-secondary">{u.sessions || '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">{relativeTime(u.lastSeen)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/users/${u.id}`} className="text-salty-muted hover:text-ember transition-colors">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
