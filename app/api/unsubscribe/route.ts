import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'

/**
 * RFC 8058 one-click unsubscribe endpoint. This is the URL placed in the
 * `List-Unsubscribe` header; Gmail/Yahoo send an unauthenticated POST here when a
 * recipient clicks the mailbox-native "Unsubscribe" button.
 *
 * URL shape: /api/unsubscribe?u=<userId>&t=<hmac-token>
 */

export const dynamic = 'force-dynamic'

async function unsubscribe(userId: string, token: string): Promise<boolean> {
  if (!userId || !token) return false
  if (!verifyUnsubscribeToken(userId, token)) return false

  const db = createServiceClient()
  const { error } = await db
    .from('users')
    .update({ unsubscribed_from_marketing: true })
    .eq('id', userId)
  return !error
}

/** One-click POST from the mailbox provider. Body is ignored (RFC 8058). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = req.nextUrl.searchParams.get('u') ?? ''
  const token = req.nextUrl.searchParams.get('t') ?? ''

  const ok = await unsubscribe(userId, token)
  if (!ok) return NextResponse.json({ error: 'Invalid unsubscribe link.' }, { status: 400 })
  return NextResponse.json({ unsubscribed: true }, { status: 200 })
}

/**
 * Some clients and link scanners fetch the header URL with GET. Do NOT unsubscribe on
 * GET (that would let a link prefetcher opt people out); send the human to the
 * confirmation page instead, where an explicit click completes the action.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.nextUrl.searchParams.get('u') ?? ''
  const token = req.nextUrl.searchParams.get('t') ?? ''
  const page = new URL(
    `/unsubscribe/${encodeURIComponent(userId)}?t=${encodeURIComponent(token)}`,
    req.nextUrl.origin,
  )
  return NextResponse.redirect(page)
}
