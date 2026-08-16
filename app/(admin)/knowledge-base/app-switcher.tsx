'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'

/**
 * Switches the knowledge base between the two codebases.
 *
 * A native <select> rather than a custom menu: it is keyboard- and screen-reader-correct for free,
 * and renders as the platform picker on mobile. The choice lives in the URL (?app=), so a section
 * link can be shared and lands on the right codebase.
 */
export function AppSwitcher({ current }: { current: 'mobile' | 'admin' }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <div className="relative">
      <label htmlFor="kb-app" className="sr-only">Codebase</label>
      <select
        id="kb-app"
        value={current}
        disabled={pending}
        onChange={(e) => start(() => router.push(`/knowledge-base?app=${e.target.value}`))}
        className="appearance-none rounded-lg border border-salty-border bg-warm-white py-2 pl-3.5 pr-9 font-mono text-[13px] font-medium text-salty-text transition-colors hover:border-ember focus:border-ember focus:outline-none disabled:opacity-60"
      >
        <option value="mobile">salty-mobile</option>
        <option value="admin">salty-admin</option>
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-salty-muted">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
      </span>
    </div>
  )
}
