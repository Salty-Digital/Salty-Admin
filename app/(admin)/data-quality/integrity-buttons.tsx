'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Link2, Eraser } from 'lucide-react'
import { resolveTicketAction, clearEventStrongIdAction } from './integrity-actions'

export function ResolveTicketButton({ ticketId }: { ticketId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => start(async () => {
          const r = await resolveTicketAction(ticketId)
          if (r.ok) { setMsg(r.eventId ? 'Linked' : 'No match'); router.refresh() }
          else setMsg(r.error ?? 'Failed')
        })}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md bg-stone px-2 py-1 text-[11px] font-medium text-salty-secondary transition-colors hover:bg-salty-border disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Resolve
      </button>
      {msg && <span className="text-[11px] text-salty-muted">{msg}</span>}
    </span>
  )
}

export function ClearStrongIdButton({ eventId, field }: { eventId: string; field: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => start(async () => {
        const r = await clearEventStrongIdAction(eventId, field)
        if (r.ok) { setDone(true); router.refresh() }
      })}
      disabled={pending || done}
      title={`Null ${field} on this event`}
      className="inline-flex items-center gap-1 rounded-md border border-[#F0C4C4] bg-[#FDEDED] px-2 py-0.5 text-[10.5px] font-semibold text-[#BF4A3A] transition-colors hover:bg-[#F5D0D0] disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3 w-3" /> : <Eraser className="h-3 w-3" />}
      {done ? 'Cleared' : 'Clear id'}
    </button>
  )
}
