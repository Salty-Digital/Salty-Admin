import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessPage, pageForPath } from '@/lib/pages'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Paths that must render/run for a NOT-logged-in caller. Each authenticates itself
  // by its own means, so the proxy must let anonymous requests through — otherwise they
  // get bounced to /login and their own token/signature is never seen:
  //  - /accept-invite       — bearer-token invite links
  //  - /unsubscribe/[id]     — HMAC-signed human unsubscribe confirmation page
  //  - /api/unsubscribe      — the RFC 8058 one-click POST Gmail/Yahoo send (HMAC-signed)
  //  - /api/webhooks/*       — Resend webhooks, verified by their Svix signature
  //  - /api/cron/*           — scheduled jobs, authenticated by the CRON_SECRET bearer
  const isPublicPath =
    pathname === '/login' ||
    pathname.startsWith('/accept-invite') ||
    pathname.startsWith('/unsubscribe') ||
    pathname.startsWith('/api/unsubscribe') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/cron')

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Per-admin page allowlist. Enforced HERE, not only on the page, because a Next.js server action
  // POSTs to its own page route — so gating the route gates the page's actions too, rather than
  // leaving them callable by anyone who knows the endpoint. Skipped for API routes, which
  // authenticate themselves (see isPublicPath above).
  if (user?.email && !isPublicPath && !pathname.startsWith('/api/')) {
    const page = pageForPath(pathname)
    if (page) {
      const admin = await fetchAdminAccess(user.email)
      // No admin row: getAdminUser() will bounce them anyway — don't guess here.
      if (admin && !canAccessPage(admin, page)) {
        const url = request.nextUrl.clone()
        url.pathname = '/'
        url.search = '?error=forbidden'
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

/**
 * Minimal service-role read of the caller's level + allowlist.
 *
 * Uses fetch against PostgREST rather than a Supabase client: this runs in the proxy on every
 * request, and pulling in the SDK here is weight we don't need for two columns. Returns null on any
 * failure so an outage degrades to "let the page's own requireAdmin decide" instead of locking
 * everyone out of the panel.
 */
async function fetchAdminAccess(
  email: string,
): Promise<{ access_level: number; allowed_pages: string[] | null } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  try {
    const res = await fetch(
      `${url}/rest/v1/admin_users?select=access_level,allowed_pages&is_active=eq.true&email=eq.${encodeURIComponent(email)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as { access_level: number; allowed_pages: string[] | null }[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
