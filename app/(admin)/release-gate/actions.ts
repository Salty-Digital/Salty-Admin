'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertEnum } from '@/lib/validate'

const PLATFORMS = ['ios', 'android'] as const

/** A build number is a non-negative whole integer. */
function assertBuildNumber(value: unknown, label: string): number {
  const n = Number(value)
  // Empty input coerces to 0 (= "no forced update"), which is the safe default.
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
    throw new Error(`${label} must be a whole number between 0 and 1,000,000.`)
  }
  return n
}

/** Trim to null; require a valid http(s) URL when present. */
function normalizeStoreUrl(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (s === '') return null
  let url: URL
  try {
    url = new URL(s)
  } catch {
    throw new Error('Store URL must be a full URL, including https://.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Store URL must be an http(s) link.')
  }
  return url.toString()
}

/** Trim to null; cap length. */
function normalizeMessage(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (s === '') return null
  if (s.length > 300) throw new Error('Message is too long (max 300 characters).')
  return s
}

/**
 * Update the editable fields of a release-gate row. `latest_build` is intentionally
 * NOT editable here — it self-reports monotonically from the newest install in the
 * wild, and casually lowering it would falsely re-trigger the update prompt for
 * everyone. Super Admin only.
 */
export async function updateReleaseGate(
  platform: string,
  input: { minBuild: number | string; storeUrl: string; message: string },
) {
  const admin = await requireAdmin(1)
  const plat = assertEnum(platform, PLATFORMS, 'Platform')
  const db = createServiceClient()

  // Load the current row — we need latest_build for the guard rail below, and this
  // confirms the row actually exists before we try to update it.
  const { data: current } = await db
    .from('app_release_gate')
    .select('platform, latest_build, min_build')
    .eq('platform', plat)
    .single()
  if (!current) throw new Error(`No release-gate row exists for platform "${plat}".`)

  const minBuild = assertBuildNumber(input.minBuild, 'Min build')

  // Guard rail: min_build must never exceed the newest build that actually exists.
  // If it did, EVERY user — including anyone already on the latest build — would be
  // forced to update with no newer build to update to, i.e. a soft-brick of the
  // entire install base.
  if (minBuild > current.latest_build) {
    throw new Error(
      `Min build (${minBuild}) can't be higher than the latest build in the wild (${current.latest_build}) — that would lock out every user. Set it to ${current.latest_build} or lower.`,
    )
  }

  const storeUrl = normalizeStoreUrl(input.storeUrl)
  const message = normalizeMessage(input.message)

  const { error } = await db
    .from('app_release_gate')
    .update({
      min_build: minBuild,
      store_url: storeUrl,
      message,
      updated_at: new Date().toISOString(),
    })
    .eq('platform', plat)
  if (error) throw new Error(`Failed to save: ${error.message}`)

  await logAudit(admin.id, 'update_release_gate', 'app_release_gate', undefined, {
    platform: plat,
    min_build: minBuild,
    previous_min_build: current.min_build,
    force_update: minBuild > 0,
    store_url: storeUrl,
    message,
  })

  revalidatePath('/release-gate')
  return { ok: true }
}
