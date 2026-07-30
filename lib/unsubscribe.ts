import { createHmac, timingSafeEqual } from 'crypto'

/** Absolute human-facing unsubscribe URL (confirmation page). Deterministic given the secret — no DB row per token needed. */
export function unsubscribeUrl(userId: string): string {
  const token = signUnsubscribeToken(userId)
  return `${siteBase()}/unsubscribe/${encodeURIComponent(userId)}?t=${token}`
}

/**
 * Absolute one-click unsubscribe URL for the RFC 8058 `List-Unsubscribe` header.
 * Points at an API route that accepts an unauthenticated POST (what Gmail/Yahoo send),
 * so it must be distinct from the human confirmation page above.
 */
export function oneClickUnsubscribeUrl(userId: string): string {
  const token = signUnsubscribeToken(userId)
  return `${siteBase()}/api/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`
}

function siteBase(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL
  if (!base) throw new Error('NEXT_PUBLIC_SITE_URL is not set — cannot build unsubscribe URL.')
  return base.replace(/\/+$/, '')
}

/** Constant-time verify that `token` is a valid signature for `userId`. */
export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = signUnsubscribeToken(userId)
  if (expected.length !== token.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

function signUnsubscribeToken(userId: string): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET
  if (!secret) throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not set — cannot sign unsubscribe token.')
  return createHmac('sha256', secret).update(userId).digest('base64url')
}

// ── Beta waitlist (v2 beta_signups) unsubscribe ──────────────────────────────
// Beta recipients have no main-DB account, so they're identified by their beta_signups
// row id and written back to the v2 table. Tokens are namespaced with a `beta:` prefix so
// a beta token can never be swapped in for a user unsubscribe token (or vice-versa).

/** Absolute human-facing beta-waitlist unsubscribe URL (confirmation page). */
export function betaUnsubscribeUrl(betaId: string): string {
  return `${siteBase()}/unsubscribe/beta?id=${encodeURIComponent(betaId)}&t=${signBetaToken(betaId)}`
}

/** Absolute one-click (RFC 8058) beta-waitlist unsubscribe URL for the List-Unsubscribe header. */
export function betaOneClickUnsubscribeUrl(betaId: string): string {
  return `${siteBase()}/api/unsubscribe/beta?id=${encodeURIComponent(betaId)}&t=${signBetaToken(betaId)}`
}

/** Constant-time verify that `token` is a valid signature for `betaId`. */
export function verifyBetaUnsubscribeToken(betaId: string, token: string): boolean {
  const expected = signBetaToken(betaId)
  if (expected.length !== token.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

function signBetaToken(betaId: string): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET
  if (!secret) throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not set — cannot sign unsubscribe token.')
  return createHmac('sha256', secret).update(`beta:${betaId}`).digest('base64url')
}
