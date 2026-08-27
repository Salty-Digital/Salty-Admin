function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Default subject for the beta invite (overridable from the composer). */
export const BETA_INVITE_SUBJECT = "You're in — the Salty beta is live"

// One install link for every recipient. saltydigital.com/get reads the device and sends
// Android to Google Play and iPhone to TestFlight, so this email does not have to know
// which one arrived - and when Apple approves the App Store build, that page changes and
// this does not. It also ends the drift that put the INTERNAL-TEST Play URL here while
// emails/beta-invite.html carried the public listing.
const INSTALL_URL = 'https://saltydigital.com/get'
const TESTFLIGHT_URL = INSTALL_URL
const PLAY_URL = INSTALL_URL
const WALKTHROUGH_URL = 'https://youtu.be/zcn0DhOlR4U'

/**
 * The Salty beta invite — the full, hand-designed onboarding email (TestFlight +
 * Google Play install steps, first-session checklist, in-app feedback guide).
 *
 * Ported from emails/beta-invite.html. The two `{{…}}` placeholders in that file
 * become parameters here:
 *   firstName       → the greeting ("Hey <firstName>,"); falls back to "there".
 *   referralUrl     → footer "View your referral link" (omitted when not given).
 * A visible unsubscribe link is added when `unsubscribeUrl` is supplied, and a
 * plain-text alternative is always included (avoids the MIME_HTML_ONLY penalty).
 */
