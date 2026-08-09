'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { approveImportAction, rejectImportAction, bulkApproveAction, bulkRejectAction } from './actions'
import { useAccessLevel } from '@/components/admin-provider'
import { Check, X, CheckCheck, XCircle, Loader2, ImageIcon } from 'lucide-react'
import { SortLink } from '@/components/ui/sortable'

interface ImportRow {
  id: string
  user_id: string
  source: string
  status: string
  confidence: number
  raw_data: {
    title?: string | null
    venue?: string | null
    date?: string | null
    category?: string
    subject?: string
    image_url?: string | null
  }
  created_at: string
}

function ImageThumb({ url }: { url: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <button
        onClick={() => setExpanded(true)}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded border border-salty-border bg-stone hover:opacity-80 transition-opacity"
        title="View image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="ticket" className="h-full w-full object-cover" />
      </button>
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setExpanded(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="ticket full"
            className="max-h-[80vh] max-w-[90vw] rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

export function ImportsTable({ rows, showActions }: { rows: ImportRow[]; showActions: boolean }) {
  const [, startTransition] = useTransition()
  const [bulkPending, setBulkPending] = useState<'approve' | 'reject' | null>(null)
  const [bulkConfirm, setBulkConfirm] = useState<'approve' | 'reject' | null>(null)
  const level = useAccessLevel()
  const canAct = showActions && level <= 2

  function handleBulkApprove() {
    setBulkPending('approve')
    setBulkConfirm(null)
    startTransition(async () => {
      await bulkApproveAction(rows.map(r => r.id))
      setBulkPending(null)
    })
  }

  function handleBulkReject() {
    setBulkPending('reject')
    setBulkConfirm(null)
    startTransition(async () => {
      await bulkRejectAction(rows.map(r => r.id))
      setBulkPending(null)
    })
  }

  return (
    <div>
      {canAct && rows.length > 1 && (
        <div className="flex items-center gap-2 border-b border-salty-border px-4 py-3 bg-cream/60">
          {bulkConfirm === 'approve' ? (
            <>
              <span className="text-[12px] text-salty-muted">Approve all {rows.length} imports?</span>
              <Button
                size="sm" variant="ghost"
                className="h-7 gap-1 text-[11px] text-green-700 hover:text-green-800 hover:bg-green-50"
                disabled={bulkPending !== null}
                onClick={handleBulkApprove}
              >
                {bulkPending === 'approve' && <Loader2 className="h-3 w-3 animate-spin" />}
                Yes, approve all
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-salty-muted" onClick={() => setBulkConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : bulkConfirm === 'reject' ? (
            <>
              <span className="text-[12px] text-salty-muted">Reject all {rows.length} imports?</span>
              <Button
                size="sm" variant="ghost"
                className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive hover:bg-red-50"
                disabled={bulkPending !== null}
                onClick={handleBulkReject}
              >
                {bulkPending === 'reject' && <Loader2 className="h-3 w-3 animate-spin" />}
                Yes, reject all
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] text-salty-muted" onClick={() => setBulkConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="text-[12px] text-salty-muted">{rows.length} pending</span>
              <Button
                size="sm" variant="ghost"
                className="h-7 gap-1 text-[11px] text-green-700 hover:text-green-800 hover:bg-green-50"
                onClick={() => setBulkConfirm('approve')}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Approve all
              </Button>
              <Button
                size="sm" variant="ghost"
                className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive hover:bg-red-50"
                onClick={() => setBulkConfirm('reject')}
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject all
              </Button>
            </>
          )}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject / Title</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Venue</TableHead>
            <TableHead>Date</TableHead>
            <SortLink label="Confidence" sortKey="confidence" className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" />
            <TableHead>User</TableHead>
            <SortLink label="Submitted" sortKey="submitted" className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" />
            {canAct && <TableHead className="w-20">Image</TableHead>}
            {canAct && <TableHead className="w-24" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={canAct ? 9 : 7} className="text-center text-muted-foreground py-8">
                No imports
              </TableCell>
            </TableRow>
          ) : (
            rows.map((imp) => (
              <TableRow key={imp.id}>
                <TableCell className="font-medium text-sm max-w-xs">
                  <p className="truncate">{imp.raw_data?.subject ?? imp.raw_data?.title ?? '—'}</p>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">{imp.raw_data?.category ?? '—'}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{imp.raw_data?.venue ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{imp.raw_data?.date ?? '—'}</TableCell>
                <TableCell>
                  <span className={`text-sm font-medium ${imp.confidence >= 0.4 ? 'text-foreground' : 'text-destructive'}`}>
                    {Math.round(imp.confidence * 100)}%
                  </span>
                </TableCell>
                <TableCell>
                  <Link href={`/users/${imp.user_id}`} className="text-xs text-muted-foreground hover:text-foreground underline">
                    view
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(imp.created_at).toLocaleDateString()}
                </TableCell>
                {canAct && (
                  <TableCell>
                    {imp.raw_data?.image_url
                      ? <ImageThumb url={imp.raw_data.image_url} />
                      : <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                    }
                  </TableCell>
                )}
                {canAct && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                        onClick={() => startTransition(() => approveImportAction(imp.id))}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => startTransition(() => rejectImportAction(imp.id))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
