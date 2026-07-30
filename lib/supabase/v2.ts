import { createClient } from '@supabase/supabase-js'

/**
 * Read-only service client for the Salty **v2** database (Pawel's project) — used only by the
 * Beta Signups analytics page. This is a SEPARATE Supabase project from the admin panel's own
 * database, so it needs its own credentials:
 *   V2_SUPABASE_URL          — the v2 project URL, e.g. https://<ref>.supabase.co
 *   V2_SUPABASE_SERVICE_KEY  — a service-role (or read-only) key for that project
 *
 * The panel only ever READS from this connection (beta signup analytics).
 */

export class V2NotConfiguredError extends Error {
  constructor() {
    super('The v2 database is not configured — set V2_SUPABASE_URL and V2_SUPABASE_SERVICE_KEY.')
    this.name = 'V2NotConfiguredError'
  }
}

/** True when both v2 env vars are present. Lets the page show a setup notice instead of erroring. */
export function isV2Configured(): boolean {
  return Boolean(process.env.V2_SUPABASE_URL && process.env.V2_SUPABASE_SERVICE_KEY)
}

export function createV2Client() {
  const url = process.env.V2_SUPABASE_URL
  const key = process.env.V2_SUPABASE_SERVICE_KEY
  if (!url || !key) throw new V2NotConfiguredError()
  return createClient(url, key, { auth: { persistSession: false } })
}
