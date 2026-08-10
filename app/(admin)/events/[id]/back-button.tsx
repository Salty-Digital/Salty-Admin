'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

/**
 * Context-aware "Back": returns to wherever the user came from (the user's profile,
 * the tickets list, the manual-edit queue, …) instead of a hardcoded destination.
 * Falls back to `fallback` when there's no in-app history (e.g. opened via a direct link).
 */
export function BackButton({ fallback = '/tickets', label = 'Back' }: { fallback?: string; label?: string }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) router.back()
        else router.push(fallback)
      }}
      className="inline-flex items-center gap-1.5 text-[13px] text-salty-muted hover:text-ember transition-colors"
    >
      <ArrowLeft className="h-4 w-4" /> {label}
    </button>
  )
}
