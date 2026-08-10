-- "Last active" for admins: updated whenever they use the panel (throttled to one write per
-- 2 minutes in getAdminUser), distinct from last_login_at which only moves on a fresh password
-- login. Backfill from the last known login so existing admins show a sensible value until
-- their next visit. (Already applied to prod via the Supabase migration tooling.)
alter table public.admin_users add column if not exists last_active_at timestamptz;
update public.admin_users set last_active_at = last_login_at where last_active_at is null;
