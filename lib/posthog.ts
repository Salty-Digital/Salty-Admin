/**
 * Read-only PostHog query client for admin analytics (build adoption, etc.).
 *
 * PostHog's ingestion ("project") API keys are write-only, so querying needs a
 * **Personal API key** scoped to `query:read` (+ `project:read`):
 *   POSTHOG_API_KEY     — personal API key (starts with `phx_`)
 *   POSTHOG_PROJECT_ID  — numeric project id (defaults to 489677, the Salty project)
 *   POSTHOG_HOST        — API host (defaults to https://us.posthog.com)
 *
 * The panel only ever runs read-only HogQL SELECTs against this connection. Leave
 * POSTHOG_API_KEY unset to disable the feature — pages show a "not connected" notice
 * (same pattern as the v2 database / Beta Signups page) instead of erroring.
 */

export class PostHogNotConfiguredError extends Error {
  constructor() {
    super('PostHog is not configured — set POSTHOG_API_KEY (and optionally POSTHOG_PROJECT_ID).')
    this.name = 'PostHogNotConfiguredError'
  }
}

/** True when a PostHog personal API key is present. Lets pages show a setup notice instead of erroring. */
export function isPostHogConfigured(): boolean {
  return Boolean(process.env.POSTHOG_API_KEY)
}

const DEFAULT_PROJECT_ID = '489677'
const DEFAULT_HOST = 'https://us.posthog.com'

/**
 * Run a HogQL query against PostHog's query API and return the raw columns + row
 * arrays (results are arrays of values in column order, PostHog's native shape).
 */
export async function posthogQuery(
  hogql: string,
): Promise<{ columns: string[]; results: unknown[][] }> {
  const key = process.env.POSTHOG_API_KEY
  if (!key) throw new PostHogNotConfiguredError()
  const projectId = process.env.POSTHOG_PROJECT_ID || DEFAULT_PROJECT_ID
  const host = (process.env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/$/, '')

  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: hogql } }),
    // Analytics tolerate slight staleness; cache 60s so refreshes don't hammer PostHog.
    next: { revalidate: 60 },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PostHog query failed (HTTP ${res.status}). ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as { columns?: string[]; results?: unknown[][] }
  return { columns: json.columns ?? [], results: json.results ?? [] }
}
