import { createServiceClient } from '@/lib/supabase/server'
import { runLadder } from '@/lib/llm/ladder'
import type { Incident, AlertSettings } from '@/lib/alerts'
import type { HealthReport } from '@/lib/health'

/**
 * Auto-remediation for health incidents.
 *
 * The safety property that makes this acceptable against production: **the model never
 * writes an action, it only chooses one from the allow-list below.** Every entry is a
 * bounded, reversible operation that a human would run from the admin panel anyway. An
 * LLM that returns anything not in this list is ignored and the incident escalates to a
 * person instead.
 *
 * Deterministic rules run first and cover the cases we already understand. The model tier
 * (lib/llm/ladder.ts) is only consulted for incidents with no matching rule, and only when
 * `ai_triage_enabled` is on — so the common path costs nothing and behaves identically
 * every time.
 */

export type RemediationAction =
  | 'retry_failed_enrichment_jobs'
  | 'verify_only'
  | 'none'

interface Runbook {
  action: RemediationAction
  /** Shown to the model when it picks, and to admins in the remediation log. */
  description: string
  /** Which check names this rule is allowed to act on. */
  appliesTo: (checkName: string) => boolean
  run: (incident: Incident) => Promise<{ ok: boolean; detail: string }>
}

// Keep in sync with EDGE_FUNCTIONS in lib/health.ts — this gates whether the verify_only runbook
// applies to a check name, so a function present there but missing here has no runbook.
const EDGE_FUNCTION_HINT = /^(sports-score-lookup|enrich-cast|enrich-lineup|setlist-lookup|geocode-venues|config-status)$/

export const RUNBOOKS: Runbook[] = [
  {
    action: 'retry_failed_enrichment_jobs',
    description:
      'Requeue failed enrichment jobs that still have retries left (status failed → pending, ' +
      'clears last_error). Jobs past max_attempts are left alone — their input is bad, so a ' +
      'retry reproduces the identical failure.',
    appliesTo: (name) => name === 'Enrichment backlog',
    run: async () => {
      const db = createServiceClient()

      // Only jobs with retries remaining. PostgREST can't compare two columns, so partition
      // client-side — the failed set is small by construction.
      //
      // This guard is load-bearing, not defensive. Requeuing exhausted jobs sends them
      // straight back through the worker to fail again, which drops the failure count below
      // the alert threshold just long enough to fire a "recovered" email before the count
      // climbs back. That is an alert-flap loop, and it is exactly what happened on
      // 2026-08-15 with 36 geocode jobs sitting at attempts 5-6 of 4.
      const { data: failed, error: readErr } = await db
        .from('enrichment_jobs')
        .select('ticket_id, kind, attempts, max_attempts')
        .eq('status', 'failed')
        .limit(1000)
      if (readErr) return { ok: false, detail: readErr.message }

      const rows = failed ?? []
      const retryable = rows.filter((r) => (r.attempts ?? 0) < (r.max_attempts ?? 0))
      const exhausted = rows.length - retryable.length

      if (retryable.length === 0) {
        return {
          ok: false,
          detail:
            `nothing to retry — all ${rows.length} failed job(s) are past max_attempts. ` +
            `These need a data fix (unresolvable venue strings), not a retry.`,
        }
      }

      const { data, error } = await db
        .from('enrichment_jobs')
        .update({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null })
        .eq('status', 'failed')
        .in('ticket_id', retryable.map((r) => r.ticket_id))
        .select('ticket_id')
      if (error) return { ok: false, detail: error.message }
      const suffix = exhausted ? `; left ${exhausted} dead-lettered job(s) alone` : ''
      return { ok: true, detail: `requeued ${(data ?? []).length} retryable job(s)${suffix}` }
    },
  },
  {
    action: 'verify_only',
    description:
      'Re-run the health checks to confirm the failure is real rather than a transient ' +
      'network blip or a cold edge function. Changes no state.',
    appliesTo: (name) =>
      EDGE_FUNCTION_HINT.test(name) ||
      name === 'Database (Postgres)' ||
      name === 'Auth (GoTrue)' ||
      name === 'Mobile config bridge',
    run: async () => ({ ok: true, detail: 'no state changed — verification pass will confirm' }),
  },
]

const ACTION_BY_NAME = new Map(RUNBOOKS.map((r) => [r.action, r]))

/** The rule that matches this check, if we already know what to do about it. */
function pickDeterministicAction(checkName: string): Runbook | null {
  return RUNBOOKS.find((r) => r.appliesTo(checkName)) ?? null
}

