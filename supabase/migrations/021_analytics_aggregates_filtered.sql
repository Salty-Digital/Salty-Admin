-- Add window / category / source filters to the analytics aggregates (supersedes 020).
--
-- Signatures change, so the no-arg versions are dropped rather than left behind: Postgres treats
-- f() and f(int, text, text) as different functions, and a stale overload would keep answering
-- unfiltered while the page believed it was filtering.
--
-- Filter semantics, consistent across all four:
--   p_days     null or <= 0  -> all time
--   p_category null or ''    -> all categories
--   p_source   null or ''    -> all sources
drop function if exists public.analytics_activation();
drop function if exists public.analytics_source_effectiveness();
drop function if exists public.analytics_enrichment_coverage();
drop function if exists public.analytics_time_to_first_ticket();

-- Activation becomes a COHORT view when a window is set: users who signed up in that window, and
-- what share of them activated. That is the question worth asking of a window — "did the people we
-- acquired recently convert" — rather than re-counting all-time totals against a moving date.
create or replace function public.analytics_activation(
  p_days int default null, p_category text default null, p_source text default null
)
returns table (
  total_users            bigint,
  with_ticket            bigint,
  with_2plus_tickets     bigint,
  with_inbox             bigint,
  with_photo_scan        bigint,
  seen_last_7d           bigint,
  seen_last_30d          bigint,
  avg_tickets_per_active numeric
)
language sql
security definer
set search_path = public
as $$
  with cohort as (
    select u.id, u.last_seen_at
    from public.users u
    where p_days is null or p_days <= 0
       or u.created_at >= now() - make_interval(days => p_days)
  ),
  t as (
    select t.user_id, count(*) as n
    from public.tickets t
    join cohort c on c.id = t.user_id
    where t.status = 'active'
      and (p_category is null or p_category = '' or t.category = p_category)
      and (p_source   is null or p_source   = '' or t.source   = p_source)
    group by t.user_id
  )
  select
    (select count(*) from cohort),
    (select count(*) from t),
    (select count(*) from t where n >= 2),
    (select count(distinct x.user_id) from (
       select user_id from public.gmail_connections
       union select user_id from public.imap_connections
       union select user_id from public.inbound_email_addresses) x
     join cohort c on c.id = x.user_id),
    (select count(distinct j.user_id) from public.photo_scan_jobs j join cohort c on c.id = j.user_id),
    (select count(*) from cohort where last_seen_at >= now() - interval '7 days'),
    (select count(*) from cohort where last_seen_at >= now() - interval '30 days'),
    (select round(avg(n), 1) from t);
$$;

create or replace function public.analytics_source_effectiveness(
  p_days int default null, p_category text default null, p_source text default null
)
returns table (
  source text, tickets bigint, users_reached bigint,
  first_seen timestamptz, last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  select t.source, count(*), count(distinct t.user_id), min(t.imported_at), max(t.imported_at)
  from public.tickets t
  where t.source is not null
    and (p_days is null or p_days <= 0 or t.imported_at >= now() - make_interval(days => p_days))
    and (p_category is null or p_category = '' or t.category = p_category)
    and (p_source   is null or p_source   = '' or t.source   = p_source)
  group by t.source
  order by 2 desc;
$$;

-- Enrichment jobs have no date of their own, so the window is applied to the TICKET they belong to.
create or replace function public.analytics_enrichment_coverage(
  p_days int default null, p_category text default null, p_source text default null
)
returns table (
  kind text, total_jobs bigint, done bigint, pending bigint,
  failed bigint, exhausted bigint, pct_done numeric
)
language sql
security definer
set search_path = public
as $$
  select j.kind,
         count(*),
         count(*) filter (where j.status = 'done'),
         count(*) filter (where j.status = 'pending'),
         count(*) filter (where j.status = 'failed'),
         count(*) filter (where j.status = 'failed' and j.attempts >= j.max_attempts),
         round(100.0 * count(*) filter (where j.status = 'done') / nullif(count(*), 0), 1)
  from public.enrichment_jobs j
  join public.tickets t on t.id = j.ticket_id
  where (p_days is null or p_days <= 0 or t.imported_at >= now() - make_interval(days => p_days))
    and (p_category is null or p_category = '' or t.category = p_category)
    and (p_source   is null or p_source   = '' or t.source   = p_source)
  group by j.kind
  order by 2 desc;
$$;

create or replace function public.analytics_time_to_first_ticket(
  p_days int default null, p_category text default null, p_source text default null
)
returns table (bucket text, users bigint, sort_order int)
language sql
security definer
set search_path = public
as $$
  with first_ticket as (
    select t.user_id, min(t.imported_at) as first_at
    from public.tickets t
    where (p_category is null or p_category = '' or t.category = p_category)
      and (p_source   is null or p_source   = '' or t.source   = p_source)
    group by t.user_id
  ),
  gap as (
    select extract(epoch from (f.first_at - u.created_at)) / 3600.0 as hours
    from first_ticket f
    join public.users u on u.id = f.user_id
    where f.first_at >= u.created_at
      and (p_days is null or p_days <= 0 or u.created_at >= now() - make_interval(days => p_days))
  )
  select b.bucket, count(g.hours), b.sort_order
  from (values ('< 1 hour', 1), ('1–24 hours', 2), ('1–7 days', 3), ('> 7 days', 4))
    as b(bucket, sort_order)
  left join gap g on b.bucket = case
    when g.hours < 1 then '< 1 hour' when g.hours < 24 then '1–24 hours'
    when g.hours < 168 then '1–7 days' else '> 7 days' end
  group by b.bucket, b.sort_order
  order by b.sort_order;
$$;

-- Distinct values for the filter dropdowns, so they can never offer a value with no data.
create or replace function public.analytics_filter_options()
returns table (kind text, value text, n bigint)
language sql
security definer
set search_path = public
as $$
  select 'category', coalesce(category, 'unknown'), count(*) from public.tickets group by 2
  union all
  select 'source', coalesce(source, 'unknown'), count(*) from public.tickets group by 2
  order by 1, 3 desc;
$$;

revoke all on function public.analytics_activation(int, text, text)            from public, anon, authenticated;
revoke all on function public.analytics_source_effectiveness(int, text, text)  from public, anon, authenticated;
revoke all on function public.analytics_enrichment_coverage(int, text, text)   from public, anon, authenticated;
revoke all on function public.analytics_time_to_first_ticket(int, text, text)  from public, anon, authenticated;
revoke all on function public.analytics_filter_options()                       from public, anon, authenticated;
grant execute on function public.analytics_activation(int, text, text)           to service_role;
grant execute on function public.analytics_source_effectiveness(int, text, text) to service_role;
grant execute on function public.analytics_enrichment_coverage(int, text, text)  to service_role;
grant execute on function public.analytics_time_to_first_ticket(int, text, text) to service_role;
grant execute on function public.analytics_filter_options()                      to service_role;
