import { Resend } from 'resend'

/**
 * Resend transport for admin-sent emails (product-update / announcement broadcasts
 * and one-off per-user messages).
 *
 * Requires two env vars:
 *   RESEND_API_KEY  — API key from resend.com
 *   EMAIL_FROM      — verified sender, e.g. "Salty <updates@saltydigital.ai>"
 */

const FROM = process.env.EMAIL_FROM ?? 'Salty Support <support@saltydigital.ai>'

function getClient(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    throw new Error('Email is not configured — set RESEND_API_KEY in the environment.')
  }
  return new Resend(key)
}

/** Wrap a plain-text body (newlines preserved) in a minimal, email-safe HTML shell. */
export function textToHtml(subject: string, body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;line-height:1.6;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('')
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f2;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b;">
    <div style="font-size:20px;font-weight:700;color:#E8581A;margin-bottom:20px;">Salty</div>
    <h1 style="font-size:18px;font-weight:700;margin:0 0 16px;">${subject
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>
    ${paragraphs}
    <p style="margin:28px 0 0;font-size:12px;color:#9a9a9a;">You're receiving this because you have a Salty account.</p>
  </div>
</body></html>`
}

/** Send a single email. Throws on failure. */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const resend = getClient()
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html: textToHtml(subject, body),
  })
  if (error) throw new Error(error.message)
}

export interface EmailOptions {
  /** Plain-text alternative part. Including one avoids the MIME_HTML_ONLY spam penalty. */
  text?: string
  /**
   * One-click unsubscribe URL. When set, adds the RFC 8058 `List-Unsubscribe` and
   * `List-Unsubscribe-Post` headers that Gmail/Yahoo require on bulk mail. The URL
   * must accept an unauthenticated POST (see /api/unsubscribe).
   */
  listUnsubscribeUrl?: string
}

/** Build the List-Unsubscribe headers for a message, or undefined when no URL is given. */
function unsubscribeHeaders(url?: string): Record<string, string> | undefined {
  if (!url) return undefined
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/** Send a single HTML email. Throws on failure. */
export async function sendHtmlEmail(
  to: string,
  subject: string,
  html: string,
  options: EmailOptions = {},
): Promise<void> {
  const resend = getClient()
  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    ...(options.text ? { text: options.text } : {}),
    ...(unsubscribeHeaders(options.listUnsubscribeUrl)
      ? { headers: unsubscribeHeaders(options.listUnsubscribeUrl) }
      : {}),
  })
  if (error) throw new Error(error.message)
}

export interface BulkResult {
  sent: number
  failed: number
}

/**
 * Send rendered emails to many recipients. Uses Resend's batch endpoint
 * (max 100 messages per call) and returns aggregate sent/failed counts.
 * One address per message so recipients never see each other.
 */
export async function sendBulkEmail(
  messages: Array<{ to: string; subject: string; html: string } & EmailOptions>,
): Promise<BulkResult> {
  const resend = getClient()
  let sent = 0
  let failed = 0

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100)
    try {
      const { data, error } = await resend.batch.send(
        chunk.map(({ to, subject, html, text, listUnsubscribeUrl }) => ({
          from: FROM,
          to,
          subject,
          html,
          ...(text ? { text } : {}),
          ...(unsubscribeHeaders(listUnsubscribeUrl)
            ? { headers: unsubscribeHeaders(listUnsubscribeUrl) }
            : {}),
        })),
      )
      if (error) {
        failed += chunk.length
      } else {
        // batch returns one entry per accepted message
        const accepted = data?.data?.length ?? chunk.length
        sent += accepted
        failed += chunk.length - accepted
      }
    } catch {
      failed += chunk.length
    }
  }

  return { sent, failed }
}
