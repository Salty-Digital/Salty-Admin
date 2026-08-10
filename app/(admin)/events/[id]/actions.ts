'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient, createEdgeFunctionClient } from '@/lib/supabase/server'

export interface CastMemberResult {
  name: string
  role: string | null
}

/**
 * Fetch (and persist) a ticket's cast the same way the mobile app does on first view:
 * the `enrich-cast` edge function grounds on Wikidata + Claude and inserts the result
 * into `ticket_cast` (source:'ai'). The app only reads `ticket_cast`, so shows that
 * nobody has opened yet have no cast in the DB — this lets an admin trigger it.
 *
 * enrich-cast does its own RLS-scoped ticket check from the request bearer, so it needs a
 * real service_role JWT — see createEdgeFunctionClient (the sb_secret key is not a JWT).
 * Gated to Admin+ (level <= 2), matching the event page itself.
 */
export async function fetchCastAction(
  ticketId: string,
): Promise<{ ok: boolean; cast: CastMemberResult[]; error?: string }> {
  await requireAdmin(2)
  const db = createServiceClient()

  const { data: ticket } = await db
    .from('tickets')
    .select('id, title, date_str, venue_name')
    .eq('id', ticketId)
    .single()
  if (!ticket?.title) return { ok: false, cast: [], error: 'Ticket not found' }

  const fn = createEdgeFunctionClient()
  if (!fn) return { ok: false, cast: [], error: 'SUPABASE_SERVICE_ROLE_JWT is not set in the admin environment.' }

  const { data, error } = await fn.functions.invoke('enrich-cast', {
    body: {
      ticketId,
      title: ticket.title,
      date: ticket.date_str ?? undefined,
      venue: ticket.venue_name ?? undefined,
    },
  })
  if (error) return { ok: false, cast: [], error: error.message ?? 'Enrichment failed' }

  const raw = (data as { cast?: { name?: unknown; role?: unknown }[] } | null)?.cast
  const cast: CastMemberResult[] = Array.isArray(raw)
    ? raw
        .map((c) => ({
          name: String(c.name ?? '').trim(),
          role: typeof c.role === 'string' && c.role.trim() ? c.role.trim() : null,
        }))
        .filter((c) => c.name)
    : []

  revalidatePath(`/events/${ticketId}`)
  return { ok: true, cast }
}
