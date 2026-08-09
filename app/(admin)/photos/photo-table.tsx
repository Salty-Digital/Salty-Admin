'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Trash2, Loader2, ExternalLink } from 'lucide-react'
import { deletePhotoAction } from './actions'
import { useSort, SortHeader } from '@/components/ui/sortable'

interface Photo {
  id: string
  ticket_id: string
  user_id: string
  user_email: string
  media_type: string
  match_method: string | null
  match_confidence: number | null
  taken_at: string | null
}

const METHOD_COLOR: Record<string, string> = {
  auto:         'bg-[#EAF4EE] text-[#3E8A5A]',
  manual:       'bg-stone text-salty-secondary',
  library_scan: 'bg-[#EBF2FA] text-[#3A72A8]',
  ai_verified:  'bg-gold-light text-gold',
}

function DeleteCell({ photoId }: { photoId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()

  function confirmDelete() {
    start(async () => {
      await deletePhotoAction(photoId)
      setConfirming(false)
    })
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium text-[#BF4A3A] hover:bg-[#FDEDED] transition-colors"
        title="Delete photo"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={confirmDelete}
        disabled={pending}
        className="rounded-md bg-[#BF4A3A] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#A53D30] disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
      </button>
      <button
        onClick={() => setConfirming(false)}
        disabled={pending}
        className="rounded-md bg-stone px-2 py-1 text-[11px] text-salty-secondary hover:bg-cream"
      >
        Cancel
      </button>
    </div>
  )
}

export function PhotoTable({ photos }: { photos: Photo[] }) {
  const { sorted, sortState, requestSort } = useSort(photos, {
    id: (p) => p.id,
    user: (p) => p.user_email.toLowerCase(),
    type: (p) => p.media_type,
    match: (p) => p.match_confidence,
    taken: (p) => (p.taken_at ? Date.parse(p.taken_at) : null),
  })

  if (photos.length === 0) {
    return (
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <p className="py-12 text-center text-[13px] text-salty-muted">No photos found</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <table className="w-full">
        <thead>
          <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
            <SortHeader label="ID" sortKey="id" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
            <SortHeader label="User" sortKey="user" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
            <SortHeader label="Type" sortKey="type" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
            <SortHeader label="Match %" sortKey="match" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
            <SortHeader label="Taken" sortKey="taken" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
              <td className="px-4 py-3 text-[12px] font-mono text-salty-secondary">{p.id.slice(0, 8)}</td>
              <td className="px-4 py-3 text-[12px] text-salty-secondary">
                <Link
                  href={`/users/${p.user_id}`}
                  className="inline-flex items-center gap-1 hover:text-ember truncate"
                  title={p.user_email}
                >
                  <span className="truncate max-w-[200px]">{p.user_email}</span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                </Link>
              </td>
              <td className="px-4 py-3 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="text-salty-muted capitalize">{p.media_type}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      METHOD_COLOR[p.match_method ?? ''] ?? 'bg-stone text-salty-muted'
                    }`}
                  >
                    {p.match_method ?? 'unknown'}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-[12px] font-semibold text-salty-text">
                {p.match_confidence !== null ? `${Math.round(p.match_confidence * 100)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">
                {p.taken_at ? new Date(p.taken_at).toLocaleDateString() : '—'}
              </td>
              <td className="px-4 py-3">
                <DeleteCell photoId={p.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
