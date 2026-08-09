import { redirect } from 'next/navigation'
import { getAdminUser } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { AdminProvider } from '@/components/admin-provider'
import { Sidebar } from '@/components/sidebar'
import { Header } from '@/components/header'
import type { AdminUser } from '@/types/admin'

async function getLayoutCounts(accessLevel: number) {
  const db = createServiceClient()

  // Support Chat is Super-Admin-only while it's unfinished. Skip its unread
  // lookup for everyone else so the nav badge can't advertise live activity on
  // a page they only ever see the placeholder for.
  const includeSupport = accessLevel === 1

  const [
    { count: users },
    { count: tickets },
    { count: pendingImports },
    { data: openConvos },
  ] = await Promise.all([
    db.from('users').select('*', { count: 'exact', head: true }),
    db.from('tickets').select('*', { count: 'exact', head: true }),
    db.from('pending_imports').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    includeSupport
      ? db.from('support_conversations').select('id').eq('status', 'open')
      : Promise.resolve({ data: [] as { id: string }[] }),
  ])

  const openIds = (openConvos ?? []).map((c) => c.id)
  let openSupportChats = 0
  if (openIds.length > 0) {
    const { data: unreadMsgs } = await db
      .from('support_conversation_messages')
      .select('conversation_id')
      .eq('sender_type', 'user')
      .is('read_at', null)
      .in('conversation_id', openIds)
    openSupportChats = new Set((unreadMsgs ?? []).map((m) => m.conversation_id)).size
  }

  return {
    users: users ?? 0,
    tickets: tickets ?? 0,
    pendingImports: pendingImports ?? 0,
    openSupportChats,
  }
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser()
  if (!admin) redirect('/login?error=unauthorized')

  const counts = await getLayoutCounts(admin.access_level)

  return (
    <AdminProvider admin={admin as AdminUser}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar counts={counts} />
        <div className="flex flex-1 flex-col overflow-hidden" style={{ marginLeft: 220 }}>
          <Header pendingImports={counts.pendingImports} />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </AdminProvider>
  )
}
