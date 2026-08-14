import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { maskEmail } from '@/lib/privacy'
import { MessageSquare, Ban, Radio, ShieldAlert, ExternalLink } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Db = ReturnType<typeof createServiceClient>
interface UserLite { id: string; email: string; display_name: string | null; username: string | null; avatar_url: string | null }

const STATUS_KIND_META: Record<string, { label: string; color: string }> = {
  going: { label: 'Going', color: '#5A8FBF' },
  live: { label: 'Live', color: '#BF4A3A' },
  recap: { label: 'Recap', color: '#3E8A5A' },
}

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin(3) // Moderator and above
  const showPii = admin.access_level <= 2
  const { tab = 'messages' } = await searchParams
  const active = tab === 'blocks' ? 'blocks' : tab === 'stories' ? 'stories' : 'messages'
  const db = createServiceClient()

  return (
    <div className="p-7 space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
          <ShieldAlert className="h-5 w-5 text-ember" /> Safety &amp; UGC Moderation
        </h1>
        <p className="text-[13px] text-salty-muted">Review user-to-user content — direct messages, blocks, and event stories. Read-only.</p>
      </div>

      <div className="flex gap-1 border-b border-salty-border">
        <TabLink href="/moderation" label="Direct Messages" icon={MessageSquare} active={active === 'messages'} />
        <TabLink href="/moderation?tab=blocks" label="Blocks" icon={Ban} active={active === 'blocks'} />
        <TabLink href="/moderation?tab=stories" label="Stories" icon={Radio} active={active === 'stories'} />
      </div>

      {active === 'messages' ? await renderMessages(db, showPii)
        : active === 'blocks' ? await renderBlocks(db, showPii)
        : await renderStories(db)}
    </div>
  )
}

function TabLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <Link href={href} className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13.5px] font-medium transition-colors ${active ? 'border-ember text-ember' : 'border-transparent text-salty-secondary hover:text-salty-text'}`}>
      <Icon className="h-4 w-4" /> {label}
    </Link>
  )
}

async function resolveUsers(db: Db, ids: string[]): Promise<Map<string, UserLite>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const { data } = await db.from('users').select('id, email, display_name, username, avatar_url').in('id', unique)
  return new Map((data ?? []).map((u) => [u.id, u as UserLite]))
}

function nameOf(u: UserLite | undefined, id: string, showPii: boolean): string {
  if (!u) return id.slice(0, 8)
  return u.display_name || u.username || (showPii ? u.email : maskEmail(u.email))
}

function EmptyPanel({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-salty-border bg-warm-white px-6 py-16 text-center">
      <Icon className="h-8 w-8 text-salty-muted" />
      <p className="mt-3 font-sora text-[15px] font-bold text-salty-text">{title}</p>
      <p className="mt-1 max-w-md text-[13px] text-salty-muted">{sub}</p>
    </div>
  )
}

// ─────────────────────────── Direct Messages ───────────────────────────
async function renderMessages(db: Db, showPii: boolean) {
  const { data: dmsRaw } = await db
    .from('direct_messages')
    .select('id, sender_id, recipient_id, body, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(400)
  const dms = (dmsRaw ?? []) as { id: string; sender_id: string; recipient_id: string; body: string | null; created_at: string; read_at: string | null }[]

  if (dms.length === 0) {
    return <EmptyPanel icon={MessageSquare} title="No direct messages" sub="1:1 messages between users appear here for abuse review. Nothing to moderate yet." />
  }

  const users = await resolveUsers(db, dms.flatMap((m) => [m.sender_id, m.recipient_id]))

  // Group into conversation threads by the unordered participant pair.
  const threads = new Map<string, { a: string; b: string; msgs: typeof dms; last: string; unread: number }>()
  for (const m of dms) {
    const key = [m.sender_id, m.recipient_id].sort().join('~')
    const t = threads.get(key) ?? { a: [m.sender_id, m.recipient_id].sort()[0], b: [m.sender_id, m.recipient_id].sort()[1], msgs: [], last: m.created_at, unread: 0 }
    t.msgs.push(m)
    if (m.created_at > t.last) t.last = m.created_at
    if (!m.read_at) t.unread++
    threads.set(key, t)
  }
  const sorted = [...threads.values()].sort((x, y) => Date.parse(y.last) - Date.parse(x.last))

  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-salty-muted">{sorted.length} thread{sorted.length === 1 ? '' : 's'} · {dms.length} recent message{dms.length === 1 ? '' : 's'}. Bodies shown for abuse review only.</p>
      {sorted.map((t) => {
        const ua = users.get(t.a), ub = users.get(t.b)
        const latest = t.msgs[0]
        return (
          <div key={t.a + t.b} className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
            <div className="flex items-center justify-between gap-3 border-b border-salty-border bg-cream px-5 py-3">
              <div className="flex items-center gap-2 text-[13px]">
                <Link href={`/users/${t.a}`} className="font-medium text-salty-text hover:text-ember hover:underline">{nameOf(ua, t.a, showPii)}</Link>
                <span className="text-salty-muted">↔</span>
                <Link href={`/users/${t.b}`} className="font-medium text-salty-text hover:text-ember hover:underline">{nameOf(ub, t.b, showPii)}</Link>
              </div>
              <span className="text-[11.5px] text-salty-muted">{t.msgs.length} msg{t.msgs.length === 1 ? '' : 's'}{t.unread > 0 ? ` · ${t.unread} unread` : ''}</span>
            </div>
            <div className="divide-y divide-salty-border">
              {t.msgs.slice(0, 6).map((m) => (
                <div key={m.id} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[11.5px] font-semibold text-salty-secondary">{nameOf(users.get(m.sender_id), m.sender_id, showPii)}</span>
                    <span className="shrink-0 text-[11px] text-salty-muted">{new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-salty-text">{m.body ?? <span className="text-salty-muted">(no text)</span>}</p>
                </div>
              ))}
              {t.msgs.length > 6 && <p className="px-5 py-2 text-[11.5px] text-salty-muted">+ {t.msgs.length - 6} older message{t.msgs.length - 6 === 1 ? '' : 's'} in the recent window · latest {new Date(latest.created_at).toLocaleDateString()}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────── Blocks ───────────────────────────
async function renderBlocks(db: Db, showPii: boolean) {
  const { data: blocksRaw } = await db.from('user_blocks').select('id, blocker_id, blocked_id, created_at').order('created_at', { ascending: false }).limit(500)
  const blocks = (blocksRaw ?? []) as { id: string; blocker_id: string; blocked_id: string; created_at: string }[]

  if (blocks.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyPanel icon={Ban} title="No blocks on record" sub="When a user blocks another, it shows here with both parties. Required for UGC safety (App Store Guideline 1.2)." />
        <p className="text-[11.5px] text-salty-muted">Note: a standalone <span className="font-medium">reports</span> queue (reason + action) needs a dedicated table — none exists yet, so this surfaces blocks only.</p>
      </div>
    )
  }

  const users = await resolveUsers(db, blocks.flatMap((b) => [b.blocker_id, b.blocked_id]))
  // Repeat-target counts help spot a user many people block.
  const targetCounts = new Map<string, number>()
  for (const b of blocks) targetCounts.set(b.blocked_id, (targetCounts.get(b.blocked_id) ?? 0) + 1)

  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-salty-border bg-cream">
              {['Blocker', 'Blocked user', 'Times blocked', 'When'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => {
              const times = targetCounts.get(b.blocked_id) ?? 1
              return (
                <tr key={b.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                  <td className="px-4 py-3 text-[13px]"><Link href={`/users/${b.blocker_id}`} className="inline-flex items-center gap-1 text-salty-secondary hover:text-ember hover:underline">{nameOf(users.get(b.blocker_id), b.blocker_id, showPii)}<ExternalLink className="h-3 w-3" /></Link></td>
                  <td className="px-4 py-3 text-[13px]"><Link href={`/users/${b.blocked_id}`} className="inline-flex items-center gap-1 font-medium text-salty-text hover:text-ember hover:underline">{nameOf(users.get(b.blocked_id), b.blocked_id, showPii)}<ExternalLink className="h-3 w-3" /></Link></td>
                  <td className="px-4 py-3">
                    <span className={`text-[13px] font-semibold tabular-nums ${times > 2 ? 'text-[#BF4A3A]' : 'text-salty-secondary'}`}>{times}{times > 2 ? ' ⚠' : ''}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-[12px] text-salty-muted">{new Date(b.created_at).toLocaleDateString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────── Stories ───────────────────────────
async function renderStories(db: Db) {
  const { data: statusesRaw } = await db
    .from('statuses')
    .select('id, user_id, kind, caption, event_title, event_venue, event_date, image_url, created_at, expires_at')
    .order('created_at', { ascending: false })
    .limit(300)
  const statuses = (statusesRaw ?? []) as { id: string; user_id: string; kind: string | null; caption: string | null; event_title: string | null; event_venue: string | null; event_date: string | null; image_url: string | null; created_at: string; expires_at: string | null }[]

  if (statuses.length === 0) {
    return <EmptyPanel icon={Radio} title="No stories posted" sub="Event stories (going / live / recap) that users pin to events show here for moderation of their captions and images." />
  }

  const users = await resolveUsers(db, statuses.map((s) => s.user_id))
  const now = Date.now()

  return (
    <div className="space-y-2">
      {statuses.map((s) => {
        const meta = STATUS_KIND_META[s.kind ?? ''] ?? { label: s.kind ?? '—', color: '#5B6190' }
        const live = s.expires_at && Date.parse(s.expires_at) > now
        const u = users.get(s.user_id)
        return (
          <div key={s.id} className="flex items-start gap-3 rounded-[14px] border border-salty-border bg-warm-white p-4">
            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: meta.color + '1a', color: meta.color }}>{meta.label}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12.5px]">
                <Link href={`/users/${s.user_id}`} className="font-medium text-salty-text hover:text-ember hover:underline">{nameOf(u, s.user_id, false)}</Link>
                {s.event_title && <span className="truncate text-salty-muted">· {s.event_title}{s.event_venue ? ` @ ${s.event_venue}` : ''}</span>}
              </div>
              {s.caption && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-salty-text">{s.caption}</p>}
              <p className="mt-1 text-[11px] text-salty-muted">
                {new Date(s.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                {s.image_url ? ' · has image' : ''} · {live ? 'live' : 'expired'}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
