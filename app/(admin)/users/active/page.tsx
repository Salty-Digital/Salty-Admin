import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isPostHogConfigured, posthogQuery } from '@/lib/posthog'
import { maskEmail } from '@/lib/privacy'
import { Wifi } from 'lucide-react'
import { ActiveUsersTable } from './active-users-table'

// Per-user engagement is computed over this lookback (covers the whole beta).
const LOOKBACK_DAYS = 120
// "Online now" = an app event in the last 10 minutes. Mobile SDKs batch/flush events
// (and there's a short server cache), so a tighter window misses users who are in-app
// but between event flushes.
const ONLINE_MS = 10 * 60 * 1000

const WINDOWS = [
  { key: 'now', label: 'Online now',  ms: ONLINE_MS },
  { key: '1d',  label: 'Last 24 h',   ms: 24 * 60 * 60 * 1000 },
  { key: '7d',  label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
]

// Aggregate by PostHog PERSON (not raw distinct_id): the mobile app records events under
// an anonymous device id before login and under the Supabase user id after, and PostHog
// merges both into one person. Grouping by person keeps a user's activity together, and
// `groupUniqArray(distinct_id)` lets us resolve the person to its Supabase user id.
// ORDER BY + LIMIT 500 is required — the query API caps at 100 rows with no LIMIT, and
// with no ORDER BY it returns an arbitrary 100, dropping most users.
const EVENTS_SQL = `
SELECT person_id, groupUniqArray(distinct_id) AS distinct_ids, max(timestamp) AS last_seen,
       uniq(toDate(timestamp)) AS days_active, count() AS events
FROM events
WHERE timestamp >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
GROUP BY person_id
ORDER BY last_seen DESC
LIMIT 500
`.trim()

const SESSIONS_SQL = `
SELECT distinct_id, sum(duration) AS total_seconds, count() AS sessions
FROM sessions
WHERE \`$start_timestamp\` >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
GROUP BY distinct_id
ORDER BY total_seconds DESC
LIMIT 500
`.trim()

interface PageProps {
  searchParams: Promise<{ window?: string }>
}

interface Engagement {
  lastSeen: number
  daysActive: number
  totalSeconds: number
  sessions: number
}

export default async function ActiveUsersPage({ searchParams }: PageProps) {
  const admin = await requireAdmin(3)
  const { window: win = 'now' } = await searchParams
  const windowCfg = WINDOWS.find((w) => w.key === win) ?? WINDOWS[0]
  const showPii = admin.access_level <= 2
  const db = createServiceClient()

  const configured = isPostHogConfigured()

  // Fetch the (small) users table up front — we resolve each PostHog person to a user by
  // matching one of the person's distinct_ids to a Supabase user id.
  const { data: usersData } = configured
    ? await db.from('users').select('id, email, username, display_name, tier, banned_until')
    : { data: [] }
  const users = usersData ?? []
  const userById = new Map(users.map((u) => [u.id, u]))

  const byUser = new Map<string, Engagement>()
  let queryError: string | null = null

  if (configured) {
    try {
      const [ev, ss] = await Promise.all([posthogQuery(EVENTS_SQL), posthogQuery(SESSIONS_SQL)])

      // person events → resolve to a user via its distinct_ids
      const didToUser = new Map<string, string>()
      for (const r of ev.results) {
        const dids = Array.isArray(r[1]) ? (r[1] as unknown[]).map(String) : []
        const uid = dids.find((d) => userById.has(d))
        if (!uid) continue
        byUser.set(uid, {
          lastSeen: new Date(String(r[2])).getTime(),
          daysActive: Number(r[3]) || 0,
          totalSeconds: 0,
          sessions: 0,
        })
        for (const d of dids) didToUser.set(d, uid)
      }

      // per-session-id durations → summed onto the resolved user
      for (const r of ss.results) {
        const uid = didToUser.get(String(r[0]))
        if (!uid) continue
        const e = byUser.get(uid)!
        e.totalSeconds += Number(r[1]) || 0
        e.sessions += Number(r[2]) || 0
      }
    } catch (e) {
      queryError = (e as Error).message
    }
  }

  const now = Date.now()
  const rows = users
    .filter((u) => byUser.has(u.id))
    .map((u) => {
      const e = byUser.get(u.id)!
      return {
        id: u.id,
        email: showPii ? u.email : maskEmail(u.email),
        username: u.username as string | null,
        displayName: u.display_name as string | null,
        tier: (u.tier as string) ?? 'free',
        banned: Boolean(u.banned_until && new Date(u.banned_until as string) > new Date()),
        lastSeen: e.lastSeen,
        daysActive: e.daysActive,
        totalSeconds: e.totalSeconds,
        sessions: e.sessions,
        online: now - e.lastSeen <= ONLINE_MS,
      }
    })
    .sort((a, b) => b.lastSeen - a.lastSeen)

  const onlineCount = rows.filter((r) => r.online).length
  const inWindow = rows.filter((r) => now - r.lastSeen <= windowCfg.ms)

  return (
    <div className="p-7 space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {onlineCount > 0 && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#3E8A5A] opacity-60" />
            )}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${onlineCount > 0 ? 'bg-[#3E8A5A]' : 'bg-salty-muted'}`} />
          </span>
          <h1 className="font-sora text-[20px] font-bold text-salty-text">Active Users</h1>
        </div>
        <p className="mt-0.5 text-[13px] text-salty-muted">
          Real in-app activity from PostHog — <b>{onlineCount}</b> using the app right now.
          Days active and total time are over the last {LOOKBACK_DAYS} days.
        </p>
      </div>

      {!configured ? (
        <div className="max-w-3xl rounded-[14px] border border-[#FDE8C8] bg-[#FFF8E6] px-4 py-3 text-[12.5px] text-[#8A6830]">
          <p className="font-semibold">PostHog not connected</p>
          <p className="mt-1">
            Set <code>POSTHOG_API_KEY</code> (a PostHog personal API key, <code>query:read</code>) to
            show live in-app activity. This page now reflects real app usage, not Supabase sign-in
            timestamps.
          </p>
        </div>
      ) : queryError ? (
        <div className="max-w-3xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] px-4 py-3 text-[12.5px] text-[#BF4A3A]">
          <p className="font-semibold">Couldn’t load PostHog data</p>
          <p className="mt-1 break-words">{queryError}</p>
        </div>
      ) : (
        <>
          {/* Window tabs */}
          <div className="flex w-fit gap-1 rounded-[10px] border border-salty-border bg-stone p-1">
            {WINDOWS.map((w) => (
              <Link
                key={w.key}
                href={`/users/active?window=${w.key}`}
                className={`rounded-[8px] px-4 py-1.5 text-[12px] font-medium transition-colors ${
                  w.key === win ? 'bg-warm-white text-salty-text shadow-sm' : 'text-salty-muted hover:text-salty-text'
                }`}
              >
                {w.label}
                {w.key === 'now' && onlineCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-[#EAF4EE] px-1.5 py-px text-[10px] font-bold text-[#3E8A5A]">
                    {onlineCount}
                  </span>
                )}
              </Link>
            ))}
          </div>

          <p className="text-[13px] text-salty-muted">
            {inWindow.length} user{inWindow.length !== 1 ? 's' : ''}{' '}
            {win === 'now' ? 'in the app now' : `active in the ${windowCfg.label.toLowerCase()} window`}
          </p>

          {/* Table */}
          <ActiveUsersTable
            rows={inWindow}
            emptyLabel={win === 'now' ? 'No one is in the app right now' : 'No users active in this window'}
          />

          <p className="flex items-center gap-1.5 text-[11px] text-salty-muted">
            <Wifi className="h-3.5 w-3.5" />
            “Online now” = an app event in the last 10 minutes (real usage), not the last sign-in.
          </p>
        </>
      )}
    </div>
  )
}
