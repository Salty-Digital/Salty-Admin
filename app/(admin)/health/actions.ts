'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { runHealthCycle } from '@/lib/ops-cycle'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Run a full monitoring cycle on demand — the same path the cron takes, so the button
 * proves the scheduled job works rather than exercising a separate code path.
 */
export async function runCycleNow(): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const admin = await requireAdmin(1)
    const result = await runHealthCycle()
    await logAudit(admin.id, 'health_cycle_run', 'health', undefined, {
      overall: result.report.overall,
      opened: result.opened.length,
      resolved: result.resolved.length,
      remediations: result.remediations.length,
    })

    const parts = [`status: ${result.report.overall}`]
    if (result.opened.length) parts.push(`${result.opened.length} opened`)
    if (result.resolved.length) parts.push(`${result.resolved.length} resolved`)
    if (result.remediations.length) parts.push(`${result.remediations.length} remediation(s)`)
    const notified = result.notifications.tier1Sent + result.notifications.tier2Sent + result.notifications.resolvedSent
    if (notified) parts.push(`${notified} email(s) sent`)
    else if (result.notifications.skippedReason) parts.push(`no email — ${result.notifications.skippedReason}`)

    revalidatePath('/health')
    return { ok: true, summary: parts.join(' · ') }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Close an incident by hand — for the case where an admin fixed the underlying problem
 * out-of-band and doesn't want it counting against the escalation clock.
 */
export async function resolveIncident(incidentId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin(1)
    const db = createServiceClient()
    const { error } = await db
      .from('health_incidents')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', incidentId)
      .eq('status', 'open')
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'health_incident_resolved', 'health_incident', incidentId)
    revalidatePath('/health')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
