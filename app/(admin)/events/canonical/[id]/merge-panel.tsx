'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { GitMerge, Loader2, Search, AlertTriangle } from 'lucide-react'
import { lookupEventAction, mergeEventAction, type EventPreview } from './actions'
import { fmtEventDate } from '@/lib/events'

/**
 * Merge a duplicate ("loser") event into the one being viewed (the "winner" survivor).
 * Paste the loser's event id, preview it, then confirm — the DB function repoints its
 * tickets + enrichment onto this event. Admin+ only; the page decides whether to render it.
 */
export function MergePanel({ winnerId }: { winnerId: string }) {
  const router = useRouter()
  const [loserId, setLoserId] = useState('')
  const [preview, setPreview] = useState<EventPreview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [looking, startLookup] = useTransition()
  const [merging, startMerge] = useTransition()

  function doPreview() {
    setErr(null); setPreview(null); setDone(false)
    startLookup(async () => {
      const res = await lookupEventAction(loserId.trim())
      if (res.ok && res.event) {
        if (res.event.id === winnerId) { setErr('That is this same event.'); return }
        setPreview(res.event)
      } else setErr(res.error ?? 'Lookup failed.')
    })
  }

  function doMerge() {
    if (!preview) return
    setErr(null)
    startMerge(async () => {
      const res = await mergeEventAction(winnerId, preview.id)
      if (res.ok) { setDone(true); setPreview(null); setLoserId(''); router.refresh() }
      else setErr(res.error ?? 'Merge failed.')
    })
  }

  const input = 'flex-1 rounded-lg border border-salty-border bg-cream px-3 py-2 font-mono text-[12px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none'

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-salty-muted">
        Fold a duplicate event into this one. Paste the duplicate&apos;s event id, preview it, then confirm — its tickets and
        enrichment repoint here and it&apos;s stamped as merged. This cannot be undone from the admin (no split function yet).
      </p>
      <div className="flex gap-2">
        <input
          value={loserId}
          onChange={(e) => setLoserId(e.target.value)}
          placeholder="Duplicate event UUID to merge in…"
          className={input}
        />
        <button
          onClick={doPreview}
          disabled={looking || !loserId.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-2 text-[12.5px] font-medium text-salty-secondary hover:bg-cream disabled:opacity-50"
        >
          {looking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Preview
        </button>
      </div>

      {preview && (
        <div className="rounded-lg border border-[#EAD9A6] bg-[#FFF8E6] p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8A6830]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[#8A6830]">Merge this event in?</p>
              <p className="mt-0.5 truncate text-[13px] font-medium text-salty-text">{preview.name ?? 'Untitled event'}</p>
              <p className="text-[11.5px] text-salty-muted">
                {fmtEventDate(preview.event_date)} · {preview.tickets} ticket{preview.tickets === 1 ? '' : 's'} ·{' '}
                <span className="font-mono">{preview.event_key ?? 'no key'}</span>
                {preview.merged_into && ' · already merged elsewhere'}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={doMerge}
              disabled={merging}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#BF4A3A] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#A53D30] disabled:opacity-60"
            >
              {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />} Confirm merge
            </button>
            <button onClick={() => { setPreview(null); setErr(null) }} disabled={merging} className="text-[12px] text-salty-muted hover:text-salty-text">Cancel</button>
          </div>
        </div>
      )}

      {err && <p className="text-[12px] text-[#BF4A3A]">{err}</p>}
      {done && <p className="text-[12px] text-[#3E8A5A]">Merged. Tickets and enrichment now point here.</p>}
    </div>
  )
}
