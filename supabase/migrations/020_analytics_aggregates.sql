-- Behavioural analytics for /analytics and the dashboard.
--
-- The existing pages count things (users, tickets, photos). These answer the questions those counts
-- cannot: are users ACTIVATING, which capture path actually works, and is enrichment keeping up.
--
-- In Postgres rather than PostgREST selects for the usual reason on this project: a response is
-- capped at 1000 rows regardless of .limit(), so anything reduced in JS silently becomes "the first
-- 1000". The existing analytics page already selects whole tables unbounded — fine at today's
-- volume, wrong the moment tickets passes 1000.
--
-- All read-only, SECURITY DEFINER, service_role only. No PII: counts and buckets only.

create or replace function public.analytics_activation()
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
  with t as (
    select user_id, count(*) as n from public.tickets where status = 'active' group by user_id
  )
  select
    (select count(*) from public.users)                                              as total_users,
    (select count(*) from t)                                                          as with_ticket,
    (select count(*) from t where n >= 2)                                             as with_2plus_tickets,
    (select count(distinct user_id) from (
       select user_id from public.gmail_connections
       union select user_id from public.imap_connections
       union select user_id from public.inbound_email_addresses) u)                   as with_inbox,
    (select count(distinct user_id) from public.photo_scan_jobs)                       as with_photo_scan,
    (select count(*) from public.users where last_seen_at >= now() - interval '7 days')  as seen_last_7d,
    (select count(*) from public.users where last_seen_at >= now() - interval '30 days') as seen_last_30d,
    (select round(avg(n), 1) from t)                                                   as avg_tickets_per_active;
$$;

create or replace function public.analytics_source_effectiveness()
returns table (
  source          text,
  tickets         bigint,
  users_reached   bigint,
  first_seen      timestamptz,
  last_seen       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select t.source,
         count(*)                     as tickets,
         count(distinct t.user_id)    as users_reached,
         min(t.imported_at)           as first_seen,
         max(t.imported_at)           as last_seen
  from public.tickets t
  where t.source is not null
  group by t.source
  order by tickets desc;
$$;

create or replace function public.analytics_enrichment_coverage()
returns table (
  kind        text,
  total_jobs  bigint,
  done        bigint,
  pending     bigint,
  failed      bigint,
  exhausted   bigint,
  pct_done    numeric
)
language sql
security definer
set search_path = public
as $$
  select j.kind,
         count(*)                                                                as total_jobs,
         count(*) filter (where j.status = 'done')                               as done,
         count(*) filter (where j.status = 'pending')                            as pending,
         count(*) filter (where j.status = 'failed')                             as failed,
         count(*) filter (where j.status = 'failed' and j.attempts >= j.max_attempts) as exhausted,
         round(100.0 * count(*) filter (where j.status = 'done') / nullif(count(*), 0), 1) as pct_done
  from public.enrichment_jobs j
  group by j.kind
  order by total_jobs desc;
$$;

create or replace function public.analytics_time_to_first_ticket()
returns table (bucket text, users bigint, sort_order int)
language sql
security definer
set search_path = public
as $$
  with first_ticket as (
    select t.user_id, min(t.imported_at) as first_at
    from public.tickets t group by t.user_id
  ),
  gap as (
    select extract(epoch from (f.first_at - u.created_at)) / 3600.0 as hours
    from first_ticket f join public.users u on u.id = f.user_id
    where f.first_at >= u.created_at
  )
  select b.bucket, count(g.hours), b.sort_order
  from (values
    ('< 1 hour', 1), ('1–24 hours', 2), ('1–7 days', 3), ('> 7 days', 4)
  ) as b(bucket, sort_order)
  left join gap g on b.bucket = case
    when g.hours < 1   then '< 1 hour'
    when g.hours < 24  then '1–24 hours'
    when g.hours < 168 then '1–7 days'
    else '> 7 days'
  end
  group by b.bucket, b.sort_order
  order by b.sort_order;
$$;

revoke all on function public.analytics_activation()            from public, anon, authenticated;
revoke all on function public.analytics_source_effectiveness()  from public, anon, authenticated;
revoke all on function public.analytics_enrichment_coverage()   from public, anon, authenticated;
revoke all on function public.analytics_time_to_first_ticket()  from public, anon, authenticated;
grant execute on function public.analytics_activation()           to service_role;
grant execute on function public.analytics_source_effectiveness() to service_role;
grant execute on function public.analytics_enrichment_coverage()  to service_role;
grant execute on function public.analytics_time_to_first_ticket() to service_role;
