'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, BarChart3, Users, Ticket, Mail,
  Database, Send, Bell, Settings,
  ChevronRight, LogOut, Wifi, Activity, ShieldAlert, MessageSquare,
  MailPlus, MailX, Sparkles, ScanLine, Music, Heart, Compass, Image as ImageIcon, Rocket, LineChart,
  Smartphone, Gauge, Inbox, UserCheck, KeyRound, ToggleLeft, SquarePen, HeartPulse, BadgeCheck,
  CalendarClock, Coins, BellRing, Plug, BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAdmin } from './admin-provider'
import { ACCESS_LEVEL_LABELS } from '@/types/admin'
import { ADMIN_PAGES, canAccessPage } from '@/lib/pages'

interface NavSection {
  label: string
  items: NavItem[]
}

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  maxLevel: number
  count?: number
  countVariant?: 'ember' | 'gold'
}

interface SidebarProps {
  counts?: {
    users?: number
    tickets?: number
    pendingImports?: number
    openSupportChats?: number
  }
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { href: '/',                label: 'Dashboard',      icon: LayoutDashboard, maxLevel: 4 },
      { href: '/analytics',       label: 'Analytics',      icon: BarChart3,       maxLevel: 3 },
      { href: '/build-adoption',  label: 'Build Adoption', icon: Gauge,           maxLevel: 3 },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/users',           label: 'Users',           icon: Users,    maxLevel: 4, countVariant: 'ember' },
      { href: '/users/active',    label: 'Active Users',    icon: Activity, maxLevel: 3 },
      { href: '/users/engagement', label: 'Engagement',     icon: UserCheck, maxLevel: 3 },
      { href: '/tickets',         label: 'Tickets',         icon: Ticket,   maxLevel: 3, countVariant: 'gold' },
      { href: '/manual-edit',     label: 'Manual Edit',     icon: SquarePen, maxLevel: 2 },
      { href: '/pending-imports',   label: 'Imports',          icon: Mail,     maxLevel: 2, countVariant: 'ember' },
      { href: '/gmail-connections', label: 'Email Connections', icon: Wifi,   maxLevel: 2 },
      { href: '/photo-scans',       label: 'Photo Scans',      icon: ScanLine, maxLevel: 3 },
      { href: '/events',            label: 'Events',           icon: CalendarClock, maxLevel: 3 },
      { href: '/enrichment',        label: 'Enrichment',       icon: Music,    maxLevel: 3 },
      { href: '/data-quality',      label: 'Data Quality',     icon: BadgeCheck, maxLevel: 3 },
      { href: '/photos',            label: 'Photos',           icon: ImageIcon, maxLevel: 3 },
      { href: '/feedback',          label: 'Feedback',         icon: Inbox,    maxLevel: 3 },
      { href: '/notifications',     label: 'Notifications',    icon: Bell,     maxLevel: 3 },
      { href: '/support-chat',      label: 'Support Chat',     icon: MessageSquare, maxLevel: 3, countVariant: 'ember' },
      { href: '/moderation',        label: 'Safety',           icon: ShieldAlert, maxLevel: 3 },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { href: '/email',              label: 'Email Users',  icon: MailPlus,      maxLevel: 2 },
      { href: '/email/suppressions', label: 'Suppressions', icon: MailX,         maxLevel: 2 },
      { href: '/ai-usage',  label: 'AI Usage',    icon: Sparkles,      maxLevel: 3 },
      { href: '/social',    label: 'Social',      icon: Heart,         maxLevel: 3 },
      { href: '/discovery', label: 'Discovery',   icon: Compass,       maxLevel: 3 },
    ],
  },
  {
    label: 'Signup Analytics',
    items: [
      { href: '/beta-signups', label: 'Beta Signups', icon: Rocket,    maxLevel: 3 },
      { href: '/v2-analytics', label: 'V2 Analytics', icon: LineChart, maxLevel: 3 },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/health',                label: 'Health',       icon: HeartPulse, maxLevel: 1 },
      { href: '/settings/alerts',       label: 'Alerts',       icon: BellRing,   maxLevel: 1 },
      { href: '/llm-costs',             label: 'LLM Costs',    icon: Coins,      maxLevel: 2 },
      { href: '/api-usage',             label: 'API Usage',    icon: Plug,       maxLevel: 2 },
      { href: '/knowledge-base',        label: 'Knowledge Base', icon: BookOpen, maxLevel: 2 },
      { href: '/release-gate',          label: 'Release Gate', icon: Smartphone, maxLevel: 1 },
      { href: '/settings/config',       label: 'Config Status', icon: KeyRound, maxLevel: 1 },
      { href: '/settings/feature-flags', label: 'Feature Flags', icon: ToggleLeft, maxLevel: 1 },
      { href: '/settings/admin-users',  label: 'Admin Users', icon: Settings, maxLevel: 1 },
      { href: '/settings/audit-log',    label: 'Audit Log',   icon: Database, maxLevel: 1 },
    ],
  },
]

