import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { maskEmail } from '@/lib/privacy'
import { RevokeButton } from './revoke-button'
import { SortLink } from '@/components/ui/sortable'
import { sortRows } from '@/lib/sort'
import { ExternalLink } from 'lucide-react'

interface ConnectionRow {
  user_id: string
  provider: 'gmail' | string
  email: string
  connected_at: string | null
  last_synced_at: string | null
}

const PROVIDER_COLOR: Record<string, string> = {
  gmail:   'bg-[#EBF2FA] text-[#3A72A8]',
  outlook: 'bg-gold-light text-gold',
  yahoo:   'bg-[#F3EBF8] text-[#7B44A8]',
  icloud:  'bg-stone text-salty-secondary',
  aol:     'bg-[#FDF0EA] text-ember',
}

function StaleBadge({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  if (!lastSyncedAt) return <span className="text-[11px] text-salty-muted">Never synced</span>
  const days = (Date.now() - new Date(lastSyncedAt).getTime()) / 86_400_000
  const stale = days > 14
  return (
    <span className={`text-[12px] ${stale ? 'text-[#BF4A3A] font-medium' : 'text-salty-secondary'}`}>
      {new Date(lastSyncedAt).toLocaleDateString()}
      {stale && <span className="ml-1 text-[10px]">(stale)</span>}
    </span>
  )
}

interface PageProps {
  searchParams: Promise<{ sort?: string; dir?: string }>
}

export default async function GmailConnectionsPage({ searchParams }: PageProps) {
  const admin = await requireAdmin(2)
  const { sort = '', dir = '' } = await searchParams
  const db = createServiceClient()
  const showPii = admin.access_level <= 2

  // NOTE: gmail_connections.access_token/refresh_token and imap_connections.password/imap_host/imap_port
  // are credentials and must never be selected here — only metadata columns.
  const [{ data: gmailConns }, { data: imapConns }] = await Promise.all([
    db.from('gmail_connections').select('user_id, email, connected_at, last_synced_at'),
    db.from('imap_connections').select('user_id, email, provider, connected_at, last_synced_at'),
  ])

  const connections: ConnectionRow[] = [
    ...(gmailConns ?? []).map(c => ({ ...c, provider: 'gmail' as const })),
    ...(imapConns ?? []),
  ]

  const userIds = [...new Set(connections.map(c => c.user_id))]
  const { data: users } = userIds.length > 0
    ? await db.from('users').select('id, email, display_name').in('id', userIds)
    : { data: [] }
  const userMap = Object.fromEntries((users ?? []).map(u => [u.id, u]))

  const sorted = sortRows(
    connections,
    {
      user: (c) => (userMap[c.user_id]?.email ?? '').toLowerCase(),
      provider: (c) => c.provider,
      email: (c) => c.email.toLowerCase(),
      connected: (c) => (c.connected_at ? Date.parse(c.connected_at) : null),
      synced: (c) => (c.last_synced_at ? Date.parse(c.last_synced_at) : null),
    },
    sort,
    dir,
    (c) => (c.connected_at ? new Date(c.connected_at).getTime() : 0),
  )

  const gmailCount = gmailConns?.length ?? 0
  const imapCount = imapConns?.length ?? 0

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Email Connections</h1>
        <p className="text-[13px] text-salty-muted">
          {connections.length} connected accounts · {gmailCount} Gmail · {imapCount} IMAP
        </p>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                <SortLink label="User" sortKey="user" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Provider" sortKey="provider" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Email Account" sortKey="email" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Connected" sortKey="connected" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Last Synced" sortKey="synced" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-salty-muted">No email connections</td>
                </tr>
              ) : (
                sorted.map(c => {
                  const user = userMap[c.user_id]
                  const userEmail = user?.email ?? '—'
                  const displayEmail = showPii ? userEmail : maskEmail(userEmail)
                  const connEmail = showPii ? c.email : maskEmail(c.email)
                  const isGmail = c.provider === 'gmail'
                  return (
                    <tr key={`${c.user_id}-${c.provider}`} className="border-b border-salty-border last:border-0 transition-colors hover:bg-cream">
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-medium text-salty-text">{displayEmail}</p>
                        {user?.display_name && <p className="text-[11px] text-salty-muted">{user.display_name}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${PROVIDER_COLOR[c.provider] ?? 'bg-stone text-salty-secondary'}`}>
                          {c.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-salty-text">{connEmail}</td>
                      <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">
                        {c.connected_at ? new Date(c.connected_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StaleBadge lastSyncedAt={c.last_synced_at} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/users/${c.user_id}`} className="text-salty-muted hover:text-ember transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                          <RevokeButton
                            userId={c.user_id}
                            userEmail={displayEmail}
                            kind={isGmail ? 'gmail' : 'imap'}
                            providerLabel={isGmail ? 'Gmail' : c.provider}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
