import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { ReleaseGateForm, type GateRow } from './release-gate-form'

const PLATFORM_META: Record<string, { label: string; hint: string }> = {
  ios: { label: 'iOS', hint: 'TestFlight build' },
  android: { label: 'Android', hint: 'Play Store internal test' },
}

// Newest-first display order regardless of what the DB returns.
const ORDER = ['ios', 'android']

export default async function ReleaseGatePage() {
  await requireAdmin(1)
  const db = createServiceClient()

  const { data } = await db
    .from('app_release_gate')
    .select('platform, latest_build, min_build, store_url, message, updated_at')

  const rows = ((data ?? []) as GateRow[]).sort(
    (a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform),
  )

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Release Gate</h1>
        <p className="text-[13px] text-salty-muted">
          Drives the in-app “update available” prompt. The latest build self-reports from the newest
          install; you set the force-update floor, store link, and prompt copy.
        </p>
      </div>

      {/* How it works / guard rails */}
      <div className="max-w-3xl rounded-[14px] border border-[#FDE8C8] bg-[#FFF8E6] px-4 py-3 text-[12.5px] text-[#8A6830]">
        <p className="font-semibold">How the gate works</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            Users below the <b>latest build</b> see a dismissable “update available” prompt.
          </li>
          <li>
            Users below the <b>min build</b> get a <b>forced</b> (non-dismissable) update. Leave min
            build at <b>0</b> for no force.
          </li>
          <li>Min build can’t exceed the latest build in the wild — that would lock out everyone.</li>
        </ul>
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-salty-muted">No release-gate rows found.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <ReleaseGateForm key={row.platform} row={row} meta={PLATFORM_META[row.platform]} />
          ))}
        </div>
      )}
    </div>
  )
}
