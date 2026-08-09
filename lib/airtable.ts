/**
 * Read-only Airtable client for the "Beta Users Feedback" base (base id
 * appUUEmdTAOl9ZmXV) — in-app feedback, synced from Supabase via the
 * feedback-to-airtable edge function. This is the single source for the admin
 * Beta Feedback dashboard (the TestFlight base is deliberately not read here).
 *
 *   AIRTABLE_API_KEY                — personal access token (starts with `pat`),
 *                                     scoped to data.records:read on the base below.
 *   AIRTABLE_BETA_FEEDBACK_BASE_ID  — base id (defaults to appUUEmdTAOl9ZmXV).
 *
 * Read-only. Leave AIRTABLE_API_KEY unset to disable the page (it shows a setup
 * notice instead of erroring — same pattern as the v2 database / PostHog).
 */

export class AirtableNotConfiguredError extends Error {
  constructor() {
    super('Airtable is not configured — set AIRTABLE_API_KEY.')
    this.name = 'AirtableNotConfiguredError'
  }
}

/** True when an Airtable personal access token is present. */
export function isAirtableConfigured(): boolean {
  return Boolean(process.env.AIRTABLE_API_KEY)
}

const DEFAULT_BASE_ID = 'appUUEmdTAOl9ZmXV'
const FEEDBACK_TABLE_ID = 'tblC9Ssc8ayu0Nyjx'

// Stable field IDs on the Feedback table — we request returnFieldsByFieldId so a
// field rename in Airtable can't silently break the mapping.
const F = {
  summary: 'fldmLTZSvfOqVN4OC',
  message: 'fldMAdnVhLCvdTdmB',
  category: 'fldncvJRVPKQhlkf5',
  status: 'fldjoSdi2cqriK065',
  rating: 'fldlxzDrcdFUKdBXM',
  device: 'fldDBfueVcInySKhi',
  appVersion: 'fldZmnikRBd7LJCD4',
  featurePage: 'fldCFZbbQoka9iz0O',
  submittedAt: 'fldkp0NvQCMNNNwqM',
  screenshots: 'fldkQKrvPs9FHDyqk',
} as const

export type Platform = 'iOS' | 'Android' | 'Unknown'

export interface Screenshot {
  url: string
  thumb: string
}

export interface BetaFeedbackRow {
  id: string
  summary: string
  message: string
  category: string
  status: string
  rating: number | null
  device: string
  platform: Platform
  appVersion: string
  build: number | null
  featurePage: string
  submittedAt: string | null
  screenshots: Screenshot[]
}

function platformFromDevice(device: string): Platform {
  if (/android/i.test(device)) return 'Android'
  if (/ios|iphone|ipad/i.test(device)) return 'iOS'
  return 'Unknown'
}

/** App Version looks like "1.0.0 (40)" — the build number lives in the parens. */
function buildFromAppVersion(v: string): number | null {
  const m = v.match(/\((\d+)\)/)
  return m ? Number(m[1]) : null
}

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

/** Fetch every row from the Beta Users Feedback base, newest first. */
export async function fetchBetaFeedback(): Promise<BetaFeedbackRow[]> {
  const key = process.env.AIRTABLE_API_KEY
  if (!key) throw new AirtableNotConfiguredError()
  const baseId = process.env.AIRTABLE_BETA_FEEDBACK_BASE_ID || DEFAULT_BASE_ID

  const rows: BetaFeedbackRow[] = []
  let offset: string | undefined
  // Page through (100/page); cap at 50 pages (5k rows) as a safety valve.
  for (let page = 0; page < 50; page++) {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${FEEDBACK_TABLE_ID}`)
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('returnFieldsByFieldId', 'true')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate: 60 },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Airtable request failed (HTTP ${res.status}). ${text.slice(0, 200)}`)
    }

    const json = (await res.json()) as { records?: AirtableRecord[]; offset?: string }
    for (const rec of json.records ?? []) {
      const f = rec.fields
      const str = (id: string) => (typeof f[id] === 'string' ? (f[id] as string) : '')
      const device = str(F.device)
      const appVersion = str(F.appVersion)
      const ratingRaw = f[F.rating]
      const attach = f[F.screenshots]
      const screenshots: Screenshot[] = Array.isArray(attach)
        ? attach
            .map((a) => {
              const o = (a ?? {}) as {
                url?: unknown
                thumbnails?: { large?: { url?: unknown }; small?: { url?: unknown } }
              }
              const url = typeof o.url === 'string' ? o.url : ''
              const thumb =
                (typeof o.thumbnails?.large?.url === 'string' ? o.thumbnails.large.url : '') ||
                (typeof o.thumbnails?.small?.url === 'string' ? o.thumbnails.small.url : '') ||
                url
              return { url, thumb }
            })
            .filter((s) => s.url)
        : []
      rows.push({
        id: rec.id,
        summary: str(F.summary),
        message: str(F.message),
        category: str(F.category) || 'Uncategorized',
        status: str(F.status) || 'New',
        rating: typeof ratingRaw === 'number' ? ratingRaw : null,
        device,
        platform: platformFromDevice(device),
        appVersion,
        build: buildFromAppVersion(appVersion),
        featurePage: str(F.featurePage),
        submittedAt: str(F.submittedAt) || null,
        screenshots,
      })
    }

    offset = json.offset
    if (!offset) break
  }

  rows.sort((a, b) => {
    const ta = a.submittedAt ? Date.parse(a.submittedAt) : 0
    const tb = b.submittedAt ? Date.parse(b.submittedAt) : 0
    return tb - ta
  })
  return rows
}
