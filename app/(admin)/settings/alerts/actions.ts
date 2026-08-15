'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { sendHtmlEmail } from '@/lib/email'
import { getAlertContacts } from '@/lib/alerts'

type Result = { ok: boolean; error?: string; message?: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function saveAlertSettings(input: {
  notifyEnabled: boolean
  escalateAfterMinutes: number
  notifyMinSeverity: 'warn' | 'down'
  remediationEnabled: boolean
  maxRemediationAttempts: number
  aiTriageEnabled: boolean
}): Promise<Result> {
  try {
    const admin = await requireAdmin(1)
    const minutes = Math.round(input.escalateAfterMinutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      return { ok: false, error: 'Escalation delay must be between 1 and 1440 minutes.' }
    }
    const attempts = Math.round(input.maxRemediationAttempts)
    if (!Number.isFinite(attempts) || attempts < 0 || attempts > 20) {
      return { ok: false, error: 'Max auto-fix attempts must be between 0 and 20.' }
    }
    if (input.notifyMinSeverity !== 'warn' && input.notifyMinSeverity !== 'down') {
      return { ok: false, error: 'Invalid severity threshold.' }
    }

    const db = createServiceClient()
    const { error } = await db
      .from('alert_settings')
      .update({
        notify_enabled: input.notifyEnabled,
        escalate_after_minutes: minutes,
        notify_min_severity: input.notifyMinSeverity,
        remediation_enabled: input.remediationEnabled,
        max_remediation_attempts: attempts,
        ai_triage_enabled: input.aiTriageEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
    if (error) return { ok: false, error: error.message }

    await logAudit(admin.id, 'alert_settings_updated', 'alert_settings', '1', { ...input })
    revalidatePath('/settings/alerts')
    revalidatePath('/health')
    return { ok: true, message: 'Settings saved.' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function addAlertContact(input: { email: string; name: string; tier: 1 | 2 }): Promise<Result> {
  try {
    const admin = await requireAdmin(1)
    const email = input.email.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' }
    if (input.tier !== 1 && input.tier !== 2) return { ok: false, error: 'Tier must be 1 or 2.' }

    const db = createServiceClient()
    const { error } = await db
      .from('alert_contacts')
      .upsert(
        { email, name: input.name.trim() || null, tier: input.tier, is_active: true },
        { onConflict: 'email' },
      )
    if (error) return { ok: false, error: error.message }

    await logAudit(admin.id, 'alert_contact_added', 'alert_contact', email, { tier: input.tier })
    revalidatePath('/settings/alerts')
    revalidatePath('/health')
    return { ok: true, message: `${email} added to tier ${input.tier}.` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function setContactActive(id: string, isActive: boolean): Promise<Result> {
  try {
    const admin = await requireAdmin(1)
    const db = createServiceClient()
    const { error } = await db.from('alert_contacts').update({ is_active: isActive }).eq('id', id)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, isActive ? 'alert_contact_enabled' : 'alert_contact_disabled', 'alert_contact', id)
    revalidatePath('/settings/alerts')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function removeAlertContact(id: string): Promise<Result> {
  try {
    const admin = await requireAdmin(1)
    const db = createServiceClient()
    const { error } = await db.from('alert_contacts').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'alert_contact_removed', 'alert_contact', id)
    revalidatePath('/settings/alerts')
    revalidatePath('/health')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Send a harmless test alert to every active contact. Worth having: the failure mode this
 * whole system is meant to prevent is "nobody found out", and an untested alert path is
 * exactly how that happens.
 */
export async function sendTestAlert(): Promise<Result> {
  try {
    const admin = await requireAdmin(1)
    if (!process.env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY is not set in the admin environment.' }

    const contacts = (await getAlertContacts()).filter((c) => c.is_active)
    if (contacts.length === 0) return { ok: false, error: 'No active contacts to send to.' }

    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? ''
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f2;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b;">
  <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:#E8581A;">SALTY · OPS</div>
  <h1 style="font-size:19px;font-weight:700;margin:14px 0 6px;color:#3E8A5A;">Test alert — delivery is working</h1>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#4a4a4a;">
    This is a manual test sent from Settings → Alerts by ${admin.email}. Nothing is wrong.
    If you received this, real incident alerts will reach you too.
  </p>
  <p style="margin:20px 0 0;font-size:13px;"><a href="${base}/health" style="color:#E8581A;font-weight:600;">Open the health dashboard →</a></p>
</div></body></html>`
    const text = `SALTY · OPS\nTest alert — delivery is working.\nSent by ${admin.email}. Nothing is wrong.\n${base}/health`

    const results = await Promise.allSettled(
      contacts.map((c) => sendHtmlEmail(c.email, '[Salty] Test alert — delivery is working', html, { text })),
    )
    const sent = results.filter((r) => r.status === 'fulfilled').length
    await logAudit(admin.id, 'alert_test_sent', 'alert_contact', undefined, { sent, total: contacts.length })

    if (sent === 0) {
      const first = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      return { ok: false, error: `All sends failed: ${first?.reason?.message ?? 'unknown error'}` }
    }
    return { ok: true, message: `Test alert sent to ${sent} of ${contacts.length} contact(s).` }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
