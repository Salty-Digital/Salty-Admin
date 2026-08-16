/**
 * The canonical list of admin pages.
 *
 * Extracted out of components/sidebar.tsx so ONE table drives three things that must never
 * disagree: what the sidebar renders, what the per-admin page allowlist offers, and what the proxy
 * enforces. When they were separate, a page could be hidden from the nav while still being
 * reachable by typing the URL.
 *
 * `maxLevel` is the CAPABILITY bar (1 = Super Admin … 4 = Support) and is unchanged. The allowlist
 * layers ON TOP of it — it can only ever narrow access, never widen it. See canAccessPage().
 */

export interface AdminPage {
  href: string
  label: string
  section: string
  maxLevel: number
}

export const ADMIN_PAGES: AdminPage[] = [
  { href: '/',                        label: 'Dashboard',       section: 'Overview',   maxLevel: 4 },
  { href: '/analytics',               label: 'Analytics',       section: 'Overview',   maxLevel: 3 },
  { href: '/build-adoption',          label: 'Build Adoption',  section: 'Overview',   maxLevel: 3 },

  { href: '/users',                   label: 'Users',              section: 'Management', maxLevel: 4 },
  { href: '/users/active',            label: 'Active Users',       section: 'Management', maxLevel: 3 },
  { href: '/users/engagement',        label: 'Engagement',         section: 'Management', maxLevel: 3 },
  { href: '/tickets',                 label: 'Tickets',            section: 'Management', maxLevel: 3 },
  { href: '/manual-edit',             label: 'Manual Edit',        section: 'Management', maxLevel: 2 },
  { href: '/pending-imports',         label: 'Imports',            section: 'Management', maxLevel: 2 },
  { href: '/gmail-connections',       label: 'Email Connections',  section: 'Management', maxLevel: 2 },
  { href: '/photo-scans',             label: 'Photo Scans',        section: 'Management', maxLevel: 3 },
  { href: '/events',                  label: 'Events',             section: 'Management', maxLevel: 3 },
  { href: '/enrichment',              label: 'Enrichment',         section: 'Management', maxLevel: 3 },
  { href: '/data-quality',            label: 'Data Quality',       section: 'Management', maxLevel: 3 },
  { href: '/photos',                  label: 'Photos',             section: 'Management', maxLevel: 3 },
  { href: '/feedback',                label: 'Feedback',           section: 'Management', maxLevel: 3 },
  { href: '/notifications',           label: 'Notifications',      section: 'Management', maxLevel: 3 },
  { href: '/support-chat',            label: 'Support Chat',       section: 'Management', maxLevel: 3 },
  { href: '/moderation',              label: 'Safety',             section: 'Management', maxLevel: 3 },

  { href: '/email',                   label: 'Email Users',  section: 'Engagement', maxLevel: 2 },
  { href: '/email/suppressions',      label: 'Suppressions', section: 'Engagement', maxLevel: 2 },
  { href: '/ai-usage',                label: 'AI Usage',     section: 'Engagement', maxLevel: 3 },
  { href: '/social',                  label: 'Social',       section: 'Engagement', maxLevel: 3 },
  { href: '/discovery',               label: 'Discovery',    section: 'Engagement', maxLevel: 3 },

  { href: '/beta-signups',            label: 'Beta Signups', section: 'Signup Analytics', maxLevel: 3 },
  { href: '/v2-analytics',            label: 'V2 Analytics', section: 'Signup Analytics', maxLevel: 3 },

  { href: '/health',                  label: 'Health',         section: 'System', maxLevel: 1 },
  { href: '/settings/alerts',         label: 'Alerts',         section: 'System', maxLevel: 1 },
  { href: '/llm-costs',               label: 'LLM Costs',      section: 'System', maxLevel: 2 },
  { href: '/api-usage',               label: 'API Usage',      section: 'System', maxLevel: 2 },
  { href: '/knowledge-base',          label: 'Knowledge Base', section: 'System', maxLevel: 2 },
  { href: '/release-gate',            label: 'Release Gate',   section: 'System', maxLevel: 1 },
  { href: '/settings/config',         label: 'Config Status',  section: 'System', maxLevel: 1 },
  { href: '/settings/feature-flags',  label: 'Feature Flags',  section: 'System', maxLevel: 1 },
  { href: '/settings/admin-users',    label: 'Admin Users',    section: 'System', maxLevel: 1 },
  { href: '/settings/audit-log',      label: 'Audit Log',      section: 'System', maxLevel: 1 },
]

export const PAGE_SECTIONS = [...new Set(ADMIN_PAGES.map((p) => p.section))]

/** Pages a given level is allowed to reach at all, before any per-admin allowlist. */
export const pagesForLevel = (level: number): AdminPage[] =>
  ADMIN_PAGES.filter((p) => level <= p.maxLevel)

/**
 * Map a request path to the page that owns it, longest-prefix-first.
 *
 * Detail routes (/users/abc, /events/canonical/xyz) must resolve to their parent page, or the
 * allowlist would gate the list but leave every detail view open. '/' only matches exactly —
 * otherwise it would swallow every path.
 */
export function pageForPath(pathname: string): AdminPage | null {
  if (pathname === '/') return ADMIN_PAGES.find((p) => p.href === '/') ?? null
  const matches = ADMIN_PAGES
    .filter((p) => p.href !== '/' && (pathname === p.href || pathname.startsWith(`${p.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)
  return matches[0] ?? null
}

/**
 * Can this admin reach this page?
 *
 * Two gates, both must pass:
 *   1. LEVEL  — the existing capability bar. Unchanged, and the allowlist cannot override it.
 *   2. ALLOWLIST — an optional per-admin narrowing.
 *
 * Level 1 (Super Admin) always bypasses the allowlist: someone has to be able to fix a
 * mis-configured allowlist, and locking the owner out of /settings/admin-users would be
 * unrecoverable through the UI.
 *
 * `allowedPages == null` means "not configured" and imposes NO restriction — so existing admins
 * keep exactly the access they had until someone deliberately narrows them. An EMPTY array is a
 * real, deliberate "no pages".
 */
export function canAccessPage(
  admin: { access_level: number; allowed_pages: string[] | null },
  page: AdminPage | null,
): boolean {
  if (!page) return true                       // unregistered path — level checks still apply
  if (admin.access_level > page.maxLevel) return false
  if (admin.access_level <= 1) return true
  if (admin.allowed_pages == null) return true
  return admin.allowed_pages.includes(page.href)
}
