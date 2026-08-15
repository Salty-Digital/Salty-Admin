-- Exact distinct-user count behind the unreviewed-import backlog.
--
-- `pending_imports` counts EVENTS, not people — one user with a linked inbox routinely
-- contributes dozens, so the raw total (1,211 at time of writing) reads as a user count
-- and badly overstates reach. Every surface that shows the total now shows this next to it.
--
-- It has to be counted in Postgres. Doing it client-side means selecting user_id for every
-- pending row, and PostgREST caps a response at db-max-rows (1000 on this project) — so a
-- JS Set over the result silently undercounts once the backlog passes that. It already has:
-- the truncated approach reported 7 users where the real answer is 9.
create or replace function public.count_pending_import_users()
returns integer
language sql
stable
as $$
  select count(distinct user_id)::integer
  from public.pending_imports
  where status = 'pending';
$$;

-- Admin-only: the service-role key is the only caller.
revoke execute on function public.count_pending_import_users() from public;
revoke execute on function public.count_pending_import_users() from anon;
revoke execute on function public.count_pending_import_users() from authenticated;
