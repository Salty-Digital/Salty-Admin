import { createServiceClient } from '@/lib/supabase/server'

/**
 * The external-API ledger (`api_usage_log`), written by the edge functions' trackedFetch wrapper.
 *
 * Sibling to lib/llm/log.ts, but for the OTHER side of the bill: Ticketmaster, TheSportsDB,
 * setlist.fm, Spotify, Nominatim, ESPN, MLB — the providers the product depends on that nothing was
 * watching. The provider's own dashboard can tell you a quota is nearly spent; only this can tell
 * you which edge function spent it.
 *
 * Every figure is aggregated in Postgres (016_api_usage_summary.sql). Reducing rows in JS would be
 * silently wrong: PostgREST caps responses at 1000 rows on this project regardless of .limit(), and
 * this table is already past 12k. Same trap as count_pending_import_users.
 */

export interface ProviderUsage {
  external_api: string
  calls: number
  failures: number
  /** Percentage, one decimal. Null when the window had no calls with a recorded outcome. */
  success_rate: number | null
  p50_ms: number | null
  p95_ms: number | null
  last_seen: string
}

export interface FunctionUsage {
  function_name: string
  external_api: string
  calls: number
  failures: number
  p95_ms: number | null
}

export interface DailyUsage {
  day: string
  calls: number
  failures: number
}

export interface UsageFailure {
  id: string
  function_name: string
  external_api: string
  error_message: string | null
  latency_ms: number | null
  created_at: string
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v))

export async function loadProviderUsage(days: number): Promise<ProviderUsage[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('get_api_usage_summary', { p_days: days })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    external_api: String(r.external_api),
    calls: num(r.calls),
    failures: num(r.failures),
    success_rate: numOrNull(r.success_rate),
    p50_ms: numOrNull(r.p50_ms),
    p95_ms: numOrNull(r.p95_ms),
    last_seen: String(r.last_seen),
  }))
}

export async function loadFunctionUsage(days: number): Promise<FunctionUsage[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('get_api_usage_by_function', { p_days: days })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    function_name: String(r.function_name),
    external_api: String(r.external_api),
    calls: num(r.calls),
    failures: num(r.failures),
    p95_ms: numOrNull(r.p95_ms),
  }))
}

export async function loadDailyUsage(days: number): Promise<DailyUsage[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('get_api_usage_daily', { p_days: days })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    calls: num(r.calls),
    failures: num(r.failures),
  }))
}

/**
 * Most recent failures. A plain select is safe here ONLY because the limit is far below the
 * 1000-row PostgREST cap — do not raise it past that without moving this into Postgres too.
 */
export async function loadRecentFailures(days: number, limit = 40): Promise<UsageFailure[]> {
  const db = createServiceClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data } = await db
    .from('api_usage_log')
    .select('id, function_name, external_api, error_message, latency_ms, created_at')
    .eq('success', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as UsageFailure[]
}

/** Display label for a provider slug. Unknown slugs fall back to the raw value. */
export const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  ticketmaster: 'Ticketmaster',
  thesportsdb: 'TheSportsDB',
  setlistfm: 'setlist.fm',
  phishnet: 'phish.net',
  spotify: 'Spotify',
  musicbrainz: 'MusicBrainz',
  nominatim: 'Nominatim',
  photon: 'Photon',
  espn: 'ESPN',
  'mlb-statsapi': 'MLB Stats API',
  'nba-stats': 'NBA Stats',
  expo_push: 'Expo Push',
}
