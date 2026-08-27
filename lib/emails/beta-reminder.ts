function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Default subject for the reminder (overridable from the composer). */
export const BETA_REMINDER_SUBJECT = "The shows you've forgotten you went to"

const INSTALL_URL = 'https://saltydigital.com/get'

/**
 * The nudge for people already on the waitlist who never installed.
 *
 * A separate template from beta-invite.ts on purpose. That one is the onboarding email a NEW
 * signup gets from the database trigger the moment they join, and it reads like one: a launch
 * announcement, then three numbered steps, then a seven-task testing checklist. Sent to
 * someone who signed up six weeks ago and never opened the app, it is both stale and
 * backwards — it puts a manual in front of a person who has not got the thing yet.
 *
 * So this one does the opposite. One reason to care, one button, and the testing asks
 * compressed to three lines they can read AFTER installing. Same visual language as the
 * invite — header, palette, footer — because it is the same product, not a different campaign.
 *
 * Every claim here is something the app actually does: email/photo/calendar import, artist
 * search on manual add, Ask AI on the Home screen, and the lifetime-premium promise the
 * original invite already made to these same people. No invented statistics.
 */
export function renderBetaReminderEmail(input: {
  firstName?: string
  referralUrl?: string
  unsubscribeUrl?: string
  subject?: string
} = {}): { subject: string; html: string; text: string } {
  const firstNameText = (input.firstName ?? '').trim() || 'there'
  const firstName = escapeHtml(firstNameText)
  const subjectText = (input.subject ?? '').trim() || BETA_REMINDER_SUBJECT
  const subject = escapeHtml(subjectText)

  for (const [name, url] of [['Referral URL', input.referralUrl], ['Unsubscribe URL', input.unsubscribeUrl]] as const) {
    if (url && url.includes('"')) throw new Error(`${name} cannot contain double quotes.`)
  }

  const referralLine = input.referralUrl
    ? `You're receiving this because you're on the Salty beta waitlist. <a href="${input.referralUrl}" style="color:#FAC775; text-decoration:underline;">View your referral link</a><br>`
    : `You're receiving this because you're on the Salty beta waitlist.<br>`
  const unsubPrefix = input.unsubscribeUrl
    ? `<a href="${input.unsubscribeUrl}" style="color:#FAC775; text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; `
    : ``

  const sans = `'Helvetica Neue',Helvetica,Arial,sans-serif`

  const bullets = [
    'Let it scan your email or photos &mdash; old tickets come back on their own.',
    'Anything it missed, search the artist or team and attach the show.',
    'Ask it a question about your own history on the Home screen, and see what it knows.',
  ].map(text => `
                    <tr>
                      <td width="26" valign="top" style="padding-bottom:11px; font-family:${sans}; font-size:15px; line-height:23px; color:#E8581A;">&bull;</td>
                      <td valign="top" style="padding-bottom:11px; font-family:${sans}; font-size:15px; line-height:23px; color:#1a1530;">${text}</td>
                    </tr>`).join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:#eef0fb;">

<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; height:0; width:0;">Salty builds your concert and game history out of the ticket receipts, photos and calendar entries you already have. You never type a thing.</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef0fb" style="background-color:#eef0fb; margin:0; padding:0;">
  <tr>
    <td align="center" style="padding:28px 12px 40px 12px;">

      <table width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff; border-radius:20px;">

        <tr>
          <td bgcolor="#5B2FD4" align="center" style="background-color:#5B2FD4; padding:36px 28px 32px 28px; border-radius:20px 20px 0 0;">
            <div style="font-family:${sans}; font-size:34px; font-weight:700; color:#ffffff; letter-spacing:10px; line-height:38px; padding-left:10px;">SALTY</div>
            <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:14px;">
              <tr>
                <td bgcolor="#7854DC" style="background-color:#7854DC; border-radius:999px; padding:7px 15px; font-family:${sans}; font-size:11px; font-weight:700; color:#ffffff; letter-spacing:1.4px;">&#9733;&nbsp; YOUR YEAR, REPLAYED</td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:34px 32px 6px 32px;">
            <div style="font-family:${sans}; font-size:12px; font-weight:700; color:#5B2FD4; letter-spacing:1.6px; padding-bottom:12px;">YOUR SPOT IS STILL OPEN</div>
            <div style="font-family:${sans}; font-size:36px; font-weight:700; color:#1A0848; line-height:40px; letter-spacing:-0.6px;">Don&#39;t just go.</div>
            <div style="font-family:${sans}; font-size:36px; font-weight:700; font-style:italic; color:#E8581A; line-height:42px; letter-spacing:-0.6px;">Remember it.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 32px 0 32px;">
            <div style="font-family:${sans}; font-size:16px; line-height:25px; color:#1a1530;">Hey ${firstName},</div>
            <div style="font-family:${sans}; font-size:16px; line-height:25px; color:#1a1530; padding-top:12px;">You put your name down for Salty a while back and never got it onto your phone. Here is what has been waiting.</div>
            <div style="font-family:${sans}; font-size:16px; line-height:25px; color:#1a1530; padding-top:12px;">Salty reads the ticket receipts already in your inbox, the photos in your camera roll and the events in your calendar, and turns them into your concert and game history. <strong>You do not type any of it in.</strong> It works backwards through what you already have, so the history fills itself in.</div>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 32px 4px 32px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#5B2FD4" style="background-color:#5B2FD4; border-radius:999px;">
                  <a href="${INSTALL_URL}" target="_blank" style="display:inline-block; padding:15px 34px; font-family:${sans}; font-size:16px; font-weight:700; color:#ffffff; text-decoration:none;">Install Salty</a>
                </td>
              </tr>
            </table>
            <div style="font-family:${sans}; font-size:13px; line-height:20px; color:#6b6a85; padding-top:11px;">One link for iPhone and Android &mdash; it works out which you are on.</div>
          </td>
        </tr>

        <tr>
          <td style="padding:26px 32px 0 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5f3; border-radius:14px;">
              <tr>
                <td style="padding:22px;">
                  <div style="font-family:${sans}; font-size:17px; font-weight:700; color:#1A0848; padding-bottom:14px;">The first two minutes</div>
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">${bullets}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 32px 0 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F7F4FF" style="background-color:#F7F4FF; border-radius:14px;">
              <tr>
                <td style="padding:20px 22px;">
                  <div style="font-family:${sans}; font-size:15px; line-height:23px; color:#1a1530;"><strong>Your early-tester place is still held.</strong> Lifetime premium, free, for as long as Salty is running &mdash; the same thing we promised when you signed up. It does not expire while you think about it.</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 32px 30px 32px;">
            <div style="font-family:${sans}; font-size:15px; line-height:23px; color:#6b6a85;">Once you are in, anything that feels wrong goes straight to us from the <strong>&#9776;</strong> menu &rarr; <strong>Feedback</strong>. We read every one.</div>
          </td>
        </tr>

        <tr>
          <td bgcolor="#1A0848" style="background-color:#1A0848; padding:30px 32px; border-radius:0 0 20px 20px;">
            <div style="font-family:${sans}; font-size:22px; font-weight:700; color:#ffffff; letter-spacing:7px; padding-bottom:10px;">SALTY</div>
            <div style="font-family:${sans}; font-size:14px; line-height:21px; color:#B9B2D6; padding-bottom:14px;">A fan-memory app for tracking your concerts, games, and Broadway shows.<br>Concerts &middot; Sports &middot; Travel &mdash; remembered.</div>
            <div style="font-family:${sans}; font-size:12px; line-height:19px; color:#8E86AD;">Questions? Reply to this email, or reach us at <a href="mailto:hello@saltydigital.com" style="color:#FAC775; text-decoration:underline;">hello@saltydigital.com</a>.<br>${referralLine}
              <span style="color:#8E86AD;">${unsubPrefix}Salty Digital, Delaware, USA &nbsp;&middot;&nbsp; &copy; 2026 Salty Digital. All rights reserved.</span>
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`

  const text = `SALTY - Don't just go. Remember it.

Hey ${firstNameText},

You put your name down for Salty a while back and never got it onto your phone. Here is what has been waiting.

Salty reads the ticket receipts already in your inbox, the photos in your camera roll and the events in your calendar, and turns them into your concert and game history. You do not type any of it in.

INSTALL SALTY: ${INSTALL_URL}
(One link for iPhone and Android - it works out which you are on.)

THE FIRST TWO MINUTES
- Let it scan your email or photos - old tickets come back on their own.
- Anything it missed, search the artist or team and attach the show.
- Ask it a question about your own history on the Home screen, and see what it knows.

YOUR EARLY-TESTER PLACE IS STILL HELD
Lifetime premium, free, for as long as Salty is running - the same thing we promised when you signed up.

Once you are in, anything that feels wrong goes straight to us from the menu -> Feedback. We read every one.

Questions? Reply to this email, or reach us at hello@saltydigital.com.
You're receiving this because you're on the Salty beta waitlist.${input.referralUrl ? `\nYour referral link: ${input.referralUrl}` : ''}
${input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}\n` : ''}Salty Digital, Delaware, USA - (c) 2026 Salty Digital. All rights reserved.`

  return { subject: subjectText, html, text }
}
