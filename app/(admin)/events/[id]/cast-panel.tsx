'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { fetchCastAction, type CastMemberResult } from './actions'

/**
 * Renders a ticket's cast. When the DB has no cast rows yet (the app enriches lazily
 * on first in-app view), it offers a "Fetch cast" button that runs the same
 * `enrich-cast` AI lookup and persists the result — so the admin sees the same
 * content the app would show, on demand rather than on every page load.
 */
export function CastPanel({ ticketId, initialCast }: { ticketId: string; initialCast: CastMemberResult[] }) {
  const [cast, setCast] = useState<CastMemberResult[]>(initialCast)
  const [checked, setChecked] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function fetchCast() {
    setErr(null)
    start(async () => {
      const res = await fetchCastAction(ticketId)
      if (res.ok) {
        setCast(res.cast)
        setChecked(true)
      } else {
        setErr(res.error ?? 'Failed to fetch cast')
      }
    })
  }

  if (cast.length > 0) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {cast.map((c, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-salty-text">{c.name}</span>
            {c.role && <span className="text-[11.5px] text-salty-muted">{c.role}</span>}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-2.5">
      <p className="text-[13px] text-salty-muted">
        {checked
          ? 'No cast could be found for this show.'
          : 'Cast isn’t enriched yet — the app generates it on first view. Fetch it now (same AI lookup, saved to the ticket).'}
      </p>
      {!checked && (
        <button
          onClick={fetchCast}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-cream px-3 py-1.5 text-[12.5px] font-medium text-salty-secondary transition-colors hover:bg-stone disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-ember" />}
          {pending ? 'Fetching cast…' : 'Fetch cast'}
        </button>
      )}
      {err && <p className="text-[12px] text-[#BF4A3A]">{err}</p>}
    </div>
  )
}
