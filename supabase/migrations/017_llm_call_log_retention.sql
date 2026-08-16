-- Retention for llm_call_log — the admin panel's own per-call token/cost ledger (014_ops_monitoring).
--
-- Sibling of the api_usage_log retention added the same day (salty-mobile
-- 20260816120000_api_usage_log_retention.sql), but deliberately NOT the same numbers, because the
-- two tables are read differently and are worth different amounts:
--
--   api_usage_log   /api-usage  widest window 30d   -> floor 30,  keep 90
--   llm_call_log    /llm-costs  widest window 90d   -> floor 90,  keep 365
--
-- Two reasons this one keeps four times as long. First, /llm-costs offers a 90-day tab, so 90 days
-- is the floor before anything the page can display starts disappearing — a 90-day retention would
-- mean the 90d tab was always looking at the ragged edge of the prune. Second, this is a MONEY
-- ledger: "what did we spend on AI last quarter vs this one" is a real question, and the volume is
-- negligible (admin-panel calls only — the table holds 0 rows today), so a year costs nothing.
--
-- Sizing, for the record: even at 500 calls/day this is ~180k rows/yr, comfortably small. If it ever
-- outgrows that, the fix is a monthly cost rollup, not a shorter window — the per-call attribution
-- ("which feature spent it") is the entire point of the table per lib/llm/log.ts.

create or replace function public.prune_llm_call_log(p_keep_days int default 365)
returns integer
language sql
security definer
set search_path = public
as $$
  with pruned as (
    -- Floor of 90 = the widest window /llm-costs can display. A mistyped prune_llm_call_log(1)
    -- must not be able to delete data the page is actively reading; a deleted ledger row is
    -- unrecoverable. Lowering retention below 90 is a code change, not an argument.
    delete from public.llm_call_log
     where created_at < now() - make_interval(days => greatest(90, coalesce(p_keep_days, 365)))
    returning 1
  )
  select count(*)::int from pruned;
$$;

-- Supabase re-grants EXECUTE to PUBLIC on every CREATE FUNCTION; lock it to service-role/cron.
revoke all on function public.prune_llm_call_log(int) from public, anon, authenticated;

comment on function public.prune_llm_call_log(int) is
  'Delete llm_call_log rows older than p_keep_days (default 365, floor 90). Daily via pg_cron. The 90-day floor matches the widest /llm-costs window, so no argument can delete data the page reads.';

-- Daily at 03:35 UTC — after prune-api-usage-log (03:20) and clear of the :00/:10/:15/:17 crons.
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed - skipping prune-llm-call-log schedule';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'prune-llm-call-log') then
    perform cron.unschedule('prune-llm-call-log');
  end if;
  perform cron.schedule(
    'prune-llm-call-log',
    '35 3 * * *',
    $$select public.prune_llm_call_log()$$
  );
end
$do$;

-- The prune filters by time, as does loadLlmCalls()' window query. Without this both seq-scan.
create index if not exists llm_call_log_created_at_idx on public.llm_call_log (created_at desc);
