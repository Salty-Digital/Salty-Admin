import { NextResponse, type NextRequest } from 'next/server'
import { createV2Client } from '@/lib/supabase/v2'
import { verifyBetaUnsubscribeToken } from '@/lib/unsubscribe'

/**
 * RFC 8058 one-click unsubscribe for beta-waitlist emails. This is the URL placed in the
 * `List-Unsubscribe` header of sends to beta_signups recipients who don't have an account.
 * It writes `unsubscribed_at` back to the v2 beta_signups row, which resolveBetaRecipients
 * then excludes from future sends.
 *
 * URL shape: /api/unsubscribe/beta?id=<beta_signups.id>&t=<hmac-token>
 */

export const dynamic = 'force-dynamic'

async function unsubscribe(betaId: string, token: string): Promise<boolean> {
  if (!betaId || !token) return false
  if (!verifyBetaUnsubscribeToken(betaId, token)) return false
  try {
    const db = createV2Client()
    const { error } = await db.from('beta_signups').update({ unsubscribed_at: new Date().toISOString() }).eq('id', betaId)
    return !error
  } catch {
    return false // v2 not configured / unreachable
  }
}

/** One-click POST from the mailbox provider. Body is ignored (RFC 8058). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const betaId = req.nextUrl.searchParams.get('id') ?? ''
  const token = req.nextUrl.searchParams.get('t') ?? ''
  const ok = await unsubscribe(betaId, token)
  if (!ok) return NextResponse.json({ error: 'Invalid unsubscribe link.' }, { status: 400 })
  return NextResponse.json({ unsubscribed: true }, { status: 200 })
}

/**
 * Link scanners and some clients GET the header URL. Do NOT unsubscribe on GET (a prefetch
 * would opt people out) — send the human to the confirmation page for an explicit click.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const betaId = req.nextUrl.searchParams.get('id') ?? ''
  const token = req.nextUrl.searchParams.get('t') ?? ''
  const page = new URL(`/unsubscribe/beta?id=${encodeURIComponent(betaId)}&t=${encodeURIComponent(token)}`, req.nextUrl.origin)
  return NextResponse.redirect(page)
}
