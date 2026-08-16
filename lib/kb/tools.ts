import { createServiceClient } from '@/lib/supabase/server'

/**
 * Read-only tools the knowledge-base assistant can call to answer questions about the LIVE system.
 *
 * This is what turns "how does enrichment work" into "why is THIS ticket not enriched".
 *
 * SAFETY MODEL — the assistant never writes, and never composes SQL:
 *  - Every tool is a fixed, hand-written query. The model chooses WHICH tool and supplies typed
 *    arguments; it cannot express an arbitrary statement. There is no execute_sql tool on purpose.
 *  - Every result is bounded (row caps, clamped windows) so a tool call cannot dump a table into
 *    the context or the answer.
 *  - No PII: emails are masked and free-text user content is never selected. A question about a
 *    person is answered with ids and counts, not their data.
 *  - Aggregates go through the Postgres RPCs, never a JS reduce, because PostgREST truncates at
 *    1000 rows and a total computed here would be quietly wrong.
 */

export interface KbTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  run: (input: Record<string, unknown>) => Promise<unknown>
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.trunc(n))) : dflt
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** uuid-only guard: these tools take ids, never free text that could be a search term. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const KB_TOOLS: KbTool[] = [
  {
    name: 'enrichment_backlog',
    description:
      'Current enrichment queue state: job counts grouped by kind and status (pending/done/failed), ' +
      'plus how many failed jobs still have retries left. Use for "is enrichment healthy / backed up".',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const db = createServiceClient()
      const { data } = await db.rpc('kb_enrichment_backlog')
      return data ?? []
    },
  },
  {
    name: 'ticket_enrichment_status',
    description:
      'Why a SPECIFIC ticket is or is not enriched. Returns the ticket\'s category/date/status and ' +
      'every enrichment job row for it (kind, status, attempts, last_error, next_attempt_at). ' +
      'Requires the ticket UUID.',
    input_schema: {
      type: 'object',
      properties: { ticket_id: { type: 'string', description: 'Ticket UUID' } },
      required: ['ticket_id'],
    },
    async run(input) {
      const id = str(input.ticket_id)
      if (!UUID.test(id)) return { error: 'ticket_id must be a UUID.' }
      const db = createServiceClient()
      const { data } = await db.rpc('kb_ticket_enrichment', { p_ticket: id })
      return data ?? { error: 'No ticket found with that id.' }
    },
  },
  {
    name: 'scan_health',
    description:
      'Per-source ingestion health from scan_cron_health: total/ok runs, last run, last success, ' +
      'and whether the scheduler has gone silent for that source. Use for "are inboxes being scanned".',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const db = createServiceClient()
      const { data } = await db
        .from('scan_cron_health')
        .select('source, total_runs, ok_runs, last_run_at, last_ok_at, cron_silent, no_recent_success')
      return data ?? []
    },
  },
  {
    name: 'recent_scan_failures',
    description:
      'Most recent failed scan runs with their outcome and error message, newest first. ' +
      'Use for "why did scanning fail". Errors are credential-safe by construction.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Optional: gmail | imap | forward' },
        limit: { type: 'number', description: 'Rows, 1-20 (default 10)' },
      },
    },
    async run(input) {
      const db = createServiceClient()
      let q = db
        .from('scan_runs')
        .select('source, outcome, started_at, error_message')
        .neq('outcome', 'ok')
        .order('started_at', { ascending: false })
        .limit(clamp(input.limit, 1, 20, 10))
      const source = str(input.source)
      if (['gmail', 'imap', 'forward'].includes(source)) q = q.eq('source', source)
      const { data } = await q
      return data ?? []
    },
  },
  {
    name: 'open_incidents',
    description:
      'Open health incidents (check name, severity, detail, when it opened) plus recent auto-remediation ' +
      'attempts. Use for "what is currently broken / what is alerting".',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const db = createServiceClient()
      // Column names verified against the live schema: health_incidents tracks first_seen_at /
      // last_seen_at (there is no opened_at), and health_remediations uses ran_at (no created_at).
      // A live run caught both as PostgREST 400s — the Supabase client is untyped here, so
      // typecheck cannot.
      const [incidents, remediations] = await Promise.all([
        db.from('health_incidents')
          .select('check_name, severity, detail, first_seen_at, last_seen_at, remediation_count')
          .eq('status', 'open').order('first_seen_at', { ascending: false }).limit(20),
        db.from('health_remediations')
          .select('check_name, action, status, detail, ran_at')
          .order('ran_at', { ascending: false }).limit(10),
      ])
      if (incidents.error) return { error: `health_incidents: ${incidents.error.message}` }
      return { open_incidents: incidents.data ?? [], recent_remediations: remediations.data ?? [] }
    },
  },
  {
    name: 'provider_usage',
    description:
      'External API usage over a window: per-provider call volume, failure count, success rate and ' +
      'p50/p95 latency. Use for "is a provider failing / slow / near quota".',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Window in days, 1-30 (default 7)' } },
    },
    async run(input) {
      const db = createServiceClient()
      const { data } = await db.rpc('get_api_usage_summary', { p_days: clamp(input.days, 1, 30, 7) })
      return data ?? []
    },
  },
  {
    name: 'table_counts',
    description:
      'Row counts for the main app tables (tickets, events, pending_imports, users, enrichment_jobs, ' +
      'and the connection tables). Use for scale questions like "how many tickets are there".',
    input_schema: { type: 'object', properties: {} },
    async run() {
      const db = createServiceClient()
      const { data } = await db.rpc('kb_table_counts')
      return data ?? []
    },
  },
]

export const TOOL_BY_NAME = new Map(KB_TOOLS.map((t) => [t.name, t]))

/** The Anthropic tool definitions (schema only — `run` stays server-side). */
export const anthropicToolDefs = () =>
  KB_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }))
