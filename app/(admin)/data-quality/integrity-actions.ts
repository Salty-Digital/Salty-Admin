'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertEnum } from '@/lib/validate'

const STRONG_ID_FIELDS = ['setlistfm_id', 'sport_api_id', 'phishnet_show_id'] as const

/** Link an unresolved ticket to its canonical event via resolve_event_for_ticket. Admin+. */
export async function resolveTicketAction(ticketId: string): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const { data, error } = await db.rpc('resolve_event_for_ticket', { p_ticket: tid })
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'resolve_event_for_ticket', 'ticket', tid, { event_id: data ?? null })
    revalidatePath('/data-quality')
    revalidatePath('/events')
    return { ok: true, eventId: (data as string) ?? undefined }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Null a corrupt strong id on a single event so it stops colliding across events. Reversible —
 * the worker re-derives ids on the next verify pass. Admin+, audited.
 */
export async function clearEventStrongIdAction(eventId: string, field: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin(2)
    const id = assertUUID(eventId, 'Event ID')
    const f = assertEnum(field, STRONG_ID_FIELDS, 'Strong-ID field')
    const db = createServiceClient()
    const { error } = await db.from('events').update({ [f]: null }).eq('id', id)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'clear_event_strong_id', 'event', id, { field: f })
    revalidatePath('/data-quality')
    revalidatePath(`/events/canonical/${id}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
