'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient, createEdgeFunctionClient } from '@/lib/supabase/server'
import { assertUUID, assertString } from '@/lib/validate'
import { TICKET_CATEGORIES } from '@/lib/categories'
import { aiEventLookup, type EventLookupInput, type EventLookupResult } from '@/lib/anthropic'

type Result = { ok: true } | { ok: false; error: string }

const STATUSES = ['active', 'archived', 'pending']

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function ownerId(db: ReturnType<typeof createServiceClient>, ticketId: string): Promise<string | null> {
  const { data } = await db.from('tickets').select('user_id').eq('id', ticketId).single()
  return data?.user_id ?? null
}

/** Core ticket fields — everything on the tickets row that admins hand-correct. */
export async function saveTicketCoreAction(
  ticketId: string,
  fields: {
    title?: string
    original_title?: string
    venue_name?: string
    date_str?: string
    time_str?: string
    seat?: string
    section?: string
    category?: string
    price_paid?: string
    price_currency?: string
    est_price?: string
    rating?: string
    status?: string
  },
): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const { data: ticket } = await db.from('tickets').select('id').eq('id', tid).single()
    if (!ticket) return { ok: false, error: 'Ticket not found.' }

    const patch: Record<string, unknown> = {}
    const str = (v: string | undefined) => (v === undefined ? undefined : v.trim() === '' ? null : v.trim())
    if (fields.title !== undefined)          patch.title = str(fields.title)
    if (fields.original_title !== undefined) patch.original_title = str(fields.original_title)
    if (fields.venue_name !== undefined)     patch.venue_name = str(fields.venue_name)
    if (fields.date_str !== undefined)       patch.date_str = str(fields.date_str)
    if (fields.time_str !== undefined)       patch.time_str = str(fields.time_str)
    if (fields.seat !== undefined)           patch.seat = str(fields.seat)
    if (fields.section !== undefined)        patch.section = str(fields.section)
    if (fields.est_price !== undefined)      patch.est_price = str(fields.est_price)
    if (fields.price_currency !== undefined) patch.price_currency = str(fields.price_currency)
    if (fields.price_paid !== undefined)     patch.price_paid = num(fields.price_paid)
    if (fields.rating !== undefined) {
      const r = num(fields.rating)
      patch.rating = r === null ? null : Math.min(5, Math.max(1, Math.round(r)))
    }
    if (fields.category !== undefined) {
      if (!(TICKET_CATEGORIES as readonly string[]).includes(fields.category)) return { ok: false, error: 'Invalid category.' }
      patch.category = fields.category
    }
    if (fields.status !== undefined) {
      if (!STATUSES.includes(fields.status)) return { ok: false, error: 'Invalid status.' }
      patch.status = fields.status
    }
    if (Object.keys(patch).length === 0) return { ok: true }

    const { error } = await db.from('tickets').update(patch).eq('id', tid)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'manual_edit_ticket', 'ticket', tid, patch)
    revalidatePath(`/events/${tid}`)
    revalidatePath('/manual-edit')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Tags ──────────────────────────────────────────────────────────────────────
