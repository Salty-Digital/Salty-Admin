'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { KeySquare, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ADMIN_PAGES, PAGE_SECTIONS, isAboveLevel } from '@/lib/pages'
import { setAllowedPagesAction } from './actions'

/**
 * Per-admin page allowlist editor.
 *
 * Two distinct states, and the difference matters:
 *   Unrestricted  allowed_pages IS NULL — this admin sees everything their LEVEL permits.
 *   Restricted    an explicit list, which becomes authoritative regardless of level.
 *
 * EVERY page is offered, including ones above the target's access level, because granting a
 * specific System page to a specific person without promoting them to Super Admin is the whole
 * point of the feature. Those are marked, because page access is not capability: the page's own
 * server actions still call requireAdmin(n) and will refuse them.
 */
export function PageAccessDialog({
  adminId, email, accessLevel, allowedPages,
}: {
  adminId: string
  email: string
  accessLevel: number
  allowedPages: string[] | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Every page, not just the level-eligible ones — an explicit allowlist overrides the level.
  const eligible = useMemo(() => ADMIN_PAGES, [])
  const [restricted, setRestricted] = useState(allowedPages !== null)
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(allowedPages ?? eligible.map((p) => p.href)),
  )

  const toggle = (href: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      return next
    })
  }

  const setSection = (section: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const p of eligible.filter((x) => x.section === section)) {
        if (on) next.add(p.href)
        else next.delete(p.href)
      }
      return next
    })
  }

  const save = () => {
    setError(null)
    start(async () => {
      try {
        await setAllowedPagesAction(adminId, restricted ? [...selected] : null)
        setOpen(false)
        router.refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  const summary = allowedPages === null
    ? 'All pages for their level'
    : `${allowedPages.length} of ${eligible.length} pages`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center gap-1.5 text-[12.5px] font-medium text-ember hover:underline">
          <KeySquare className="h-3.5 w-3.5" /> {summary}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Page access — {email}</DialogTitle>
          <DialogDescription>
            Choose which pages this admin can open. Their access level still applies on top, so this
            can only narrow what they reach, never widen it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-salty-border bg-cream p-1">
            {[
              { v: false, label: 'All pages for their level' },
              { v: true, label: 'Only selected pages' },
            ].map((o) => (
              <button
                key={String(o.v)}
                onClick={() => setRestricted(o.v)}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  restricted === o.v ? 'bg-warm-white text-ember shadow-sm' : 'text-salty-muted hover:text-salty-text'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {restricted && (
            <div className="space-y-3">
              {PAGE_SECTIONS.map((section) => {
                const pages = eligible.filter((p) => p.section === section)
                if (pages.length === 0) return null
                const allOn = pages.every((p) => selected.has(p.href))
                return (
                  <div key={section} className="rounded-[10px] border border-salty-border">
                    <div className="flex items-center justify-between border-b border-salty-border bg-cream px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{section}</p>
                      <button
                        onClick={() => setSection(section, !allOn)}
                        className="text-[11.5px] font-medium text-ember hover:underline"
                      >
                        {allOn ? 'Clear' : 'Select all'}
                      </button>
                    </div>
                    <div className="grid gap-x-4 gap-y-1 p-3 sm:grid-cols-2">
                      {pages.map((p) => {
                        const above = isAboveLevel(accessLevel, p)
                        return (
                          <label key={p.href} className="flex cursor-pointer items-center gap-2 text-[12.5px] text-salty-text">
                            <input
                              type="checkbox"
                              checked={selected.has(p.href)}
                              onChange={() => toggle(p.href)}
                              className="h-3.5 w-3.5 accent-[#E8581A]"
                            />
                            <span>{p.label}</span>
                            {above && (
                              <span
                                title={`This page normally needs level ${p.maxLevel}. They can open it, but its actions still require level ${p.maxLevel} and will refuse them.`}
                                className="rounded-full bg-[#FBF1DE] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#8A6830]"
                              >
                                L{p.maxLevel}
                              </span>
                            )}
                            <span className="ml-auto font-mono text-[10.5px] text-salty-muted">{p.href}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <p className="text-[11.5px] text-salty-muted">
                {selected.size} of {eligible.length} selected. An explicit list overrides their
                access level, so pages above level {accessLevel} can be granted — those are marked{' '}
                <span className="rounded-full bg-[#FBF1DE] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#8A6830]">L1</span>{' '}
                and stay viewable-but-not-actionable, because each page&apos;s own actions still
                enforce the level.
              </p>
            </div>
          )}

          {error && <p className="text-[12.5px] font-medium text-[#BF4A3A]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
