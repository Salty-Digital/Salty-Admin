import { createServiceClient } from '@/lib/supabase/server'
import { posthogQuery, isPostHogConfigured } from '@/lib/posthog'

/**
 * Behavioural analytics — activation, capture effectiveness, enrichment coverage, engagement.
 *
 * Complements the existing count-based panels. Counts tell you how big the system is; these tell
 * you whether it is WORKING: are users activating, which capture path produces tickets, is the
 * enrichment queue keeping up, and are people coming back.
 *
 * Every database figure is aggregated in Postgres (migration 020). Reducing rows in JS would be
 * silently wrong past 1000 rows — the PostgREST cap this project keeps running into.
 */

const num = (v: unknown): number => (v == null ? 0 : Number(v))

/**
 * Analytics filter set. `days: null` means all time; empty category/source mean "all".
 * Passed straight through to the RPCs, which do the filtering in SQL.
 */
export interface AnalyticsFilters {
  days: number | null
  category: string
  source: string
}

/** Parse and CLAMP raw search params — these reach SQL, so they are never trusted as-is. */
export function parseFilters(
  params: { days?: string; category?: string; source?: string },
  allowedCategories: string[] = [],
  allowedSources: string[] = [],
): AnalyticsFilters {
  const raw = params.days
  // Absent -> default 30d. Explicit empty string -> all time (the "All time" tab).
  const days = raw === undefined ? 30 : raw === '' ? null : Number(raw)
  const category = params.category ?? ''
  const source = params.source ?? ''
  return {
    days: Number.isFinite(days) && days !== null ? Math.max(1, Math.min(days, 3650)) : null,
    // Only values the data actually contains — a crafted param can't reach SQL as a novel string.
    category: allowedCategories.includes(category) ? category : '',
    source: allowedSources.includes(source) ? source : '',
  }
}

const rpcArgs = (f: AnalyticsFilters) => ({
  p_days: f.days,
  p_category: f.category || null,
  p_source: f.source || null,
})

export interface FilterOptions {
  categories: { value: string; n: number }[]
  sources: { value: string; n: number }[]
}

/** Distinct values present in the data, so a dropdown never offers an empty filter. */
export async function loadFilterOptions(): Promise<FilterOptions> {
  const db = createServiceClient()
  const { data } = await db.rpc('analytics_filter_options')
  const rows = (data ?? []) as { kind: string; value: string; n: number }[]
  return {
    categories: rows.filter((r) => r.kind === 'category').map((r) => ({ value: r.value, n: num(r.n) })),
    sources: rows.filter((r) => r.kind === 'source').map((r) => ({ value: r.value, n: num(r.n) })),
  }
}

export interface Activation {
  totalUsers: number
  withTicket: number
  with2Plus: number
  withInbox: number
  withPhotoScan: number
  seen7d: number
  seen30d: number
  avgTicketsPerActive: number
}

export async function loadActivation(f: AnalyticsFilters): Promise<Activation> {
  const db = createServiceClient()
  const { data } = await db.rpc('analytics_activation', rpcArgs(f))
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    totalUsers: num(r?.total_users),
    withTicket: num(r?.with_ticket),
    with2Plus: num(r?.with_2plus_tickets),
    withInbox: num(r?.with_inbox),
    withPhotoScan: num(r?.with_photo_scan),
    seen7d: num(r?.seen_last_7d),
    seen30d: num(r?.seen_last_30d),
    avgTicketsPerActive: num(r?.avg_tickets_per_active),
  }
}

export interface SourceEffectiveness {
  source: string
  tickets: number
  usersReached: number
  lastSeen: string | null
}

export async function loadSourceEffectiveness(f: AnalyticsFilters): Promise<SourceEffectiveness[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('analytics_source_effectiveness', rpcArgs(f))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    source: String(r.source),
    tickets: num(r.tickets),
    usersReached: num(r.users_reached),
    lastSeen: r.last_seen ? String(r.last_seen) : null,
  }))
}

export interface EnrichmentCoverage {
  kind: string
  totalJobs: number
  done: number
  pending: number
  failed: number
  exhausted: number
  pctDone: number
}

export async function loadEnrichmentCoverage(f: AnalyticsFilters): Promise<EnrichmentCoverage[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('analytics_enrichment_coverage', rpcArgs(f))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: String(r.kind),
    totalJobs: num(r.total_jobs),
    done: num(r.done),
    pending: num(r.pending),
    failed: num(r.failed),
    exhausted: num(r.exhausted),
    pctDone: num(r.pct_done),
  }))
}

export interface TimeToFirstTicket {
  bucket: string
  users: number
}

export async function loadTimeToFirstTicket(f: AnalyticsFilters): Promise<TimeToFirstTicket[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('analytics_time_to_first_ticket', rpcArgs(f))
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    bucket: String(r.bucket),
    users: num(r.users),
  }))
}

export interface Engagement {
  configured: boolean
  error: string | null
  /** Daily active users, oldest first. */
  daily: { day: string; users: number }[]
  wau: number
  mau: number
  /** WAU/MAU — the standard stickiness ratio. Null when there is no MAU to divide by. */
  stickiness: number | null
}

/**
 * Engagement from PostHog `app_opened`.
 *
 * Deliberately not derived from `users.last_seen_at`: that is written by the app on its own
 * schedule and cannot give a per-DAY series or a real WAU/MAU. Never throws — an expired PostHog
 * key must degrade this panel, not take down the analytics page.
 */
export async function loadEngagement(days = 30): Promise<Engagement> {
  const empty = { configured: false, error: null, daily: [], wau: 0, mau: 0, stickiness: null }
  if (!isPostHogConfigured()) return empty
  try {
    const window = Math.max(7, Math.min(days, 90))
    const { results } = await posthogQuery(`
      SELECT toDate(timestamp) AS day, uniq(person_id) AS users
      FROM events
      WHERE event = 'app_opened' AND timestamp >= now() - INTERVAL ${window} DAY
      GROUP BY day ORDER BY day
    `)
    const daily = results.map((r) => ({ day: String(r[0]), users: Number(r[1] ?? 0) }))

    // uniq() is not additive across days, so WAU/MAU must be their own queries rather than a sum.
    const [{ results: w }, { results: m }] = await Promise.all([
      posthogQuery(`SELECT uniq(person_id) FROM events WHERE event = 'app_opened' AND timestamp >= now() - INTERVAL 7 DAY`),
      posthogQuery(`SELECT uniq(person_id) FROM events WHERE event = 'app_opened' AND timestamp >= now() - INTERVAL 30 DAY`),
    ])
    const wau = Number(w?.[0]?.[0] ?? 0)
    const mau = Number(m?.[0]?.[0] ?? 0)

    return {
      configured: true,
      error: null,
      daily,
      wau,
      mau,
      stickiness: mau > 0 ? Math.round((wau / mau) * 1000) / 10 : null,
    }
  } catch (e) {
    return { ...empty, configured: true, error: (e as Error).message.slice(0, 200) }
  }
}
