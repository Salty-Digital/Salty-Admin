import { recordLlmCall } from '@/lib/llm/log'
import { ADMIN_PAGES } from '@/lib/pages'
import { anthropicToolDefs, TOOL_BY_NAME } from './tools'
import corpus from './corpus.generated.json'

/**
 * The knowledge-base assistant: answers questions about salty-mobile and Salty-Admin.
 *
 * Context is a SHIPPED CORPUS, not live file access — the deployed admin is a compiled Next.js app
 * with neither repo on disk. scripts/build-kb-corpus.mjs walks both repos locally and commits a
 * structural snapshot (every edge function and its purpose, every migration and its header, the
 * planning docs and their status, both repos' module/route/lib inventories). Roughly 28k tokens,
 * which fits comfortably in one request, so there is no retrieval step to get wrong.
 *
 * The trade-off, stated plainly in the system prompt so the model does not paper over it: the
 * assistant knows what exists and why, not the line-by-line implementation. It should say so rather
 * than guess at code it cannot see.
 *
 * Uses Sonnet rather than the Haiku constant in lib/anthropic.ts: this is long-context synthesis
 * across two codebases, which is exactly where the cheaper model degrades into plausible-sounding
 * architecture that was never built.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'
const MAX_QUESTION = 1000

/** Where an answer's claims can be checked — rendered as links under the answer. */
export interface Citation {
  kind: 'page' | 'file'
  label: string
  href?: string
}

export interface AskResult {
  ok: boolean
  answer: string
  error?: string
  /** Names of the live-data tools consulted, so the reader knows it queried rather than recalled. */
  toolsUsed?: string[]
  citations?: Citation[]
}

/** Max tool round-trips before we stop and answer with what we have. */
const MAX_TOOL_ROUNDS = 4

/**
 * Hand-written architectural narrative the generated corpus cannot express: invariants, failure
 * modes, and the decisions behind them. This is the part that turns an inventory into knowledge.
 * Keep it in sync with the Knowledge Base page sections — they are the same facts.
 */
const ARCHITECTURE_NOTES = `
SYSTEM SHAPE
- Two repos, ONE Supabase project (lzhrntjwnmrpwebmqyha). Local dev points at production; there is
  no separate dev database.
- salty-mobile owns the Expo app, every edge function, and the whole database schema.
- Salty-Admin is a Next.js 16 control plane reading the same database with the service role.
- Migrations are applied OUT OF BAND (supabase db push is broken; remote history drifted). Apply via
  the Supabase MCP apply_migration or the dashboard, then commit the delta file. The real drift gate
  is npm run types:check.

INGESTION
- Sources: gmail, imap, photo, forward, csv. Each writes a scan_runs row per attempt (forward does
  NOT in practice, despite the Pillar 4.1 build log claiming it does — 33 addresses and 10 real
  tickets exist with zero forward scan_runs).
- Scheduled scanning is OPT-IN and defaults OFF. A scan_schedules row is only created when a user
  changes the setting; DEFAULT_SCAN_SCHEDULE.enabled is false. run-scheduled-scans iterates that
  table, so connecting an inbox alone never produces a cron scan.
- Photos stay client-thin: the library is never bulk-uploaded. App Store privacy labels depend on it.

ENRICHMENT
- One queue (enrichment_jobs, PK (ticket_id, kind)) drained by enrichment-worker every 10 minutes.
- Flow: enqueue_enrichment_jobs (discover) -> claim_enrichment_jobs (lease, FOR UPDATE SKIP LOCKED)
  -> handler -> complete_enrichment_job (done | transient retry, 15m*4^n backoff, 4 attempts).
- Kinds: ${ADMIN_PAGES.length ? '' : ''}geocode, sports_result, cast, setlist, verify, lineup, roster.
- "done" means ATTEMPTED (found or definitively none), never "succeeded". A transient failure must
  be a retry, or a resolvable item converges to "nothing here" forever.
- Sibling-copy runs before any external call: the first ticket at a canonical event pays the cost,
  later tickets copy it via copy_*_from_sibling.
- Adding a kind = a discovery predicate + a worker handler + a BATCH cap + the kind in the admin's
  enrichment/kinds.ts. No new cron.

CREDENTIALS
- AES-256-GCM in _shared/crypto.ts; the key lives only in the edge runtime.
- Formats: enc:v2:<kid>:<data> (current, kid names the key), enc:v1:<data> (legacy, key unknowable),
  no prefix (pre-encryption plaintext).
- Rotation: set the new key as TOKEN_ENCRYPTION_KEY and the old as TOKEN_ENCRYPTION_KEY_PREVIOUS.
  Both are tried on decrypt. Rotating WITHOUT the previous key permanently destroys every stored
  credential — this happened on 2026-08-08 and killed six mailbox connections.
- decryptSecret THROWS on failure by design; returning null would hand callers an empty password.

KNOWN TRAPS (each caused a real bug)
- PostgREST truncates every response at 1000 rows regardless of .limit(). Aggregate in Postgres and
  expose an RPC; never reduce rows in JS for a total.
- Deploying an edge function resets verify_jwt to true. Self-authenticating functions must be pinned
  in supabase/config.toml and deployed from the repo root. Missing this took the scan cron down for
  three weeks.
- Every terminal failure must write its telemetry row. A throw escaping before persistScanRun leaves
  no record, which reads as "never scheduled" rather than "failing constantly".
- Empty and throttled are different answers. Providers return empty under load; treating that as
  "no data exists" marks good records permanently unresolvable.
- create or replace swaps the WHOLE function body. enqueue_enrichment_jobs is restated in full by
  every migration touching it; copy from the most recent version.
- Never let a provider URL reach a log or ledger — Ticketmaster carries the API key in the query
  string. sanitizeApiError strips URLs.
- tickets.date_str is free text and is_past is unreliable. Parse with toIsoDate().

ADMIN ACCESS MODEL
- Four levels, 1 = Super Admin (highest) .. 4 = Support. Page-level requireAdmin(n) redirects;
  every server action re-checks independently — the action is the real boundary.
- Per-admin page allowlists (admin_users.allowed_pages): null = level rules apply; set = that list
  is authoritative and OVERRIDES the level, so a level-1 page can be granted to a level-2 admin.
  Safe because page access is not capability — each page's actions still call requireAdmin(n), so a
  granted page is viewable but its actions refuse. Level 1 bypasses the allowlist entirely.
`.trim()

