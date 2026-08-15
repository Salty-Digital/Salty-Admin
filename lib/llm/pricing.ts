/**
 * Per-model token rates, in USD per million tokens.
 *
 * Cost is computed and stored at write time (see log.ts) rather than derived at read time,
 * so editing a rate here never silently rewrites what we already spent. Update this table
 * when a price changes; historical rows keep the rate that was in force.
 */

export interface ModelRate {
  /** USD per 1M uncached input tokens. */
  input: number
  /** USD per 1M output tokens. */
  output: number
  label: string
}

// Anthropic list prices as of 2026-08. Sonnet 5 has an introductory rate ($2/$10) through
// 2026-08-31; we bill the standard rate here so the dashboard never *under*-states spend.
export const MODEL_RATES: Record<string, ModelRate> = {
  'claude-fable-5':             { input: 10, output: 50, label: 'Claude Fable 5' },
  'claude-opus-5':              { input: 5,  output: 25, label: 'Claude Opus 5' },
  'claude-opus-4-8':            { input: 5,  output: 25, label: 'Claude Opus 4.8' },
  'claude-sonnet-5':            { input: 3,  output: 15, label: 'Claude Sonnet 5' },
  'claude-sonnet-4-6':          { input: 3,  output: 15, label: 'Claude Sonnet 4.6' },
  'claude-haiku-4-5':           { input: 1,  output: 5,  label: 'Claude Haiku 4.5' },
  'claude-haiku-4-5-20251001':  { input: 1,  output: 5,  label: 'Claude Haiku 4.5' },
}

// Free-tier models used by the remediation ladder. Rated at zero so the dashboard shows
// what auto-remediation actually costs — which, for tiers 1 and 2, is nothing.
const FREE_MODEL_PREFIXES = ['gemini-', 'llama-', 'groq/', 'grok-', 'openai/gpt-oss']

/** Cache reads bill at ~10% of the input rate; 5-minute cache writes at ~125%. */
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

export function rateFor(model: string): ModelRate | null {
  if (MODEL_RATES[model]) return MODEL_RATES[model]
  if (FREE_MODEL_PREFIXES.some((p) => model.startsWith(p))) return { input: 0, output: 0, label: model }
  // Unknown model: fall back to a prefix match so a dated snapshot ID still prices.
  const prefix = Object.keys(MODEL_RATES).find((k) => model.startsWith(k))
  return prefix ? MODEL_RATES[prefix] : null
}

export interface TokenCounts {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

/** USD cost of one call. Returns 0 for models we have no rate for — never guesses. */
export function costOf(model: string, tokens: TokenCounts): number {
  const rate = rateFor(model)
  if (!rate) return 0
  const perToken = (usdPerMillion: number) => usdPerMillion / 1_000_000
  return (
    (tokens.inputTokens ?? 0) * perToken(rate.input) +
    (tokens.outputTokens ?? 0) * perToken(rate.output) +
    (tokens.cacheReadTokens ?? 0) * perToken(rate.input) * CACHE_READ_MULTIPLIER +
    (tokens.cacheCreationTokens ?? 0) * perToken(rate.input) * CACHE_WRITE_MULTIPLIER
  )
}

/** Format a USD amount for the dashboard — sub-cent spend still needs to be visible. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1) return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

export function modelLabel(model: string): string {
  return rateFor(model)?.label ?? model
}
