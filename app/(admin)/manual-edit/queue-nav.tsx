'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
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
  const [pending, start] = useTransition()

  function doneAndNext() {
    start(async () => {
      await markReviewedAction(currentId, true)
      router.push(nav.nextId ? `/manual-edit?ticket=${nav.nextId}` : '/manual-edit')
    })
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
        disabled={pending}
        title="Mark this ticket reviewed and jump to the next one"
        className="inline-flex items-center gap-1.5 rounded-lg bg-ember px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-ember/90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
        Done &amp; next
      </button>
    </div>
  )
}
