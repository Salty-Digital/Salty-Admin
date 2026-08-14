# Salty Admin — App-Parity & Complete-Setup Plan

**What this is:** a gap analysis of the admin panel against the mobile app's *current* data/feature surface, plus the full set of sections a complete admin for this app should have. The app grew a whole **canonical-events + enrichment** layer (Phases 0–3, shipped to `salty-mobile` main) that the admin has **no surface for at all**, plus several older app features that were never wired into the admin. Everything below targets the shared Supabase project `lzhrntjwnmrpwebmqyha` via the **service-role** server client, exactly like the existing pages.

**How the gaps were found:** grepped every `.from()/.rpc()` across `app/` + `lib/`. The admin already queries ~35 app tables. The canonical-event surface (`event_key`, `merged_into`, `enrichment_jobs`, `reconcile_event_strong_ids`, `get_event_setlist/get_event_cast`, `copy_*_from_sibling`) returned **zero files**; `direct_messages`, `privacy_settings`, `scan_runs`, `user_blocks`/reports returned **zero** too.

> **Update (2026-08-14) — P0–P2 shipped.** Canonical Events browser, Enrichment Pipeline, Data-Quality integrity, UGC moderation (`/moderation`), user-detail privacy, and Health scan-run telemetry are all built and the production build passes. See the status column below. Notes:
> - **One DB addition** (read-only): `public.get_enrichment_worker_runs(int)` — a `SECURITY DEFINER` bridge so the panel can read `net._http_response` (the `net` schema isn't exposed to PostgREST). Locked to `service_role` only.
> - **Reports queue** still needs its own table — `user_blocks` has no reason/action and there is no `reports` table, so moderation surfaces **blocks** only (as the plan's Backlog anticipated).
> - **Not yet built:** Kids/child-profiles (Super-Admin, COPPA-sensitive) and the P3 niceties.

---

## What the admin already covers (don't rebuild)

Users (list / `[id]` / active / engagement) · Tickets (+ bulk recategorise/status/delete, CSV export) · Pending Imports (queue, bulk approve/reject) · Email Connections (Gmail + IMAP, token-safe) · Moderation (photos / notes / tags) · Feedback · Notifications (push + broadcast) · Support Chat · Email (campaigns / suppressions / beta-invite / unsubscribe / Resend webhooks) · **Enrichment (per-ticket setlists / sports_stats / cast)** · Data-Quality · **Events/`[id]` (per-*ticket* detail)** · Social (friendships / followed_artists) · Discovery (saved_events / wishlists) · Photo-Scans (jobs + match proposals) · Health · Analytics / v2-analytics · AI-Usage · Build-Adoption · Beta-Signups · Release-Gate · Settings (admin-users / audit-log / config / feature-flags) · Profile.

Access model already in place: 4 levels (Super Admin / Admin / Moderator / Support), server-side re-checks on every action, `admin_audit_log`, PII masking, token exclusion. **Reuse all of this** — new pages plug into the same patterns.

---

## Gaps — priority-ordered

### 🔴 P0 · Canonical Events browser (entirely missing — the biggest gap)

The app now has a **canonical event** that many tickets across many users resolve to. The admin's `events/[id]` page is actually a **per-ticket** detail (it joins `tickets` + all the per-ticket child tables by one id) — there is **no cross-user, one-row-per-real-event view**, and nothing reads the new `events` columns.

**Schema now on `public.events`:** `event_key` (UNIQUE canonical id), `sport_api_id`, `setlistfm_id`, `phishnet_show_id`, `wikidata_qid`, `merged_into` (uuid → surviving event). `public.tickets.event_id` FKs to it. Identity precedence: `g:<sport_api_id>` > `sf:<setlistfm_id>` > `pn:<phishnet_show_id>` > fuzzy `title|day`.

**Server-callable SQL functions (service role):** `resolve_event_for_ticket(ticket)`, `get_or_create_event(...)`, `event_canonical_key(title,date,strong_id)`, `backfill_ticket_events(lim)`, `merge_events(loser,winner)`, `reconcile_event_strong_ids(lim)`, `get_event_setlist(ticket)`, `get_event_cast(ticket)`.

**Build:**
- **`/events` (new list)** — one row per canonical event (`WHERE merged_into IS NULL`): name, category, date, `event_key`, **# tickets**, **# distinct users**, strong-id badge (`g:`/`sf:`/`pn:`/fuzzy), merged-into count. Filters: category, keyed-vs-fuzzy, has-multiple-attendees, merged.
- **`/events/[id]` (repurpose or add a canonical view)** — every ticket at the event **across users** (owner + attendees), the **shared enrichment** (call `get_event_setlist`/`get_event_cast`), pooled photos, and **merge history** (`SELECT … WHERE merged_into = :id`). This is where cross-user convergence becomes visible.
- **Actions (Admin+, audited):** merge two events (`merge_events`), re-key / reconcile (`reconcile_event_strong_ids`), resolve an unlinked ticket (`resolve_event_for_ticket`). A "split" (undo a bad merge) is not yet a function — see Backlog.

*Why it matters:* this is the core of what shipped this session; without it the team can't see or fix how tickets collapse into events, or diagnose a bad/missing merge.

---

### 🔴 P0 · Enrichment pipeline health (the queue is invisible)

The existing Enrichment page shows per-ticket `setlists`/`sports_stats`/`ticket_cast` **results**, but not the **job queue** that produces them. That queue is now the whole enrichment engine.

**Schema:** `public.enrichment_jobs` PK `(ticket_id, kind)` — `kind` ∈ `geocode|sports_result|cast|setlist|verify`; `status` `pending|done|failed`; `attempts`, `max_attempts`, `next_attempt_at`, `last_error`. Driven by cron `enrichment-worker` (`*/10`) via `trigger_enrichment_worker()`; functions `enqueue_enrichment_jobs`, `claim_enrichment_jobs`, `complete_enrichment_job`.

**Build — `/enrichment` (add a "Pipeline" tab):**
- Counts by **(kind × status)**; **failed** jobs with `last_error`; **stuck/leased** jobs (`next_attempt_at` far in the future); attempts/backoff distribution.
- **Reconcile panel** — last `reconcile_event_strong_ids` result (rekeyed / merged), and a "Run reconcile" button (Admin+, audited).
- **Worker runs** — most recent `enrichment-worker` summary. Source: `net._http_response` (the pg_net response table the cron POSTs land in) — surface `status_code`, `content` (the JSON summary with `copied` counts), `created`.
- **Actions (Admin+):** retry a failed job (reset `status='pending', next_attempt_at=now()`), trigger a worker run (`trigger_enrichment_worker()`).

---

### 🟠 P1 · Data-Quality: strong-ID integrity (extend the existing page)

The Data-Quality page checks enrichment *completeness*. Add the **identity-integrity** checks (these are the exact queries used to find + fix the `setlistfm_id` corruption this session):

- **Corrupt strong ids** — a `setlistfm_id` (or `sport_api_id`) that spans **>1 canonical event** → the false-merge bug. `GROUP BY s.setlistfm_id HAVING count(distinct t.event_id) > 1`.
- **Reconcile candidates** — fuzzy-keyed events whose tickets carry a trusted strong id (`event_key NOT LIKE 'g:%'/'sf:%'/'pn:%'` but a strong id exists).
- **Unresolved tickets** — `status='active' AND event_id IS NULL`.
- **Merge/orphan health** — events with `merged_into` set; dangling `tickets.event_id` → nonexistent event (should be 0).
- **Wrong-artist setlists** — a setlist's songs on a ticket whose title doesn't match (the residual Les-Mis / SOFI-TUKKER class). Hard to auto-detect; surface same-`songs`-across-different-title as a candidate list.

Each: count + drill-down + (where safe) a one-click fix (reconcile / null a corrupt id / delete + re-enqueue).

---

### 🟠 P1 · UGC moderation gaps (safety / App Store Guideline 1.2)

- **Direct Messages** (`direct_messages` — **absent**): a read-only moderation view (recent / reported threads, redaction-aware), Moderator+. The app ships 1:1 DMs; there is currently no way to review them for abuse. This is an App-Store UGC-safety gap.
- **Block & Report queue** (`user_blocks` / reports — **absent**): the app ships block + report (required for UGC). Admin needs a **reports queue** (reporter, target user/content, reason, action: warn / ban / dismiss) and a **block list** view. Ties into the existing ban action.
- **Statuses / stories** (`statuses` — thin, 1 ref): event stories (`going`/`live`/`recap`) need a moderation surface (they're user text pinned to events).

---

### 🟡 P2 · Privacy, kids, ingestion telemetry

- **Privacy settings** (`privacy_settings` — **absent**): surface a user's `profile_visibility` / `share_events` / `allow_tagging` on **user detail** — needed for support ("why can't X see me?") and moderation. Read-only is enough.
- **Kids / child_profiles** (COPPA-sensitive, thin today): a dedicated, **Super-Admin-only** view — parent linkage, 13+ age gate compliance, never public. Treat as sensitive; audit every read.
- **Scan runs / ingestion telemetry** (`scan_runs` — absent; `ingestion_health` view unused): add to Health — per-run outcomes (`listed / fetched / passed_filter / accepted / failed / non_ticket`), plus the current `enrichment_jobs` backlog. Shows *why* imports did/didn't land.

---

### 🟢 P3 · Nice-to-haves

- **Festival plans** — `tickets.category_metadata.festival` (days + per-act "caught" + stage) inspector.
- **Sports enrichment coverage** — which games have box_score / lineup / highlight_clips; `sport_api_id` coverage %; feeds the new in-app sport→league drill-down.
- **Artist alerts** — `followed_artists` + `sent_artist_alerts` delivery view (who got alerted for which show).

---

## Complete-admin target map

| Section | Status | Notes |
|---|---|---|
| Users / detail / active / engagement | ✅ Have | |
| Tickets (+ bulk, export) | ✅ Have | |
| Pending Imports (bulk) | ✅ Have | |
| Email Connections (Gmail/IMAP) | ✅ Have | token-safe |
| Moderation: photos / notes / tags | ✅ Have | |
| Feedback / Notifications / Support Chat | ✅ Have | |
| Email campaigns / suppressions / unsubscribe | ✅ Have | |
| Analytics / v2 / AI-usage / build-adoption | ✅ Have | |
| Settings: admin-users / audit-log / config / flags | ✅ Have | |
| Enrichment **results** (per ticket) | ✅ Have | |
| **Canonical Events browser + detail** | ✅ **Shipped** | `/events` list + `/events/canonical/[id]`; cross-user, shared enrichment, merge history, audited merge |
| **Enrichment queue / worker / reconcile** | ✅ **Shipped** | `/enrichment` **Pipeline** tab: kind×status, failed/stuck, worker runs, retry / trigger / reconcile |
| **Data-Quality: strong-ID integrity** | ✅ **Shipped** | Identity-integrity panel: corrupt ids, reconcile candidates, unresolved, dangling, wrong-artist + fixes |
| **Direct Messages moderation** | ✅ **Shipped** | `/moderation` → Direct Messages (read-only threads) |
| **Block & Report queue** | 🟠 Partial | `/moderation` → Blocks (block list). A **reports** queue still needs a `reports` table (none exists) |
| Statuses / stories moderation | ✅ **Shipped** | `/moderation` → Stories |
| Privacy settings (on user detail) | ✅ **Shipped** | Privacy & safety card on `/users/[id]` |
| Kids / child profiles (Super-Admin) | 🟠 Thin (P2) | COPPA-sensitive — not yet built |
| Scan-runs / ingestion telemetry | ✅ **Shipped** | Scan-runs funnel + backlog on `/health` |
| Festival / sports-coverage / artist-alerts | 🟢 Nice (P3) | not yet built |

---

## Implementation notes

- **Reads:** service-role server client (`lib/supabase/server.ts`), same as every existing page. Regenerate the admin's Supabase types if it uses generated types, so the new `events`/`enrichment_jobs` columns + functions are typed.
- **Mutations** (merge, reconcile, retry, resolve): re-check access level server-side **and** write `admin_audit_log` — mirror the existing bulk-approve/ban pattern. Suggested gating: Events browse = **Moderator+**; merge / reconcile / retry-job = **Admin+**; Kids = **Super-Admin only**.
- **The canonical-event SQL functions are already granted to `service_role`** — call them via `.rpc(...)`; no new DB work needed for the P0s beyond the UI + audited action wrappers.
- **Charts:** reuse Recharts (queue-by-kind over time, reconcile rekeyed/merged trend, DM/report volume).
- **Backlog (needs new DB work, not just UI):** an event **split/unmerge** action (there's `merge_events` but no inverse); a persisted **worker-run log** table (today the only trace is `net._http_response`); song→artist verification for the wrong-artist-setlist check.

---

## Suggested build order

1. **Canonical Events** list + detail (read-only) — highest value, unblocks visibility.
2. **Enrichment queue** tab + worker-run surface (read-only).
3. **Data-Quality** integrity checks (read-only) → then the audited fix actions (reconcile / retry / merge).
4. **DMs + Block/Report** moderation (safety before broader launch).
5. Privacy on user-detail, scan-run telemetry on Health.
6. P3 niceties.
