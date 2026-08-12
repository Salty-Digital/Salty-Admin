import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { maskEmail } from '@/lib/privacy'
import { sanitizeOrFilterTerm } from '@/lib/validate'
import { parseActivity, fetchActorIds, applyActivityFilter } from '@/lib/userActivity'

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(1)
  const { searchParams } = req.nextUrl
  const q    = searchParams.get('q')    ?? ''
  const zip  = searchParams.get('zip')  ?? ''
  const tier = searchParams.get('tier') ?? ''
  const activity = parseActivity(searchParams.get('activity'))

  const db = createServiceClient()
  let query = db
    .from('users')
    .select('id, email, username, display_name, tier, zip_code, created_at, banned_until')
    .order('created_at', { ascending: false })
    .limit(10000)

  if (q) {
    const safeQ = sanitizeOrFilterTerm(q)
    if (safeQ) query = query.or(`email.ilike.%${safeQ}%,username.ilike.%${safeQ}%,display_name.ilike.%${safeQ}%`)
  }
  if (zip)  query = query.ilike('zip_code', `%${zip}%`)
  if (tier) query = query.eq('tier', tier)
  if (activity) query = applyActivityFilter(query, activity, await fetchActorIds(db))

  const { data: users } = await query

  const userIds = (users ?? []).map(u => u.id)
  const { data: ticketCounts } = userIds.length > 0
    ? await db.from('tickets').select('user_id').in('user_id', userIds)
    : { data: [] }

  const ticketMap: Record<string, number> = {}
  for (const t of ticketCounts ?? []) ticketMap[t.user_id] = (ticketMap[t.user_id] ?? 0) + 1

  const rows = [
    ['ID', 'Email', 'Username', 'Display Name', 'Tier', 'Zip Code', 'Tickets', 'Banned Until', 'Joined'].join(','),
    ...(users ?? []).map(u => [
      u.id,
      `"${admin.access_level <= 2 ? u.email : maskEmail(u.email)}"`,
      `"${u.username ?? ''}"`,
      `"${u.display_name ?? ''}"`,
      u.tier ?? 'free',
      u.zip_code ?? '',
      ticketMap[u.id] ?? 0,
      u.banned_until ? new Date(u.banned_until).toISOString() : '',
      new Date(u.created_at).toISOString(),
    ].join(',')),
  ]

  // Bulk PII export — always audited regardless of row count
  await logAudit(admin.id, 'export_users_csv', undefined, undefined, {
    filters: { q, zip, tier, activity },
    row_count: users?.length ?? 0,
  })

  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="users-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  })
}
