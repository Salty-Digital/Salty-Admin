import { runHealthChecks, type HealthReport } from '@/lib/health'
import {
  reconcileIncidents,
  dispatchAlerts,
  getAlertSettings,
  getOpenIncidents,
  type Incident,
  type NotifyOutcome,
} from '@/lib/alerts'
import { runRemediations, type RemediationOutcome } from '@/lib/remediation'

/**
 * One full monitoring cycle: check → reconcile → remediate → verify → notify.
 *
 * Shared by the cron route and the "Run now" button on /health so both do exactly the
 * same thing. The ordering matters: remediation runs *before* notification, and a
 * verification pass re-reconciles afterwards. A transient blip that auto-heals within the
 * cycle therefore resolves silently — nobody is emailed about a problem that no longer
 * exists by the time the email would have been sent.
 */

export interface CycleResult {
  report: HealthReport
  opened: Incident[]
  stillOpen: Incident[]
  resolved: Incident[]
  remediations: RemediationOutcome[]
  notifications: NotifyOutcome
  verified: boolean
  durationMs: number
}

export async function runHealthCycle(): Promise<CycleResult> {
  const t0 = Date.now()
  const settings = await getAlertSettings()

  const report = await runHealthChecks()
  let reconciled = await reconcileIncidents(report)

  // Remediate everything currently open (including incidents that pre-date this run —
  // a check that has been failing for an hour still deserves a retry attempt).
  const openNow = await getOpenIncidents()
  const remediations = await runRemediations(openNow, settings, report)

  // Verification pass. Only worth the second round-trip if something actually changed
  // state; a run of pure `verify_only` outcomes still counts, since that action exists
  // precisely to distinguish a transient blip from a real failure.
  const actedOn = remediations.some((r) => r.status === 'succeeded')
  let finalReport = report
  let verified = false
  if (actedOn) {
    finalReport = await runHealthChecks()
    reconciled = await reconcileIncidents(finalReport)
    verified = true
  }

  const notifications = await dispatchAlerts(reconciled, settings)

  return {
    report: finalReport,
    ...reconciled,
    remediations,
    notifications,
    verified,
    durationMs: Date.now() - t0,
  }
}
