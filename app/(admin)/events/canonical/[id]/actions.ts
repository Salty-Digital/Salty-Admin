'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID } from '@/lib/validate'

export interface EventPreview {
  id: string
  name: string | null
  event_key: string | null
  event_date: string | null
  category: string | null
  tickets: number
  merged_into: string | null
}

/**
 * Look up a candidate event (the merge loser) so the admin can confirm what they're about
 * to fold in before it happens. Admin+ only, read-only.
 */
export async function lookupEventAction(eventId: string): Promise<{ ok: boolean; event?: EventPreview; error?: string }> {
  try {
    await requireAdmin(2)
    const id = assertUUID(eventId, 'Event ID')
    const db = createServiceClient()
    const { data: ev } = await db
      .from('events')
      .select('id, name, event_key, event_date, category, merged_into')
      .eq('id', id)
      .maybeSingle()
    if (!ev) return { ok: false, error: 'No event with that ID.' }
    const { count } = await db.from('tickets').select('id', { count: 'exact', head: true }).eq('event_id', id)
    return { ok: true, event: { ...ev, tickets: count ?? 0 } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Merge `loserId` into `winnerId` via the DB function `merge_events(p_loser, p_winner)`,
 * which repoints tickets/enrichment to the winner and stamps the loser's `merged_into`.
 * Admin+ only, audited. The winner is always the canonical event whose page we're on.
 */
export async function mergeEventAction(
  winnerId: string,
  loserId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin(2)
    const winner = assertUUID(winnerId, 'Winner event ID')
    const loser = assertUUID(loserId, 'Loser event ID')
    if (winner === loser) return { ok: false, error: 'Cannot merge an event into itself.' }
    const db = createServiceClient()

    // Both must exist; the winner must still be canonical (not itself already merged away).
    const { data: rows } = await db.from('events').select('id, merged_into, name').in('id', [winner, loser])
    const w = rows?.find((r) => r.id === winner)
    const l = rows?.find((r) => r.id === loser)
    if (!w) return { ok: false, error: 'Winner event not found.' }
    if (!l) return { ok: false, error: 'Loser event not found.' }
    if (w.merged_into) return { ok: false, error: 'The winner has itself been merged elsewhere — reload the page.' }

    const { error } = await db.rpc('merge_events', { p_loser: loser, p_winner: winner })
    if (error) return { ok: false, error: error.message }

    await logAudit(admin.id, 'merge_events', 'event', winner, { loser, loser_name: l.name, winner_name: w.name })
    revalidatePath(`/events/canonical/${winner}`)
    revalidatePath('/events')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
