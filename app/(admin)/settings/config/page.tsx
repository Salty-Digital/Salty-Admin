import { requireAdmin } from '@/lib/auth'
import { isConfigStatusConfigured, fetchMobileSecretStatus } from '@/lib/config-status'
import { Check, Minus, KeyRound } from 'lucide-react'

// Descriptions for the server-side secrets the config-status edge function reports on.
const MOBILE_SECRET_DESCRIPTIONS: Record<string, string> = {
  TICKETMASTER_API_KEY: 'Ticketmaster Discovery — event enrichment',
  THESPORTSDB_API_KEY: 'TheSportsDB — sports metadata (SAL2-449)',
  SPORTRADAR_API_KEY: 'Sportradar — sports data (optional hook)',
  SETLISTFM_API_KEY: 'setlist.fm — concert setlists',
  ANTHROPIC_API_KEY: 'Anthropic — category classifier / AI',
  GOOGLE_CLIENT_ID: 'Google OAuth — Gmail connect',
  GOOGLE_CLIENT_SECRET: 'Google OAuth — Gmail connect (secret)',
  AIRTABLE_API_KEY: 'Airtable — feedback sync (feedback-to-airtable)',
  FEEDBACK_WEBHOOK_SECRET: 'Feedback → Airtable webhook secret',
}

// The admin panel's own environment — presence only, read from process.env.
const ADMIN_ENV: { name: string; desc: string }[] = [
  { name: 'SUPABASE_SERVICE_KEY', desc: 'Supabase service role — core data access' },
  { name: 'RESEND_API_KEY', desc: 'Resend — admin invites & user emails' },
  { name: 'RESEND_WEBHOOK_SECRET', desc: 'Resend webhook — bounce/complaint suppression' },
  { name: 'POSTHOG_API_KEY', desc: 'PostHog — Build Adoption & User Engagement' },
  { name: 'AIRTABLE_API_KEY', desc: 'Airtable — Beta Feedback' },
  { name: 'V2_SUPABASE_URL', desc: 'V2 database — Beta Signups' },
  { name: 'CONFIG_STATUS_SECRET', desc: 'Shared secret for the config-status edge function (this page)' },
  { name: 'UNSUBSCRIBE_TOKEN_SECRET', desc: 'Marketing unsubscribe link signing' },
]

function StatusRow({ name, desc, set }: { name: string; desc: string; set: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-salty-border px-4 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="font-mono text-[12.5px] font-medium text-salty-text">{name}</p>
        <p className="truncate text-[11.5px] text-salty-muted">{desc}</p>
      </div>
      {set ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#B8D9C5] bg-[#EAF4EE] px-2 py-0.5 text-[11px] font-semibold text-[#3E8A5A]">
          <Check className="h-3 w-3" /> Set
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-salty-border bg-cream px-2 py-0.5 text-[11px] font-semibold text-salty-muted">
          <Minus className="h-3 w-3" /> Not set
        </span>
      )}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="border-b border-salty-border px-4 py-3">
        <p className="font-sora text-[14px] font-bold text-salty-text">{title}</p>
        <p className="text-[11.5px] text-salty-muted">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

export default async function ConfigStatusPage() {
  await requireAdmin(1)

  const mobileConfigured = isConfigStatusConfigured()
  let known: Record<string, boolean> | null = null
  let others: string[] = []
  let mobileError: string | null = null
  if (mobileConfigured) {
    try {
      const res = await fetchMobileSecretStatus()
      known = res.known
      others = res.others
    } catch (e) {
      mobileError = (e as Error).message
    }
  }

  const knownRows = Object.keys(MOBILE_SECRET_DESCRIPTIONS).map((name) => ({
    name,
    desc: MOBILE_SECRET_DESCRIPTIONS[name],
    set: known ? Boolean(known[name]) : false,
  }))

  return (
    <div className="p-7 space-y-5">
      <div>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Config Status</h1>
        <p className="text-[13px] text-salty-muted">
          Which integration keys are configured — presence only. Secret <b>values are never shown</b>.
        </p>
      </div>

      {/* Mobile app secrets — via the read-only config-status edge function */}
      <Section
        title="Mobile app — Edge Function secrets"
        subtitle="Reported by the config-status edge function in the mobile Supabase project (read-only, presence only)."
      >
        {!mobileConfigured ? (
          <div className="bg-[#FFF8E6] px-4 py-3 text-[12.5px] text-[#8A6830]">
            Set <code>CONFIG_STATUS_SECRET</code> (a shared secret that matches the mobile project’s
            <code> config-status</code> Edge Function secret) to check these. The admin-panel keys
            below don’t need it.
          </div>
        ) : mobileError ? (
          <div className="bg-[#FDEDED] px-4 py-3 text-[12.5px] text-[#BF4A3A] break-words">{mobileError}</div>
        ) : (
          <>
            {knownRows.map((r) => (
              <StatusRow key={r.name} name={r.name} desc={r.desc} set={r.set} />
            ))}
            {others.length > 0 && (
              <div className="border-t border-salty-border px-4 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">
                  {others.length} other secret{others.length !== 1 ? 's' : ''} configured
                </p>
                <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-salty-secondary break-words">
                  {others.join(' · ')}
                </p>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Admin panel env */}
      <Section title="Admin panel — environment" subtitle="Keys this admin site itself uses (from its own environment).">
        {ADMIN_ENV.map((e) => (
          <StatusRow key={e.name} name={e.name} desc={e.desc} set={Boolean(process.env[e.name])} />
        ))}
      </Section>

      <p className="flex items-center gap-1.5 text-[11.5px] text-salty-muted">
        <KeyRound className="h-3.5 w-3.5" />
        Gmail/CASA OAuth is configured in Google Cloud + the mobile app, not as a single secret here.
      </p>
    </div>
  )
}
