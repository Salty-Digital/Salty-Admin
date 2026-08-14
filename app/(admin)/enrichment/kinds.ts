/** Enrichment job kinds — the `kind` half of enrichment_jobs' (ticket_id, kind) PK.
 * Kept out of actions.ts because a 'use server' module may only export async functions. */
export const ENRICHMENT_KINDS = ['geocode', 'sports_result', 'cast', 'setlist', 'verify'] as const
export type EnrichmentKind = (typeof ENRICHMENT_KINDS)[number]