export async function addTagAction(
  ticketId: string,
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const tag = assertString(text, 'Tag', 60)
    const db = createServiceClient()
    const uid = await ownerId(db, tid)
    if (!uid) return { ok: false, error: 'Ticket not found.' }
    const { data, error } = await db
      .from('ticket_tags')
      .insert({ ticket_id: tid, user_id: uid, tag_text: tag })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/events/${tid}`)
    return { ok: true, id: data.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function removeTagAction(ticketId: string, tagId: string): Promise<Result> {
  try {
    await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const id = assertUUID(tagId, 'Tag ID')
    const db = createServiceClient()
    const { error } = await db.from('ticket_tags').delete().eq('id', id).eq('ticket_id', tid)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/events/${tid}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Notes ─────────────────────────────────────────────────────────────────────
export async function addNoteAction(
  ticketId: string,
  text: string,
): Promise<{ ok: true; id: string; created_at: string } | { ok: false; error: string }> {
  try {
    await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const body = assertString(text, 'Note', 2000)
    const db = createServiceClient()
    const uid = await ownerId(db, tid)
    if (!uid) return { ok: false, error: 'Ticket not found.' }
    const { data, error } = await db
      .from('ticket_notes')
      .insert({ ticket_id: tid, user_id: uid, text: body })
      .select('id, created_at')
      .single()
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/events/${tid}`)
    return { ok: true, id: data.id, created_at: data.created_at }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function removeNoteAction(ticketId: string, noteId: string): Promise<Result> {
  try {
    await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const id = assertUUID(noteId, 'Note ID')
    const db = createServiceClient()
    const { error } = await db.from('ticket_notes').delete().eq('id', id).eq('ticket_id', tid)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/events/${tid}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Cast (theatre) — replace the whole list ─────────────────────────────────────
export async function saveCastAction(
  ticketId: string,
  members: { name: string; role: string }[],
): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const rows = (members ?? [])
      .map((m) => ({ name: String(m.name ?? '').trim(), role: String(m.role ?? '').trim() }))
      .filter((m) => m.name)
      .slice(0, 60)

    const { error: delErr } = await db.from('ticket_cast').delete().eq('ticket_id', tid)
    if (delErr) return { ok: false, error: delErr.message }
    if (rows.length > 0) {
      const { error } = await db.from('ticket_cast').insert(
        rows.map((m) => ({ ticket_id: tid, name: m.name, role: m.role || null, source: 'manual' })),
      )
      if (error) return { ok: false, error: error.message }
    }
    await logAudit(admin.id, 'manual_edit_cast', 'ticket', tid, { count: rows.length })
    revalidatePath(`/events/${tid}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Cast lookup — Wikidata + AI via the enrich-cast edge function ────────────────
// The mirror of fetchSportsAction for theatre. enrich-cast grounds on Wikidata + Claude
// and upserts ticket_cast (source:'ai') itself, so a returned result is already saved;
// the form just fills with it for review. Needs the service_role JWT (see fetchSports).
export async function fetchCastAction(
  ticketId: string,
): Promise<{ ok: true; cast: { name: string; role: string }[] } | { ok: false; error: string }> {
  try {
    await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const { data: ticket } = await db.from('tickets').select('id, title, date_str, venue_name').eq('id', tid).single()
    if (!ticket?.title) return { ok: false, error: 'Ticket not found.' }

    const fn = createEdgeFunctionClient()
    if (!fn) return { ok: false, error: 'SUPABASE_SERVICE_ROLE_JWT is not set in the admin environment.' }

    const { data, error } = await fn.functions.invoke('enrich-cast', {
      body: { ticketId: tid, title: ticket.title, date: ticket.date_str ?? undefined, venue: ticket.venue_name ?? undefined },
    })
    if (error) return { ok: false, error: error.message ?? 'Enrichment failed' }

    const raw = (data as { cast?: { name?: unknown; role?: unknown }[] } | null)?.cast
    const cast = Array.isArray(raw)
      ? raw
          .map((c) => ({ name: String(c.name ?? '').trim(), role: typeof c.role === 'string' ? c.role.trim() : '' }))
          .filter((c) => c.name)
      : []
    revalidatePath(`/events/${tid}`)
    return { ok: true, cast }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Setlist (headliner) — replace the position-0 / artist-null row ───────────────
export async function saveSetlistAction(
  ticketId: string,
  songs: string[],
  tourName?: string,
): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const cleanSongs = (songs ?? []).map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, 100)
    const payload = {
      ticket_id: tid,
      artist: null as string | null,
      position: 0,
      songs: cleanSongs.map((song) => ({ song })),
      source: 'manual',
      tour_name: tourName?.trim() || null,
    }
    const { data: existing } = await db
      .from('setlists')
      .select('id')
      .eq('ticket_id', tid)
      .is('artist', null)
      .maybeSingle()
    const { error } = existing?.id
      ? await db.from('setlists').update(payload).eq('id', existing.id)
      : await db.from('setlists').insert(payload)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'manual_edit_setlist', 'ticket', tid, { songs: cleanSongs.length })
    revalidatePath(`/events/${tid}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Sports result — upsert the single sports_stats row ───────────────────────────
export async function saveSportsAction(
  ticketId: string,
  fields: {
    home_team?: string; away_team?: string
    home_score?: string; away_score?: string
    status?: string; league?: string; sport?: string
    venue?: string; city?: string; season?: string; attendance?: string
  },
): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const s = (v: string | undefined) => (v === undefined ? null : v.trim() || null)
    const payload = {
      ticket_id: tid,
      home_team: s(fields.home_team),
      away_team: s(fields.away_team),
      home_score: num(fields.home_score),
      away_score: num(fields.away_score),
      status: s(fields.status),
      league: s(fields.league),
      sport: s(fields.sport),
      venue: s(fields.venue),
      city: s(fields.city),
      season: s(fields.season),
      attendance: num(fields.attendance),
    }
    const { data: existing } = await db.from('sports_stats').select('ticket_id').eq('ticket_id', tid).maybeSingle()
    const { error } = existing
      ? await db.from('sports_stats').update(payload).eq('ticket_id', tid)
      : await db.from('sports_stats').insert(payload)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'manual_edit_sports', 'ticket', tid)
    revalidatePath(`/events/${tid}`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Sports score lookup — exact result from the sports-score-lookup edge function ──
export interface SportsFetchResult {
  home_team: string; away_team: string; home_score: string; away_score: string; status: string
  league: string; sport: string; venue: string; city: string; season: string; attendance: string
}

export async function fetchSportsAction(
  ticketId: string,
): Promise<{ ok: true; found: boolean; sports?: SportsFetchResult } | { ok: false; error: string }> {
  try {
    await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    const { data: ticket } = await db.from('tickets').select('id, title, date_str').eq('id', tid).single()
    if (!ticket?.title) return { ok: false, error: 'Ticket not found.' }

    const fn = createEdgeFunctionClient()
    if (!fn) return { ok: false, error: 'SUPABASE_SERVICE_ROLE_JWT is not set in the admin environment.' }

    // The edge function parses the two teams from the title, so it needs a matchup-style
    // title (e.g. "Yankees vs Red Sox") and the date. It upserts sports_stats itself.
    const { data, error } = await fn.functions.invoke('sports-score-lookup', {
      body: { ticketId: tid, title: ticket.title, dateStr: ticket.date_str ?? undefined },
    })
    if (error) return { ok: false, error: error.message ?? 'Lookup failed' }

    const found = !!(data as { found?: boolean } | null)?.found
    const s = (data as { sports_stats?: Record<string, unknown> } | null)?.sports_stats
    revalidatePath(`/events/${tid}`)
    if (!found || !s) return { ok: true, found: false }

    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))
    return {
      ok: true,
      found: true,
      sports: {
        home_team: str(s.home_team), away_team: str(s.away_team),
        home_score: str(s.home_score), away_score: str(s.away_score),
        status: str(s.status), league: str(s.league), sport: str(s.sport),
        venue: str(s.venue), city: str(s.city), season: str(s.season), attendance: str(s.attendance),
      },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Review status — "mark done" in the queue (admin_ticket_reviews table) ─────────
export async function markReviewedAction(ticketId: string, done: boolean): Promise<Result> {
  try {
    const admin = await requireAdmin(2)
    const tid = assertUUID(ticketId, 'Ticket ID')
    const db = createServiceClient()
    if (done) {
      const { error } = await db
        .from('admin_ticket_reviews')
        .upsert({ ticket_id: tid, reviewed_by: admin.id, reviewed_at: new Date().toISOString() }, { onConflict: 'ticket_id' })
      if (error) return { ok: false, error: error.message }
    } else {
      const { error } = await db.from('admin_ticket_reviews').delete().eq('ticket_id', tid)
      if (error) return { ok: false, error: error.message }
    }
    revalidatePath('/manual-edit')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── AI lookup — helps the admin fill fields; never writes anything itself ─────────
export async function aiLookupAction(
  input: EventLookupInput,
): Promise<{ ok: true; data: EventLookupResult } | { ok: false; error: string }> {
  await requireAdmin(2)
  return aiEventLookup(input)
}
