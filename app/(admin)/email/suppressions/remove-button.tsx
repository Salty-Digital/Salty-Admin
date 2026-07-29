'use client'

import { useTransition } from 'react'
import { Loader2, Undo2 } from 'lucide-react'
import { removeSuppressionAction } from './actions'

/** Un-suppress a single address. The action revalidates the page, so the row drops on success. */
export function RemoveSuppressionButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      onClick={() => startTransition(async () => { await removeSuppressionAction(email) })}
      disabled={pending}
      title="Allow this address to receive email again"
      className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-cream px-2.5 py-1 text-[12px] font-medium text-salty-secondary transition-colors hover:bg-stone hover:text-salty-text disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
      {pending ? 'Removing…' : 'Remove'}
    </button>
  )
}
