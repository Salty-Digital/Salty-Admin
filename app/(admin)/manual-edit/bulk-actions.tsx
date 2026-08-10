'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, CheckCheck, Loader2 } from 'lucide-react'
import { fetchSportsAction, fetchCastAction, markReviewedAction } from './actions'

export interface BulkRow { id: string; category: string; flags: string[] }

// Only these enrichment gaps are fetchable from the admin panel. Setlists are excluded on
// purpose — setlist-lookup needs the real signed-in user, so it can't be admin-triggered.
function fetchKind(r: BulkRow): 'sports' | 'cast' | null {
  if (r.category === 'sports' && r.flags.includes('No result')) return 'sports'
  if (r.category === 'theater' && r.flags.includes('No cast')) return 'cast'
  return null
}

// Run `fn` over `items` with bounded concurrency — gentle on TheSportsDB / enrich-cast,
// same shape as the one-off backfill scripts.
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!)
    }),
  )
}

export function BulkActions({ rows }: { rows: BulkRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'fetch' | 'done'>(null)
  const [prog, setProg] = useState({ done: 0, total: 0, hit: 0 })
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmDone, setConfirmDone] = useState(false)

  const fetchable = rows.filter((r) => fetchKind(r))

  async function fetchAll() {
    if (fetchable.length === 0 || busy) return
    setConfirmDone(false); setMsg(null); setBusy('fetch')
    setProg({ done: 0, total: fetchable.length, hit: 0 })
    let done = 0, hit = 0
    await runPool(fetchable, 3, async (r) => {
      try {
        if (fetchKind(r) === 'sports') {
          const res = await fetchSportsAction(r.id)
          if (res.ok && res.found) hit++
        } else {
          const res = await fetchCastAction(r.id)
          if (res.ok && res.cast.length > 0) hit++
        }
      } catch { /* keep going — one failure shouldn't stop the batch */ }
      done++
      setProg({ done, total: fetchable.length, hit })
    })
    setBusy(null)
    setMsg(`Fetched ${hit} of ${fetchable.length}. The rest have no data available (bad date, not a real game, or not in the source).`)
    router.refresh()
  }

  async function markAllDone() {
    if (rows.length === 0 || busy) return
    setConfirmDone(false); setMsg(null); setBusy('done')
    setProg({ done: 0, total: rows.length, hit: 0 })
    let done = 0
    await runPool(rows, 4, async (r) => {
      try { await markReviewedAction(r.id, true) } catch { /* keep going */ }
      done++
      setProg((p) => ({ ...p, done }))
    })
    setBusy(null)
    setMsg(`Marked ${rows.length} ticket${rows.length === 1 ? '' : 's'} done.`)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-salty-border bg-cream/50 px-4 py-3">
      <button
        onClick={fetchAll}
        disabled={busy !== null || fetchable.length === 0}
        title={fetchable.length === 0 ? 'No fetchable enrichment gaps in the current filter' : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-ember/90 disabled:opacity-50"
      >
        {busy === 'fetch' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Fetch all missing ({fetchable.length})
      </button>

      <button
        onClick={() => (confirmDone ? markAllDone() : setConfirmDone(true))}
        disabled={busy !== null || rows.length === 0}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50 ${
          confirmDone
            ? 'border-ember bg-ember-light text-ember hover:bg-ember-light/80'
            : 'border-salty-border bg-warm-white text-salty-secondary hover:bg-stone'
        }`}
      >
        {busy === 'done' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
        {confirmDone ? `Confirm — mark ${rows.length} done` : `Mark all done (${rows.length})`}
      </button>
      {confirmDone && !busy && (
        <button onClick={() => setConfirmDone(false)} className="text-[12.5px] text-salty-muted hover:text-salty-text">
          Cancel
        </button>
      )}

      {busy ? (
        <span className="text-[12.5px] font-medium text-salty-secondary">
          {prog.done} / {prog.total}{busy === 'fetch' ? ` · ${prog.hit} found` : ''}…
        </span>
      ) : msg ? (
        <span className="text-[12.5px] text-salty-muted">{msg}</span>
      ) : null}

      <span className="ml-auto hidden text-[11.5px] text-salty-muted sm:block">
        Acts on all {rows.length} filtered ticket{rows.length === 1 ? '' : 's'} — narrow with the filters above first.
      </span>
    </div>
  )
}
