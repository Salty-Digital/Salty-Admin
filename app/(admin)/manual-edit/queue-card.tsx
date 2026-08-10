'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Check, RotateCcw, Loader2 } from 'lucide-react'
import { CATEGORY_LABELS } from '@/lib/categories'
import { markReviewedAction } from './actions'

const FLAG_TONE: Record<string, string> = {
  'No title': 'bg-[#FDEDED] text-[#BF4A3A]', 'No venue': 'bg-[#FDEDED] text-[#BF4A3A]', 'No date': 'bg-[#FDEDED] text-[#BF4A3A]',
  'Uncategorised': 'bg-gold-light text-gold', 'Low confidence': 'bg-gold-light text-gold', 'Pending': 'bg-[#EBF2FA] text-[#3A72A8]',
  'No cast': 'bg-[#F3EBF8] text-[#7B44A8]', 'No result': 'bg-[#F3EBF8] text-[#7B44A8]',
}

export interface QueueRow {
  id: string; title: string | null; venue_name: string | null; date_str: string | null
  category: string; email: string | null; flags: string[]
}

export function QueueCard({ row, done }: { row: QueueRow; done: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function mark() {
    start(async () => {
      await markReviewedAction(row.id, !done)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-[12px] border border-salty-border bg-warm-white">
      <Link href={`/manual-edit?ticket=${row.id}`} className="flex flex-1 items-start gap-3 px-4 py-3 transition-colors hover:bg-cream">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-salty-text">{row.title || 'Untitled'}</p>
          <p className="truncate text-[11.5px] text-salty-muted">
            {[row.venue_name, row.date_str, row.email].filter(Boolean).join(' · ') || '—'}
          </p>
          {row.flags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {row.flags.map((fl) => (
                <span key={fl} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${FLAG_TONE[fl] ?? 'bg-gold-light text-gold'}`}>{fl}</span>
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-stone px-2.5 py-0.5 text-[11px] font-medium capitalize text-salty-secondary">
          {CATEGORY_LABELS[row.category] ?? row.category}
        </span>
      </Link>
      <div className="flex justify-end border-t border-salty-border bg-cream/40 px-3 py-1.5">
        <button
          onClick={mark}
          disabled={pending}
          className="inline-flex items-center gap-1 text-[11.5px] font-medium text-salty-secondary transition-colors hover:text-ember disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {done ? 'Reopen' : 'Mark done'}
        </button>
      </div>
    </div>
  )
}
