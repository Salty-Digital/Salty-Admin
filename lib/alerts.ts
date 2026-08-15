import { createServiceClient } from '@/lib/supabase/server'
import { sendHtmlEmail } from '@/lib/email'
import type { Check, HealthReport, Status } from '@/lib/health'

/**
 * Incident lifecycle and cascading notification for the health checks.
 *
 * The rule that makes this usable rather than noisy: **alerts fire on state transitions,
 * not on state.** A check that has been down for six hours produced one tier-1 email when
 * it broke, one tier-2 email when it stayed broken past the escalation window, and one
 * "recovered" email at the end — not one per cron tick.
 *
 * Tier 1 is the first responder (Rahul). Tier 2 is pulled in only when tier 1 hasn't
 * cleared the incident within `escalate_after_minutes` — the "what if he's travelling"
 * case from the 8/15 review.
 */

export interface AlertSettings {
  notify_enabled: boolean
  escalate_after_minutes: number
  notify_min_severity: 'warn' | 'down'
  remediation_enabled: boolean
  max_remediation_attempts: number
  ai_triage_enabled: boolean
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  notify_enabled: true,
  escalate_after_minutes: 30,
  notify_min_severity: 'down',
  remediation_enabled: false,
  max_remediation_attempts: 3,
  ai_triage_enabled: false,
}

export interface Incident {
  id: string
  check_name: string
  severity: 'warn' | 'down'
  status: 'open' | 'resolved'
  detail: string | null
  first_seen_at: string
  last_seen_at: string
  resolved_at: string | null
  notified_tier1_at: string | null
  notified_tier2_at: string | null
  resolved_notified_at: string | null
  remediation_count: number
}

export interface AlertContact {
  id: string
  email: string
  name: string | null
  tier: number
  is_active: boolean
}

const SEVERITY_RANK: Record<'warn' | 'down', number> = { warn: 1, down: 2 }

export async function getAlertSettings(): Promise<AlertSettings> {
  const db = createServiceClient()
  const { data } = await db.from('alert_settings').select('*').eq('id', 1).maybeSingle()
  return { ...DEFAULT_ALERT_SETTINGS, ...(data ?? {}) } as AlertSettings
}

export async function getAlertContacts(): Promise<AlertContact[]> {
  const db = createServiceClient()
  const { data } = await db
    .from('alert_contacts')
    .select('id, email, name, tier, is_active')
    .order('tier')
    .order('email')
  return (data ?? []) as AlertContact[]
}

export async function getOpenIncidents(): Promise<Incident[]> {
  const db = createServiceClient()
  const { data } = await db
    .from('health_incidents')
    .select('*')
    .eq('status', 'open')
    .order('first_seen_at', { ascending: false })
  return (data ?? []) as Incident[]
}

export async function getRecentIncidents(limit = 25): Promise<Incident[]> {
  const db = createServiceClient()
  const { data } = await db
    .from('health_incidents')
    .select('*')
    .order('first_seen_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as Incident[]
}

/**
 * Reconcile the current check results against the open incidents.
 *
 * Advisory checks are deliberately excluded: a warning that an optional integration key
 * isn't set is a to-do, not an incident, and paging someone about it at 3am would train
 * everyone to ignore the alerts.
 */
export async function reconcileIncidents(report: HealthReport): Promise<{
  opened: Incident[]
  stillOpen: Incident[]
  resolved: Incident[]
}> {
  const db = createServiceClient()
  const open = await getOpenIncidents()
  const byName = new Map(open.map((i) => [i.check_name, i]))

  const failing = report.checks.filter(
    (c): c is Check & { status: 'warn' | 'down' } => c.status !== 'ok' && !c.advisory,
  )
  const failingNames = new Set(failing.map((c) => c.name))

  const opened: Incident[] = []
  const stillOpen: Incident[] = []

  for (const check of failing) {
    const existing = byName.get(check.name)
    if (!existing) {
      const { data } = await db
        .from('health_incidents')
        .insert({ check_name: check.name, severity: check.status, detail: check.detail })
        .select('*')
        .single()
      if (data) opened.push(data as Incident)
      continue
    }

    // A warn that deteriorates into a down is a new fact worth re-sending, so clear the
    // tier-1 stamp and let the notify pass treat it as fresh.
    const escalatedSeverity = SEVERITY_RANK[check.status] > SEVERITY_RANK[existing.severity]
    const { data } = await db
      .from('health_incidents')
      .update({
        severity: check.status,
        detail: check.detail,
        last_seen_at: new Date().toISOString(),
        ...(escalatedSeverity ? { notified_tier1_at: null, notified_tier2_at: null } : {}),
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (data) stillOpen.push(data as Incident)
  }

  // Anything open that no longer appears in the failing set has recovered.
  const recovering = open.filter((i) => !failingNames.has(i.check_name))
  const resolved: Incident[] = []
  for (const inc of recovering) {
    const { data } = await db
      .from('health_incidents')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', inc.id)
      .select('*')
      .single()
    if (data) resolved.push(data as Incident)
  }

  return { opened, stillOpen, resolved }
}

/** How long an incident has been open, as a human phrase. */
function openFor(inc: Incident): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(inc.first_seen_at)) / 60_000))
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/**
 * Internal ops email. Deliberately NOT the branded consumer template — that one carries
 * an unsubscribe link and a "you're receiving this because you have a Salty account"
 * footer, both of which are wrong (and, for the unsubscribe, dangerous) on an alert.
 */
