'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID } from '@/lib/validate'
import { isKnownCategory } from '@/lib/categories'

export async function approveImportAction(importId: string) {
  const admin = await requireAdmin(2)
  const iid   = assertUUID(importId, 'Import ID')
  const db    = createServiceClient()

  const { data: imp } = await db
    .from('pending_imports')
    .select('id, user_id, raw_data, confidence, status, source')
    .eq('id', iid)
    .single()

  if (!imp) throw new Error('Import not found.')
  if (imp.status !== 'pending') throw new Error('Import is not in pending state.')

  const raw = imp.raw_data as Record<string, unknown>

  await db.from('tickets').insert({
    user_id:    assertUUID(imp.user_id, 'User ID'),
    title:      typeof raw.title === 'string' ? raw.title.slice(0, 300) : null,
    venue_name: typeof raw.venue === 'string' ? raw.venue.slice(0, 300) : null,
    date_str:   typeof raw.date === 'string'  ? raw.date.slice(0, 50)   : null,
    time_str:   typeof raw.time === 'string'  ? raw.time.slice(0, 20)   : null,
    seat:       typeof raw.seat === 'string'  ? raw.seat.slice(0, 100)  : null,
    category:   isKnownCategory(raw.category) ? raw.category : 'other',
    tint:       typeof raw.tint === 'string'  ? raw.tint : '#b0b8e0',
    image_url:  typeof raw.image_url === 'string' ? raw.image_url : '',
    confidence: imp.confidence,
    source:     typeof imp.source === 'string' && imp.source ? imp.source : 'gmail',
    status:     'active',
    is_past:    false,
  })

  await db.from('pending_imports').update({ status: 'approved' }).eq('id', iid)
  await logAudit(admin.id, 'approve_import', 'pending_import', iid, { user_id: imp.user_id })
  revalidatePath('/pending-imports')
}

export async function rejectImportAction(importId: string) {
  const admin = await requireAdmin(2)
  const iid   = assertUUID(importId, 'Import ID')
  const db    = createServiceClient()

  const { data: imp } = await db
    .from('pending_imports')
    .select('id, status')
    .eq('id', iid)
    .single()

  if (!imp) throw new Error('Import not found.')
  if (imp.status !== 'pending') throw new Error('Import is not in pending state.')

  await db.from('pending_imports').update({ status: 'rejected' }).eq('id', iid)
  await logAudit(admin.id, 'reject_import', 'pending_import', iid)
  revalidatePath('/pending-imports')
}

export async function bulkApproveAction(importIds: string[]) {
  const admin = await requireAdmin(2)
  if (!Array.isArray(importIds) || importIds.length === 0) throw new Error('No import IDs provided.')

  const ids = importIds.map(id => assertUUID(id, 'Import ID'))
  const db  = createServiceClient()

  const { data: imports } = await db
    .from('pending_imports')
    .select('id, user_id, raw_data, confidence, status, source')
    .in('id', ids)
    .eq('status', 'pending')

  if (!imports || imports.length === 0) throw new Error('No pending imports found.')

  const tickets = (imports as Array<{ id: string; user_id: string; raw_data: Record<string, unknown>; confidence: number; source: string | null }>).map(imp => {
    const raw = imp.raw_data
    return {
      user_id:    assertUUID(imp.user_id, 'User ID'),
      title:      typeof raw.title === 'string' ? raw.title.slice(0, 300) : null,
      venue_name: typeof raw.venue === 'string' ? raw.venue.slice(0, 300) : null,
      date_str:   typeof raw.date === 'string'  ? raw.date.slice(0, 50)   : null,
      time_str:   typeof raw.time === 'string'  ? raw.time.slice(0, 20)   : null,
      seat:       typeof raw.seat === 'string'  ? raw.seat.slice(0, 100)  : null,
      category:   isKnownCategory(raw.category) ? raw.category : 'other',
      tint:       typeof raw.tint === 'string'  ? raw.tint : '#b0b8e0',
      image_url:  typeof raw.image_url === 'string' ? raw.image_url : '',
      confidence: imp.confidence,
      source:     typeof imp.source === 'string' && imp.source ? imp.source : 'gmail',
      status:     'active',
      is_past:    false,
    }
  })

  await db.from('tickets').insert(tickets)
  await db.from('pending_imports').update({ status: 'approved' }).in('id', ids)
  await logAudit(admin.id, 'bulk_approve_imports', 'pending_import', undefined, { count: ids.length })
  revalidatePath('/pending-imports')
}

export async function bulkRejectAction(importIds: string[]) {
  const admin = await requireAdmin(2)
  if (!Array.isArray(importIds) || importIds.length === 0) throw new Error('No import IDs provided.')

  const ids = importIds.map(id => assertUUID(id, 'Import ID'))
  const db  = createServiceClient()

  await db.from('pending_imports').update({ status: 'rejected' }).in('id', ids).eq('status', 'pending')
  await logAudit(admin.id, 'bulk_reject_imports', 'pending_import', undefined, { count: ids.length })
  revalidatePath('/pending-imports')
}
