import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { Flag, ArrowRight, Info } from 'lucide-react'

export const metadata = { title: 'Feature Flags' }

// Compile-time flags baked into the mobile app build — documented here (read-only),
// since they can't be read live and changing them requires an app release.
const COMPILE_TIME_FLAGS: { name: string; value: string; desc: string }[] = [
  { name: 'AUTOCAPTURE_ENABLED', value: 'false', desc: 'PostHog autocapture — off for 1.0 (explicit events only).' },
]

async function count(db: ReturnType<typeof createServiceClient>, table: string, filter?: [string, boolean]) {
  let q = db.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = q.eq(filter[0], filter[1])
  const { count } = await q
  return count ?? 0
}

export default async function FeatureFlagsPage() {
  await requireAdmin(1)
  const db = createServiceClient()

  const [gate, gmailTotal, gmailConsent, imapTotal, imapConsent, schedTotal, schedEnabled] =
    await Promise.all([
      db.from('app_release_gate').select('platform, latest_build, min_build'),
      count(db, 'gmail_connections'),
      count(db, 'gmail_connections', ['scan_consent', true]),
      count(db, 'imap_connections'),
      count(db, 'imap_connections', ['ai_consent', true]),
      count(db, 'scan_schedules'),
      count(db, 'scan_schedules', ['enabled', true]),
    ])

  const gateRows = (gate.data ?? []).sort((a, b) =>
    a.platform === 'ios' ? -1 : b.platform === 'ios' ? 1 : 0,
  )

  const consent = [
    { label: 'Gmail scan consent', on: gmailConsent, total: gmailTotal, of: 'connections' },
    { label: 'IMAP AI consent', on: imapConsent, total: imapTotal, of: 'connections' },
    { label: 'Scheduled scans enabled', on: schedEnabled, total: schedTotal, of: 'schedules' },
  ]

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Feature Flags</h1>
        <p className="text-[13px] text-salty-muted">
          Operational flags and kill-switches, with their current values and source. Read-only for
          now — the one live global lever is the release gate.
        </p>
      </div>

      {/* Global kill-switch — release gate (DB-backed, live) */}
      <div className="max-w-3xl overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="flex items-center justify-between border-b border-salty-border px-4 py-3">
          <div>
            <p className="font-sora text-[14px] font-bold text-salty-text">Force-update kill-switch</p>
            <p className="text-[11.5px] text-salty-muted">DB-backed (app_release_gate) · live · editable on Release Gate</p>
          </div>
          <Link
            href="/release-gate"
            className="flex items-center gap-1 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[12px] font-medium text-salty-secondary transition-colors hover:bg-cream"
          >
            Release Gate <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {gateRows.length === 0 ? (
          <p className="px-4 py-3 text-[12.5px] text-salty-muted">No release-gate rows.</p>
        ) : (
          gateRows.map((r) => {
            const forceOn = (r.min_build ?? 0) > 0
            return (
              <div key={r.platform} className="flex items-center justify-between border-b border-salty-border px-4 py-2.5 last:border-0">
                <div>
                  <p className="text-[13px] font-medium capitalize text-salty-text">{r.platform}</p>
                  <p className="text-[11.5px] text-salty-muted">latest build {r.latest_build} · min build {r.min_build}</p>
                </div>
                <span
                  className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                    forceOn
                      ? 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A]'
                      : 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]'
                  }`}
                >
                  {forceOn ? `Forcing < ${r.min_build}` : 'No forced update'}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* Compile-time flags (documented) */}
      <div className="max-w-3xl overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="border-b border-salty-border px-4 py-3">
          <p className="font-sora text-[14px] font-bold text-salty-text">App flags (compile-time)</p>
          <p className="text-[11.5px] text-salty-muted">Constants in the mobile build — changing them needs an app release.</p>
        </div>
        {COMPILE_TIME_FLAGS.map((f) => (
          <div key={f.name} className="flex items-center justify-between gap-4 border-b border-salty-border px-4 py-2.5 last:border-0">
            <div className="min-w-0">
              <p className="font-mono text-[12.5px] font-medium text-salty-text">{f.name}</p>
              <p className="truncate text-[11.5px] text-salty-muted">{f.desc}</p>
            </div>
            <span className="shrink-0 rounded-md border border-salty-border bg-cream px-2 py-0.5 font-mono text-[11px] font-semibold text-salty-secondary">
              {f.value}
            </span>
          </div>
        ))}
        <div className="flex items-start gap-2 px-4 py-2.5 text-[11.5px] text-salty-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            No PostHog feature flags are defined for this project. Other compile-time flags live in
            the salty-mobile source and aren’t readable here.
          </span>
        </div>
      </div>

      {/* Per-user consent (DB-backed, live adoption) */}
      <div className="max-w-3xl overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <div className="border-b border-salty-border px-4 py-3">
          <p className="font-sora text-[14px] font-bold text-salty-text">Consent (per-user)</p>
          <p className="text-[11.5px] text-salty-muted">DB-backed per-user consents — not global toggles. Current adoption:</p>
        </div>
        {consent.map((c) => (
          <div key={c.label} className="flex items-center justify-between border-b border-salty-border px-4 py-2.5 last:border-0">
            <p className="text-[13px] text-salty-text">{c.label}</p>
            <p className="text-[12.5px] text-salty-secondary">
              <span className="font-semibold text-salty-text">{c.on}</span> / {c.total} {c.of}
            </p>
          </div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-[11.5px] text-salty-muted">
        <Flag className="h-3.5 w-3.5" />
        Promote a flag to a DB-backed toggle only where it’s safe to flip without an app release.
      </p>
    </div>
  )
}