function renderAlertEmail(input: {
  headline: string
  tone: 'down' | 'warn' | 'ok'
  incidents: Incident[]
  note?: string
  dashboardUrl: string
}): { html: string; text: string } {
  const color = { down: '#BF4A3A', warn: '#8A6830', ok: '#3E8A5A' }[input.tone]
  const rows = input.incidents
    .map(
      (i) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e9e5df;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
          <div style="font-size:14px;font-weight:600;color:#2b2b2b;">${escape(i.check_name)}
            <span style="font-size:11px;font-weight:700;color:${i.severity === 'down' ? '#BF4A3A' : '#8A6830'};text-transform:uppercase;">&nbsp;${i.severity}</span>
          </div>
          <div style="font-size:12.5px;color:#6b6b6b;margin-top:2px;">${escape(i.detail ?? '')}</div>
          <div style="font-size:11.5px;color:#9a9a9a;margin-top:2px;">open for ${openFor(i)}</div>
        </td>
      </tr>`,
    )
    .join('')

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f2;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b;">
  <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:#E8581A;">SALTY · OPS</div>
  <h1 style="font-size:19px;font-weight:700;margin:14px 0 6px;color:${color};">${escape(input.headline)}</h1>
  ${input.note ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#4a4a4a;">${escape(input.note)}</p>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e9e5df;border-radius:10px;background:#fff;border-collapse:separate;">
    ${rows}
  </table>
  <p style="margin:20px 0 0;font-size:13px;">
    <a href="${input.dashboardUrl}" style="color:#E8581A;font-weight:600;">Open the health dashboard →</a>
  </p>
  <p style="margin:22px 0 0;font-size:11.5px;color:#9a9a9a;">
    Automated alert from the Salty admin panel. Recipients are managed on Settings → Alerts.
  </p>
</div></body></html>`

  const text = [
    `SALTY · OPS`,
    input.headline,
    input.note ?? '',
    '',
    ...input.incidents.map((i) => `- [${i.severity.toUpperCase()}] ${i.check_name}: ${i.detail ?? ''} (open ${openFor(i)})`),
    '',
    `Health dashboard: ${input.dashboardUrl}`,
  ]
    .filter(Boolean)
    .join('\n')

  return { html, text }
}

function escape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function dashboardUrl() {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? ''
  return `${base}/health`
}

async function notify(contacts: AlertContact[], subject: string, body: { html: string; text: string }) {
  const results = await Promise.allSettled(
    contacts.map((c) => sendHtmlEmail(c.email, subject, body.html, { text: body.text })),
  )
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length) {
    console.error('[alerts] failed to notify', failed.length, 'of', contacts.length, 'contacts')
  }
  return results.length - failed.length
}

export interface NotifyOutcome {
  tier1Sent: number
  tier2Sent: number
  resolvedSent: number
  skippedReason?: string
}

/**
 * Send whatever this tick's reconciliation warrants. Idempotent: each incident carries the
 * timestamps of what has already been sent, so re-running the cron is harmless.
 */
