import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isPostHogConfigured, posthogQuery } from '@/lib/posthog'
import { Apple, Smartphone } from 'lucide-react'

// Active-user window the distribution is computed over.
const WINDOW_DAYS = 30

// Per-PERSON current build (build on their most recent event) + the person's distinct_ids
// and last_seen, so the page can resolve the person to a real Supabase user and count one
// current build per UNIQUE user. Counting persons directly would inflate the tester numbers
// past the real user base (anonymous / pre-login sessions are their own persons). Junk build
// numbers (a stray 1017756 appears in the data) are filtered to a sane range.
const ADOPTION_SQL = `
SELECT
  person_id,
  groupUniqArray(distinct_id) AS distinct_ids,
  argMax(properties.$os, timestamp) AS platform,
  argMax(toInt(properties.$app_build), timestamp) AS current_build,
  max(timestamp) AS last_seen
FROM events
WHERE timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY
  AND properties.$app_build IS NOT NULL
  AND toInt(properties.$app_build) BETWEEN 1 AND 100000
GROUP BY person_id
ORDER BY last_seen DESC
LIMIT 500
`.trim()

interface BuildBucket {
  build: number
  testers: number
}

interface PlatformAdoption {
  platform: string
  label: string
  hint: string
  Icon: typeof Apple
  latest: number
  buckets: BuildBucket[]
  total: number
  onLatest: number
  oneBehind: number
  stale: number
}

const PLATFORM_META: Record<string, { label: string; hint: string; Icon: typeof Apple }> = {
  ios: { label: 'iOS', hint: 'TestFlight', Icon: Apple },
  android: { label: 'Android', hint: 'Play internal test', Icon: Smartphone },
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

export default async function BuildAdoptionPage() {
  await requireAdmin(3)
  const db = createServiceClient()

  // Latest build per platform comes from the release gate (self-reported newest install).
  const { data: gateData } = await db
    .from('app_release_gate')
    .select('platform, latest_build')
  const latestByPlatform = new Map<string, number>(
    (gateData ?? []).map((r) => [r.platform, r.latest_build as number]),
  )

  const configured = isPostHogConfigured()
  let queryError: string | null = null
  // platform ('ios'/'android') -> build -> unique-tester count
  const rawByPlatform = new Map<string, BuildBucket[]>()

  if (configured) {
    // Real users, so each tester is counted once and anonymous / pre-login PostHog
    // persons (which would inflate the counts past the real user base) are excluded.
    const { data: usersData } = await db.from('users').select('id')
    const userIds = new Set((usersData ?? []).map((u) => u.id as string))

    try {
      const { results } = await posthogQuery(ADOPTION_SQL)

      // Collapse to one current build per real user (their latest event wins).
      const byUser = new Map<string, { platform: string; build: number; lastSeen: number }>()
      for (const row of results) {
        const dids = Array.isArray(row[1]) ? (row[1] as unknown[]).map(String) : []
        const uid = dids.find((d) => userIds.has(d))
        if (!uid) continue
        const platform = String(row[2]).toLowerCase()
        const build = Number(row[3])
        const lastSeen = new Date(String(row[4])).getTime()
        if (!Number.isFinite(build) || (platform !== 'ios' && platform !== 'android')) continue
        const existing = byUser.get(uid)
        if (!existing || lastSeen > existing.lastSeen) byUser.set(uid, { platform, build, lastSeen })
      }

      // Count unique users per (platform, build).
      const counts = new Map<string, Map<number, number>>()
      for (const { platform, build } of byUser.values()) {
        const m = counts.get(platform) ?? new Map<number, number>()
        m.set(build, (m.get(build) ?? 0) + 1)
        counts.set(platform, m)
      }
      for (const [platform, m] of counts) {
        rawByPlatform.set(
          platform,
          [...m.entries()].map(([build, testers]) => ({ build, testers })),
        )
      }
    } catch (e) {
      queryError = (e as Error).message
    }
  }

  const platforms: PlatformAdoption[] = ['ios', 'android'].map((key) => {
    const meta = PLATFORM_META[key]
    const latest = latestByPlatform.get(key) ?? 0
    const buckets = (rawByPlatform.get(key) ?? []).slice().sort((a, b) => b.build - a.build)
    const total = buckets.reduce((s, b) => s + b.testers, 0)
    const onLatest = buckets.filter((b) => b.build >= latest).reduce((s, b) => s + b.testers, 0)
    const oneBehind = buckets.filter((b) => b.build === latest - 1).reduce((s, b) => s + b.testers, 0)
    const stale = buckets.filter((b) => b.build < latest - 1).reduce((s, b) => s + b.testers, 0)
    return { platform: key, ...meta, latest, buckets, total, onLatest, oneBehind, stale }
  })

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Build Adoption</h1>
        <p className="text-[13px] text-salty-muted">
          Which build each active tester is actually on vs. the latest, over the last {WINDOW_DAYS} days.
          Testers more than one build behind are the usual source of stale, already-fixed bug reports.
        </p>
      </div>

      {!configured && (
        <div className="max-w-3xl rounded-[14px] border border-[#FDE8C8] bg-[#FFF8E6] px-4 py-3 text-[12.5px] text-[#8A6830]">
          <p className="font-semibold">PostHog not connected</p>
          <p className="mt-1">
            Set <code>POSTHOG_API_KEY</code> (a PostHog <b>personal</b> API key scoped to{' '}
            <code>query:read</code>) — and optionally <code>POSTHOG_PROJECT_ID</code> (defaults to
            the Salty project 489677) — in the environment to populate this view. The latest builds
            below still come from the release gate.
          </p>
        </div>
      )}

      {configured && queryError && (
        <div className="max-w-3xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] px-4 py-3 text-[12.5px] text-[#BF4A3A]">
          <p className="font-semibold">Couldn’t load PostHog data</p>
          <p className="mt-1 break-words">{queryError}</p>
        </div>
      )}

      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        {platforms.map((p) => (
          <PlatformCard key={p.platform} p={p} showBars={configured && !queryError} />
        ))}
      </div>
    </div>
  )
}

