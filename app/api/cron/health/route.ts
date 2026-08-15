import { NextResponse } from 'next/server'
import { runHealthCycle } from '@/lib/ops-cycle'

/**
 * Scheduled health cycle: check → reconcile → remediate → verify → notify.
 *
 * Triggered by Vercel Cron (see vercel.json), which sends `Authorization: Bearer
 * $CRON_SECRET` on every invocation. Any scheduler that can set that header works too —
 * GitHub Actions, cron-job.org — so this isn't tied to a hosting plan.
 *
 * Fails closed: with no CRON_SECRET configured the endpoint refuses every request rather
 * than exposing an unauthenticated trigger that reads production data.
 */

export const dynamic = 'force-dynamic'
// The cycle pings five edge functions and may run a verification pass, so give it room.
export const maxDuration = 120

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization')
  return header === `Bearer ${secret}`
}

async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { error: 'Unauthorized. Send Authorization: Bearer $CRON_SECRET.' },
      { status: 401 },
    )
  }

  try {
    const result = await runHealthCycle()
    return NextResponse.json({
      ok: true,
      overall: result.report.overall,
      ranAt: result.report.ranAt,
      durationMs: result.durationMs,
      incidents: {
        opened: result.opened.map((i) => i.check_name),
        stillOpen: result.stillOpen.map((i) => i.check_name),
        resolved: result.resolved.map((i) => i.check_name),
      },
      remediations: result.remediations,
      verified: result.verified,
      notifications: result.notifications,
    })
  } catch (e) {
    // A monitor that dies silently is worse than no monitor — surface it in the response
    // and the platform logs so a failing cron is visible.
    console.error('[cron/health] cycle failed:', e)
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return handle(request)
}

// Vercel Cron issues GETs; POST is here so any other scheduler can drive it too.
export async function POST(request: Request) {
  return handle(request)
}
