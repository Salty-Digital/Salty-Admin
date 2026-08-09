/**
 * Read-only client for the mobile project's `config-status` edge function — reports
 * which server-side secrets are set (names + presence booleans only; secret VALUES are
 * never returned). Auth is a shared secret sent as the `x-config-secret` header, so the
 * powerful Supabase Management personal access token stays OUT of the admin app.
 *
 *   CONFIG_STATUS_SECRET — shared secret; must match the same-named Edge Function secret
 *                          set in the mobile Supabase project.
 *
 * Leave CONFIG_STATUS_SECRET unset to disable the mobile-secrets section (a setup notice
 * shows instead — same pattern as the other optional integrations).
 */

export class ConfigStatusNotConfiguredError extends Error {
  constructor() {
    super('config-status not configured — set CONFIG_STATUS_SECRET.')
    this.name = 'ConfigStatusNotConfiguredError'
  }
}

/** True when the admin holds the shared secret and knows the Supabase URL. */
export function isConfigStatusConfigured(): boolean {
  return Boolean(process.env.CONFIG_STATUS_SECRET && process.env.NEXT_PUBLIC_SUPABASE_URL)
}

export interface MobileSecretStatus {
  known: Record<string, boolean>
  others: string[]
}

export async function fetchMobileSecretStatus(): Promise<MobileSecretStatus> {
  const secret = process.env.CONFIG_STATUS_SECRET
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!secret || !base) throw new ConfigStatusNotConfiguredError()

  const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/config-status`, {
    headers: { 'x-config-secret': secret },
    next: { revalidate: 60 },
  })
  if (!res.ok) {
    // 401 here almost always means CONFIG_STATUS_SECRET isn't set in the mobile project
    // yet, or the two values don't match.
    throw new Error(
      res.status === 401
        ? 'Unauthorized (401) — the mobile project’s CONFIG_STATUS_SECRET is unset or doesn’t match this app’s.'
        : `config-status returned HTTP ${res.status}.`,
    )
  }

  const json = (await res.json()) as Partial<MobileSecretStatus>
  return { known: json.known ?? {}, others: json.others ?? [] }
}