export function renderBetaInviteEmail(input: {
  firstName?: string
  referralUrl?: string
  unsubscribeUrl?: string
  subject?: string
} = {}): { subject: string; html: string; text: string } {
  const firstNameText = (input.firstName ?? '').trim() || 'there'
  const firstName = escapeHtml(firstNameText)
  const subjectText = (input.subject ?? '').trim() || BETA_INVITE_SUBJECT
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

    <!-- ── BRAND BAND ─────────────────────────────────────────────── -->
    <tr>
      <td bgcolor="#5B2FD4" align="center" style="background-color:#5B2FD4; padding:36px 28px 32px 28px; border-radius:20px 20px 0 0;">
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:34px; font-weight:700; color:#ffffff; letter-spacing:10px; line-height:38px; padding-left:10px;">SALTY</div>
        <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:16px;">
          <tr>
            <td bgcolor="#7854DC" style="background-color:#7854DC; border-radius:999px; padding:7px 15px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#ffffff; letter-spacing:1.4px;">&#9733;&nbsp; YOUR YEAR, REPLAYED</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── HERO ───────────────────────────────────────────────────── -->
    <tr>
      <td style="padding:38px 32px 8px 32px;">
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; color:#5B2FD4; letter-spacing:1.6px; padding-bottom:12px;">THE BETA IS LIVE</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:36px; font-weight:700; color:#1A0848; line-height:40px; letter-spacing:-0.6px;">Don't just go.</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:36px; font-weight:700; font-style:italic; color:#E8581A; line-height:42px; letter-spacing:-0.6px;">Remember it.</div>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 0 32px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">
        <p style="margin:0 0 14px 0;">Hey ${firstName},</p>
        <p style="margin:0 0 14px 0;">You signed up early, and you're in &mdash; <strong style="color:#1A0848;">the Salty beta is open and running.</strong> You're one of a small group of first testers, and this is everything you need to get going.</p>
      </td>
    </tr>

    <!-- ── VIDEO ──────────────────────────────────────────────────── -->
    <tr>
      <td style="padding:14px 32px 4px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef0fb" style="background-color:#eef0fb; border-radius:14px;">
          <tr>
            <td align="center" style="padding:22px 22px 24px 22px;">
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:#1A0848; padding-bottom:6px;">New here? Watch this first &#127909;</div>
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#6b6a85; padding-bottom:16px;">A quick walkthrough of the app, so you know what you're looking at before you dive in.</div>
              <table cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td bgcolor="#5B2FD4" style="background-color:#5B2FD4; border-radius:999px;">
                    <a href="${WALKTHROUGH_URL}" target="_blank" style="display:inline-block; padding:14px 28px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none;">&#9654;&nbsp; Watch the walkthrough</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── perforation ────────────────────────────────────────────── -->
    <tr><td style="padding:30px 32px 0 32px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="border-top:2px dashed #e7e5f3; font-size:1px; line-height:1px;">&nbsp;</td></tr></table></td></tr>

    <!-- ── GET THE APP ────────────────────────────────────────────── -->
    <tr>
      <td style="padding:30px 32px 0 32px;">
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; color:#E8581A; letter-spacing:1.6px; padding-bottom:8px;">STEP ONE</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:26px; font-weight:700; color:#1A0848; letter-spacing:-0.4px;">Get the app</div>
      </td>
    </tr>

    <!-- iPhone -->
    <tr>
      <td style="padding:20px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5f3; border-radius:14px;">
          <tr>
            <td style="padding:22px 22px 22px 22px;">
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:#1A0848; padding-bottom:14px;">iPhone &mdash; TestFlight</div>

              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">1</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Download <strong>TestFlight</strong> from the App Store &mdash; it's free, and made by Apple.</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">2</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap the button below to get your invite.</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">3</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Open the invite and tap <strong>View in TestFlight</strong>.</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">4</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap <strong>Install</strong> &mdash; Salty downloads just like a normal app.</td>
                </tr>
                <tr>
                  <td width="32" valign="top"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">5</td></tr></table></td>
                  <td valign="top" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Open Salty from your home screen and sign in with your email.</td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                <tr>
                  <td bgcolor="#5B2FD4" style="background-color:#5B2FD4; border-radius:999px;">
                    <a href="${TESTFLIGHT_URL}" target="_blank" style="display:inline-block; padding:13px 26px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none;">Get Salty for iPhone</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Android -->
    <tr>
      <td style="padding:14px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5f3; border-radius:14px;">
          <tr>
            <td style="padding:22px 22px 22px 22px;">
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:#1A0848; padding-bottom:14px;">Android &mdash; Google Play</div>

              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">1</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap the button below &mdash; it opens Salty on Google Play.</td>
                </tr>
                <tr>
                  <td width="32" valign="top"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">2</td></tr></table></td>
                  <td valign="top" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap <strong>Install</strong>, then open Salty and sign in with your email.</td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                <tr>
                  <td bgcolor="#5B2FD4" style="background-color:#5B2FD4; border-radius:999px;">
                    <a href="${PLAY_URL}" target="_blank" style="display:inline-block; padding:13px 26px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none;">Get Salty on Google Play</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── perforation ────────────────────────────────────────────── -->
    <tr><td style="padding:30px 32px 0 32px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="border-top:2px dashed #e7e5f3; font-size:1px; line-height:1px;">&nbsp;</td></tr></table></td></tr>

    <!-- ── FIRST SESSION ──────────────────────────────────────────── -->
    <tr>
      <td style="padding:30px 32px 0 32px;">
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; color:#E8581A; letter-spacing:1.6px; padding-bottom:8px;">STEP TWO</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:26px; font-weight:700; color:#1A0848; letter-spacing:-0.4px; padding-bottom:6px;">Your first session</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#6b6a85;">Try these specific things &mdash; they're where we most need your eyes.</div>
      </td>
    </tr>

    <tr>
      <td style="padding:18px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Import at least 3 tickets</strong> &mdash; use a different method for each: photo, email scan, calendar, or manual entry.</td>
          </tr>
          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Get familiar with the bottom menu</strong> &mdash; Discover, Tickets, Home, Calendar, and Memories.</td>
          </tr>
          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Ask AI anything</strong> &mdash; on the Home screen, tap <strong>Ask AI</strong>, our chatbot. Ask it about your stats and see what it tells you.</td>
          </tr>
          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Try the artist search</strong> &mdash; when adding a ticket manually with the <strong>+</strong> button on Tickets, type a name (like &ldquo;AJR&rdquo;) and it'll pull up their upcoming shows for you to attach.</td>
          </tr>
          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Tag a friend who was there</strong> &mdash; know another beta tester who was at the same event? Open that ticket, find <strong>Attendees</strong>, and tag them &mdash; see how it connects your tickets together.</td>
          </tr>
          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Explore the &#9776; menu</strong> (top of the Home screen) &mdash; Friends, Following, Saved Events, Settings, and Feedback. Especially <strong>Settings</strong>: notification preferences, how often the app auto-scans for tickets, App Lock, and permissions. Adjust anything that doesn't feel right and tell us why.</td>
          </tr>
          <tr>
            <td width="14" valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#E8581A; font-weight:700;">&bull;</td>
            <td valign="top" style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Deny a permission on purpose</strong> &mdash; camera or calendar, partway through. We want to know whether what happens next is clear or confusing.</td>
          </tr>

        </table>
      </td>
    </tr>

    <!-- ── perforation ────────────────────────────────────────────── -->
    <tr><td style="padding:16px 32px 0 32px;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="border-top:2px dashed #e7e5f3; font-size:1px; line-height:1px;">&nbsp;</td></tr></table></td></tr>

    <!-- ── FEEDBACK ───────────────────────────────────────────────── -->
    <tr>
      <td style="padding:30px 32px 0 32px;">
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; color:#E8581A; letter-spacing:1.6px; padding-bottom:8px;">STEP THREE</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:26px; font-weight:700; color:#1A0848; letter-spacing:-0.4px; padding-bottom:6px;">Report bugs, share ideas</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#6b6a85;">Feedback is built right into the app &mdash; no need for TestFlight or the Play Store.</div>
      </td>
    </tr>

    <tr>
      <td style="padding:18px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">1</td></tr></table></td>
            <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap the <strong>&#9776;</strong> in the top left of the Home screen.</td>
          </tr>
          <tr>
            <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">2</td></tr></table></td>
            <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap <strong>Feedback</strong>.</td>
          </tr>
          <tr>
            <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">3</td></tr></table></td>
            <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Pick a category &mdash; <strong>Bug Report</strong> for something broken, <strong>Feature Request</strong> or <strong>General</strong> for an idea or something that felt clunky. No idea is too small.</td>
          </tr>
          <tr>
            <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">4</td></tr></table></td>
            <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Optionally tell us which part of the app it's about, and rate your overall experience.</td>
          </tr>
          <tr>
            <td width="32" valign="top"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">5</td></tr></table></td>
            <td valign="top" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Write your message, attach up to <strong>3 photos</strong> if it helps explain what you mean, and hit <strong>Submit</strong>.</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #E8581A;">
          <tr>
            <td style="padding:2px 0 2px 14px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;">
              <p style="margin:0 0 8px 0;"><strong style="color:#1A0848;">Be honest.</strong> We'd rather hear &ldquo;this is confusing&rdquo; now than after launch.</p>
              <p style="margin:0;"><strong style="color:#1A0848;">Weekly survey.</strong> Every week during the beta we'll also send a short survey covering features, design, functionality, bugs, and anything else on your mind.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── WHY IT MATTERS ─────────────────────────────────────────── -->
    <tr>
      <td style="padding:30px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef0fb" style="background-color:#eef0fb; border-radius:14px;">
          <tr>
            <td style="padding:24px 24px 24px 24px;">
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; color:#1A0848; padding-bottom:14px;">Why being a beta tester matters</div>
              <p style="margin:0 0 12px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">You shape what Salty becomes.</strong> Your feedback directly decides what we build next &mdash; this isn't a formality, we're reading every note.</p>
              <p style="margin:0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;"><strong style="color:#1A0848;">Lifetime premium access, free</strong> &mdash; for as long as Salty is up and running. You're one of our first ~35 users, and that's our way of saying thanks for being here first.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── SIGN OFF ───────────────────────────────────────────────── -->
    <tr>
      <td style="padding:30px 32px 34px 32px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">
        <p style="margin:0 0 16px 0;">Thank you for believing in this before it was even real. We can't wait for you to see it.</p>
        <p style="margin:0; font-weight:700; color:#1A0848;">&mdash; The Salty Team</p>
      </td>
    </tr>

    <!-- ── FOOTER ─────────────────────────────────────────────────── -->
    <tr>
      <td bgcolor="#1A0848" style="background-color:#1A0848; padding:28px 32px 30px 32px; border-radius:0 0 20px 20px;">
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#ffffff; letter-spacing:6px; padding-bottom:12px; padding-left:6px;">SALTY</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#B9B2D6; padding-bottom:14px;">A fan-memory app for tracking your concerts, games, and Broadway shows.<br>Concerts &middot; Sports &middot; Travel &mdash; remembered.</div>
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:13px; line-height:21px; color:#B9B2D6;">
          Questions? Reply to this email, or reach us at <a href="mailto:support@support.saltydigital.ai" style="color:#FAC775; text-decoration:underline;">support@support.saltydigital.ai</a>.<br>
          ${referralLine}
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

  const text = `${subjectText}

Hey ${firstNameText},

You signed up early, and you're in — the Salty beta is open and running. You're one of a small group of first testers, and this is everything you need to get going.

NEW HERE? WATCH THIS FIRST
A quick walkthrough of the app: ${WALKTHROUGH_URL}

STEP ONE — GET THE APP
iPhone (TestFlight): ${TESTFLIGHT_URL}
  1. Download TestFlight from the App Store (it's free, made by Apple).
  2. Tap the link above to get your invite.
  3. Open the invite and tap "View in TestFlight".
  4. Tap Install — Salty downloads like a normal app.
  5. Open Salty and sign in with your email.
Android (Google Play): ${PLAY_URL}
  1. Tap the link - it opens Salty on Google Play.
  2. Tap Install, then open Salty and sign in with your email.

STEP TWO — YOUR FIRST SESSION
- Import at least 3 tickets, each a different way: photo, email scan, calendar, manual.
- Get familiar with the bottom menu: Discover, Tickets, Home, Calendar, Memories.
- Ask AI anything on the Home screen — ask about your stats.
- Try artist search when adding a ticket manually (the + on Tickets).
- Tag a friend who was there: open a ticket, find Attendees, tag them.
- Explore the top-left menu: Friends, Following, Saved Events, Settings, Feedback.
- Deny a permission on purpose (camera or calendar) and see what happens.

STEP THREE — REPORT BUGS, SHARE IDEAS
Feedback is built into the app: top-left menu → Feedback → pick a category → write your message (attach up to 3 photos) → Submit. Be honest — we'd rather hear "this is confusing" now than after launch. Each week we'll also send a short survey.

WHY IT MATTERS
Your feedback decides what we build next. As a thank-you, you get lifetime premium access, free, for as long as Salty is up and running — you're one of our first ~35 users.

Thank you for believing in this before it was even real. We can't wait for you to see it.
— The Salty Team

Questions? Reply to this email, or reach us at support@support.saltydigital.ai
${input.unsubscribeUrl ? `Unsubscribe: ${input.unsubscribeUrl}\n` : ''}Salty Digital, Delaware, USA · © 2026 Salty Digital. All rights reserved.`

  return { subject: subjectText, html, text }
}
