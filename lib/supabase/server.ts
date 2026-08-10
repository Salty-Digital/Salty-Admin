import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

/** Auth-aware client — reads/writes the user's session cookie. Use in Server Components and Server Actions. */
export async function createAuthClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components have read-only cookies — silently ignore
          }
        },
      },
    },
  )
}

/** Service-role client — bypasses RLS. Use for all app-data queries server-side. */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } },
  )
}

/**
 * Client for INVOKING edge functions that build an RLS-scoped Postgres client from the
 * request's Authorization bearer (enrich-cast, sports-score-lookup). Those functions need
 * a real JWT bearer, but SUPABASE_SERVICE_KEY is the new `sb_secret_…` format (not a JWT),
 * so PostgREST rejects it as a bearer. This uses the legacy `service_role` JWT
 * (SUPABASE_SERVICE_ROLE_JWT), which PostgREST accepts as service_role and lets those
 * functions bypass RLS. Returns null when the var isn't set.
 */
export function createEdgeFunctionClient() {
  const jwt = process.env.SUPABASE_SERVICE_ROLE_JWT
  if (!jwt) return null
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, jwt, { auth: { persistSession: false } })
}
