'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID } from '@/lib/validate'

const STORAGE_BUCKET = 'ticket-photos'

function pathFromStorageUrl(url: string): string | null {
  const marker = `/${STORAGE_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return url.slice(idx + marker.length)
}

export async function deletePhotoAction(photoId: string) {
  const admin = await requireAdmin(3)
  const pid   = assertUUID(photoId, 'Photo ID')
  const db    = createServiceClient()

  const { data: photo } = await db.from('photos').select('id, storage_url, ticket_id').eq('id', pid).single()
  if (!photo) throw new Error('Photo not found.')

  if (photo.storage_url) {
    const path = pathFromStorageUrl(photo.storage_url)
    if (path) await db.storage.from(STORAGE_BUCKET).remove([path])
  }

  await db.from('photos').delete().eq('id', pid)
  await logAudit(admin.id, 'delete_photo', 'photo', pid, { ticket_id: photo.ticket_id })
  revalidatePath('/photos')
}

export async function bulkDeletePhotosAction(
  photoIds: string[],
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  try {
    const admin = await requireAdmin(3)
    const ids = [...new Set(photoIds.map((id) => assertUUID(id, 'Photo ID')))].slice(0, 500)
    if (ids.length === 0) return { ok: true, deleted: 0 }
    const db = createServiceClient()

    const { data: photos } = await db.from('photos').select('id, storage_url').in('id', ids)
    const paths = (photos ?? [])
      .map((p) => (p.storage_url ? pathFromStorageUrl(p.storage_url) : null))
      .filter((x): x is string => !!x)
    if (paths.length > 0) await db.storage.from(STORAGE_BUCKET).remove(paths)

    const { error } = await db.from('photos').delete().in('id', ids)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'bulk_delete_photos', 'photo', undefined, { count: ids.length })
    revalidatePath('/photos')
    return { ok: true, deleted: ids.length }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
