import { requireAdmin } from '@/lib/auth'
import { renderBetaReminderEmail } from '@/lib/emails/beta-reminder'

/**
 * Admin-only preview of the install reminder, rendered exactly as recipients see it.
 * Twin of the beta-invite preview beside it; linked from the Email page's template picker.
 * The greeting shows a "{first name}" merge token (real sends substitute each recipient's
 * actual first name); a dummy unsubscribe link lets the footer render without signing env vars.
 */
export async function GET() {
  await requireAdmin(2)
  const { html } = renderBetaReminderEmail({ firstName: '{first name}', unsubscribeUrl: '#' })
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
