import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
