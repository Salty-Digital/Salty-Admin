'use client'

import { Activity } from 'lucide-react'

/**
 * Recently active admins.
 *
 * Replaced a "Recent logins" feed. Logins are the wrong signal here: sessions persist, so
 * `last_login_at` barely moves and an admin who has been in the panel all week can show a login
 * from a month ago. `last_active_at` (refreshed on page loads, throttled to one write per 2 min in
 * getAdminUser) is what actually answers "who is using this".
 *
 * The login's IP / device is kept as context on each row, so the security glance the old panel gave
 * — including the "New IP" flag — is not lost, just attached to the person rather than the event.
 */

export interface ActivityRow {
  id: string
  admin_email: string
  full_name: string | null
  last_active_at: string | null
  last_login_at: string | null
  ip_address: string | null
  user_agent: string | null
  isNewIp?: boolean
  is_active: boolean
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'Just now'
  const mins = Math.floor(diff / 60_000)
  const hrs = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w === 1 ? '' : 's'} ago` }
  const mo = Math.floor(days / 30); return `${mo} month${mo === 1 ? '' : 's'} ago`
}

/** Online-ish within 5 minutes — last_active_at is written at most every 2 min, so this is safe. */
const isLive = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 5 * 60_000

// Best-effort readable device from the user-agent — enough for a security glance.
function parseDevice(ua: string | null): string {
  if (!ua) return '—'
  const browser =
    /Edg/i.test(ua) ? 'Edge'
    : /OPR|Opera/i.test(ua) ? 'Opera'
    : /Chrome|CriOS/i.test(ua) ? 'Chrome'
    : /Firefox|FxiOS/i.test(ua) ? 'Firefox'
    : /Safari/i.test(ua) ? 'Safari'
    : 'Browser'
  const os =
    /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
    : /Linux/i.test(ua) ? 'Linux'
    : ''
  return os ? `${browser} · ${os}` : browser
}

export function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 font-sora text-[15px] font-bold text-salty-text">
        <Activity className="h-4 w-4 text-ember" /> Recently active
        <span className="text-[12px] font-normal text-salty-muted">
          · all admins · most recent first
        </span>
      </h2>

      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Last active</th>
                <th className="px-4 py-3">Last login</th>
                <th className="px-4 py-3">IP address</th>
                <th className="px-4 py-3">Device</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-salty-muted">No admin activity recorded yet.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium text-salty-text">{r.admin_email}</span>
                        {!r.is_active && (
                          <span className="rounded-full bg-[#FDEDED] px-1.5 py-0.5 text-[10px] font-semibold text-[#BF4A3A]">Inactive</span>
                        )}
                      </div>
                      {r.full_name && <p className="text-[11px] text-salty-muted">{r.full_name}</p>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary">
                      <span className="flex items-center gap-1.5">
                        {isLive(r.last_active_at) && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[#3E8A5A]" aria-label="active now" />
                        )}
                        <span suppressHydrationWarning title={r.last_active_at ? new Date(r.last_active_at).toLocaleString() : undefined}>
                          {timeAgo(r.last_active_at)}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-muted">
                      <span suppressHydrationWarning title={r.last_login_at ? new Date(r.last_login_at).toLocaleString() : undefined}>
                        {timeAgo(r.last_login_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-salty-secondary">
                      {r.ip_address ?? '—'}
                      {r.isNewIp && (
                        <span className="ml-2 rounded-full border border-[#EAD9A6] bg-[#FFF8E6] px-1.5 py-0.5 font-sans text-[10px] font-semibold text-[#8A6830]">New IP</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-salty-secondary">{parseDevice(r.user_agent)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11.5px] text-salty-muted">
        “Last active” is refreshed as an admin uses the panel (throttled to one write every 2
        minutes), so it reflects real use — unlike login time, which barely moves because sessions
        persist. IP and device come from that admin’s most recent login.
      </p>
    </div>
  )
}