export async function dispatchAlerts(
  reconciled: { opened: Incident[]; stillOpen: Incident[]; resolved: Incident[] },
  settings: AlertSettings,
): Promise<NotifyOutcome> {
  const out: NotifyOutcome = { tier1Sent: 0, tier2Sent: 0, resolvedSent: 0 }
  if (!settings.notify_enabled) return { ...out, skippedReason: 'notifications disabled in settings' }
  if (!process.env.RESEND_API_KEY) return { ...out, skippedReason: 'RESEND_API_KEY not set' }

  const db = createServiceClient()
  const contacts = (await getAlertContacts()).filter((c) => c.is_active)
  const tier1 = contacts.filter((c) => c.tier === 1)
  const tier2 = contacts.filter((c) => c.tier === 2)
  if (contacts.length === 0) return { ...out, skippedReason: 'no active alert contacts configured' }

  const minRank = SEVERITY_RANK[settings.notify_min_severity]
  const alertable = (i: Incident) => SEVERITY_RANK[i.severity] >= minRank
  const url = dashboardUrl()
  const now = new Date().toISOString()

  // ── New (or newly-worsened) incidents → tier 1 ──
  const fresh = [...reconciled.opened, ...reconciled.stillOpen].filter(
    (i) => alertable(i) && !i.notified_tier1_at,
  )
  if (fresh.length && tier1.length) {
    const worst = fresh.some((i) => i.severity === 'down') ? 'down' : 'warn'
    const headline = worst === 'down'
      ? `${fresh.length === 1 ? fresh[0].check_name : `${fresh.length} checks`} — DOWN`
      : `${fresh.length === 1 ? fresh[0].check_name : `${fresh.length} checks`} — degraded`
    const body = renderAlertEmail({ headline, tone: worst, incidents: fresh, dashboardUrl: url })
    out.tier1Sent = await notify(tier1, `[Salty] ${headline}`, body)
    if (out.tier1Sent > 0) {
      await db.from('health_incidents').update({ notified_tier1_at: now }).in('id', fresh.map((i) => i.id))
    }
  }

  // ── Still open past the escalation window → tier 2 ──
  const cutoff = Date.now() - settings.escalate_after_minutes * 60_000
  const stale = reconciled.stillOpen.filter(
    (i) => alertable(i) && i.notified_tier1_at && !i.notified_tier2_at && Date.parse(i.first_seen_at) <= cutoff,
  )
  if (stale.length && tier2.length) {
    const headline = `Unresolved for ${settings.escalate_after_minutes}+ min — escalating`
    const body = renderAlertEmail({
      headline,
      tone: stale.some((i) => i.severity === 'down') ? 'down' : 'warn',
      incidents: stale,
      note: `These checks were reported to the on-call engineer and are still failing after ${settings.escalate_after_minutes} minutes.`,
      dashboardUrl: url,
    })
    out.tier2Sent = await notify(tier2, `[Salty] ESCALATION — ${headline}`, body)
    if (out.tier2Sent > 0) {
      await db.from('health_incidents').update({ notified_tier2_at: now }).in('id', stale.map((i) => i.id))
    }
  }

  // ── Recovered → tell whoever was told it broke ──
  const recovered = reconciled.resolved.filter((i) => i.notified_tier1_at && !i.resolved_notified_at)
  if (recovered.length) {
    const audience = [...tier1, ...(recovered.some((i) => i.notified_tier2_at) ? tier2 : [])]
    const headline = `Recovered — ${recovered.length === 1 ? recovered[0].check_name : `${recovered.length} checks`}`
    const body = renderAlertEmail({ headline, tone: 'ok', incidents: recovered, dashboardUrl: url })
    out.resolvedSent = await notify(audience, `[Salty] ${headline}`, body)
    if (out.resolvedSent > 0) {
      await db.from('health_incidents').update({ resolved_notified_at: now }).in('id', recovered.map((i) => i.id))
    }
  }

  return out
}

/** Severity of the worst currently-open incident, for badges. */
export function worstSeverity(incidents: Incident[]): Status {
  if (incidents.some((i) => i.severity === 'down')) return 'down'
  if (incidents.length > 0) return 'warn'
  return 'ok'
}
