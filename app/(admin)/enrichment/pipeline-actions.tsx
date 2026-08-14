'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, RefreshCw, RotateCcw, Loader2, Check } from 'lucide-react'
import { triggerWorkerAction, runReconcileAction, retryFailedKindAction, retryJobAction } from './actions'

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[12.5px] font-medium text-salty-secondary transition-colors hover:bg-cream hover:text-ember disabled:opacity-50'

export function TriggerWorkerButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={() => start(async () => {
          const r = await triggerWorkerAction()
          setMsg(r.ok ? 'Worker kicked — refresh in ~15s for results.' : r.error)
          if (r.ok) setTimeout(() => router.refresh(), 1500)
        })}
        disabled={pending}
        className={btn}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run worker now
      </button>
      {msg && <span className="text-[11.5px] text-salty-muted">{msg}</span>}
    </div>
  )
}

export function RunReconcileButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={() => start(async () => {
          const r = await runReconcileAction()
          if (r.ok) { setMsg(`Rekeyed ${r.rekeyed} · merged ${r.merged}.`); router.refresh() }
          else setMsg(r.error ?? 'Failed.')
        })}
        disabled={pending}
        className={btn}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run reconcile
      </button>
      {msg && <span className="text-[11.5px] text-salty-muted">{msg}</span>}
    </div>
  )
}

export function RetryKindButton({ kind, count }: { kind: string; count: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [done, setDone] = useState<number | null>(null)
  return (
    <button
      onClick={() => start(async () => {
        const r = await retryFailedKindAction(kind)
        if (r.ok) { setDone(r.count ?? 0); router.refresh() }
      })}
      disabled={pending || count === 0}
      className="inline-flex items-center gap-1.5 rounded-md border border-[#F0C4C4] bg-[#FDEDED] px-2.5 py-1 text-[11.5px] font-semibold text-[#BF4A3A] transition-colors hover:bg-[#F5D0D0] disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : done !== null ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
      {done !== null ? `Requeued ${done}` : `Retry all ${count}`}
    </button>
  )
}

export function RetryJobButton({ ticketId, kind }: { ticketId: string; kind: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => start(async () => {
        const r = await retryJobAction(ticketId, kind)
        if (r.ok) { setDone(true); router.refresh() }
      })}
      disabled={pending || done}
      className="inline-flex items-center gap-1 rounded-md bg-stone px-2 py-1 text-[11px] font-medium text-salty-secondary transition-colors hover:bg-salty-border disabled:opacity-60"
      title="Re-queue this job now"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
      {done ? 'Queued' : 'Retry'}
    </button>
  )
}
