import { createServiceClient } from '@/lib/supabase/server'

/**
 * How many distinct users are behind the unreviewed-import backlog.
 *
 * `pending_imports` counts EVENTS, not people: one user with a linked inbox routinely
 * contributes dozens, so the raw total reads as a user count and badly overstates reach.
 * Every surface that shows the total shows this next to it.
 *
 * Counted in Postgres, not JS. PostgREST caps a response at `db-max-rows` (1000 on this
 * project), so `select user_id` + a Set silently undercounts the moment the backlog passes
 * that — and the backlog is already four figures.
 */
export async function countPendingImportUsers(
  db: ReturnType<typeof createServiceClient>,
): Promise<number> {
  const { data, error } = await db.rpc('count_pending_import_users')
  if (!error && typeof data === 'number') return data

  // Fallback for an environment where the function hasn't been applied yet (e.g. a fresh
  // clone before migrations run). Pages through the rows so it stays exact.
  const users = new Set<string>()
  const PAGE = 1000
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const { data: rows } = await db
      .from('pending_imports')
      .select('user_id')
      .eq('status', 'pending')
      .range(offset, offset + PAGE - 1)
    if (!rows?.length) break
    for (const r of rows) if (r.user_id) users.add(r.user_id)
    if (rows.length < PAGE) break
  }
  return users.size
}
