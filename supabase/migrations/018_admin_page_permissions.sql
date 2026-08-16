-- Per-admin page allowlist.
--
-- Access was a single number (1 Super Admin … 4 Support), so granting someone Imports also granted
-- every other level-2 page. This adds an optional narrowing on top of that bar.
--
-- NULL = not configured, imposes NO restriction (existing admins keep exactly the access they have
-- until someone deliberately narrows them). An EMPTY array is a real, deliberate "no pages".
-- Level 1 bypasses it entirely — someone must always be able to repair a bad allowlist.
--
-- Enforced in three places, all reading lib/pages.ts:
--   proxy.ts        blocks the request (server-action POSTs hit their own page route, so this
--                   gates those too, not just the GET)
--   requirePage()   page-level redirect
--   sidebar         hides what you cannot reach
alter table public.admin_users add column if not exists allowed_pages text[];

comment on column public.admin_users.allowed_pages is
  'Optional per-admin page allowlist of hrefs (see lib/pages.ts ADMIN_PAGES). NULL = unrestricted (level rules only); empty array = no pages. Never widens access beyond access_level, and is bypassed for level 1.';
