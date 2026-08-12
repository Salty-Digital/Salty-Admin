import { requireAdmin } from '@/lib/auth'
import { renderBetaInviteEmail } from '@/lib/emails/beta-invite'

/**
 * Admin-only preview of the beta invite email, rendered exactly as recipients see it.
 * Opened in a new tab from the Email page's "Beta invite" tab. The greeting shows a
 * "{first name}" merge token (real sends substitute each recipient's actual first name);
 * a dummy unsubscribe link lets the footer render without needing signing env vars.
 */
export async function GET() {
  await requireAdmin(2)
  const { html } = renderBetaInviteEmail({ firstName: '{first name}', unsubscribeUrl: '#' })
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
