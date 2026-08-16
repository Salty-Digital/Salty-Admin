-- Saved knowledge-base answers — a growing FAQ.
--
-- The second person to ask "how do I add an enrichment kind?" should not pay for another Sonnet
-- call over a 29k-token corpus. Saving an answer also makes it reviewable: a wrong answer can be
-- deleted, which an ephemeral chat response cannot.
--
-- corpus_generated_at is stored WITH the answer so a saved entry can be shown as potentially stale
-- once the corpus moves past it — the same failure the /health corpus check guards against, but
-- per-answer.
create table if not exists public.kb_saved_answers (
  id                   uuid primary key default gen_random_uuid(),
  question             text not null,
  answer               text not null,
  tools_used           text[] not null default '{}',
  corpus_generated_at  timestamptz,
  saved_by             uuid references public.admin_users(id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists kb_saved_answers_created_idx on public.kb_saved_answers (created_at desc);

-- Admin-only data: RLS on with NO policies, reachable solely through the service role, exactly like
-- the other admin tables (alert_contacts, health_incidents, llm_call_log).
alter table public.kb_saved_answers enable row level security;
revoke all on table public.kb_saved_answers from anon, authenticated;
