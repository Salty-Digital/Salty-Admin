import { BellRing } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { getAlertSettings, getAlertContacts } from '@/lib/alerts'
import { availableTiers } from '@/lib/llm/ladder'
import { AlertsForm } from './alerts-form'

export const dynamic = 'force-dynamic'

export default async function AlertsSettingsPage() {
  await requireAdmin(1)
  const [settings, contacts] = await Promise.all([getAlertSettings(), getAlertContacts()])

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
          <BellRing className="h-5 w-5 text-ember" /> Alerts
        </h1>
        <p className="text-[13px] text-salty-muted">
          Who gets told when a health check fails, how long before it escalates, and what the
          system may try to fix on its own.
        </p>
      </div>

      <AlertsForm
        initialSettings={settings}
        contacts={contacts}
        hasResendKey={Boolean(process.env.RESEND_API_KEY)}
        ladderTiers={availableTiers()}
      />

      <p className="text-[11.5px] leading-relaxed text-salty-muted">
        Checks run on a schedule via <code className="font-mono">/api/cron/health</code>, and on
        demand from the <span className="font-medium">Run cycle now</span> button on the health
        page. Alerts fire on state changes only — a check that stays down produces one alert, one
        escalation, and one recovery notice, not one per run.
      </p>
    </div>
  )
}
