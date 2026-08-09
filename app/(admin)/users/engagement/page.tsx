import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isPostHogConfigured, posthogQuery } from '@/lib/posthog'
import { maskEmail } from '@/lib/privacy'
import { EngagementClient, type EngagementRow, type Classification } from './engagement-client'

// Engagement is computed over app events from the last N days (covers the beta).
const WINDOW_DAYS = 120
const DAY_MS = 24 * 60 * 60 * 1000

// Aggregate by PostHog PERSON (merges each user's anonymous + logged-in distinct_ids),
// then resolve the person to its Supabase user id. ORDER BY + LIMIT 500 is required —
// the query API caps at 100 rows with no LIMIT, dropping most users.
const ENGAGEMENT_SQL = `
SELECT person_id, groupUniqArray(distinct_id) AS distinct_ids,
       uniq(toDate(timestamp)) AS active_days, count() AS events
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
GROUP BY person_id
ORDER BY active_days DESC
LIMIT 500
`.trim()

interface Engagement {
  activeDays: number
  events: number
}

export default async function EngagementPage() {
  const admin = await requireAdmin(3)
  const showPii = admin.access_level <= 2
  const db = createServiceClient()

  // 1. All app users (small beta base — no pagination needed).
  const { data: usersData } = await db
    .from('users')
    .select('id, email, username, display_name, tier, created_at, banned_until')
  const users = usersData ?? []

  // 2. Ticket counts per user.
  const { data: ticketRows } = await db.from('tickets').select('user_id')
  const ticketMap: Record<string, number> = {}
  for (const t of ticketRows ?? []) ticketMap[t.user_id] = (ticketMap[t.user_id] ?? 0) + 1

  // 3. Auth sign-in timestamps (returned-a-2nd-day signal).
  type AuthUser = { id: string; last_sign_in_at?: string | null }
  const authMap = new Map<string, string | null>()
  for (let page = 1; page <= 5; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 1000 })
    const batch = (data?.users ?? []) as AuthUser[]
    for (const u of batch) authMap.set(u.id, u.last_sign_in_at ?? null)
    if (batch.length < 1000) break
  }

  // 4. PostHog engagement (optional — degrades gracefully).
  const posthogConfigured = isPostHogConfigured()
  let posthogAvailable = false
  const engagementMap = new Map<string, Engagement>()
  if (posthogConfigured) {
    try {
      const userIds = new Set(users.map((u) => u.id))
      const { results } = await posthogQuery(ENGAGEMENT_SQL)
      for (const row of results) {
        const dids = Array.isArray(row[1]) ? (row[1] as unknown[]).map(String) : []
        const uid = dids.find((d) => userIds.has(d))
        if (!uid) continue
        engagementMap.set(uid, { activeDays: Number(row[2]) || 0, events: Number(row[3]) || 0 })
      }
      posthogAvailable = true
    } catch {
      posthogAvailable = false
    }
  }

  // Classify each account.
  const rows: EngagementRow[] = users.map((u) => {
    const email = (u.email ?? '').trim()
    const isTeam = email.toLowerCase().endsWith('@saltydigital.ai')
    const tickets = ticketMap[u.id] ?? 0
    const eng = engagementMap.get(u.id)
    const activeDays = posthogAvailable ? eng?.activeDays ?? 0 : null
    const lastSignIn = authMap.get(u.id) ?? null

    const returned = Boolean(
      lastSignIn && u.created_at && Date.parse(lastSignIn) - Date.parse(u.created_at) > DAY_MS,
    )
    const didAction = tickets >= 1 || (activeDays !== null && activeDays >= 2) || returned
    const classification: Classification = isTeam ? 'team' : didAction ? 'real-active' : 'dormant'

    return {
      id: u.id,
      email: showPii ? (email || '—') : maskEmail(email),
      displayName: u.display_name ?? null,
      username: u.username ?? null,
      tier: u.tier ?? 'free',
      tickets,
      activeDays,
      lastSignIn,
      returned,
      banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
      classification,
    }
  })

  const nonTeam = rows.filter((r) => r.classification !== 'team')
  const summary = {
    total: rows.length,
    realActive: rows.filter((r) => r.classification === 'real-active').length,
    dormant: rows.filter((r) => r.classification === 'dormant').length,
    team: rows.filter((r) => r.classification === 'team').length,
    imported: nonTeam.filter((r) => r.tickets >= 1).length,
    returned: nonTeam.filter((r) => r.returned || (r.activeDays !== null && r.activeDays >= 2)).length,
  }

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">User Engagement</h1>
        <p className="text-[13px] text-salty-muted">
          Separates <b>real, active</b> users (imported a ticket, opened the app on a 2nd day, or came
          back to sign in) from dormant accounts — emulators, QA, and reinstalls that never did
          anything. Team accounts are called out separately.
        </p>
      </div>

      {posthogConfigured && !posthogAvailable && (
        <div className="max-w-3xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] px-4 py-3 text-[12.5px] text-[#BF4A3A]">
          Couldn’t reach PostHog for the app-engagement signal — classification is using tickets and
          sign-in returns only.
        </div>
      )}
      {!posthogConfigured && (
        <div className="max-w-3xl rounded-[14px] border border-[#FDE8C8] bg-[#FFF8E6] px-4 py-3 text-[12.5px] text-[#8A6830]">
          Set <code>POSTHOG_API_KEY</code> to add the app-engagement signal (active days). Until then,
          classification uses tickets imported and whether the user returned to sign in.
        </div>
      )}

      <EngagementClient rows={rows} summary={summary} windowDays={WINDOW_DAYS} />
    </div>
  )
}
