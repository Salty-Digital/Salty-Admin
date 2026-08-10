'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, CheckCheck, Loader2 } from 'lucide-react'
import { markReviewedAction } from './actions'

export interface QueueNavData {
  total: number
  position: number | null
  prevId: string | null
  nextId: string | null
}

const stepCls = (enabled: boolean) =>
  `inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
    enabled
      ? 'border-salty-border bg-warm-white text-salty-secondary hover:bg-cream'
      : 'pointer-events-none border-salty-border bg-cream text-salty-muted opacity-50'
  }`

export function QueueNav({ currentId, nav }: { currentId: string; nav: QueueNavData }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function doneAndNext() {
    if (busy) return
    setErr(null)
    setBusy(true)
    const res = await markReviewedAction(currentId, true, false) // skip revalidate — we navigate
    if (!res.ok) { setErr(res.error); setBusy(false); return }
    // Moving to the next ticket only changes ?ticket=, which the App Router won't re-render
    // on push alone — refresh() forces the new ticket's server render. (busy stays true; we
    // navigate away, unmounting this component.)
    router.push(nav.nextId ? `/manual-edit?ticket=${nav.nextId}` : '/manual-edit')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {nav.position != null && (
        <span className="mr-1 text-[12px] tabular-nums text-salty-muted">
          {nav.position} of {nav.total} in queue
        </span>
      )}

      {nav.prevId ? (
        <Link href={`/manual-edit?ticket=${nav.prevId}`} className={stepCls(true)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Link>
      ) : (
        <span className={stepCls(false)}><ChevronLeft className="h-3.5 w-3.5" /> Prev</span>
      )}

      {nav.nextId ? (
        <Link href={`/manual-edit?ticket=${nav.nextId}`} className={stepCls(true)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className={stepCls(false)}>Next <ChevronRight className="h-3.5 w-3.5" /></span>
      )}

      <button
        onClick={doneAndNext}
        disabled={busy}
        title="Mark this ticket reviewed and jump to the next one"
        className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-ember/90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
        Done &amp; next
      </button>
      {err && <span className="text-[11.5px] text-[#BF4A3A]">{err}</span>}
    </div>
  )
}
