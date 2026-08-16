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

  // Admin: who can use this panel, and what they did with it. Split out of System because these
  // two govern the panel's own access rather than the product's health.
  { href: '/settings/admin-users',    label: 'Admin Users',    section: 'Admin', maxLevel: 1 },
  { href: '/settings/audit-log',      label: 'Audit Log',      section: 'Admin', maxLevel: 1 },
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
 * The model is "level is the DEFAULT, an explicit allowlist is the OVERRIDE":
 *
 *   allowed_pages == null   -> level rules apply (access_level <= page.maxLevel).
 *   allowed_pages set       -> exactly those pages, whatever the level says.
 *   access_level <= 1       -> everything, always.
 *
 * NOTE — this is a deliberate change from the original design, where the allowlist could only ever
 * NARROW. It could not grant a level-2 admin a level-1 page like /settings/config, which made the
 * feature useless for its actual purpose: handing a specific System page to a specific person
 * without promoting them to Super Admin.
 *
 * The safety property that makes widening acceptable is that PAGE access is not CAPABILITY. Every
 * mutating server action independently calls requireAdmin(n), so granting someone /settings/config
 * lets them SEE it while its level-1 actions still refuse them. The picker warns when a granted
 * page sits above the admin's level for exactly that reason.
 *
 * Level 1 still bypasses everything: someone must always be able to repair a bad allowlist, and
 * locking the owner out of /settings/admin-users would be unrecoverable through the UI.
 */
export function canAccessPage(
  admin: { access_level: number; allowed_pages: string[] | null },
  page: AdminPage | null,
): boolean {
  if (!page) return true                        // unregistered path — page gates don't apply
  if (admin.access_level <= 1) return true      // Super Admin: everything, always
  if (admin.allowed_pages == null) return admin.access_level <= page.maxLevel
  return admin.allowed_pages.includes(page.href)
}

/** True when this page sits above the admin's level, so its actions may still refuse them. */
export function isAboveLevel(accessLevel: number, page: AdminPage): boolean {
  return accessLevel > page.maxLevel
}
