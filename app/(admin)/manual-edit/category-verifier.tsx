'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Tags, Loader2, ArrowRight, Check } from 'lucide-react'
import { CATEGORY_LABELS } from '@/lib/categories'
import { verifyCategoryAction, saveTicketCoreAction } from './actions'

export interface VerifyRow {
  id: string
  title: string | null
  venue_name: string | null
  date_str: string | null
  category: string
}

interface Mismatch { id: string; title: string; current: string; suggested: string; reason: string }

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const q = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, q.length) }, async () => {
      while (q.length) await fn(q.shift()!)
    }),
  )
}

// Runs the AI category check over the whole filtered queue and lets the admin fix every
// mislabel at once — the bulk version of the per-ticket "Verify category" button. Also
// catches "Uncategorised" tickets, since the AI proposes a real category for those too.
export function CategoryVerifier({ rows }: { rows: VerifyRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)
  const [prog, setProg] = useState({ done: 0, total: 0 })
  const [mismatches, setMismatches] = useState<Mismatch[]>([])
  const [applying, setApplying] = useState<Set<string>>(new Set())

  async function verifyAll() {
    if (busy || rows.length === 0) return
    setBusy(true); setRan(true); setMismatches([]); setProg({ done: 0, total: rows.length })
    const found: Mismatch[] = []
    let done = 0
    await runPool(rows, 4, async (r) => {
      if (r.title?.trim()) {
        try {
          const res = await verifyCategoryAction({ title: r.title, venue: r.venue_name, date: r.date_str, category: r.category })
          if (res.ok && !res.matches) {
            found.push({ id: r.id, title: r.title, current: r.category, suggested: res.suggested, reason: res.reason })
            setMismatches([...found])
          }
        } catch { /* skip one, keep going */ }
      }
      done++; setProg({ done, total: rows.length })
    })
    setBusy(false)
  }

  async function apply(m: Mismatch) {
    if (applying.has(m.id)) return
    setApplying((p) => new Set(p).add(m.id))
    const res = await saveTicketCoreAction(m.id, { category: m.suggested })
    setApplying((p) => { const n = new Set(p); n.delete(m.id); return n })
    if (res.ok) { setMismatches((prev) => prev.filter((x) => x.id !== m.id)); router.refresh() }
  }

  async function applyAll() {
    for (const m of [...mismatches]) await apply(m)
  }

  return (
    <div className="space-y-3 rounded-[12px] border border-[#E6D9F2] bg-[#FAF6FF] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={verifyAll}
          disabled={busy || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#7B44A8] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#6a3a92] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tags className="h-4 w-4" />}
          Verify categories ({rows.length})
        </button>

        {busy && <span className="text-[12.5px] font-medium text-salty-secondary">{prog.done} / {prog.total} · {mismatches.length} to fix…</span>}
        {!busy && ran && (
          <span className="text-[12.5px] text-salty-muted">
            {mismatches.length === 0 ? 'Every category looks correct.' : `${mismatches.length} likely mislabelled.`}
          </span>
        )}
        {!busy && mismatches.length > 1 && (
          <button onClick={applyAll} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[#7B44A8] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#7B44A8] hover:bg-[#F3EBF8]">
            <Check className="h-3.5 w-3.5" /> Apply all {mismatches.length}
          </button>
        )}
      </div>

      {mismatches.length > 0 && (
        <div className="space-y-1.5">
          {mismatches.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-salty-border bg-warm-white px-3 py-2 text-[12.5px]">
              <Link href={`/manual-edit?ticket=${m.id}`} className="max-w-[220px] truncate font-medium text-salty-text hover:text-ember">{m.title}</Link>
              <span className="rounded bg-stone px-1.5 py-0.5 text-[11px] text-salty-muted">{CATEGORY_LABELS[m.current] || m.current || '—'}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-salty-muted" />
              <span className="rounded bg-[#F3EBF8] px-1.5 py-0.5 text-[11px] font-semibold text-[#7B44A8]">{CATEGORY_LABELS[m.suggested] ?? m.suggested}</span>
              <span className="hidden min-w-0 flex-1 truncate text-salty-muted md:block">— {m.reason}</span>
              <button
                onClick={() => apply(m)}
                disabled={applying.has(m.id)}
                className="ml-auto shrink-0 rounded-md border border-salty-border bg-cream px-2.5 py-1 text-[11.5px] font-medium text-salty-secondary hover:bg-stone disabled:opacity-50"
              >
                {applying.has(m.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
