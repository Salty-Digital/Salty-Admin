import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'

// Node runtime: we need `crypto` and the raw request body for signature verification.
export const runtime = 'nodejs'

/**
 * Resend webhook receiver. Subscribe it (in the Resend dashboard → Webhooks) to
 * `email.bounced` and `email.complained`, and set RESEND_WEBHOOK_SECRET to the
 * signing secret Resend shows (starts with `whsec_`).
 *
 * On a permanent bounce or a spam complaint we add the recipient to
 * public.email_suppressions; resolveRecipients() then excludes them from every
 * future send. This protects the sending domain's reputation — repeatedly mailing
 * dead addresses or people who marked us as spam is what gets a domain blocked.
 *
 * Requests are authenticated by their Svix signature, NOT by admin auth (Resend
 * calls this unauthenticated). The endpoint fails closed if the secret is missing.
 */

/** Verify a Svix (Resend) webhook signature. Returns true only on an exact, in-window match. */
function verifySignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  // Reject stale deliveries (replay protection): timestamp must be within 5 minutes.
  const ts = Number(svixTimestamp)
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false

  // The secret is `whsec_<base64>`; the HMAC key is the base64-decoded remainder.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest('base64')
  const expectedBuf = Buffer.from(expected)

  // Header is a space-separated list of `v1,<sig>` pairs; any one matching is valid.
  return signatureHeader
    .split(' ')
    .map(part => part.split(','))
    .filter(([version]) => version === 'v1')
    .some(([, sig]) => {
      const sigBuf = Buffer.from(sig ?? '')
      return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)
    })
}

interface ResendEvent {
  type?: string
  data?: {
    to?: string | string[]
    bounce?: { type?: string; subType?: string; message?: string }
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    // Fail closed: without the secret we can't trust any payload.
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set — rejecting.')
    return NextResponse.json({ error: 'Webhook not configured.' }, { status: 500 })
  }

  const body = await req.text() // raw body — required for the HMAC
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing signature headers.' }, { status: 400 })
  }
  if (!verifySignature(secret, svixId, svixTimestamp, body, svixSignature)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  let event: ResendEvent
  try {
    event = JSON.parse(body) as ResendEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const type = event.type
  if (type !== 'email.bounced' && type !== 'email.complained') {
    // Acknowledge unrelated events (delivered, opened, …) without acting on them.
    return NextResponse.json({ ok: true, ignored: type ?? null })
  }

  let reason: 'bounced' | 'complained'
  if (type === 'email.complained') {
    reason = 'complained'
  } else {
    // Only suppress permanent (hard) bounces. Transient/soft bounces are retried by
    // Resend and the address may still be deliverable, so we leave those alone.
    const bounceType = String(event.data?.bounce?.type ?? '').toLowerCase()
    if (bounceType === 'transient' || bounceType === 'soft') {
      return NextResponse.json({ ok: true, skipped: 'soft-bounce' })
    }
    reason = 'bounced'
  }

  const to = event.data?.to
  const addresses = (Array.isArray(to) ? to : typeof to === 'string' ? [to] : [])
    .map(addr => (typeof addr === 'string' ? addr.trim().toLowerCase() : ''))
    .filter(addr => addr.includes('@'))
  if (addresses.length === 0) {
    return NextResponse.json({ ok: true, suppressed: 0 })
  }

  const now = new Date().toISOString()
  const rows = addresses.map(email => ({
    email,
    reason,
    event_type: type,
    detail: reason === 'bounced' ? (event.data?.bounce ?? null) : null,
    updated_at: now,
  }))

  const db = createServiceClient()
  const { error } = await db.from('email_suppressions').upsert(rows, { onConflict: 'email' })
  if (error) {
    // Return 5xx so Resend retries (e.g. if migration 011 hasn't been applied yet).
    console.error('[resend-webhook] failed to record suppression:', error.message)
    return NextResponse.json({ error: 'Could not record suppression.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, reason, suppressed: rows.length })
}
