function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderBrandedEmail(input: {
  subject: string
  body: string
  pillLabel: string
  unsubscribeUrl?: string
  /** Footer "why you're receiving this" line. Defaults to the account line. */
  reasonLine?: string
}): { subject: string; html: string; text: string } {
  const reasonText = input.reasonLine ?? "You're receiving this because you have a Salty account."
  const reasonHtml = escapeHtml(reasonText)
  if (input.unsubscribeUrl?.includes('"')) {
    throw new Error('Unsubscribe URL cannot contain double quotes.')
  }

  const subject = escapeHtml(input.subject)
  const pillLabel = escapeHtml(input.pillLabel)
  const bodyHtml = escapeHtml(input.body)
    .split(/\n{2,}/)
    .map(
      paragraph =>
        `<p style="margin:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">${paragraph.replace(/\n/g, '<br/>')}</p>`,
    )
    .join('')
  const footerContact = input.unsubscribeUrl
    ? `<a href="${input.unsubscribeUrl}" style="color:#FAC775; text-decoration:underline;">Unsubscribe</a> &middot; <a href="mailto:support@saltydigital.ai" style="color:#FAC775; text-decoration:underline;">support@saltydigital.ai</a>`
    : `<a href="mailto:support@saltydigital.ai" style="color:#FAC775; text-decoration:underline;">support@saltydigital.ai</a>`

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:#eef0fb;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef0fb" style="background-color:#eef0fb; margin:0; padding:0;">
<tr>
<td align="center" style="padding:24px 12px;">

  <table width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:20px;">

    <tr>
      <td bgcolor="#5B2FD4" align="center" style="background-color:#5B2FD4; padding:36px 28px 32px 28px; border-radius:20px 20px 0 0;">
        <table cellpadding="0" cellspacing="0" border="0" align="center">
          <tr>
            <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:34px; font-weight:700; color:#ffffff; letter-spacing:10px; line-height:38px; padding-left:10px;">SALTY</td>
          </tr>
        </table>
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:16px;">
          <tr>
            <td bgcolor="#7854DC" style="background-color:#7854DC; border-radius:999px; padding:7px 15px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#ffffff; letter-spacing:1.4px;">${pillLabel}</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:36px 32px 30px 32px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">
        ${bodyHtml}
      </td>
    </tr>

    <tr>
      <td bgcolor="#1A0848" style="background-color:#1A0848; padding:28px 32px 30px 32px; border-radius:0 0 20px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#ffffff; letter-spacing:6px; padding-bottom:12px; padding-left:6px;">SALTY</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#B9B2D6; padding-bottom:14px;">${reasonHtml}</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:13px; line-height:21px; color:#B9B2D6;">${footerContact}<br><span style="color:#8E86AD;">Salty Digital, Delaware, USA &middot; &copy; 2026 Salty Digital. All rights reserved.</span></td>
          </tr>
        </table>
      </td>
    </tr>

  </table>

</td>
</tr>
</table>

</body>
</html>`

  // Plain-text alternative. A multipart/alternative message (text + html) avoids the
  // MIME_HTML_ONLY spam penalty and is what legitimate bulk senders always include.
  const footerText = input.unsubscribeUrl
    ? `Unsubscribe: ${input.unsubscribeUrl}\nQuestions? support@saltydigital.ai`
    : `Questions? support@saltydigital.ai`
  const text = `${input.subject}

${input.body.trim()}

—
SALTY
${reasonText}
${footerText}
Salty Digital, Delaware, USA · © 2026 Salty Digital. All rights reserved.`

  return { subject: input.subject, html, text }
}
