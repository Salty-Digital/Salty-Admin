'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useSort, SortHeader } from '@/components/ui/sortable'
import type { BetaFeedbackRow } from '@/lib/airtable'

const STATUS_ORDER = ['New', 'Reviewing', 'Resolved'] as const

const STATUS_STYLE: Record<string, string> = {
  New: 'border-[#FDE8C8] bg-[#FEF3C7] text-[#8A6830]',
  Reviewing: 'border-[#CFE2F5] bg-[#E6F0FB] text-[#2F6FB0]',
  Resolved: 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]',
}
const STATUS_FALLBACK = 'border-salty-border bg-cream text-salty-secondary'

const inputCls =
  'rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20 font-sans'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Screenshot thumbnail that opens the full image in a lightbox overlay. */
function ScreenshotThumb({ url, thumb }: { url: string; thumb: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-12 w-12 overflow-hidden rounded-md border border-salty-border transition-opacity hover:opacity-80"
        title="View screenshot"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb} alt="Feedback screenshot" className="h-full w-full object-cover" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Feedback screenshot"
            className="max-h-[85vh] max-w-[90vw] rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

export function FeedbackClient({ rows }: { rows: BetaFeedbackRow[] }) {
  const [status, setStatus] = useState<string>('')
  const [category, setCategory] = useState<string>('')
  const [platform, setPlatform] = useState<string>('')
  const [build, setBuild] = useState<string>('')
  const [search, setSearch] = useState<string>('')

  // Option lists derived from the data.
  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category))).sort(),
    [rows],
  )
  const platforms = useMemo(
    () => Array.from(new Set(rows.map((r) => r.platform))).sort(),
    [rows],
  )
  const builds = useMemo(
    () =>
      Array.from(new Set(rows.map((r) => r.build).filter((b): b is number => b != null))).sort(
        (a, b) => b - a,
      ),
    [rows],
  )

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (status && r.status !== status) return false
      if (category && r.category !== category) return false
      if (platform && r.platform !== platform) return false
      if (build && String(r.build) !== build) return false
      if (q && !(`${r.summary} ${r.message}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [rows, status, category, platform, build, search])

  const { sorted, sortState, requestSort } = useSort(filtered, {
    feedback: (r) => (r.message || r.summary || '').toLowerCase(),
    category: (r) => r.category,
    status: (r) => r.status,
    platform: (r) => r.platform,
    build: (r) => r.build,
    submitted: (r) => (r.submittedAt ? Date.parse(r.submittedAt) : null),
  })

  return (
    <div className="space-y-5">
      {/* Status tiles (also act as status filters) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Total"
          value={rows.length}
          active={status === ''}
          onClick={() => setStatus('')}
        />
        {STATUS_ORDER.map((s) => (
          <StatTile
            key={s}
            label={s}
            value={statusCounts[s] ?? 0}
            active={status === s}
            tone={s}
            onClick={() => setStatus(status === s ? '' : s)}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-salty-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search feedback…"
            className={`${inputCls} pl-8 w-56`}
          />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputCls}>
          <option value="">All platforms</option>
          {platforms.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select value={build} onChange={(e) => setBuild(e.target.value)} className={inputCls}>
          <option value="">All builds</option>
          {builds.map((b) => (
            <option key={b} value={String(b)}>Build {b}</option>
          ))}
        </select>
        {(status || category || platform || build || search) && (
          <button
            onClick={() => { setStatus(''); setCategory(''); setPlatform(''); setBuild(''); setSearch('') }}
            className="text-[12.5px] font-medium text-ember hover:underline"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-[12.5px] text-salty-muted">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-salty-border text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">
                <SortHeader label="Feedback" sortKey="feedback" sortState={sortState} onSort={requestSort} className="px-4 py-2.5" />
                <SortHeader label="Category" sortKey="category" sortState={sortState} onSort={requestSort} className="px-4 py-2.5" />
                <SortHeader label="Status" sortKey="status" sortState={sortState} onSort={requestSort} className="px-4 py-2.5" />
                <SortHeader label="Platform" sortKey="platform" sortState={sortState} onSort={requestSort} className="px-4 py-2.5" />
                <SortHeader label="Build" sortKey="build" sortState={sortState} onSort={requestSort} className="px-4 py-2.5" />
                <SortHeader label="Submitted" sortKey="submitted" sortState={sortState} onSort={requestSort} className="px-4 py-2.5 whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-salty-muted">
                    No feedback matches these filters.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.id} className="border-b border-salty-border/60 align-top last:border-0">
                    <td className="max-w-md px-4 py-3">
                      <p className="whitespace-pre-wrap text-[13px] text-salty-text">{r.message || r.summary}</p>
                      {r.featurePage && (
                        <span className="mt-1 inline-block text-[11px] text-salty-muted">{r.featurePage}</span>
                      )}
                      {r.screenshots.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.screenshots.map((s, i) => (
                            <ScreenshotThumb key={i} url={s.url} thumb={s.thumb} />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-salty-secondary whitespace-nowrap">{r.category}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status] ?? STATUS_FALLBACK}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-salty-secondary whitespace-nowrap">{r.platform}</td>
                    <td className="px-4 py-3 text-[12.5px] text-salty-secondary whitespace-nowrap">
                      {r.build ?? '—'}
                      {r.appVersion && <span className="ml-1 text-[11px] text-salty-muted">{r.appVersion.replace(/\s*\(\d+\)/, '')}</span>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-muted whitespace-nowrap">{fmtDate(r.submittedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatTile({
  label,
  value,
  active,
  tone,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  tone?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[14px] border bg-warm-white p-4 text-left transition-colors ${
        active ? 'border-ember ring-2 ring-ember/20' : 'border-salty-border hover:border-salty-muted'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {tone && (
          <span
            className={`h-2 w-2 rounded-full ${
              tone === 'New' ? 'bg-[#E0A93A]' : tone === 'Reviewing' ? 'bg-[#2F6FB0]' : tone === 'Resolved' ? 'bg-[#3E8A5A]' : 'bg-salty-muted'
            }`}
          />
        )}
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{label}</p>
      </div>
      <p className="mt-1 font-sora text-[24px] font-bold text-salty-text">{value}</p>
    </button>
  )
}
