// Access-control checks for lib/pages.ts.
//
// This is a security boundary, so the rules that matter are asserted rather than assumed:
// the allowlist must never widen access, level 1 must never be lockable out, and detail routes
// must inherit their parent page's permission.
//
// Plain node (node --test) because the admin repo has no jest setup; lib/pages.ts is dependency-free.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAccessPage, pageForPath, pagesForLevel, isAboveLevel, ADMIN_PAGES } from './pages.ts'

const page = (href) => ADMIN_PAGES.find((p) => p.href === href)

// CHANGED from the original design, deliberately: the allowlist used to be narrow-only, which made
// it impossible to grant one System page without promoting someone to Super Admin. An explicit list
// now overrides the level. Capability is still bounded — see the note below.
test('an explicit allowlist OVERRIDES the level, granting a page above it', () => {
  const admin = { access_level: 2, allowed_pages: ['/settings/config'] }
  assert.equal(canAccessPage(admin, page('/settings/config')), true) // level-1 page, granted
  assert.equal(canAccessPage(admin, page('/users')), false)          // not listed -> denied
})

test('level still governs when NO allowlist is set', () => {
  const admin = { access_level: 2, allowed_pages: null }
  assert.equal(canAccessPage(admin, page('/settings/config')), false) // level 1 page
  assert.equal(canAccessPage(admin, page('/llm-costs')), true)        // level 2 page
})

// The guard that makes widening safe: a granted page above the level is flagged so the UI can warn,
// and every mutating action on it still calls requireAdmin(n) independently.
test('isAboveLevel flags a grant whose actions will still refuse the admin', () => {
  assert.equal(isAboveLevel(2, page('/settings/config')), true)
  assert.equal(isAboveLevel(2, page('/llm-costs')), false)
  assert.equal(isAboveLevel(1, page('/settings/config')), false)
})

test('Admin Users and Audit Log live in the Admin section, not System', () => {
  assert.equal(page('/settings/admin-users').section, 'Admin')
  assert.equal(page('/settings/audit-log').section, 'Admin')
  assert.ok(ADMIN_PAGES.some((p) => p.section === 'System'))
})

test('level 1 bypasses the allowlist entirely — cannot be locked out', () => {
  const owner = { access_level: 1, allowed_pages: [] }
  assert.equal(canAccessPage(owner, page('/settings/admin-users')), true)
  assert.equal(canAccessPage(owner, page('/health')), true)
})

test('null allowed_pages imposes no extra restriction (existing admins unaffected)', () => {
  const admin = { access_level: 2, allowed_pages: null }
  assert.equal(canAccessPage(admin, page('/users')), true)
  assert.equal(canAccessPage(admin, page('/llm-costs')), true)
})

test('an empty array is a real "no pages", not "unset"', () => {
  const admin = { access_level: 2, allowed_pages: [] }
  assert.equal(canAccessPage(admin, page('/users')), false)
})

test('an explicit allowlist admits only what it names', () => {
  const admin = { access_level: 2, allowed_pages: ['/users', '/tickets'] }
  assert.equal(canAccessPage(admin, page('/users')), true)
  assert.equal(canAccessPage(admin, page('/tickets')), true)
  assert.equal(canAccessPage(admin, page('/llm-costs')), false)
})

test('detail routes inherit their parent page permission', () => {
  assert.equal(pageForPath('/users/abc-123').href, '/users')
  assert.equal(pageForPath('/events/canonical/xyz').href, '/events')
  // Longest prefix wins: /users/active is its own page, not /users.
  assert.equal(pageForPath('/users/active').href, '/users/active')
  assert.equal(pageForPath('/email/suppressions').href, '/email/suppressions')
})

test('"/" matches only itself and never swallows other paths', () => {
  assert.equal(pageForPath('/').href, '/')
  assert.notEqual(pageForPath('/tickets').href, '/')
})

test('a denied parent denies its detail routes', () => {
  const admin = { access_level: 2, allowed_pages: ['/tickets'] }
  assert.equal(canAccessPage(admin, pageForPath('/users/abc-123')), false)
  assert.equal(canAccessPage(admin, pageForPath('/tickets/whatever')), true)
})

test('unregistered paths fall through to the level checks', () => {
  assert.equal(pageForPath('/totally-unknown'), null)
  assert.equal(canAccessPage({ access_level: 4, allowed_pages: [] }, null), true)
})

test('pagesForLevel never returns a page above the level', () => {
  for (const level of [1, 2, 3, 4]) {
    for (const p of pagesForLevel(level)) assert.ok(level <= p.maxLevel)
  }
})

test('every page href is unique', () => {
  const hrefs = ADMIN_PAGES.map((p) => p.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
})
