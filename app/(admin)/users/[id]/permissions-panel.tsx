// Why a user has no photos: the panel that stops us guessing.
//
// On the 2026-09-01 weekly, Chris was looking at a live user whose tickets had no photos or
// videos and asked whether that meant she had never added any. Nobody could say. The data to
// answer it either did not exist (a denied photo prompt left no trace anywhere) or existed and
// was never shown (scan_runs and photo_scan_jobs have carried per-user outcomes and error
// messages all along). This reads both.
//
// The empty states carry most of the weight. "We have not heard from this user's app" and
// "this user said no" are completely different answers, and a support view that renders them
// the same way is worse than one that shows nothing.

import { CalendarCheck } from 'lucide-react'

type PermissionState = {
  notifications: string
  camera: string
  photo_library: string
  calendar: string
  location: string
  contacts: string
  app_build: string | null
  platform: string | null
  updated_at: string
} | null

type ScanSchedule = {
  enabled: boolean
  frequency: string
  day_of_week: number
  day_of_month: number
  hour: number
  minute: number
  last_run_at: string | null
} | null

type ScanRun = {
  source: string | null
  started_at: string | null
  finished_at: string | null
  outcome: string | null
  error_message: string | null
  accepted: number | null
  pending: number | null
  listed: number | null
} | null

type PhotoScanJob = {
  status: string | null
  started_at: string | null
  completed_at: string | null
  matched_count: number | null
  new_ticket_count: number | null
  error_message: string | null
  access_privileges: string | null
} | null

const PERMISSION_LABELS: [keyof NonNullable<PermissionState>, string][] = [
  ['photo_library', 'Photo library'],
  ['calendar', 'Calendar'],
  ['notifications', 'Notifications'],
  ['camera', 'Camera'],
  ['location', 'Location'],
  ['contacts', 'Contacts'],
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function timeLabel(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}:${String(minute).padStart(2, '0')} ${suffix}`
}

function scheduleSummary(s: NonNullable<ScanSchedule>): string {
  const time = timeLabel(s.hour, s.minute)
  if (s.frequency === 'daily') return `every day at ${time}`
  if (s.frequency === 'weekly') return `every ${WEEKDAYS[s.day_of_week] ?? 'Monday'} at ${time}`
  return `monthly on day ${s.day_of_month} at ${time}`
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function PermissionPill({ status }: { status: string }) {
  if (status === 'granted') return <span className="font-medium text-[#3E8A5A]">Granted</span>
  if (status === 'denied') return <span className="font-medium text-[#BF4A3A]">Denied</span>
  // Deliberately not "Unknown": the OS told us this one, and what it said is that the person has
  // never been shown the prompt. That is an answer, and a different one from "we have no data".
  return <span className="text-salty-muted">Never asked</span>
}

function ScanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-[13px] text-salty-muted shrink-0">{label}</span>
      <span className="text-[13px] text-right text-salty-text">{children}</span>
    </div>
  )
}

export function PermissionsPanel({
  permissions,
  schedule,
  lastEmailScan,
  lastPhotoScan,
}: {
  permissions: PermissionState
  schedule: ScanSchedule
  lastEmailScan: ScanRun
  lastPhotoScan: PhotoScanJob
}) {
  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-salty-border pb-2">
        <CalendarCheck className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[13px] font-bold text-salty-text">Permissions &amp; scanning</h2>
        {permissions && (
          <span className="text-[11px] text-salty-muted">
            · as reported {ago(permissions.updated_at)}
            {permissions.app_build ? ` from build ${permissions.app_build}` : ''}
            {permissions.platform ? ` on ${permissions.platform}` : ''}
          </span>
        )}
      </div>

      {permissions ? (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {PERMISSION_LABELS.map(([key, label]) => (
            <div key={key}>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{label}</p>
              <p className="mt-0.5 text-[13.5px]"><PermissionPill status={String(permissions[key])} /></p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-salty-muted">
          This user&apos;s app has never reported its permissions. Recording started in the build that
          shipped 2026-09-01, so anyone who has not opened the app since will show nothing here —
          it does <span className="font-medium text-salty-text">not</span> mean they denied anything.
        </p>
      )}

      <div className="mt-4 border-t border-salty-border pt-2">
        <ScanRow label="Scheduled scan">
          {schedule?.enabled
            ? <span className="font-medium text-[#3E8A5A]">On · {scheduleSummary(schedule)} · last run {ago(schedule.last_run_at)}</span>
            : <span className="text-salty-muted">{schedule ? 'Off' : 'Never set up'}</span>
          }
        </ScanRow>

        <ScanRow label="Last email scan">
          {lastEmailScan ? (
            <>
              <span>{ago(lastEmailScan.finished_at ?? lastEmailScan.started_at)}</span>
              {lastEmailScan.outcome && (
                <span className={lastEmailScan.outcome === 'ok' ? ' text-[#3E8A5A]' : ' text-[#BF4A3A]'}> · {lastEmailScan.outcome}</span>
              )}
              <span className="text-salty-muted">
                {' '}· {lastEmailScan.listed ?? 0} found, {lastEmailScan.accepted ?? 0} accepted, {lastEmailScan.pending ?? 0} to review
              </span>
              {lastEmailScan.error_message && (
                <span className="block text-[12px] text-[#BF4A3A]">{lastEmailScan.error_message}</span>
              )}
            </>
          ) : (
            <span className="text-salty-muted">Never run</span>
          )}
        </ScanRow>

        <ScanRow label="Last photo scan">
          {lastPhotoScan ? (
            <>
              <span>{ago(lastPhotoScan.completed_at ?? lastPhotoScan.started_at)}</span>
              <span className={lastPhotoScan.status === 'completed' ? ' text-[#3E8A5A]' : ' text-[#BF4A3A]'}> · {lastPhotoScan.status}</span>
              <span className="text-salty-muted">
                {' '}· {lastPhotoScan.matched_count ?? 0} matched, {lastPhotoScan.new_ticket_count ?? 0} new
                {lastPhotoScan.access_privileges ? ` · ${lastPhotoScan.access_privileges} access` : ''}
              </span>
              {lastPhotoScan.error_message && (
                <span className="block text-[12px] text-[#BF4A3A]">{lastPhotoScan.error_message}</span>
              )}
            </>
          ) : (
            // A photo scan job row is only ever created AFTER access is granted, so its absence
            // says nothing about permission on its own — read the photo library pill above.
            <span className="text-salty-muted">Never run</span>
          )}
        </ScanRow>
      </div>
    </div>
  )
}
