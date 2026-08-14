/**
 * Helpers for the canonical-event surface (the `public.events` table the app resolves
 * every ticket to). Mirrors the app's identity model: an event's `event_key` is a
 * strong id when it carries a `g:`/`sf:`/`pn:` prefix, otherwise a fuzzy `title|date`.
 * Precedence: g: (sports) > sf: (setlist.fm) > pn: (phish.net) > fuzzy.
 */

export type EventKeyKind = 'sport' | 'setlist' | 'phish' | 'fuzzy' | 'none'

export interface EventKeyBadge {
  kind: EventKeyKind
  /** Short label for the badge, e.g. "Sports API". */
  label: string
  /** Accent color for the badge chip. */
  color: string
  /** The strong id itself (without prefix) when keyed, else null. */
  strongId: string | null
}

const BADGES: Record<EventKeyKind, { label: string; color: string }> = {
  sport:   { label: 'Sports API',  color: '#5A8FBF' },
  setlist: { label: 'setlist.fm',  color: '#7B44A8' },
  phish:   { label: 'Phish.net',   color: '#3E8A5A' },
  fuzzy:   { label: 'Fuzzy',       color: '#C8A96E' },
  none:    { label: 'No key',      color: '#9A8F82' },
}

/** Classify an event_key into a strong-id badge. */
export function classifyEventKey(eventKey: string | null | undefined): EventKeyBadge {
  if (!eventKey) return { kind: 'none', ...BADGES.none, strongId: null }
  if (eventKey.startsWith('g:'))  return { kind: 'sport',   ...BADGES.sport,   strongId: eventKey.slice(2) }
  if (eventKey.startsWith('sf:')) return { kind: 'setlist', ...BADGES.setlist, strongId: eventKey.slice(3) }
  if (eventKey.startsWith('pn:')) return { kind: 'phish',   ...BADGES.phish,   strongId: eventKey.slice(3) }
  return { kind: 'fuzzy', ...BADGES.fuzzy, strongId: null }
}

/** Whether an event_key is a trusted strong id (vs. a fuzzy title|date). */
export function isStrongKey(eventKey: string | null | undefined): boolean {
  const k = classifyEventKey(eventKey).kind
  return k === 'sport' || k === 'setlist' || k === 'phish'
}

/** Format a canonical event's timestamptz `event_date` as a short date. */
export function fmtEventDate(iso: string | null | undefined): string {
  if (!iso) return 'No date'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return 'No date'
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
