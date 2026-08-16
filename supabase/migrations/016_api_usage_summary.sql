-- Aggregations behind the External API Usage page (/api-usage).
--
-- `api_usage_log` is the edge functions' ledger of every outbound provider call (Ticketmaster,
-- TheSportsDB, setlist.fm, Spotify, Nominatim, ESPN, MLB, Anthropic, …). It already holds 12k+ rows
-- and only grows, so the page must NOT pull rows and reduce them in JS: PostgREST caps a response at
-- db-max-rows (1000 on this project) regardless of .limit(), which silently turns "calls last 30d"
-- into "calls in the most recent 1000 rows". Same trap documented in 015_count_pending_import_users.
--
-- So every number the page shows is computed here, in Postgres, over the full window.
-- All three are read-only, SECURITY DEFINER (the table is RLS-on with no policies), service_role only.

-- Per-provider rollup: volume, failures, and the latency shape. p95 is the number that actually
-- moves before a provider falls over — an average hides a tail that is already timing out.
create or replace function public.get_api_usage_summary(p_days int default 7)
returns table (
  external_api   text,
  calls          bigint,
  failures       bigint,
  success_rate   numeric,
  p50_ms         int,
  p95_ms         int,
  last_seen      timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    l.external_api,
    count(*)                                                             as calls,
    count(*) filter (where not l.success)                                as failures,
    round(100.0 * count(*) filter (where l.success) / nullif(count(*), 0), 1) as success_rate,
    percentile_disc(0.50) within group (order by l.latency_ms)::int      as p50_ms,
    percentile_disc(0.95) within group (order by l.latency_ms)::int      as p95_ms,
    max(l.created_at)                                                    as last_seen
  from public.api_usage_log l
  where l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)))
  group by l.external_api
  order by calls desc;
$$;

-- Which edge function is driving each provider. This is the attribution that makes a spike
-- actionable — "TheSportsDB is up 5x" is not, "enrichment-worker's roster kind is" is.
create or replace function public.get_api_usage_by_function(p_days int default 7)
returns table (
  function_name text,
  external_api  text,
  calls         bigint,
  failures      bigint,
  p95_ms        int
)
language sql
security definer
set search_path = public
as $$
  select
    l.function_name,
    l.external_api,
    count(*)                                                        as calls,
    count(*) filter (where not l.success)                           as failures,
    percentile_disc(0.95) within group (order by l.latency_ms)::int as p95_ms
  from public.api_usage_log l
  where l.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)))
  group by l.function_name, l.external_api
  order by calls desc;
$$;

-- Daily call/failure counts for the trend strip. Uses generate_series so a day with NO calls is a
-- real zero-height bar rather than a missing one — a provider going silent is exactly the signal.
create or replace function public.get_api_usage_daily(p_days int default 7)
returns table (day date, calls bigint, failures bigint)
language sql
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
      (now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 365)) - 1))::date,
      now()::date,
      interval '1 day'
    )::date as day
  )
  select s.day,
         count(l.id)                                as calls,
         count(l.id) filter (where not l.success)   as failures
  from span s
  left join public.api_usage_log l on l.created_at::date = s.day
  group by s.day
  order by s.day;
$$;

revoke all on function public.get_api_usage_summary(int)     from public, anon, authenticated;
revoke all on function public.get_api_usage_by_function(int) from public, anon, authenticated;
revoke all on function public.get_api_usage_daily(int)       from public, anon, authenticated;
grant execute on function public.get_api_usage_summary(int)     to service_role;
grant execute on function public.get_api_usage_by_function(int) to service_role;
grant execute on function public.get_api_usage_daily(int)       to service_role;

-- The page's window filter always scans by time; without this every load seq-scans a growing table.
create index if not exists api_usage_log_created_at_idx on public.api_usage_log (created_at desc);
