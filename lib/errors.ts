import { posthogQuery, isPostHogConfigured } from '@/lib/posthog'

/**
 * Mobile crash / unhandled-exception feed, from PostHog's `$exception` events.
 *
 * Closes the last blind spot in the health picture. lib/health.ts pings edge functions for
 * reachability and reads ingestion telemetry, but nothing surfaced errors happening ON DEVICE —
 * a crash loop in the app was invisible to the admin panel entirely. PostHog is already collecting
 * these (44 in the 30 days before this shipped), so this needs no new integration or credential,
 * just a read.
 *
 * Grouped by PostHog's own `$exception_issue_id`, so the grouping matches what you'd see in
 * PostHog's Error Tracking UI rather than a second, divergent definition.
 */

export interface ErrorIssue {
  issueId: string
  type: string
  message: string
  events: number
  users: number
  lastSeen: string
  appVersions: string[]
}

export interface ErrorSummary {
  configured: boolean
  /** Non-null when the query failed — the health check degrades instead of taking the page down. */
  error: string | null
  total: number
  users: number
  issues: ErrorIssue[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** PostHog stores these as arrays ($exception_types / $exception_values); take the first entry. */
function firstOf(v: unknown): string {
  if (Array.isArray(v)) return str(v[0])
  const s = str(v)
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) return str(parsed[0])
    } catch { /* fall through to the raw string */ }
  }
  return s
}

/**
 * Top issues in the window, most frequent first.
 *
 * Never throws: an expired PostHog key or a query error must degrade this panel, not break
 * /health — the rest of the page is the part that reports whether the system is up.
 */
export async function loadErrorSummary(days = 7, limit = 8): Promise<ErrorSummary> {
  if (!isPostHogConfigured()) {
    return { configured: false, error: null, total: 0, users: 0, issues: [] }
  }
  try {
    const { results } = await posthogQuery(`
      SELECT
        properties.$exception_issue_id                AS issue_id,
        any(properties.$exception_types)              AS types,
        any(properties.$exception_values)             AS vals,
        count()                                       AS events,
        uniq(person_id)                               AS users,
        max(timestamp)                                AS last_seen,
        arrayDistinct(groupArray(properties.$app_version)) AS app_versions
      FROM events
      WHERE event = '$exception'
        AND timestamp >= now() - INTERVAL ${Math.max(1, Math.min(days, 90))} DAY
      GROUP BY issue_id
      ORDER BY events DESC
      LIMIT ${Math.max(1, Math.min(limit, 50))}
    `)

    const issues: ErrorIssue[] = results.map((row) => ({
      issueId: str(row[0]),
      type: firstOf(row[1]) || 'Error',
      message: firstOf(row[2]),
      events: Number(row[3] ?? 0),
      users: Number(row[4] ?? 0),
      lastSeen: str(row[5]),
      appVersions: Array.isArray(row[6]) ? row[6].map(str).filter(Boolean) : [],
    }))

    return {
      configured: true,
      error: null,
      // Totals are folded from the top-N issues, so they describe what is DISPLAYED. A separate
      // count() would silently disagree with the list whenever the tail is truncated.
      total: issues.reduce((n, i) => n + i.events, 0),
      users: issues.reduce((n, i) => Math.max(n, i.users), 0),
      issues,
    }
  } catch (e) {
    return { configured: true, error: (e as Error).message.slice(0, 200), total: 0, users: 0, issues: [] }
  }
}
