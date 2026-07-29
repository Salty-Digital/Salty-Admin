'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus } from 'lucide-react'

import { addSuppressionAction } from './actions'

/** Manually block an address. The action revalidates the page, so the new row appears on success. */
export function AddSuppressionForm() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    setError(null)
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter an email address.')
      return
    }
    startTransition(async () => {
      try {
        await addSuppressionAction(trimmed)
        setEmail('')
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-5">
      <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
        Block an address
      </label>
      <div className="flex gap-2">
        <input
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="name@example.com"
          type="email"
          className="w-full max-w-sm rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20 font-sans"
        />
        <button
          onClick={add}
          disabled={pending}
          className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#D44D15] disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-[#BF4A3A]">{error}</p>}
      <p className="mt-2 text-[12px] text-salty-muted">
        The address stops receiving any email until you remove it here. Existing bounce/complaint entries are left unchanged.
      </p>
    </div>
  )
}
