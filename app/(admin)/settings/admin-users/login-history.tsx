'use client'

import { History } from 'lucide-react'

export interface LoginRow {
  id: string
  admin_email: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
  isNewIp?: boolean
}

function timeAgo(iso: string): string {
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

export function LoginHistory({ rows }: { rows: LoginRow[] }) {
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 font-sora text-[15px] font-bold text-salty-text">
        <History className="h-4 w-4 text-ember" /> Recent logins
        <span className="text-[12px] font-normal text-salty-muted">· all admins · last {rows.length}</span>
      </h2>

      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
              <th className="px-4 py-3">Admin</th>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">IP address</th>
              <th className="px-4 py-3">Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] text-salty-muted">No logins recorded yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-salty-border last:border-0 hover:bg-cream">
                  <td className="px-4 py-3 text-[12.5px] font-medium text-salty-text">{r.admin_email}</td>
                  <td className="px-4 py-3 text-[12px] text-salty-secondary">
                    <span suppressHydrationWarning title={new Date(r.created_at).toLocaleString()}>{timeAgo(r.created_at)}</span>
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
  )
}
