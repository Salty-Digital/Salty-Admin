import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { NotifComposer } from './notif-composer'
import { SortLink } from '@/components/ui/sortable'
import { sortRows } from '@/lib/sort'

interface PageProps {
  searchParams: Promise<{ source?: string; sort?: string; dir?: string }>
}

const VALID_SOURCES = ['admin', 'system'] as const
type SourceFilter = (typeof VALID_SOURCES)[number] | 'all'

const PREF_TOGGLES: [string, string][] = [
  ['event_reminders', 'Event reminders'],
  ['friend_activity', 'Friend activity'],
  ['new_detections', 'New detections'],
  ['setlist_available', 'Setlist available'],
  ['photos_added', 'Photos added'],
  ['artist_alerts', 'Artist alerts'],
]

export default async function NotificationsPage({ searchParams }: PageProps) {
  await requireAdmin(3)
  const { source: sourceParam, sort = '', dir = '' } = await searchParams
  const filter: SourceFilter = (VALID_SOURCES as readonly string[]).includes(sourceParam ?? '')
    ? (sourceParam as SourceFilter)
    : 'all'
  const db = createServiceClient()

  // Log query respects the filter tab. All other queries stay unfiltered — they
  // power the aggregate reach/opt-in panels which are per-project, not per-source.
  // Supabase's query builder returns a NEW builder from each method — chaining
  // without reassignment silently drops the filter.
  let logQuery = db
    .from('notifications')
    .select('id, user_id, title, body, read, source, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (filter !== 'all') logQuery = logQuery.eq('source', filter) as typeof logQuery

  const [
    { data: users },
    { data: log },
    { count: totalUsers },
    { data: tokens },
    { data: prefs },
  ] = await Promise.all([
    db.from('users').select('id, email').order('email').limit(500),
    logQuery,
    db.from('users').select('*', { count: 'exact', head: true }),
    db.from('notification_tokens').select('user_id, platform'),
    db.from('notification_preferences').select('*'),
  ])

  // ── Push reach ──
  const tokenRows = tokens ?? []
  const iosTokens = tokenRows.filter(t => t.platform === 'ios').length
  const androidTokens = tokenRows.filter(t => t.platform === 'android').length
  const usersWithToken = new Set(tokenRows.map(t => t.user_id).filter(Boolean)).size
  const reachPct = totalUsers ? Math.round(usersWithToken / totalUsers * 100) : 0

  // ── Opt-in rates ──
  const prefRows = (prefs ?? []) as Record<string, unknown>[]
  const optInRates = PREF_TOGGLES.map(([key, label]) => {
    const on = prefRows.filter(p => p[key] === true).length
    const pct = prefRows.length ? Math.round(on / prefRows.length * 100) : 0
    return { key, label, on, pct }
  })

  // Resolve user emails for the log
  const logUserIds = [...new Set((log ?? []).map(n => n.user_id).filter(Boolean))]
  const { data: logUsers } = logUserIds.length > 0
    ? await db.from('users').select('id, email').in('id', logUserIds)
    : { data: [] }
  const emailMap: Record<string, string> = {}
  for (const u of logUsers ?? []) emailMap[u.id] = u.email

  const sortedLog = sortRows(
    log ?? [],
    {
      title: (n) => (n.title ?? '').toLowerCase(),
      body: (n) => (n.body ?? '').toLowerCase(),
      user: (n) => (emailMap[n.user_id] ?? '').toLowerCase(),
      source: (n) => n.source ?? 'system',
      read: (n) => (n.read ? 1 : 0),
      sent: (n) => (n.created_at ? Date.parse(n.created_at) : 0),
    },
    sort,
    dir,
    (n) => (n.created_at ? new Date(n.created_at).getTime() : 0),
  )

  return (
    <div className="p-7 space-y-7">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Notifications</h1>
        <p className="text-[13px] text-salty-muted">Send push notifications to individual users or broadcast to all</p>
      </div>

      <NotifComposer users={users ?? []} />

      {/* Delivery insight */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <div className="border-b border-salty-border px-5 py-4">
            <h2 className="font-sora text-[14px] font-bold text-salty-text">Push Reach</h2>
          </div>
          <div className="flex items-center justify-between border-b border-salty-border px-5 py-3">
            <div><p className="text-[13px] text-salty-secondary">Users reachable</p><p className="text-[11px] text-salty-muted">{usersWithToken} of {totalUsers ?? 0} have a push token</p></div>
            <span className="font-sora text-[17px] font-bold text-salty-text">{reachPct}%</span>
          </div>
          <div className="flex items-center justify-between border-b border-salty-border px-5 py-3">
            <span className="text-[13px] text-salty-secondary">iOS tokens</span><span className="font-sora text-[15px] font-bold text-salty-text">{iosTokens}</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-[13px] text-salty-secondary">Android tokens</span><span className="font-sora text-[15px] font-bold text-salty-text">{androidTokens}</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <div className="border-b border-salty-border px-5 py-4">
            <h2 className="font-sora text-[14px] font-bold text-salty-text">Notification Opt-in Rates</h2>
          </div>
          {optInRates.map(r => (
            <div key={r.key} className="flex items-center gap-3 border-b border-salty-border px-5 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-salty-text">{r.label}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-stone">
                  <div className="h-full rounded-full bg-ember" style={{ width: `${r.pct}%` }} />
                </div>
              </div>
              <span className="font-sora text-[13px] font-bold text-salty-text shrink-0 w-20 text-right">{r.pct}% <span className="font-sans font-normal text-[11px] text-salty-muted">({r.on})</span></span>
            </div>
          ))}
        </div>
      </div>

      {/* Log */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-sora text-[15px] font-bold text-salty-text">Recent Notifications</h2>
          <div className="flex gap-1 rounded-lg bg-stone p-1">
            {([
              { key: 'all',    label: 'All' },
              { key: 'admin',  label: 'Admin' },
              { key: 'system', label: 'System' },
            ] as const).map(t => {
              const href = t.key === 'all' ? '/notifications' : `/notifications?source=${t.key}`
              const active = filter === t.key
              return (
                <Link
                  key={t.key}
                  href={href}
                  className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${
                    active ? 'bg-warm-white text-salty-text shadow-sm' : 'text-salty-secondary hover:text-salty-text'
                  }`}
                >
                  {t.label}
                </Link>
              )
            })}
          </div>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                <SortLink label="Title" sortKey="title" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Body" sortKey="body" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="User" sortKey="user" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Source" sortKey="source" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Read" sortKey="read" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
                <SortLink label="Sent" sortKey="sent" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted" />
              </tr>
            </thead>
            <tbody>
              {(log ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[13px] text-salty-muted">
                  {filter === 'all' ? 'No notifications sent yet' : `No ${filter} notifications`}
                </td></tr>
              ) : (
                sortedLog.map(n => (
                  <tr key={n.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                    <td className="px-4 py-3 text-[13px] font-medium text-salty-text">{n.title}</td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary max-w-xs"><p className="truncate">{n.body}</p></td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary">{emailMap[n.user_id] ?? n.user_id?.slice(0,8)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        n.source === 'admin' ? 'bg-ember-light text-ember' : 'bg-stone text-salty-muted'
                      }`}>
                        {n.source ?? 'system'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${n.read ? 'bg-stone text-salty-muted' : 'bg-ember-light text-ember'}`}>
                        {n.read ? 'Read' : 'Unread'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">
                      {new Date(n.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
