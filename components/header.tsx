'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, RefreshCw, Search, Import, CheckCircle } from 'lucide-react'

const TITLES: Record<string, string> = {
  '/':                        'Dashboard',
  '/users':                   'Users',
  '/tickets':                 'Tickets',
  '/feedback':                'Feedback',
  '/pending-imports':         'Pending Imports',
  '/notifications':           'Notifications',
  '/analytics':               'Analytics',
  '/settings/admin-users':    'Admin Users',
  '/settings/audit-log':      'Audit Log',
}

function getTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname]
  for (const [key, val] of Object.entries(TITLES)) {
    if (pathname.startsWith(key) && key !== '/') return val
  }
  return 'Salty Admin'
}

const TODAY = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

interface HeaderProps {
  pendingImports: number
}

export function Header({ pendingImports }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const title = getTitle(pathname)
  const total = pendingImports

  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  // Mark-as-seen: opening the bell dismisses the dot; it returns only when the count grows.
  // The stored value is clamped down to the current total, so resolving items clears it too.
  useEffect(() => {
    const stored = Number(localStorage.getItem('notif_seen_total'))
    setSeen(Math.min(Number.isFinite(stored) ? stored : 0, total))
  }, [total])

  const hasUnseen = total > seen

  function toggleBell() {
    setOpen(prev => {
      const next = !prev
      if (next) {
        setSeen(total)
        try { localStorage.setItem('notif_seen_total', String(total)) } catch { /* storage unavailable */ }
      }
      return next
    })
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  return (
    <header
      className="sticky top-0 z-40 flex items-center gap-4 border-b border-salty-border bg-warm-white px-7"
      style={{ height: 60 }}
    >
      <div className="flex items-baseline gap-1.5">
        <h1 className="font-sora text-[18px] font-bold tracking-tight text-salty-text">{title}</h1>
        <span className="text-[13px] text-salty-muted" suppressHydrationWarning>· {TODAY}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg border border-salty-border bg-cream px-3 py-[7px] w-48">
          <Search className="h-3.5 w-3.5 shrink-0 text-salty-muted" />
          <input
            type="text"
            placeholder="Search users, tickets…"
            className="w-full bg-transparent text-[13px] text-salty-text placeholder:text-salty-muted focus:outline-none font-sans"
          />
        </div>

        {/* Bell */}
        <div ref={ref} className="relative">
          <button
            onClick={toggleBell}
            className="relative flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-salty-border bg-warm-white text-salty-secondary transition-colors hover:bg-cream"
          >
            <Bell className="h-4 w-4" />
            {hasUnseen && (
              <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full border-2 border-white bg-ember" />
            )}
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-[12px] border border-salty-border bg-warm-white shadow-lg z-50">
              <div className="border-b border-salty-border px-4 py-3">
                <p className="font-sora text-[13px] font-bold text-salty-text">Needs attention</p>
              </div>

              {total === 0 ? (
                <div className="flex items-center gap-2.5 px-4 py-4 text-salty-muted">
                  <CheckCircle className="h-4 w-4 text-[#3E8A5A]" />
                  <span className="text-[13px]">All caught up</span>
                </div>
              ) : (
                <div>
                  {pendingImports > 0 && (
                    <button
                      onClick={() => navigate('/pending-imports')}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cream border-b border-salty-border last:border-0"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#EBF2FA] text-[#3A72A8]">
                        <Import className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-salty-text">{pendingImports} pending import{pendingImports !== 1 ? 's' : ''}</p>
                        <p className="text-[11px] text-salty-muted">Waiting for review</p>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-salty-border bg-warm-white text-salty-secondary transition-colors hover:bg-cream"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
