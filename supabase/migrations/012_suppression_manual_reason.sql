-- Allow admins to manually add an address to the suppression list (e.g. to block a
-- known-bad address proactively, before it ever bounces). Extends the reason check
-- from migration 011 with a third value, 'manual'.

alter table public.email_suppressions
  drop constraint if exists email_suppressions_reason_check;

alter table public.email_suppressions
  add constraint email_suppressions_reason_check
  check (reason in ('bounced', 'complained', 'manual'));
