# Salty — Progress

Source of truth for the website's progress section. Machine-readable copy: `public/progress.json`.

_Last updated: 2026-08-16_

---

## Summary

Three pieces of work: two enrichment pipelines repaired, and the Supabase migration history
rebaselined. All three were failing for the same underlying reason — **a dirty or diverged
key, not a provider outage** — which is why retrying had never helped.

| Workstream | Before | After | Of |
|---|---|---|---|
| Tickets with map coordinates | 0 | **19** | 29 |
| Sports tickets with a resolved game | 55 | **70** | 93 |
| Matching versions, repo ↔ prod ledger | 28 of 218 | **1** | 1 |

Tests: **2364 passing** (147 added). Wrong rows found and removed: **11**.
Foreign leagues on US-venue tickets: **0**. Prod schema changes: **0**.

---

## Venue geocoding

28 tickets — not the 20 first reported — sat permanently failed with `no related result`.

The provider was never at fault. It's Nominatim, which **has no API key**, and it returned
**HTTP 200 on every request**. The real cause: it returns an empty result when a venue *name*
is mashed together with a *street address* in one query. A fallback ladder existed to split
them, but only fired when the address sat on its own newline — so comma-separated
`Name, street, city, ST`, by far the most common shape, produced exactly one candidate: the
one form guaranteed to return nothing. **26 of 28 venues issued a single unanswerable query.**

**Result:** 19 resolved, 3 correctly marked not-geocodable (a URL, a bare country, a private
residence), 7 honest misses, no wrong pins.

---

## Sports game resolution

Tickets naming a single team never resolved an opponent: `parseSingleTeam` never returns
null, so noisy titles went to the API verbatim and matched nothing.

Cleaning the key exposed a worse problem — ambiguous nicknames resolved to the **wrong team**.
Live, `Mets` returned a Puerto Rican basketball club and `Giants` an Australian netball team.
An earlier revision wrote **11 confidently wrong rows** before a geography guard caught them;
all were removed and each is now covered by a regression test.

**Result:** 70 of 93 resolved, zero geographically impossible matches.

---

## Supabase migration history

The repo and prod's applied ledger had drifted to **125 files vs 218 rows, only 28 versions
in common**. `supabase db push` was unusable, so every migration went in by a route that
stamps its own version — widening the gap daily.

Verified before acting, which changed the plan: replaying the old repo produced **60 tables
against prod's 68**. It was a strict subset, missing eight admin/ops tables. Repairing the
ledger to match it would have made every future branch and reset **silently miss them** —
converting a visible drift into an invisible one.

So the baseline was dumped **from prod**, 192 files archived, and the ledger repaired to a
single row.

**Result:** `db push` reports "Remote database is up to date" again. Prod schema untouched;
the previous 218-row ledger is backed up.

---

## Shipped

- Query ladder segments on commas and dashes, not just newlines
- Locality is never dropped from a query when the venue supplies one
- Typo-tolerant fallback for misspelled venues (`Wriggly Field` → Wrigley Field)
- URLs, bare countries and private residences no longer enter the geocode queue
- Team abbreviations expanded (`NYR`, `D-backs`) for both search and verification
- Year-less dates placed by weekday inference (`Sun, Jul 26` → 2015-07-26)
- Geography guard — a result must be plausible for the ticket's coordinates
- Venue → home team index, learned from resolved tickets rather than hard-coded
- Migration baseline rebuilt from prod; `db push` restored

---

## Pending

From **Linear (team Salty)**, the source of truth.

| Issue | Priority | Status | Item |
|---|---|---|---|
| SAL2-458 | High | Backlog | **Connect the Supabase GitHub integration** — preview branches replay zero migrations without it |
| SAL2-455 | High | In Progress | Migration history reconciled; branching still broken, blocked on SAL2-458 |
| SAL2-19 | High | Todo | Renew GitHub token — **expired 2026-08-06**, overdue |
| SAL2-434 | High | Backlog | Rotate `SALTY_CRM_WEBHOOK_SECRET` — exposed in plaintext in a transcript |
| SAL2-363 | High | Backlog | Rotate `SUPABASE_SERVICE_ROLE_KEY` and Apple dev/dist certs |
| SAL2-345 | High | Backlog | Audit every secret in Doppler `salty-v2/prd` against dev |
| SAL2-445 | Medium | Blocked | Automated load testing — needs a working branch/staging target |
| SAL2-417 | High | Backlog | Restore Kanban view, description preview and min-score slider on `/pipeline` |
| SAL2-372 | High | Backlog | Revise beta feedback survey |
| SAL2-446 | — | Backlog | Check `salty-admin` for the same login bug as `salty-crm` |
| SAL2-366 | Medium | Backlog | Manual ticket-add cannot create past events, future only |
| SAL2-352 | Medium | Backlog | Close PostHog event-tracking gaps |

> **Source coverage.** Linear and Airtable were read directly. The **Notion Task Queue and raw
> meeting transcripts could not be reached** — the Notion connector is unauthorized and no
> transcripts exist on disk. Transcript items do flow into Linear via `task_extractor`, so
> they are likely represented above, but completeness is unconfirmed.

---

## Known gaps

- **Preview branches replay zero migrations** — the project has no GitHub integration connected (SAL2-458)
- Branch status reports `MIGRATIONS_PASSED` over an empty database; **assert on table count, never status**
- `eventsday.php` returns no venue field, so the venue-anchored sports path works through home team only
- A right-country but wrong-venue game can still slip through on the team-anchored path
- 23 of 93 sports tickets remain unresolved — mostly non-team events or titles naming no resolvable team
- Eight admin/ops tables reach prod from outside this repo, so schema arrives from more than one source