function buildSystemPrompt(): string {
  return [
    'You are the engineering knowledge base for Salty, a live events / ticket-collection product.',
    'You answer questions about two codebases: salty-mobile (the Expo app, all Supabase edge',
    'functions, and the database schema) and Salty-Admin (the Next.js admin control plane).',
    '',
    'HOW TO ANSWER',
    '- Be concrete and specific. Name the actual function, table, migration or route.',
    '- Lead with the answer, then the reasoning. Keep it tight; this is a reference, not an essay.',
    '- When something is a known trap or invariant, say so and say what breaks if it is ignored.',
    '',
    'WHAT YOU KNOW AND DO NOT KNOW — this matters, do not paper over it:',
    '- You have STRUCTURE and INTENT: every edge function and its purpose, every migration and its',
    '  header, planning and legal/compliance docs, and both repos\' module/route/lib inventories.',
    '- You do NOT have the source code. You cannot quote implementations or line numbers.',
    '- If a question needs code you cannot see, say which file to open rather than inventing it.',
    '- If the corpus does not cover something, say so plainly. Never fabricate a function, table,',
    '  column or migration name — a confident wrong name is worse here than "I do not know".',
    '',
    'LIVE DATA — you have read-only tools against the production database.',
    '- Use them whenever the question is about the CURRENT state ("why is this ticket not enriched",',
    '  "is anything broken", "are inboxes scanning", "how many tickets"). Do not guess at live state',
    '  you could look up, and do not describe the mechanism when they asked for the reading.',
    '- Do not call a tool for questions that are purely about how the system is built.',
    '- Say what the data shows, then what it means. If a tool returns nothing, say that rather than',
    '  filling the gap from the architecture notes.',
    '- Legal/compliance answers: point at the document and its sections. Never improvise a',
    '  compliance position — say which doc governs it and that it needs a human read.',
    '',
    'ARCHITECTURE, INVARIANTS AND FAILURE MODES',
    ARCHITECTURE_NOTES,
    '',
    'ADMIN PAGES',
    ADMIN_PAGES.map((p) => `- ${p.href} (${p.label}, ${p.section}, level<=${p.maxLevel})`).join('\n'),
    '',
    'REPOSITORY INVENTORY (generated from both repos)',
    JSON.stringify(corpus),
  ].join('\n')
}

export function isAskConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

/** Corpus freshness, so the UI can admit when the snapshot is old rather than quietly drifting. */
export function corpusMeta() {
  const c = corpus as { generatedAt: string; edgeFunctions: unknown[]; migrations: unknown[] }
  return {
    generatedAt: c.generatedAt,
    edgeFunctions: c.edgeFunctions.length,
    migrations: c.migrations.length,
  }
}

type Block = { type: string; [k: string]: unknown }

/**
 * Derive citations from the finished answer.
 *
 * Post-processing rather than asking the model for a citations field: the model can be wrong about
 * whether a file exists, but it cannot be wrong about what it wrote. Matching the answer text
 * against the REAL inventory means every link is guaranteed to resolve — a fabricated filename
 * simply produces no citation instead of a broken one.
 */
