import { createServiceClient } from '@/lib/supabase/server'

type Db = ReturnType<typeof createServiceClient>

// Users-list activity filter. "Performed an action" = imported ≥1 ticket OR connected an
// email account (Gmail/IMAP) — the concrete, DB-queryable engagement signals already shown
// on the Users list. "Registered only" is the complement (signed up, never did either).
export type ActivityFilter = '' | 'active' | 'registered'

export function parseActivity(v: string | null | undefined): ActivityFilter {
  return v === 'active' || v === 'registered' ? v : ''
}

// A user id that cannot exist, used to force an empty result set when an `active` filter is
// requested but nobody qualifies (PostgREST rejects an empty `.in()` list).
const NO_MATCH = '00000000-0000-0000-0000-000000000000'

/** Ids of users who performed an action (≥1 ticket, or a Gmail/IMAP connection). */
export async function fetchActorIds(db: Db): Promise<Set<string>> {
  // Only ever select user_id here — never touch gmail_connections/imap_connections credentials.
  const [{ data: tickets }, { data: gmail }, { data: imap }] = await Promise.all([
    db.from('tickets').select('user_id'),
    db.from('gmail_connections').select('user_id'),
    db.from('imap_connections').select('user_id'),
  ])
  const ids = new Set<string>()
  for (const r of tickets ?? []) ids.add((r as { user_id: string }).user_id)
  for (const r of gmail ?? []) ids.add((r as { user_id: string }).user_id)
  for (const r of imap ?? []) ids.add((r as { user_id: string }).user_id)
  return ids
}

/**
 * Apply the activity filter to a Supabase `users` query. Returns the (possibly) narrowed
 * builder so callers can keep chaining. No-op for the empty filter.
 */
export function applyActivityFilter<Q extends {
  in(col: string, vals: readonly string[]): Q
  not(col: string, op: 'in', vals: string): Q
}>(query: Q, activity: ActivityFilter, actorIds: Set<string>): Q {
  if (activity === 'active') {
    return query.in('id', actorIds.size ? [...actorIds] : [NO_MATCH])
  }
  if (activity === 'registered' && actorIds.size > 0) {
    return query.not('id', 'in', `(${[...actorIds].join(',')})`)
  }
  return query
}
