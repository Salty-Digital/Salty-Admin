import { TICKET_CATEGORIES, CATEGORY_LABELS } from './categories'

// Salty's edge functions call Anthropic over raw fetch with a forced tool call (see
// enrich-cast); the admin app has no SDK installed, so we mirror that proven pattern —
// no new dependency, and it's known to work on this account's key.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

// Haiku 4.5 is what the mobile app already uses for enrichment, so this account's key is
// guaranteed to have it. Swap this one string for stronger recall if your key has access
// (e.g. 'claude-opus-5' — but that also needs its own availability on the key).
const MODEL = 'claude-haiku-4-5-20251001'

export interface EventLookupInput {
  title: string
  date?: string | null
  venue?: string | null
  category?: string | null
}

export interface EventLookupResult {
  known: boolean
  title: string
  performer: string
  venue_name: string
  city: string
  date_str: string
  time_str: string
  category: string
  price_estimate: string
  description: string
  tags: string[]
  notable_people: { name: string; role: string }[]
  sports: {
    home_team: string; away_team: string; home_score: string; away_score: string
    league: string; status: string
    sport: string; venue: string; city: string; season: string; attendance: string
  } | null
}

// A forced tool call is how we get structured output — the model must return exactly
// these fields (empty strings when unknown), so there's no brittle text parsing.
const REPORT_EVENT_TOOL = {
  name: 'report_event',
  description: 'Report the known details of a live event to help an admin complete a ticket record.',
  input_schema: {
    type: 'object',
    properties: {
      known: { type: 'boolean', description: 'Whether you can confidently identify this specific event.' },
      title: { type: 'string' },
      performer: { type: 'string', description: 'Headlining artist, team matchup, show, or production.' },
      venue_name: { type: 'string' },
      city: { type: 'string' },
      date_str: { type: 'string' },
      time_str: { type: 'string' },
      category: { type: 'string', enum: [...TICKET_CATEGORIES] },
      price_estimate: { type: 'string', description: 'Rough typical ticket price range, e.g. "$80–$150".' },
      description: { type: 'string', description: 'One concise sentence describing the event.' },
      tags: {
        type: 'array',
        description: 'A few short, factual labels for this event — league/competition, tour, genre, rivalry, milestone (e.g. "MLB", "Subway Series", "Eras Tour"). 2–5 max. Not personal or speculative.',
        items: { type: 'string' },
      },
      notable_people: {
        type: 'array',
        description: 'Theatre cast/creatives or concert opening acts (name + role). Empty otherwise.',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, role: { type: 'string' } },
          required: ['name'],
        },
      },
      sports: {
        type: 'object',
        description: 'For a sports GAME, the matchup and full context. Omit for non-game sports tickets (stadium tours, experiences).',
        properties: {
          home_team: { type: 'string' },
          away_team: { type: 'string' },
          home_score: { type: 'integer' },
          away_score: { type: 'integer' },
          league: { type: 'string', description: 'e.g. "MLB", "NBA".' },
          status: { type: 'string', description: 'e.g. "Final".' },
          sport: { type: 'string', description: 'e.g. "Baseball", "Basketball".' },
          venue: { type: 'string' },
          city: { type: 'string' },
          season: { type: 'string', description: 'e.g. "2019".' },
          attendance: { type: 'integer' },
        },
      },
    },
    required: ['known'],
  },
} as const

function buildPrompt(input: EventLookupInput): string {
  const parts = [`Event title: "${input.title}"`]
  if (input.date) parts.push(`Date: "${input.date}"`)
  if (input.venue) parts.push(`Venue: "${input.venue}"`)
  if (input.category) parts.push(`Category hint: "${input.category}"`)
  return [
    'An admin is correcting and completing the details of a live-event ticket. Here is what is known:',
    parts.join('\n'),
    'Report your best knowledge of THIS specific event via the report_event tool.',
    'Fill EVERY field you can for this event, not just the title — time, a rough price range, a one-line description, and 2–5 factual tags. For a sports game, fill the `sports` object as fully as you can: both teams, the final score, sport, league, venue, city, season, and attendance if known (omit `sports` for non-game tickets like stadium tours).',
    'Only fill a field when you are reasonably confident it is correct for this event. Use empty strings / an empty array for anything you do not know, and set known=false if you cannot identify the event at all. Never invent specifics — in particular, do not guess exact scores or attendance you are unsure of.',
  ].join('\n')
}

