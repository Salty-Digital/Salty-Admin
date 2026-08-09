'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSort, SortHeader } from '@/components/ui/sortable'

export interface ConversationRow {
  id: string
  status: 'open' | 'closed'
  closedBy: string | null
  userEmail: string
  userDisplayName: string | null
  lastMessagePreview: string
  lastSenderType: 'user' | 'admin' | null
  lastMessageAt: string
  unread: boolean
}

export function ConversationTable({ rows }: { rows: ConversationRow[] }) {
  const { sorted, sortState, requestSort } = useSort(rows, {
    user: (r) => (r.userDisplayName ?? r.userEmail).toLowerCase(),
    message: (r) => r.lastMessagePreview.toLowerCase(),
    from: (r) => r.lastSenderType ?? '',
    updated: (r) => (r.lastMessageAt ? Date.parse(r.lastMessageAt) : null),
  })
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader label="User" sortKey="user" sortState={sortState} onSort={requestSort} className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" />
          <SortHeader label="Last message" sortKey="message" sortState={sortState} onSort={requestSort} className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" />
          <SortHeader label="From" sortKey="from" sortState={sortState} onSort={requestSort} className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" />
          <SortHeader label="Updated" sortKey="updated" sortState={sortState} onSort={requestSort} className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" />
          <TableHead className="w-16" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">No conversations</TableCell>
          </TableRow>
        ) : (
          sorted.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {r.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-ember" />}
                  <div>
                    <p>{r.userDisplayName ?? r.userEmail}</p>
                    <p className="text-xs text-salty-muted">{r.userEmail}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="max-w-sm">
                <p className="truncate text-sm">{r.lastMessagePreview || '—'}</p>
              </TableCell>
              <TableCell>
                <Badge variant={r.lastSenderType === 'admin' ? 'secondary' : 'outline'} className="text-xs capitalize">
                  {r.lastSenderType ?? '—'}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(r.lastMessageAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <Link href={`/support-chat/${r.id}`} className="text-[12px] font-medium text-ember hover:underline">
                  Open
                </Link>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  )
}
