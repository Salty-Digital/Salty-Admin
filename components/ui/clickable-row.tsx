'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode, KeyboardEvent, MouseEvent } from 'react'

/**
 * A table row (`<tr>`) whose whole surface navigates to `href` — the entire row
 * is the tap target, not just a trailing button. Drop-in replacement for a `<tr>`.
 *
 * Inner interactive elements keep working automatically: a click that originates
 * from an `<a>`, `<button>`, `<select>`, `<input>` (or anything marked
 * `data-row-ignore`) is left alone so that element's own handler wins. That means
 * a ticket row can navigate to the event while its inner "user" link still goes
 * to the user — no per-link `stopPropagation` needed.
 *
 * Matches anchor affordances: Cmd/Ctrl-click and middle-click open in a new tab,
 * the row is keyboard-focusable, and Enter/Space activate it. Hovering prefetches.
 */
export function ClickableRow({
  href,
  children,
  className = '',
  ariaLabel,
}: {
  href: string
  children: ReactNode
  className?: string
  ariaLabel?: string
}) {
  const router = useRouter()

  const fromInteractive = (e: MouseEvent<HTMLTableRowElement>) =>
    !!(e.target as HTMLElement).closest('a,button,select,input,[data-row-ignore]')

  function go(newTab: boolean) {
    if (newTab) window.open(href, '_blank', 'noopener')
    else router.push(href)
  }

  return (
    <tr
      onClick={(e) => { if (!fromInteractive(e)) go(e.metaKey || e.ctrlKey) }}
      onAuxClick={(e) => { if (e.button === 1 && !fromInteractive(e)) go(true) }}
      onKeyDown={(e: KeyboardEvent<HTMLTableRowElement>) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e.metaKey || e.ctrlKey) }
      }}
      onMouseEnter={() => router.prefetch(href)}
      tabIndex={0}
      role="link"
      aria-label={ariaLabel}
      className={`cursor-pointer outline-none focus-visible:bg-cream ${className}`}
    >
      {children}
    </tr>
  )
}