function PlatformCard({ p, showBars }: { p: PlatformAdoption; showBars: boolean }) {
  const { Icon } = p
  const maxTesters = p.buckets.reduce((m, b) => Math.max(m, b.testers), 0)

  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-stone">
            <Icon className="h-[18px] w-[18px] text-salty-text" />
          </div>
          <div>
            <p className="font-sora text-[15px] font-bold text-salty-text">{p.label}</p>
            <p className="text-[11px] text-salty-muted">{p.hint}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Latest build</p>
          <p className="font-sora text-[22px] font-bold text-salty-text leading-tight">{p.latest || '—'}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Active testers" value={String(p.total)} />
        <Stat label="On latest" value={`${pct(p.onLatest, p.total)}%`} sub={`${p.onLatest}`} tone="good" />
        <Stat label=">1 behind" value={`${pct(p.stale, p.total)}%`} sub={`${p.stale}`} tone={p.stale > 0 ? 'bad' : 'neutral'} />
      </div>

      {/* Distribution */}
      {!showBars ? (
        <p className="text-[12px] text-salty-muted">Connect PostHog to see the build distribution.</p>
      ) : p.buckets.length === 0 ? (
        <p className="text-[12px] text-salty-muted">No tester activity in the last {WINDOW_DAYS} days.</p>
      ) : (
        <div className="space-y-1.5">
          {p.buckets.map((b) => {
            const behind = p.latest - b.build
            const tone =
              b.build >= p.latest ? 'good' : behind === 1 ? 'warn' : 'bad'
            const barColor =
              tone === 'good' ? 'bg-[#7FB894]' : tone === 'warn' ? 'bg-gold' : 'bg-ember'
            const width = maxTesters > 0 ? Math.max(4, Math.round((b.testers / maxTesters) * 100)) : 0
            return (
              <div key={b.build} className="flex items-center gap-2.5">
                <div className="w-14 shrink-0 text-right">
                  <span className="font-sora text-[13px] font-semibold text-salty-text">{b.build}</span>
                  {b.build >= p.latest && (
                    <span className="ml-1 text-[9px] font-bold uppercase text-[#3E8A5A]">now</span>
                  )}
                </div>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-cream">
                  <div className={`h-full ${barColor} rounded`} style={{ width: `${width}%` }} />
                </div>
                <div className="w-16 shrink-0 text-[12px] text-salty-secondary">
                  {b.testers} {behind > 1 && <span className="text-salty-muted">(−{behind})</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string
  value: string
  sub?: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  const valueColor =
    tone === 'good' ? 'text-[#3E8A5A]' : tone === 'bad' ? 'text-ember' : 'text-salty-text'
  return (
    <div className="rounded-[10px] border border-salty-border bg-cream px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-salty-muted">{label}</p>
      <p className={`mt-0.5 font-sora text-[18px] font-bold leading-tight ${valueColor}`}>
        {value}
        {sub !== undefined && <span className="ml-1 text-[11px] font-medium text-salty-muted">{sub}</span>}
      </p>
    </div>
  )
}