function citationsFor(answer: string): Citation[] {
  const out: Citation[] = []
  const seen = new Set<string>()
  const push = (c: Citation) => {
    const key = `${c.kind}:${c.label}`
    if (!seen.has(key)) { seen.add(key); out.push(c) }
  }

  for (const p of ADMIN_PAGES) {
    if (p.href === '/') continue
    if (new RegExp(`(^|[\\s(\`"'])${p.href}(?![\\w/-])`).test(answer)) {
      push({ kind: 'page', label: p.label, href: p.href })
    }
  }

  const c = corpus as {
    edgeFunctions: { name: string }[]
    migrations: { file: string }[]
    adminLibs: { name: string }[]
    sharedModules: { name: string }[]
  }
  for (const f of c.edgeFunctions) {
    if (new RegExp(`\\b${f.name}\\b`).test(answer)) {
      push({ kind: 'file', label: `supabase/functions/${f.name}/` })
    }
  }
  for (const m of c.migrations) if (answer.includes(m.file)) push({ kind: 'file', label: m.file })
  for (const l of c.adminLibs) if (answer.includes(l.name)) push({ kind: 'file', label: `lib/${l.name}` })
  for (const s of c.sharedModules) {
    if (answer.includes(s.name)) push({ kind: 'file', label: `supabase/functions/_shared/${s.name}` })
  }

  return out.slice(0, 12)
}

/**
 * Ask, running an agentic tool loop when the question needs live data.
 *
 * Bounded at MAX_TOOL_ROUNDS: a runaway loop would burn tokens and stall the request, and every
 * question worth asking here resolves in one or two lookups. If the cap is hit we answer with what
 * has been gathered rather than failing.
 */
export async function askKnowledgeBase(question: string): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, answer: '', error: 'ANTHROPIC_API_KEY is not set in the admin environment.' }

  const q = question.trim().slice(0, MAX_QUESTION)
  if (!q) return { ok: false, answer: '', error: 'Ask a question first.' }

  const startedAt = Date.now()
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content: q }]
  const toolsUsed: string[] = []
  let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1600,
          system: [{
            type: 'text',
            text: buildSystemPrompt(),
            // The corpus is identical every request; caching turns a ~29k-token prompt into a cache
            // read, which matters doubly here because a tool loop re-sends it each round.
            cache_control: { type: 'ephemeral' },
          }],
          tools: anthropicToolDefs(),
          // On the last allowed round, forbid further tools so the model must produce prose.
          ...(round === MAX_TOOL_ROUNDS ? { tool_choice: { type: 'none' } } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(90_000),
      })

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        await recordLlmCall({
          operation: 'knowledge-base.ask', model: MODEL, source: 'admin',
          ok: false, error: `HTTP ${res.status}`, latencyMs: Date.now() - startedAt,
        })
        return { ok: false, answer: '', error: `Anthropic returned ${res.status}. ${detail}` }
      }

      const json = await res.json()
      const u = json.usage ?? {}
      inputTokens += u.input_tokens ?? 0
      outputTokens += u.output_tokens ?? 0
      cacheRead += u.cache_read_input_tokens ?? 0
      cacheWrite += u.cache_creation_input_tokens ?? 0

      const blocks: Block[] = json.content ?? []
      const toolCalls = blocks.filter((b) => b.type === 'tool_use')

      if (json.stop_reason === 'tool_use' && toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: blocks })
        const results = []
        for (const call of toolCalls) {
          const name = String(call.name)
          const tool = TOOL_BY_NAME.get(name)
          toolsUsed.push(name)
          let payload: unknown
          try {
            payload = tool
              ? await tool.run((call.input ?? {}) as Record<string, unknown>)
              : { error: `Unknown tool ${name}` }
          } catch (e) {
            // A failing tool must not kill the answer — report it and let the model work around it.
            payload = { error: (e as Error).message.slice(0, 200) }
          }
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(payload).slice(0, 12_000),
          })
        }
        messages.push({ role: 'user', content: results })
        continue
      }

      const answer = blocks
        .filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? ''))
        .join('\n')
        .trim()

      await recordLlmCall({
        operation: 'knowledge-base.ask', model: MODEL, source: 'admin',
        tokens: {
          inputTokens, outputTokens,
          cacheReadTokens: cacheRead, cacheCreationTokens: cacheWrite,
        },
        ok: true, latencyMs: Date.now() - startedAt,
      })

      if (!answer) return { ok: false, answer: '', error: 'The model returned an empty answer.' }
      return {
        ok: true,
        answer,
        toolsUsed: [...new Set(toolsUsed)],
        citations: citationsFor(answer),
      }
    }

    return { ok: false, answer: '', error: 'The assistant kept looking things up without answering.' }
  } catch (e) {
    const message = (e as Error).message
    await recordLlmCall({
      operation: 'knowledge-base.ask', model: MODEL, source: 'admin',
      ok: false, error: message.slice(0, 200), latencyMs: Date.now() - startedAt,
    })
    return { ok: false, answer: '', error: message.includes('timed out') ? 'The request timed out.' : message }
  }
}
