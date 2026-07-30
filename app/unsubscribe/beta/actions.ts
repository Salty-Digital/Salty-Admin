'use server'

import { redirect } from 'next/navigation'
import { createV2Client } from '@/lib/supabase/v2'
import { verifyBetaUnsubscribeToken } from '@/lib/unsubscribe'
import { assertUUID, assertString } from '@/lib/validate'

export async function unsubscribeBetaAction(betaIdRaw: string, tokenRaw: string): Promise<void> {
  const betaId = assertUUID(betaIdRaw, 'ID')
  const token = assertString(tokenRaw, 'Token', 200)
  if (!verifyBetaUnsubscribeToken(betaId, token)) throw new Error('Invalid unsubscribe link.')

  const db = createV2Client()
  const { error } = await db.from('beta_signups').update({ unsubscribed_at: new Date().toISOString() }).eq('id', betaId)
  if (error) throw new Error('Failed to record unsubscribe.')

  redirect(`/unsubscribe/beta?id=${encodeURIComponent(betaId)}&t=${encodeURIComponent(token)}&done=1`)
}
