'use client'

import { FileText } from 'lucide-react'

/**
 * A small "start from a template" dropdown for the message composers. It's a
 * controlled select pinned to the empty option so it always reads "Start from a
 * template…" — picking an entry fires `onPick(id)` and then snaps back, so the
 * same template can be re-applied. The parent owns the actual field-filling.
 */
export function TemplatePicker({
  options,
  onPick,
  className,
  label = 'Start from a template',
}: {
  options: { id: string; name: string }[]
  onPick: (id: string) => void
  className?: string
  label?: string
}) {
  return (
    <div className="relative">
      <FileText className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-salty-muted" />
      <select
        value=""
        onChange={e => { if (e.target.value) onPick(e.target.value) }}
        className={`${className ?? ''} pl-9`}
        aria-label={label}
      >
        <option value="">{label}…</option>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </div>
  )
}
