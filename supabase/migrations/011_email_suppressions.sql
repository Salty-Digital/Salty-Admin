-- Hard-bounce / spam-complaint suppression list, keyed by email address.
-- Populated by the Resend webhook (/api/webhooks/resend) whenever a message to an
-- address permanently bounces or is marked as spam. resolveRecipients() drops any
-- address listed here from every broadcast and custom send, so a young sending
-- domain's reputation isn't eroded by re-mailing dead addresses or complainers.

create table if not exists public.email_suppressions (
  email       text primary key,          -- lowercased recipient address
  reason      text not null check (reason in ('bounced', 'complained')),
  event_type  text,                       -- raw Resend event, e.g. 'email.bounced'
  detail      jsonb,                      -- raw bounce/complaint payload, for debugging
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Admin-only table; the admin app talks to it via the service-role key, which
-- bypasses RLS. Enable RLS with no policies so nothing else can read it.
alter table public.email_suppressions enable row level security;

create index if not exists email_suppressions_created_at_idx
  on public.email_suppressions (created_at desc);
