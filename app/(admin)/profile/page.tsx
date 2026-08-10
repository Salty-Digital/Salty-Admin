import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { EditNameForm } from './edit-name-form'
import { ChangePasswordForm } from './reset-password-button'
import { ACCESS_LEVEL_LABELS } from '@/types/admin'
import { Shield } from 'lucide-react'

const LEVEL_COLORS: Record<number, { bg: string; text: string }> = {
  1: { bg: '#FDF0EA', text: '#E8581A' },
  2: { bg: '#FBF6ED', text: '#C8A96E' },
  3: { bg: '#EBF2FA', text: '#3A72A8' },
  4: { bg: '#EAF4EE', text: '#3E8A5A' },
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'
  if (/iPhone|iPad|iPod/.test(ua))  return 'iOS device'
  if (/Android/.test(ua))            return 'Android device'
  if (/Windows/.test(ua)) {
    if (/Edg/.test(ua))    return 'Edge on Windows'
    if (/Chrome/.test(ua)) return 'Chrome on Windows'
    if (/Firefox/.test(ua)) return 'Firefox on Windows'
    return 'Windows browser'
  }
  if (/Macintosh/.test(ua)) {
    if (/Edg/.test(ua))    return 'Edge on Mac'
    if (/Chrome/.test(ua)) return 'Chrome on Mac'
    if (/Safari/.test(ua)) return 'Safari on Mac'
    return 'Mac browser'
  }
  if (/Linux/.test(ua)) return 'Linux browser'
  return 'Unknown browser'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ProfilePage() {
  const admin = await requireAdmin()
  const db    = createServiceClient()

  const [{ data: me }, { data: loginHistory }] = await Promise.all([
    db.from('admin_users')
      .select('id, email, full_name, access_level, last_login_at, created_at, invited_by')
      .eq('id', admin.id)
      .single(),
    db.from('admin_login_history')
      .select('id, ip_address, user_agent, created_at')
      .eq('admin_id', admin.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Resolve inviter email
  let inviterEmail: string | null = null
  if (me?.invited_by) {
    const { data: inviter } = await db
      .from('admin_users')
      .select('email, full_name')
      .eq('id', me.invited_by)
      .single()
    inviterEmail = inviter?.full_name ?? inviter?.email ?? null
  }

  const initials = me?.full_name
    ? me.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : (me?.email ?? '').slice(0, 2).toUpperCase()

  const levelStyle = LEVEL_COLORS[me?.access_level ?? 4]

  return (
    <div className="p-7 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">My Profile</h1>
        <p className="text-[13px] text-salty-muted">Your account details and login activity</p>
      </div>

      {/* Identity card */}
      <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 flex items-center gap-5">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-sora text-[22px] font-bold text-white select-none"
          style={{ background: 'linear-gradient(135deg, #E8581A, #C8A96E)' }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-sora text-[17px] font-bold text-salty-text truncate">
            {me?.full_name ?? me?.email}
          </p>
          {me?.full_name && (
            <p className="text-[13px] text-salty-muted truncate">{me.email}</p>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5" style={{ color: levelStyle.text }} />
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ background: levelStyle.bg, color: levelStyle.text }}
            >
              {ACCESS_LEVEL_LABELS[me?.access_level ?? 4]}
            </span>
          </div>
        </div>
      </div>

      {/* Account info */}
      <div className="rounded-[14px] border border-salty-border bg-warm-white overflow-hidden">
        <div className="border-b border-salty-border px-5 py-4">
          <h2 className="font-sora text-[14px] font-bold text-salty-text">Account info</h2>
        </div>
        {[
          { label: 'Email',      value: me?.email ?? '—' },
          { label: 'Member since', value: me?.created_at ? new Date(me.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
          { label: 'Last login', value: me?.last_login_at ? `${new Date(me.last_login_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} (${timeAgo(me.last_login_at)})` : 'Never' },
          { label: 'Invited by', value: inviterEmail ?? 'Original admin' },
        ].map(row => (
          <div key={row.label} className="flex items-center justify-between border-b border-salty-border px-5 py-3 last:border-0">
            <span className="text-[13px] text-salty-muted">{row.label}</span>
            <span className="text-[13px] text-salty-text text-right max-w-xs">{row.value}</span>
          </div>
        ))}
      </div>

      {/* Edit name */}
      <div className="rounded-[14px] border border-salty-border bg-warm-white overflow-hidden">
        <div className="border-b border-salty-border px-5 py-4">
          <h2 className="font-sora text-[14px] font-bold text-salty-text">Edit profile</h2>
        </div>
        <div className="px-5 py-5">
          <EditNameForm currentName={me?.full_name ?? null} />
        </div>
      </div>

      {/* Security */}
      <div className="rounded-[14px] border border-salty-border bg-warm-white overflow-hidden">
        <div className="border-b border-salty-border px-5 py-4">
          <h2 className="font-sora text-[14px] font-bold text-salty-text">Security</h2>
        </div>
        <div className="px-5 py-5">
          <ChangePasswordForm />
        </div>
      </div>

      {/* Recent logins */}
      <div className="rounded-[14px] border border-salty-border bg-warm-white overflow-hidden">
        <div className="border-b border-salty-border px-5 py-4">
          <h2 className="font-sora text-[14px] font-bold text-salty-text">Recent logins</h2>
          <p className="text-[12px] text-salty-muted mt-0.5">Last {loginHistory?.length ?? 0} sign-ins to this account</p>
        </div>
        {!loginHistory || loginHistory.length === 0 ? (
          <p className="px-5 py-6 text-[13px] text-salty-muted">No login history yet. It will appear here after your next sign-in.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream">
                {['When', 'Device / Browser', 'IP Address'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loginHistory.map((row, i) => (
                <tr key={row.id} className="border-b border-salty-border last:border-0">
                  <td className="px-5 py-3">
                    <p className="text-[13px] font-medium text-salty-text">{timeAgo(row.created_at)}</p>
                    <p className="text-[11px] text-salty-muted">
                      {new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-salty-secondary">
                    {parseUserAgent(row.user_agent)}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-salty-secondary font-mono">
                    {row.ip_address ?? '—'}
                    {i === 0 && (
                      <span className="ml-2 rounded-full bg-[#EAF4EE] px-2 py-0.5 text-[10px] font-semibold font-sans text-[#3E8A5A]">Current</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
