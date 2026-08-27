function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderAdminInviteEmail(input: {
  fullName: string
  inviterName: string
  inviteUrl: string
}): { subject: string; html: string } {
  if (input.inviteUrl.includes('"')) {
    throw new Error('Invite URL cannot contain double quotes.')
  }

  const fullName = escapeHtml(input.fullName)
  const inviterName = escapeHtml(input.inviterName)
  const { inviteUrl } = input
  const subject = "You're invited to Salty Admin"

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Salty Admin invite</title>
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
            <td bgcolor="#7854DC" style="background-color:#7854DC; border-radius:999px; padding:7px 15px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#ffffff; letter-spacing:1.4px;">ADMIN ACCESS</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:38px 32px 8px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:12px; font-weight:700; color:#E8581A; letter-spacing:1.6px; padding-bottom:12px;">INTERNAL TEAM ACCESS</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:36px; font-weight:700; color:#1A0848; line-height:40px;">You're on the team.</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:36px; font-weight:700; font-style:italic; color:#E8581A; line-height:42px;">Let's get you signed in.</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 0 32px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">Hey ${fullName},</td>
          </tr>
          <tr>
            <td style="padding:0 0 14px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;"><strong style="color:#1A0848;">${inviterName}</strong> invited you to <strong style="color:#1A0848;">Salty Admin</strong> &mdash; the internal tool we use to manage the app. <strong style="color:#1A0848;">Set your password</strong> to activate your account.</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:14px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5f3; border-radius:14px;">
          <tr>
            <td style="padding:22px 22px 22px 22px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:17px; font-weight:700; color:#1A0848; padding-bottom:14px;">Set your password</td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">1</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Tap the button below.</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">2</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Create a password &mdash; at least 8 characters.</td>
                </tr>
                <tr>
                  <td width="32" valign="top" style="padding-bottom:9px;"><table cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" bgcolor="#eef0fb" align="center" style="background-color:#eef0fb; border-radius:11px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:11px; font-weight:700; color:#5B2FD4; line-height:22px;">3</td></tr></table></td>
                  <td valign="top" style="padding-bottom:9px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:22px; color:#1a1530;">Sign in on the next screen. This password is separate from any Salty app account.</td>
                </tr>
              </table>

              <table cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                <tr>
                  <td bgcolor="#5B2FD4" style="background-color:#5B2FD4; border-radius:999px;">
                    <a href="${inviteUrl}" target="_blank" style="display:inline-block; padding:13px 26px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; font-weight:700; color:#ffffff; text-decoration:none;">Set my password</a>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:13px; line-height:20px; color:#6b6a85;">Trouble with the button? Copy this link:<br><span style="word-break:break-all;">${inviteUrl}</span></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 0 32px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #E8581A;">
          <tr>
            <td style="padding:2px 0 2px 14px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:15px; line-height:23px; color:#1a1530;">This link expires in 48 hours. If you weren't expecting this invite, ignore this email &mdash; nothing happens without you clicking through.</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:30px 32px 34px 32px; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:0 0 16px 0; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; color:#1a1530;">Welcome aboard. Any questions, just reply.</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:16px; line-height:25px; font-weight:700; color:#1A0848;">&mdash; The Salty Team</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td bgcolor="#1A0848" style="background-color:#1A0848; padding:28px 32px 30px 32px; border-radius:0 0 20px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:18px; font-weight:700; color:#ffffff; letter-spacing:6px; padding-bottom:12px; padding-left:6px;">SALTY</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:14px; line-height:21px; color:#B9B2D6; padding-bottom:14px;">Salty Admin &middot; Internal team access only.</td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:13px; line-height:21px; color:#B9B2D6;">Questions? Reply to this email, or reach us at <a href="mailto:support@support.saltydigital.ai" style="color:#FAC775; text-decoration:underline;">support@support.saltydigital.ai</a>.<br><span style="color:#8E86AD;">Salty Digital, Delaware, USA &middot; &copy; 2026 Salty Digital. All rights reserved.</span></td>
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

  return { subject, html }
}
