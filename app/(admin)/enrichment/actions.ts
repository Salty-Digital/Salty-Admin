'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertEnum } from '@/lib/validate'
import { ENRICHMENT_KINDS } from './kinds'

type Result = { ok: true; count?: number } | { ok: false; error: string }

/** Re-queue a single failed/stuck job: back to pending, due now, error cleared. Admin+. */
export async function retryJobAction(ticketId: string, kind: string): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const k = assertEnum(kind, ENRICHMENT_KINDS, 'Kind')
    const db = createServiceClient()
    const { error } = await db
      .from('enrichment_jobs')
      .update({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null })
      .eq('ticket_id', tid)
      .eq('kind', k)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'retry_enrichment_job', 'enrichment_job', tid, { kind: k })
    revalidatePath('/enrichment')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Re-queue every failed job of a kind (e.g. the 35 failed geocodes). Admin+. */
export async function retryFailedKindAction(kind: string): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const k = assertEnum(kind, ENRICHMENT_KINDS, 'Kind')
    const db = createServiceClient()
    const { data, error } = await db
      .from('enrichment_jobs')
      .update({ status: 'pending', next_attempt_at: new Date().toISOString(), last_error: null })
      .eq('kind', k)
      .eq('status', 'failed')
      .select('ticket_id')
    if (error) return { ok: false, error: error.message }
    const count = data?.length ?? 0
    await logAudit(admin.id, 'retry_failed_enrichment_kind', 'enrichment_job', undefined, { kind: k, count })
    revalidatePath('/enrichment')
    return { ok: true, count }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Kick the enrichment-worker immediately instead of waiting for the 10-minute cron. Admin+. */
export async function triggerWorkerAction(): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const db = createServiceClient()
    const { error } = await db.rpc('trigger_enrichment_worker')
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'trigger_enrichment_worker', 'enrichment_job', undefined)
    revalidatePath('/enrichment')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Re-key fuzzy events that now carry a trusted strong id, merging duplicates. Admin+. */
export async function runReconcileAction(): Promise<{ ok: boolean; rekeyed?: number; merged?: number; error?: string }> {
  try {
    const admin = await requireAdmin(2)
    const db = createServiceClient()
    const { data, error } = await db.rpc('reconcile_event_strong_ids', { p_limit: 200 })
    if (error) return { ok: false, error: error.message }
    const row = Array.isArray(data) ? data[0] : data
    const rekeyed = Number(row?.rekeyed ?? 0)
    const merged = Number(row?.merged ?? 0)
    await logAudit(admin.id, 'reconcile_event_strong_ids', 'event', undefined, { rekeyed, merged })
    revalidatePath('/enrichment')
    revalidatePath('/data-quality')
    revalidatePath('/events')
    return { ok: true, rekeyed, merged }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
