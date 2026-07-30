import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { EmailComposer } from './email-composer'

interface Campaign {
  id: string
  subject: string
  segment: { type?: string; tier?: string; activeDays?: number; user_id?: string; emailCount?: number; betaStatus?: string; recipientCount?: number } | null
  recipient_count: number
  sent_count: number
  failed_count: number
  created_at: string
}

function segmentLabel(seg: Campaign['segment'], userEmailById: Map<string, string>): string {
  if (!seg || !seg.type || seg.type === 'all') return 'All users'
  if (seg.type === 'user' && seg.user_id) {
    const email = userEmailById.get(seg.user_id)
    return email ? `To ${email}` : 'To (deleted user)'
  }
  if (seg.type === 'tier') return `Tier: ${seg.tier}`
  if (seg.type === 'active') return `Active ${seg.activeDays}d`
  if (seg.type === 'custom') return `Custom list (${seg.emailCount ?? '?'})`
  if (seg.type === 'beta') {
    const label = seg.betaStatus === 'signed' ? 'signed up' : seg.betaStatus === 'unsigned' ? 'not signed up' : 'all'
    return `Beta: ${label} (${seg.recipientCount ?? '?'})`
  }
  return seg.type
}

export default async function EmailPage() {
  await requireAdmin(2)
  const db = createServiceClient()

  const [{ data: users }, { data }] = await Promise.all([
    db.from('users').select('id, email').order('email').limit(1000),
    // email_campaigns may not exist yet (migration 007 not applied) — tolerate that.
    db.from('email_campaigns')
      .select('id, subject, segment, recipient_count, sent_count, failed_count, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  const campaigns: Campaign[] = data ? (data as Campaign[]) : []
  const userIds = [...new Set(campaigns
    .map(c => c.segment)
    .filter((seg): seg is NonNullable<Campaign['segment']> => seg?.type === 'user' && !!seg.user_id)
    .map(seg => seg.user_id))]
  const userEmailById = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: campaignUsers } = await db.from('users').select('id, email').in('id', userIds)
    for (const user of campaignUsers ?? []) {
      if (typeof user.id === 'string' && typeof user.email === 'string') {
        userEmailById.set(user.id, user.email)
      }
    }
  }

  return (
    <div className="p-7 space-y-7">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Email Users</h1>
        <p className="text-[13px] text-salty-muted">Send product updates and announcements to users by email</p>
      </div>

      <EmailComposer users={(users ?? []).filter(u => u.email)} />

      <div>
        <h2 className="font-sora text-[15px] font-bold text-salty-text mb-3">Recent Emails</h2>
        <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                {['Subject', 'Segment', 'Recipients', 'Sent', 'Failed', 'When'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[13px] text-salty-muted">No campaigns sent yet</td></tr>
              ) : (
                campaigns.map(c => (
                  <tr key={c.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                    <td className="px-4 py-3 text-[13px] font-medium text-salty-text max-w-xs"><p className="truncate">{c.subject}</p></td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary">{segmentLabel(c.segment, userEmailById)}</td>
                    <td className="px-4 py-3 text-[13px] text-salty-text">{c.recipient_count}</td>
                    <td className="px-4 py-3 text-[13px] text-[#3E8A5A]">{c.sent_count}</td>
                    <td className="px-4 py-3 text-[13px]">{c.failed_count > 0 ? <span className="text-[#BF4A3A]">{c.failed_count}</span> : <span className="text-salty-muted">0</span>}</td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
