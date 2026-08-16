import { createServiceClient } from '@/lib/supabase/server'
import { costOf, type TokenCounts } from './pricing'

/**
 * Per-call token and cost accounting for every model call the admin panel makes.
 *
 * This is our own ledger, not a mirror of the provider's. The provider's billing page can
 * tell you the org spent $12 last week; only this table can tell you it was the Manual Edit
 * AI lookup, run 340 times, mostly by one admin. That attribution is the whole point —
 * without it "reduce AI cost" has nothing to act on.
 */

export interface LlmCallRecord {
  /** Feature that spent the money — dot-namespaced, e.g. 'manual-edit.event-lookup'. */
  operation: string
  model: string
  provider?: string
  source?: 'admin' | 'edge' | 'cron'
  tokens?: TokenCounts
  ok?: boolean
  error?: string | null
  latencyMs?: number
  adminId?: string | null
}

/** Anthropic's `usage` block, mapped onto our token shape. */
export function tokensFromAnthropicUsage(usage: unknown): TokenCounts {
  const u = (usage ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheReadTokens: num(u.cache_read_input_tokens),
    cacheCreationTokens: num(u.cache_creation_input_tokens),
  }
}

/**
 * Record one model call. Never throws: a failure to write the ledger must not take down
 * the feature that was being measured.
 */
export async function recordLlmCall(record: LlmCallRecord): Promise<void> {
  try {
    const t = record.tokens ?? {}
    const db = createServiceClient()
    await db.from('llm_call_log').insert({
      source: record.source ?? 'admin',
      provider: record.provider ?? 'anthropic',
      model: record.model,
      operation: record.operation,
      input_tokens: t.inputTokens ?? 0,
      output_tokens: t.outputTokens ?? 0,
      cache_read_tokens: t.cacheReadTokens ?? 0,
      cache_creation_tokens: t.cacheCreationTokens ?? 0,
      cost_usd: costOf(record.model, t),
      ok: record.ok ?? true,
      error: record.error ?? null,
      latency_ms: record.latencyMs ?? null,
      admin_id: record.adminId ?? null,
    })
  } catch (e) {
    console.error('[llm-log] failed to record call:', (e as Error).message)
  }
}

export interface LlmCallRow {
  id: string
  source: string
  provider: string
  model: string
  operation: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  cost_usd: number
  ok: boolean
  error: string | null
  latency_ms: number | null
  created_at: string
}

export interface LlmCostRollup {
  operation: string
  model: string
  provider: string
  calls: number
  failures: number
  tokens: number
  cost_usd: number
  p95_ms: number | null
}

export interface LlmCostDay {
  day: string
  cost_usd: number
  calls: number
}

const n = (v: unknown): number => (v == null ? 0 : Number(v))

/**
 * Per-(operation, model) spend rollup, aggregated in Postgres.
 *
 * NOT derived from loadLlmCalls: PostgREST caps a response at db-max-rows (1000 on this project)
 * regardless of .limit(), so reducing rows in JS silently reports "the most recent 1000 calls"
 * instead of the window. That is the same trap 015_count_pending_import_users documents, and it
 * is a worse failure here because the number still looks plausible — it just under-reports spend.
 */
export async function loadLlmCostSummary(sinceDays: number): Promise<LlmCostRollup[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('get_llm_cost_summary', { p_days: sinceDays })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    operation: String(r.operation),
    model: String(r.model),
    provider: String(r.provider),
    calls: n(r.calls),
    failures: n(r.failures),
    tokens: n(r.tokens),
    cost_usd: n(r.cost_usd),
    p95_ms: r.p95_ms == null ? null : Number(r.p95_ms),
  }))
}

/** Daily spend for the trend strip, aggregated in Postgres (zero-spend days included). */
export async function loadLlmCostDaily(sinceDays: number): Promise<LlmCostDay[]> {
  const db = createServiceClient()
  const { data } = await db.rpc('get_llm_cost_daily', { p_days: sinceDays })
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    cost_usd: n(r.cost_usd),
    calls: n(r.calls),
  }))
}

/**
 * Raw calls in a window, newest first.
 *
 * Use ONLY for bounded row listings (e.g. recent failures) where the limit is far below the
 * 1000-row PostgREST cap. For any total, use loadLlmCostSummary — see the note there.
 */
export async function loadLlmCalls(sinceDays: number, limit = 5000): Promise<LlmCallRow[]> {
  const db = createServiceClient()
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const { data } = await db
    .from('llm_call_log')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as LlmCallRow[]).map((r) => ({ ...r, cost_usd: Number(r.cost_usd) }))
}
