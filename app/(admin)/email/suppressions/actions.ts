'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertEmail } from '@/lib/validate'

/**
 * Manually add an address to the suppression list — e.g. to block a known-bad address
 * before it ever bounces. If the address is already suppressed (by a bounce or complaint)
 * the existing record is kept as-is; this never downgrades a real bounce to 'manual'.
 */
export async function addSuppressionAction(emailRaw: string): Promise<{ ok: true }> {
  const admin = await requireAdmin(2)
  const email = assertEmail(emailRaw, 'Email')

  const db = createServiceClient()
  const { error } = await db.from('email_suppressions').upsert(
    { email, reason: 'manual', event_type: 'manual', detail: null, updated_at: new Date().toISOString() },
    { onConflict: 'email', ignoreDuplicates: true },
  )
  if (error) throw new Error(error.message)

  await logAudit(admin.id, 'add_email_suppression', 'email_suppression', undefined, { email })
  revalidatePath('/email/suppressions')
  return { ok: true }
}

/**
 * Remove an address from the bounce/complaint suppression list so it can receive
 * mail again. Use when a good address was caught by a temporary delivery problem.
 */
export async function removeSuppressionAction(emailRaw: string): Promise<{ ok: true }> {
  const admin = await requireAdmin(2)
  const email = assertEmail(emailRaw, 'Email')

  const db = createServiceClient()
  await db.from('email_suppressions').delete().eq('email', email)

  await logAudit(admin.id, 'remove_email_suppression', 'email_suppression', undefined, { email })
  revalidatePath('/email/suppressions')
  return { ok: true }
}