function getCountForHref(href: string, counts: SidebarProps['counts']) {
  if (!counts) return undefined
  if (href === '/users')           return counts.users
  if (href === '/tickets')         return counts.tickets
  if (href === '/pending-imports') return counts.pendingImports
  if (href === '/support-chat')    return counts.openSupportChats
  return undefined
}

function formatCount(n: number) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return n.toString()
}

export function Sidebar({ counts }: SidebarProps) {
  const pathname = usePathname()
  const admin = useAdmin()

  const initials = admin.full_name
    ? admin.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : admin.email.slice(0, 2).toUpperCase()

  return (
    <aside
      style={{ width: 220 }}
      className="flex h-screen flex-col border-r border-salty-border bg-warm-white fixed left-0 top-0 bottom-0 z-50"
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-salty-border px-5 py-[18px]">
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-ember font-sora text-base font-bold text-white leading-none select-none">
          S
        </div>
        <span className="font-sora text-[17px] font-bold tracking-tight text-salty-text">Salty</span>
        <span className="ml-auto rounded-full bg-stone px-[7px] py-0.5 text-[10px] font-medium text-salty-muted">
          Admin
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_SECTIONS.map((section) => {
          {/* Same canAccessPage() the proxy and requirePage() use — the nav must never advertise a
              link that would bounce, nor hide one the user can actually reach. */}
          const visible = section.items.filter((i) =>
            canAccessPage(admin, ADMIN_PAGES.find((p) => p.href === i.href) ?? null),
          )
          if (visible.length === 0) return null
          return (
            <div key={section.label} className="mb-1">
              <p className="px-5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-salty-muted">
                {section.label}
              </p>
              {visible.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                const count = getCountForHref(item.href, counts)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex items-center gap-2.5 px-5 py-[9px] text-[13.5px] font-medium transition-colors',
                      active
                        ? 'bg-ember-light text-ember'
                        : 'text-salty-secondary hover:bg-cream hover:text-salty-text',
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[3px] bg-ember" />
                    )}
                    <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'opacity-100' : 'opacity-80')} />
                    {item.label}
                    {count !== undefined && count > 0 && (
                      <span
                        className={cn(
                          'ml-auto min-w-[22px] rounded-full px-[7px] py-px text-center text-[11px] font-semibold',
                          item.countVariant === 'gold'
                            ? 'bg-gold-light text-gold'
                            : 'bg-ember text-white',
                        )}
                      >
                        {formatCount(count)}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-salty-border p-4">
        <div className="flex items-center gap-2.5">
          <Link
            href="/profile"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white hover:opacity-80 transition-opacity"
            style={{ background: 'linear-gradient(135deg, #E8581A, #C8A96E)' }}
            title="My profile"
          >
            {initials}
          </Link>
          <Link href="/profile" className="min-w-0 flex-1 group">
            <p className="truncate text-[13px] font-semibold text-salty-text group-hover:text-ember transition-colors">
              {admin.full_name ?? admin.email}
            </p>
            <p className="text-[11px] text-salty-muted">
              {ACCESS_LEVEL_LABELS[admin.access_level]}
            </p>
          </Link>
          <a
            href="/api/auth/signout"
            title="Sign out"
            className="text-salty-muted hover:text-salty-text transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </aside>
  )
}
