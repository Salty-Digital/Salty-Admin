/**
 * Canonical ticket taxonomy for the admin panel — kept in sync with the app's
 * source of truth at salty-mobile/lib/categories.ts. When the mobile app adds or
 * renames a category or source, update THIS one file and every admin dropdown,
 * filter, validator, chart, and emoji stays correct.
 *
 * History: the admin previously hardcoded a stale list (`dining`, and missing
 * `edm`/`comedy`/`talk`) in ~8 places, which silently downgraded approved imports
 * to `other` and blocked editing those tickets.
 */

export const TICKET_CATEGORIES = [
  'concert',
  'festival',
  'edm',
  'sports',
  'theater',
  'comedy',
  'talk',
  'restaurant',
  'trip',
  'other',
] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

/** Display labels (mirror the app's CATEGORY_META labels). */
export const CATEGORY_LABELS: Record<string, string> = {
  concert: 'Concert',
  festival: 'Festival',
  edm: 'EDM',
  sports: 'Sports',
  theater: 'Theatre',
  comedy: 'Comedy',
  talk: 'Talk',
  restaurant: 'Restaurant',
  trip: 'Trip',
  other: 'Other',
}

/** Accent colors mirrored from the app's CATEGORY_META (charts, legends, dots). */
export const CATEGORY_COLORS: Record<string, string> = {
  concert: '#7C3AED',
  festival: '#D98A0B',
  edm: '#DB2777',
  sports: '#E8581A',
  theater: '#0E9F8B',
  comedy: '#C99700',
  talk: '#2563EB',
  restaurant: '#E2742B',
  trip: '#0891B2',
  other: '#5B6190',
}

/** Emoji per category (mirror the app's CATEGORY_META emoji). */
export const CATEGORY_EMOJI: Record<string, string> = {
  concert: '🎵',
  festival: '🎪',
  edm: '🎧',
  sports: '⚾',
  theater: '🎭',
  comedy: '😂',
  talk: '🎤',
  restaurant: '🍽️',
  trip: '✈️',
  other: '✨',
}

/**
 * Known ticket sources — the app's SOURCE_META (gmail, imap, photo, calendar,
 * manual, autocapture, wallet, shared) plus the enrichment/import sources that
 * appear on the tickets table (songkick, concertarchives, setlistfm, forward).
 */
export const TICKET_SOURCES = [
  'gmail',
  'imap',
  'photo',
  'calendar',
  'manual',
  'autocapture',
  'wallet',
  'shared',
  'songkick',
  'concertarchives',
  'setlistfm',
  'forward',
] as const

/** Whether a raw value is one of the canonical categories. */
export function isKnownCategory(c: unknown): c is TicketCategory {
  return typeof c === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(c)
}

/** Display label for a raw category string (falls back to the raw value, capitalized-ish). */
export function categoryLabel(raw: string | null | undefined): string {
  if (!raw) return '—'
  return CATEGORY_LABELS[raw] ?? raw
}
