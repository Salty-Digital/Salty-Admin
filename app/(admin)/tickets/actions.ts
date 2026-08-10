'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString, assertEnum } from '@/lib/validate'
import { TICKET_CATEGORIES } from '@/lib/categories'

export async function editTicketAction(
  ticketId: string,
  fields: { title?: string; venue_name?: string; date_str?: string; time_str?: string; category?: string },
) {
  const admin = await requireAdmin(3)
  const tid   = assertUUID(ticketId, 'Ticket ID')
  const db    = createServiceClient()

  // Verify ticket exists
  const { data: ticket } = await db.from('tickets').select('id').eq('id', tid).single()
  if (!ticket) throw new Error('Ticket not found.')

  // Sanitize every field that was provided
  const sanitized: Record<string, string> = {}
  if (fields.title     !== undefined) sanitized.title      = assertString(fields.title, 'Title', 300)
  if (fields.venue_name !== undefined) sanitized.venue_name = assertString(fields.venue_name, 'Venue', 300)
  if (fields.date_str  !== undefined) sanitized.date_str   = assertString(fields.date_str, 'Date', 50)
  if (fields.time_str  !== undefined) sanitized.time_str   = assertString(fields.time_str, 'Time', 20)
  if (fields.category  !== undefined) sanitized.category   = assertEnum(fields.category, TICKET_CATEGORIES, 'Category')

  if (Object.keys(sanitized).length === 0) throw new Error('No fields to update.')

  await db.from('tickets').update(sanitized).eq('id', tid)
  await logAudit(admin.id, 'edit_ticket', 'ticket', tid, sanitized)
  revalidatePath('/tickets')
}

export async function deleteTicketAction(ticketId: string) {
  const admin = await requireAdmin(2)
  const tid   = assertUUID(ticketId, 'Ticket ID')
  const db    = createServiceClient()

  const { data: ticket } = await db.from('tickets').select('id, title, user_id').eq('id', tid).single()
  if (!ticket) throw new Error('Ticket not found.')

  await db.from('tickets').delete().eq('id', tid)
  await logAudit(admin.id, 'delete_ticket', 'ticket', tid, { title: ticket.title, user_id: ticket.user_id })
  revalidatePath('/tickets')
}

// ── Bulk actions ─────────────────────────────────────────────────────────────────
const TICKET_STATUSES = ['active', 'archived', 'pending'] as const
type BulkResult = { ok: true; count: number } | { ok: false; error: string }

function cleanIds(ticketIds: string[]): string[] {
  return [...new Set(ticketIds.map((id) => assertUUID(id, 'Ticket ID')))].slice(0, 1000)
}

export async function bulkSetCategoryAction(ticketIds: string[], category: string): Promise<BulkResult> {
  try {
    const admin = await requireAdmin(3)
    const cat = assertEnum(category, TICKET_CATEGORIES, 'Category')
    const ids = cleanIds(ticketIds)
    if (ids.length === 0) return { ok: true, count: 0 }
    const db = createServiceClient()
    const { error } = await db.from('tickets').update({ category: cat }).in('id', ids)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'bulk_set_category', 'ticket', undefined, { count: ids.length, category: cat })
    revalidatePath('/tickets')
    return { ok: true, count: ids.length }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function bulkSetStatusAction(ticketIds: string[], status: string): Promise<BulkResult> {
  try {
    const admin = await requireAdmin(3)
    const st = assertEnum(status, TICKET_STATUSES, 'Status')
    const ids = cleanIds(ticketIds)
    if (ids.length === 0) return { ok: true, count: 0 }
    const db = createServiceClient()
    const { error } = await db.from('tickets').update({ status: st }).in('id', ids)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'bulk_set_status', 'ticket', undefined, { count: ids.length, status: st })
    revalidatePath('/tickets')
    return { ok: true, count: ids.length }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}

export async function bulkDeleteTicketsAction(ticketIds: string[]): Promise<BulkResult> {
  try {
    const admin = await requireAdmin(2)
    const ids = cleanIds(ticketIds)
    if (ids.length === 0) return { ok: true, count: 0 }
    const db = createServiceClient()
    const { error } = await db.from('tickets').delete().in('id', ids)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'bulk_delete_tickets', 'ticket', undefined, { count: ids.length })
    revalidatePath('/tickets')
    return { ok: true, count: ids.length }
  } catch (e) { return { ok: false, error: (e as Error).message } }
}
