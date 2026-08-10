'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, X, Play } from 'lucide-react'

export interface MediaItem {
  id: string
  url: string | null
  media_type: string
  taken_at: string | null
  match_method: string | null
}

const PREVIEW_LIMIT = 18

export function MediaGallery({ items }: { items: MediaItem[] }) {
  const usable = items.filter((m) => m.url)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (usable.length === 0) {
    return <p className="text-[13px] text-salty-muted">No photos or videos.</p>
  }

  const visible = showAll ? usable : usable.slice(0, PREVIEW_LIMIT)
  const cur = openIdx != null ? usable[openIdx] : null

  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6">
        {visible.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setOpenIdx(i)}
            className="relative aspect-square overflow-hidden rounded-lg border border-salty-border bg-stone transition-opacity hover:opacity-90"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url!} alt="" className="h-full w-full object-cover" loading="lazy" />
            {m.media_type === 'video' && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                <Play className="h-5 w-5 text-white" />
              </span>
            )}
          </button>
        ))}
      </div>

      {usable.length > PREVIEW_LIMIT && !showAll && (
        <button onClick={() => setShowAll(true)} className="mt-2 text-[12.5px] font-medium text-ember hover:underline">
          Show all {usable.length}
        </button>
      )}

      {cur && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpenIdx(null)}>
          <button
            onClick={(e) => { e.stopPropagation(); setOpenIdx(null) }}
            className="absolute right-4 top-4 text-white/80 transition-colors hover:text-white"
          >
            <X className="h-7 w-7" />
          </button>
          {usable.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setOpenIdx((openIdx! - 1 + usable.length) % usable.length) }}
                className="absolute left-3 text-white/80 transition-colors hover:text-white"
              >
                <ChevronLeft className="h-9 w-9" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setOpenIdx((openIdx! + 1) % usable.length) }}
                className="absolute right-3 text-white/80 transition-colors hover:text-white"
              >
                <ChevronRight className="h-9 w-9" />
              </button>
            </>
          )}
          <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] max-w-[92vw] items-center justify-center">
            {cur.media_type === 'video' ? (
              <video src={cur.url!} controls autoPlay className="max-h-[88vh] max-w-[92vw] rounded-xl" />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={cur.url!} alt="" className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain" />
            )}
          </div>
        </div>
      )}
    </>
  )
}
