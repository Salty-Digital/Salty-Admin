import { recordLlmCall, tokensFromAnthropicUsage } from './log'

/**
 * A three-tier model ladder for ops triage: try the free models first, fall through to the
 * paid one only when they fail or can't answer.
 *
 * This is Pawel's design from the 8/15 review (free → free → paid), narrowed to the shape
 * that's actually safe against production: the model never emits an action, it *picks* one
 * from an allow-list we hand it. Anything outside the list is discarded. See
 * lib/remediation.ts for the allow-list itself.
 *
 * Tiers activate on key presence, so an unconfigured tier is skipped rather than failing:
 *   1  GEMINI_API_KEY  → Gemini Flash (free tier)
 *   2  GROQ_API_KEY    → Llama on Groq (free tier)
 *   3  ANTHROPIC_API_KEY → Haiku 4.5 (paid, and the one that's already configured)
 */

export interface LadderTier {
  tier: number
  provider: 'gemini' | 'groq' | 'anthropic'
  model: string
  /** Free tiers cost nothing, so a run that stops at tier 1 or 2 is genuinely free. */
  free: boolean
}

export function availableTiers(): LadderTier[] {
  const tiers: LadderTier[] = []
  if (process.env.GEMINI_API_KEY) {
    tiers.push({ tier: 1, provider: 'gemini', model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash', free: true })
  }
  if (process.env.GROQ_API_KEY) {
    tiers.push({ tier: 2, provider: 'groq', model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile', free: true })
  }
  if (process.env.ANTHROPIC_API_KEY) {
    tiers.push({ tier: 3, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', free: false })
  }
  return tiers
}

interface RawResult {
  text: string
  tokens: { inputTokens: number; outputTokens: number }
}

async function callGemini(model: string, prompt: string, schemaHint: string): Promise<RawResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${schemaHint}` }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  return {
    text: json.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    tokens: {
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  }
}

async function callGroq(model: string, prompt: string, schemaHint: string): Promise<RawResult> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY!}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: `${prompt}\n\n${schemaHint}` }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    text: json.choices?.[0]?.message?.content ?? '',
    tokens: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  }
}

async function callAnthropic(model: string, prompt: string, schemaHint: string): Promise<RawResult> {
  // Same raw-fetch, forced-tool-call pattern as lib/anthropic.ts — no SDK dependency, and
  // a forced tool call is how we get structured output without brittle text parsing.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: `${prompt}\n\n${schemaHint}\nReply with the JSON object only.` }],
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: unknown }
  const t = tokensFromAnthropicUsage(json.usage)
  return {
    text: json.content?.find((b) => b.type === 'text')?.text ?? '',
    tokens: { inputTokens: t.inputTokens ?? 0, outputTokens: t.outputTokens ?? 0 },
  }
}

/** Pull the first JSON object out of a response that may be fenced or prefaced. */
function parseJson<T>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

export interface LadderResult<T> {
  value: T
  tier: LadderTier
  /** Every tier that was tried and why it didn't answer — surfaced in the admin UI. */
  attempts: { tier: number; provider: string; error: string }[]
}

/**
 * Walk the ladder until a tier returns parseable JSON that `validate` accepts.
 * Every attempt — success or failure — is written to the LLM ledger, so the cost of
 * auto-remediation shows up on the LLM Costs page alongside everything else.
 */
export async function runLadder<T>(options: {
  prompt: string
  schemaHint: string
  operation: string
  validate: (value: unknown) => T | null
}): Promise<LadderResult<T> | { value: null; attempts: { tier: number; provider: string; error: string }[] }> {
  const attempts: { tier: number; provider: string; error: string }[] = []
  const tiers = availableTiers()

  if (tiers.length === 0) {
    return { value: null, attempts: [{ tier: 0, provider: 'none', error: 'No model API key configured (GEMINI_API_KEY / GROQ_API_KEY / ANTHROPIC_API_KEY)' }] }
  }

  for (const tier of tiers) {
    const t0 = Date.now()
    try {
      const raw =
        tier.provider === 'gemini'
          ? await callGemini(tier.model, options.prompt, options.schemaHint)
          : tier.provider === 'groq'
            ? await callGroq(tier.model, options.prompt, options.schemaHint)
            : await callAnthropic(tier.model, options.prompt, options.schemaHint)

      await recordLlmCall({
        operation: options.operation,
        model: tier.model,
        provider: tier.provider,
        source: 'cron',
        tokens: raw.tokens,
        latencyMs: Date.now() - t0,
        ok: true,
      })

      const parsed = parseJson<unknown>(raw.text)
      const value = parsed === null ? null : options.validate(parsed)
      if (value !== null) return { value, tier, attempts }
      attempts.push({ tier: tier.tier, provider: tier.provider, error: 'returned no usable answer' })
    } catch (e) {
      const message = (e as Error).message
      attempts.push({ tier: tier.tier, provider: tier.provider, error: message })
      await recordLlmCall({
        operation: options.operation,
        model: tier.model,
        provider: tier.provider,
        source: 'cron',
        latencyMs: Date.now() - t0,
        ok: false,
        error: message.slice(0, 300),
      })
    }
  }

  return { value: null, attempts }
}
