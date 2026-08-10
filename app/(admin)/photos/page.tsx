import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { PhotoTable } from './photo-table'

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string }>
}

const PAGE_SIZE = 30
const NO_MATCH = '00000000-0000-0000-0000-000000000000'

export default async function PhotosPage({ searchParams }: PageProps) {
  await requireAdmin(3)
  const { page = '1', q: rawQ = '' } = await searchParams
  const q = rawQ.trim().slice(0, 120)
  const pageNum = Math.max(1, parseInt(page))
  const offset  = (pageNum - 1) * PAGE_SIZE
  const db = createServiceClient()

  // Search scopes the list to a user by email. Resolve matching users first, then filter
  // photos by their ids (photos carries no email). No match → a sentinel id so we show none.
  let matchedUserIds: string[] | null = null
  if (q) {
    const { data: matched } = await db.from('users').select('id').ilike('email', `%${q}%`).limit(500)
    matchedUserIds = (matched ?? []).map((u) => u.id as string)
  }

  let query = db
    .from('photos')
    .select('id, ticket_id, user_id, media_type, match_method, match_confidence, taken_at', { count: 'exact' })
    .order('taken_at', { ascending: false })
  if (matchedUserIds) query = query.in('user_id', matchedUserIds.length ? matchedUserIds : [NO_MATCH])

  const { data: photos, count: photoCount } = await query.range(offset, offset + PAGE_SIZE - 1)

  const userIds = [...new Set((photos ?? []).map(p => p.user_id))]
  const { data: users } = userIds.length > 0
    ? await db.from('users').select('id, email').in('id', userIds)
    : { data: [] }
  const emailMap = new Map<string, string>()
  for (const u of users ?? []) if (typeof u.id === 'string' && typeof u.email === 'string') emailMap.set(u.id, u.email)

  const rows = (photos ?? []).map(p => ({ ...p, user_email: emailMap.get(p.user_id) ?? '—' }))
  const totalPages = Math.max(1, Math.ceil((photoCount ?? 0) / PAGE_SIZE))
  const pageHref = (n: number) => `/photos?page=${n}${q ? `&q=${encodeURIComponent(q)}` : ''}`

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Photos</h1>
        <p className="text-[13px] text-salty-muted">
          {(photoCount ?? 0).toLocaleString()} {q ? <>matching <span className="font-semibold text-salty-text">“{q}”</span></> : 'total'} · review and remove photos attached to tickets
        </p>
      </div>

      <form className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-salty-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by user email…"
            className="w-full rounded-lg border border-salty-border bg-cream py-2 pl-9 pr-3 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none font-sans"
          />
        </div>
        <button className="rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-ember/90 transition-colors">
          Search
        </button>
        {q && (
          <Link href="/photos" className="flex items-center rounded-lg border border-salty-border bg-warm-white px-3 py-2 text-[13px] text-salty-secondary hover:bg-cream transition-colors">
            Clear
          </Link>
        )}
      </form>

      <PhotoTable photos={rows} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px] text-salty-muted">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-3">
            {pageNum > 1 && <Link href={pageHref(pageNum - 1)} className="hover:text-ember">← Previous</Link>}
            {pageNum < totalPages && <Link href={pageHref(pageNum + 1)} className="hover:text-ember">Next →</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