/**
 * Ask the model ladder which allow-listed action fits an incident we have no rule for.
 * Returns null when no tier answers or the answer isn't in the allow-list.
 */
async function pickAiAction(incident: Incident): Promise<{ runbook: Runbook; reason: string; tier: number; provider: string } | null> {
  const catalogue = RUNBOOKS.map((r) => `- ${r.action}: ${r.description}`).join('\n')
  const prompt = [
    'You are triaging a failing health check on a production web application.',
    '',
    `Check: ${incident.check_name}`,
    `Severity: ${incident.severity}`,
    `Detail: ${incident.detail ?? '(none)'}`,
    `First seen: ${incident.first_seen_at}`,
    '',
    'You may choose exactly one of these actions, or "none":',
    catalogue,
    '- none: nothing here can safely fix it; a human must look.',
    '',
    'Choose "none" unless an action clearly addresses this specific failure. Choosing a ' +
      'wrong action is worse than choosing none.',
  ].join('\n')

  const schemaHint =
    'Respond with JSON: {"action": "<one of the action names above or none>", "reason": "<one short sentence>"}'

  const result = await runLadder<{ action: RemediationAction; reason: string }>({
    prompt,
    schemaHint,
    operation: 'ops.remediation-triage',
    validate: (value) => {
      const v = value as { action?: unknown; reason?: unknown }
      const action = typeof v.action === 'string' ? v.action : ''
      // The allow-list check. Anything else the model invented is discarded here.
      if (action !== 'none' && !ACTION_BY_NAME.has(action as RemediationAction)) return null
      return { action: action as RemediationAction, reason: String(v.reason ?? '').slice(0, 300) }
    },
  })

  if (!('tier' in result) || !result.value || result.value.action === 'none') return null
  const runbook = ACTION_BY_NAME.get(result.value.action)
  if (!runbook) return null
  return { runbook, reason: result.value.reason, tier: result.tier.tier, provider: result.tier.provider }
}

export interface RemediationOutcome {
  incidentId: string
  checkName: string
  action: RemediationAction
  decidedBy: string
  status: 'succeeded' | 'failed' | 'skipped'
  detail: string
}

/**
 * Attempt remediation on the currently-open incidents.
 *
 * Bounded by `max_remediation_attempts` per incident so a permanently broken check can't
 * loop forever — after that it's a human's problem, which is what the escalation email says.
 */
export async function runRemediations(
  incidents: Incident[],
  settings: AlertSettings,
  _report: HealthReport,
): Promise<RemediationOutcome[]> {
  if (!settings.remediation_enabled) return []
  const db = createServiceClient()
  const outcomes: RemediationOutcome[] = []

  for (const incident of incidents) {
    if (incident.remediation_count >= settings.max_remediation_attempts) continue

    let runbook = pickDeterministicAction(incident.check_name)
    let decidedBy = 'runbook'
    let reason = ''

    if (!runbook && settings.ai_triage_enabled) {
      const ai = await pickAiAction(incident)
      if (ai) {
        runbook = ai.runbook
        decidedBy = `ai:tier${ai.tier}:${ai.provider}`
        reason = ai.reason
      }
    }

    if (!runbook) {
      outcomes.push({
        incidentId: incident.id,
        checkName: incident.check_name,
        action: 'none',
        decidedBy,
        status: 'skipped',
        detail: 'no runbook matches this check',
      })
      continue
    }

    let status: RemediationOutcome['status']
    let detail: string
    try {
      const result = await runbook.run(incident)
      status = result.ok ? 'succeeded' : 'failed'
      detail = reason ? `${reason} — ${result.detail}` : result.detail
    } catch (e) {
      status = 'failed'
      detail = (e as Error).message.slice(0, 500)
    }

    await db.from('health_remediations').insert({
      incident_id: incident.id,
      check_name: incident.check_name,
      action: runbook.action,
      decided_by: decidedBy,
      status,
      detail,
    })
    await db
      .from('health_incidents')
      .update({ remediation_count: incident.remediation_count + 1 })
      .eq('id', incident.id)

    outcomes.push({
      incidentId: incident.id,
      checkName: incident.check_name,
      action: runbook.action,
      decidedBy,
      status,
      detail,
    })
  }

  return outcomes
}

export interface RemediationRow {
  id: string
  check_name: string
  action: string
  decided_by: string
  status: string
  detail: string | null
  ran_at: string
}

export async function getRecentRemediations(limit = 20): Promise<RemediationRow[]> {
  const db = createServiceClient()
  const { data } = await db
    .from('health_remediations')
    .select('id, check_name, action, decided_by, status, detail, ran_at')
    .order('ran_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as RemediationRow[]
}
