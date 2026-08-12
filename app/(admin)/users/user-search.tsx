'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import { Search } from 'lucide-react'

interface Props {
  defaultQ: string
  defaultZip: string
  defaultTier: string
  defaultActivity: string
  tiers: string[]
}

export function UserSearch({ defaultQ, defaultZip, defaultTier, defaultActivity, tiers }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, start] = useTransition()

  function set(key: string, val: string) {
    start(() => {
      const p = new URLSearchParams(window.location.search)
      if (val) p.set(key, val); else p.delete(key)
      p.delete('page')
      router.push(`${pathname}?${p.toString()}`)
    })
  }

  const inputCls = 'rounded-lg border border-salty-border bg-cream px-3 py-[7px] text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none font-sans'

  return (
    <div className="flex flex-wrap gap-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-salty-muted" />
        <input
          defaultValue={defaultQ}
          onChange={e => set('q', e.target.value)}
          placeholder="Email, username, display name…"
          className={`${inputCls} pl-9 w-64`}
        />
      </div>
      <input
        defaultValue={defaultZip}
        onChange={e => set('zip', e.target.value)}
        placeholder="Zip code…"
        className={`${inputCls} w-32`}
      />
      <select defaultValue={defaultTier} onChange={e => set('tier', e.target.value)} className={inputCls}>
        <option value="">All tiers</option>
        {tiers.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
      </select>
      <select defaultValue={defaultActivity} onChange={e => set('activity', e.target.value)} className={inputCls}>
        <option value="">All activity</option>
        <option value="active">Performed an action</option>
        <option value="registered">Registered only</option>
      </select>
    </div>
  )
}
