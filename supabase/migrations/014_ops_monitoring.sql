-- Ops monitoring: turns the read-only /health page into a system that notices, notifies,
-- and (where a runbook exists) fixes. Four concerns:
--
--   alert_contacts      who gets told, and in what order
--   alert_settings      thresholds — one row, id = 1
--   health_incidents    one open row per failing check; alerts fire on state TRANSITIONS
--                       so a check that stays down doesn't re-mail every cron tick
--   health_remediations audit trail of every auto-fix attempt (deterministic or AI)
--
-- Plus llm_call_log: per-call token/cost accounting for every model call the admin makes.
--
-- All admin-only; the app talks to them with the service-role key, which bypasses RLS.
-- RLS is enabled with no policies so nothing else can read them.

-- ── Who to notify ────────────────────────────────────────────────────────────────
-- tier 1 = first responder (Rahul). tier 2 = escalation when tier 1 hasn't resolved it
-- within alert_settings.escalate_after_minutes (Chris, Pawel).
create table if not exists public.alert_contacts (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  tier        smallint not null default 1 check (tier in (1, 2)),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.alert_contacts enable row level security;

-- ── Thresholds ───────────────────────────────────────────────────────────────────
-- Single-row config table. The `id = 1` check keeps it that way.
create table if not exists public.alert_settings (
  id                        smallint primary key default 1 check (id = 1),
  -- Master switch. Off = incidents are still recorded, no email is sent.
  notify_enabled            boolean not null default true,
  -- Minutes an incident may stay open before tier 2 is pulled in.
  escalate_after_minutes    integer not null default 30 check (escalate_after_minutes > 0),
  -- Only alert on 'down'; 'warn' still opens an incident but stays silent unless this is
  -- set to 'warn'. Keeps advisory warnings (an unset optional key) out of the inbox.
  notify_min_severity       text not null default 'down' check (notify_min_severity in ('warn', 'down')),
  -- Master switch for auto-remediation. Off = the cron only observes and notifies.
  remediation_enabled       boolean not null default false,
  -- Cap on auto-fix attempts per incident, so a permanently broken check can't loop.
  max_remediation_attempts  integer not null default 3 check (max_remediation_attempts >= 0),
  -- Let the LLM ladder pick a runbook action when no deterministic rule matches.
  -- Off = deterministic runbooks only (free, and the safe default).
  ai_triage_enabled         boolean not null default false,
  updated_at                timestamptz not null default now()
);

alter table public.alert_settings enable row level security;

insert into public.alert_settings (id) values (1) on conflict (id) do nothing;

-- ── Incidents ────────────────────────────────────────────────────────────────────
-- One row per (check_name, occurrence). At most one 'open' row per check_name — enforced
-- by the partial unique index below, so a concurrent cron run can't double-open.
create table if not exists public.health_incidents (
  id                  uuid primary key default gen_random_uuid(),
  check_name          text not null,
  -- 'warn' | 'down' — mirrors the health page's Status type (minus 'ok').
  severity            text not null check (severity in ('warn', 'down')),
  status              text not null default 'open' check (status in ('open', 'resolved')),
  detail              text,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  resolved_at         timestamptz,
  -- Notification bookkeeping. Non-null = that tier has already been told about THIS
  -- incident, which is what keeps a persistent outage from re-mailing every tick.
  notified_tier1_at   timestamptz,
  notified_tier2_at   timestamptz,
  resolved_notified_at timestamptz,
  remediation_count   integer not null default 0
);

alter table public.health_incidents enable row level security;

create unique index if not exists health_incidents_one_open_per_check
  on public.health_incidents (check_name) where status = 'open';

create index if not exists health_incidents_first_seen_idx
  on public.health_incidents (first_seen_at desc);

-- ── Auto-remediation attempts ────────────────────────────────────────────────────
create table if not exists public.health_remediations (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid references public.health_incidents (id) on delete cascade,
  check_name   text not null,
  -- Allow-listed runbook action that ran, e.g. 'retry_failed_enrichment_jobs'.
  action       text not null,
  -- How the action was chosen: a deterministic rule, or which LLM tier picked it.
  decided_by   text not null default 'runbook',
  status       text not null check (status in ('succeeded', 'failed', 'skipped')),
  detail       text,
  ran_at       timestamptz not null default now()
);

alter table public.health_remediations enable row level security;

create index if not exists health_remediations_ran_at_idx
  on public.health_remediations (ran_at desc);

-- ── LLM token & cost accounting ──────────────────────────────────────────────────
-- Written by lib/llm/log.ts on every model call the admin panel makes. This is our own
-- ground truth: it attributes spend to a feature (`operation`) and an admin, which the
-- provider's own billing dashboard cannot do.
create table if not exists public.llm_call_log (
  id                     uuid primary key default gen_random_uuid(),
  -- 'admin' | 'edge' | 'cron' — which surface made the call.
  source                 text not null default 'admin',
  provider               text not null default 'anthropic',
  model                  text not null,
  -- Feature that spent the money, e.g. 'manual-edit.event-lookup'.
  operation              text not null,
  input_tokens           integer not null default 0,
  output_tokens          integer not null default 0,
  cache_read_tokens      integer not null default 0,
  cache_creation_tokens  integer not null default 0,
  -- Computed at write time from lib/llm/pricing.ts, so a later price change never
  -- silently rewrites historical spend.
  cost_usd               numeric(12, 6) not null default 0,
  ok                     boolean not null default true,
  error                  text,
  latency_ms             integer,
  admin_id               uuid,
  created_at             timestamptz not null default now()
);

alter table public.llm_call_log enable row level security;

create index if not exists llm_call_log_created_at_idx
  on public.llm_call_log (created_at desc);

create index if not exists llm_call_log_operation_idx
  on public.llm_call_log (operation, created_at desc);
