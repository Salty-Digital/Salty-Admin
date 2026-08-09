import { requireAdmin } from '@/lib/auth'
import { isAirtableConfigured, fetchBetaFeedback, type BetaFeedbackRow } from '@/lib/airtable'
import { FeedbackClient } from './feedback-client'

export default async function FeedbackPage() {
  await requireAdmin(3)

  const configured = isAirtableConfigured()
  let rows: BetaFeedbackRow[] = []
  let error: string | null = null

  if (configured) {
    try {
      rows = await fetchBetaFeedback()
    } catch (e) {
      error = (e as Error).message
    }
  }

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Feedback</h1>
        <p className="text-[13px] text-salty-muted">
          In-app feedback from the{' '}
          <span className="font-medium text-salty-secondary">Beta Users Feedback</span> Airtable base,
          newest first. Filter by status, category, platform, and build.
        </p>
      </div>

      {!configured && (
        <div className="max-w-3xl rounded-[14px] border border-[#FDE8C8] bg-[#FFF8E6] px-4 py-3 text-[12.5px] text-[#8A6830]">
          <p className="font-semibold">Airtable not connected</p>
          <p className="mt-1">
            Set <code>AIRTABLE_API_KEY</code> (a personal access token scoped to{' '}
            <code>data.records:read</code> on the Beta Users Feedback base) — and optionally{' '}
            <code>AIRTABLE_BETA_FEEDBACK_BASE_ID</code> (defaults to <code>appUUEmdTAOl9ZmXV</code>) —
            in the environment to populate this view.
          </p>
        </div>
      )}

      {configured && error && (
        <div className="max-w-3xl rounded-[14px] border border-[#F0C4C4] bg-[#FDEDED] px-4 py-3 text-[12.5px] text-[#BF4A3A]">
          <p className="font-semibold">Couldn’t load Airtable data</p>
          <p className="mt-1 break-words">{error}</p>
        </div>
      )}

      {configured && !error && <FeedbackClient rows={rows} />}
    </div>
  )
}
