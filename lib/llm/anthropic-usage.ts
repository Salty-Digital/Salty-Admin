import { costOf, modelLabel } from './pricing'

/**
 * Organisation-wide Anthropic usage, read from the Admin API.
 *
 * Our own ledger (llm_call_log) only sees calls the admin panel makes. The mobile app's
 * edge functions — the import classifier, enrichment — spend on the same Anthropic account
 * and never touch this codebase, so without this the dashboard would understate real spend
 * by whatever the app costs.
 *
 * Needs a separate **Admin API key** (`sk-ant-admin…`), not the regular ANTHROPIC_API_KEY;
 * regular keys are rejected by the organisation endpoints. Leave it unset to hide the panel.
 *
 * We price the returned token counts with our own rate table rather than calling the
 * cost_report endpoint, so the org view and the per-feature view are always denominated
 * the same way and a discrepancy means a real discrepancy, not two different price sources.
 */

const USAGE_URL = 'https://api.anthropic.com/v1/organizations/usage_report/messages'

export function isOrgUsageConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_ADMIN_KEY)
}

interface UsageResult {
  model: string | null
  uncached_input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation: { ephemeral_1h_input_tokens: number; ephemeral_5m_input_tokens: number }
}

interface UsageBucket {
  starting_at: string
  ending_at: string
  results: UsageResult[]
}

export interface OrgUsageDay {
  date: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
}

export interface OrgUsageModel {
  model: string
  label: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface OrgUsage {
  days: OrgUsageDay[]
  models: OrgUsageModel[]
  totalCostUsd: number
  totalTokens: number
}

/**
 * Daily org usage for the last `days` days (max 31 — the API's ceiling for 1d buckets).
 * Returns null when unconfigured; throws only on a real API failure so the page can
 * distinguish "not set up" from "broken".
 */
export async function fetchOrgUsage(days = 30): Promise<OrgUsage | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY
  if (!key) return null

  const limit = Math.min(Math.max(days, 1), 31)
  const startingAt = new Date(Date.now() - limit * 86_400_000)
  startingAt.setUTCHours(0, 0, 0, 0)

  const params = new URLSearchParams({
    starting_at: startingAt.toISOString(),
    bucket_width: '1d',
    limit: String(limit),
  })
  params.append('group_by[]', 'model')

  const res = await fetch(`${USAGE_URL}?${params}`, {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic Admin API ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as { data?: UsageBucket[] }
  const buckets = json.data ?? []

  const byModel = new Map<string, OrgUsageModel>()
  const dayRows: OrgUsageDay[] = []
  let totalCostUsd = 0
  let totalTokens = 0

  for (const bucket of buckets) {
    const day: OrgUsageDay = {
      date: bucket.starting_at.slice(0, 10),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
    }

    for (const r of bucket.results) {
      const model = r.model ?? 'unknown'
      const cacheCreation =
        (r.cache_creation?.ephemeral_1h_input_tokens ?? 0) + (r.cache_creation?.ephemeral_5m_input_tokens ?? 0)
      const tokens = {
        inputTokens: r.uncached_input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheReadTokens: r.cache_read_input_tokens ?? 0,
        cacheCreationTokens: cacheCreation,
      }
      const cost = costOf(model, tokens)

      day.inputTokens += tokens.inputTokens
      day.outputTokens += tokens.outputTokens
      day.cacheReadTokens += tokens.cacheReadTokens
      day.cacheCreationTokens += tokens.cacheCreationTokens
      day.costUsd += cost

      const existing = byModel.get(model) ?? {
        model,
        label: modelLabel(model),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      }
      existing.inputTokens += tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens
      existing.outputTokens += tokens.outputTokens
      existing.costUsd += cost
      byModel.set(model, existing)

      totalCostUsd += cost
      totalTokens += tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheCreationTokens
    }

    dayRows.push(day)
  }

  return {
    days: dayRows,
    models: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
    totalCostUsd,
    totalTokens,
  }
}
