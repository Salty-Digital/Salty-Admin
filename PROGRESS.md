# Salty — Progress

Source of truth for the website's progress section. Machine-readable copy: `public/progress.json`.

_Last updated: 2026-08-16_

---

## Summary

Two enrichment pipelines were repaired. Both were failing silently — and in both cases the
cause was a **dirty search key**, not a provider outage. That distinction mattered: the
obvious fixes (check the API key, retry the failures) would have found nothing.

| Workstream | Before | After | Of |
|---|---|---|---|
| Tickets with map coordinates | 0 | **19** | 29 |
| Sports tickets with a resolved game | 55 | **70** | 93 |

Test suite: **2364 passing** (147 added). Wrong rows found and removed: **11**.
Foreign leagues sitting on US-venue tickets: **0**.

---

## Venue geocoding

28 tickets — not the 20 first reported — sat permanently failed with `no related result`.

The instinct was to blame the geocoder. That was wrong on every count: the provider is
Nominatim, which **has no API key**, and it returned **HTTP 200 on every request**. No auth
failure, no quota exhaustion.

The real cause: Nominatim returns an empty result when a venue *name* is mashed together with
a *street address* in one query. A fallback ladder existed to split them — but only fired when
the address sat on its own newline. Comma-separated `Name, street, city, ST` — by far the most
common shape — produced exactly one candidate: the one form guaranteed to return nothing.
**26 of 28 venues issued a single unanswerable query.**

**Result:** 19 resolved, 3 correctly marked not-geocodable (a URL, a bare country, a private
residence), 7 honest misses, no wrong pins.

---

## Sports game resolution

Tickets naming a single team (`NY Rangers`, `Shenkman Mets Game`) never resolved an opponent.
`parseSingleTeam` never returns null — it passed noisy titles to the API verbatim, which
matched nothing, so the lookup died before reaching any fixture.

Cleaning the key exposed a worse problem: ambiguous nicknames resolved to the **wrong team**.
Live, `Mets` returned a Puerto Rican basketball club and `Giants` an Australian netball team.

The fix uses the ticket's venue to disambiguate the team, then a geography guard to reject
results that cannot be where the ticket was. An earlier revision of this work wrote **11
confidently wrong rows** — a Vermont college hockey ticket resolving to English football, a
Madison Square Garden ticket to a Scottish match. All were caught and removed; regression
tests now cover each one.

**Result:** 70 of 93 resolved, every remaining wrong row removed, zero geographically
impossible matches.

---

## Shipped

- Query ladder segments on commas and dashes, not just newlines
- Locality is never dropped from a query when the venue supplies one
- Typo-tolerant fallback for misspelled venues (`Wriggly Field` → Wrigley Field)
- URLs, bare countries and private residences no longer enter the geocode queue
- Team abbreviations expanded (`NYR`, `D-backs`) for both search and verification
- Year-less dates placed by weekday inference (`Sun, Jul 26` → 2015-07-26)
- Geography guard — a result must be plausible for the ticket's coordinates
- Venue → home team index, learned from already-resolved tickets rather than hard-coded

## Known gaps

- `eventsday.php` returns no venue field, so the venue-anchored path works through home team only
- A right-country but wrong-venue game can still slip through on the team-anchored path
- Tickets with venue `TBD` have no venue signal available at all