export async function aiEventLookup(
  input: EventLookupInput,
): Promise<{ ok: true; data: EventLookupResult } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not set in the admin environment.' }
  }
  if (!input.title?.trim()) return { ok: false, error: 'A title is required to search.' }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [REPORT_EVENT_TOOL],
        tool_choice: { type: 'tool', name: 'report_event' },
        messages: [{ role: 'user', content: buildPrompt(input) }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `AI lookup failed (${res.status}). ${body.slice(0, 300)}` }
    }
    const json = (await res.json()) as { content?: { type: string; input?: Record<string, unknown> }[] }
    const input_ = json.content?.find((b) => b.type === 'tool_use')?.input
    if (!input_) return { ok: false, error: 'The model returned no result. Try again.' }

    const p = input_ as Partial<EventLookupResult> & { sports?: Record<string, unknown> }
    const people = Array.isArray(p.notable_people)
      ? p.notable_people
          .filter((x) => x && typeof x.name === 'string' && x.name.trim())
          .map((x) => ({ name: String(x.name).trim(), role: String(x.role ?? '').trim() }))
      : []
    const sp = p.sports
    const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
    const sports =
      sp && (sp.home_team || sp.away_team || sp.home_score != null || sp.away_score != null)
        ? {
            home_team: str(sp.home_team),
            away_team: str(sp.away_team),
            home_score: str(sp.home_score),
            away_score: str(sp.away_score),
            league: str(sp.league),
            status: str(sp.status),
            sport: str(sp.sport),
            venue: str(sp.venue),
            city: str(sp.city),
            season: str(sp.season),
            attendance: str(sp.attendance),
          }
        : null
    const tags = Array.isArray(p.tags)
      ? [...new Set(p.tags.map((t) => str(t)).filter(Boolean))].slice(0, 8)
      : []
    return {
      ok: true,
      data: {
        known: !!p.known,
        title: String(p.title ?? '').trim(),
        performer: String(p.performer ?? '').trim(),
        venue_name: String(p.venue_name ?? '').trim(),
        city: String(p.city ?? '').trim(),
        date_str: String(p.date_str ?? '').trim(),
        time_str: String(p.time_str ?? '').trim(),
        category: String(p.category ?? '').trim(),
        price_estimate: String(p.price_estimate ?? '').trim(),
        description: String(p.description ?? '').trim(),
        tags,
        notable_people: people,
        sports,
      },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ── Category verification ──────────────────────────────────────────────────────────
// Independently classifies a ticket so we can catch mislabels (e.g. a Rachael Ray taping
// stored as "theater" when it's really "talk"). Cheaper/faster than a full event lookup.
export interface CategoryAssessment {
  category: string
  confident: boolean
  reason: string
}

const ASSESS_CATEGORY_TOOL = {
  name: 'assess_category',
  description: 'State the single best-fitting category for a live-event ticket.',
  input_schema: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...TICKET_CATEGORIES], description: 'The single best-fitting category for this event.' },
      confident: { type: 'boolean', description: 'True only if you can confidently tell what kind of event this is.' },
      reason: { type: 'string', description: 'One short sentence: what the event actually is and why that category fits.' },
    },
    required: ['category', 'confident', 'reason'],
  },
} as const

function buildCategoryPrompt(input: CategoryVerifyInput): string {
  const parts = [`Event title: "${input.title}"`]
  if (input.venue) parts.push(`Venue: "${input.venue}"`)
  if (input.date) parts.push(`Date: "${input.date}"`)
  const labels = TICKET_CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(', ')
  return [
    'Classify this live-event ticket into exactly one category. Here is what is known:',
    parts.join('\n'),
    `Allowed categories: ${labels}.`,
    'Judge from what the event ACTUALLY is, independent of any existing label or the venue name. Examples: a TV talk-show taping is "talk" even at a theatre; a circus, ice show, or family variety show ("Disney on Ice", "Sesame Street Live") is "other", not "theater"; a stand-up show is "comedy"; a play or musical is "theater".',
    'Report via the assess_category tool. Set confident=false and choose "other" only if you truly cannot tell what the event is.',
  ].join('\n')
}

export interface CategoryVerifyInput {
  title: string
  venue?: string | null
  date?: string | null
}

export async function verifyTicketCategory(
  input: CategoryVerifyInput,
): Promise<{ ok: true; data: CategoryAssessment } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set in the admin environment.' }
  if (!input.title?.trim()) return { ok: false, error: 'A title is required to check the category.' }

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        tools: [ASSESS_CATEGORY_TOOL],
        tool_choice: { type: 'tool', name: 'assess_category' },
        messages: [{ role: 'user', content: buildCategoryPrompt(input) }],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `AI category check failed (${res.status}). ${body.slice(0, 200)}` }
    }
    const json = (await res.json()) as { content?: { type: string; input?: Record<string, unknown> }[] }
    const out = json.content?.find((b) => b.type === 'tool_use')?.input as Partial<CategoryAssessment> | undefined
    if (!out) return { ok: false, error: 'The model returned no result. Try again.' }
    const category = String(out.category ?? '').trim()
    if (!(TICKET_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: 'The model returned an unknown category.' }
    return { ok: true, data: { category, confident: !!out.confident, reason: String(out.reason ?? '').trim() } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
