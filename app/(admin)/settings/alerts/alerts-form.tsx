'use client'

import { useState, useTransition } from 'react'
import { Trash2, Send, Save, UserPlus } from 'lucide-react'
import type { AlertSettings, AlertContact } from '@/lib/alerts'
import { saveAlertSettings, addAlertContact, removeAlertContact, setContactActive, sendTestAlert } from './actions'

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="border-b border-salty-border px-5 py-3.5">
        <h2 className="font-sora text-[14px] font-bold text-salty-text">{title}</h2>
        {sub && <p className="mt-0.5 text-[12px] text-salty-muted">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  checked, onChange, label, hint, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 py-2.5 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-ember"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-salty-text">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-snug text-salty-muted">{hint}</span>}
      </span>
    </label>
  )
}

export function AlertsForm({
  initialSettings,
  contacts,
  hasResendKey,
  ladderTiers,
}: {
  initialSettings: AlertSettings
  contacts: AlertContact[]
  hasResendKey: boolean
  ladderTiers: { tier: number; provider: string; model: string; free: boolean }[]
}) {
  const [s, setS] = useState(initialSettings)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [tier, setTier] = useState<1 | 2>(1)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const flash = (r: { ok: boolean; error?: string; message?: string }) =>
    setMsg(r.ok ? { tone: 'ok', text: r.message ?? 'Saved.' } : { tone: 'err', text: r.error ?? 'Failed.' })

  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      setMsg(null)
      flash(await fn())
    })

  const tier1 = contacts.filter((c) => c.tier === 1)
  const tier2 = contacts.filter((c) => c.tier === 2)

  return (
    <div className="space-y-5">
      {msg && (
        <div
          className={`rounded-[12px] border px-4 py-2.5 text-[13px] ${
            msg.tone === 'ok'
              ? 'border-[#B8D9C5] bg-[#EAF4EE] text-[#2F6B46]'
              : 'border-[#EBB9B0] bg-[#FDEDED] text-[#A53D30]'
          }`}
        >
          {msg.text}
        </div>
      )}

      {!hasResendKey && (
        <div className="rounded-[12px] border border-[#EAD9A6] bg-[#FFF8E6] px-4 py-2.5 text-[13px] text-[#8A6830]">
          RESEND_API_KEY is not set — incidents will be recorded but no email can be sent.
        </div>
      )}

      {/* ── Recipients ── */}
      <Card
        title="Who gets alerted"
        sub="Tier 1 is paged first. Tier 2 is pulled in only if the incident is still open after the escalation delay."
      >
        {[
          { label: 'Tier 1 · first responder', list: tier1 },
          { label: 'Tier 2 · escalation', list: tier2 },
        ].map(({ label, list }) => (
          <div key={label} className="border-b border-salty-border last:border-0">
            <p className="bg-cream/50 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
              {label}
            </p>
            {list.length === 0 ? (
              <p className="px-5 py-3 text-[13px] text-salty-muted">Nobody assigned.</p>
            ) : (
              list.map((c) => (
                <div key={c.id} className="flex items-center gap-3 border-t border-salty-border px-5 py-2.5 first:border-t-0">
                  <input
                    type="checkbox"
                    checked={c.is_active}
                    disabled={pending}
                    onChange={(e) => act(() => setContactActive(c.id, e.target.checked))}
                    title={c.is_active ? 'Active — click to mute' : 'Muted — click to activate'}
                    className="h-4 w-4 shrink-0 accent-ember"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] font-medium ${c.is_active ? 'text-salty-text' : 'text-salty-muted line-through'}`}>
                      {c.email}
                    </p>
                    {c.name && <p className="truncate text-[11.5px] text-salty-muted">{c.name}</p>}
                  </div>
                  <button
                    onClick={() => act(() => removeAlertContact(c.id))}
                    disabled={pending}
                    title="Remove"
                    className="shrink-0 text-salty-muted transition-colors hover:text-[#BF4A3A] disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        ))}

        <div className="flex flex-wrap items-end gap-2 border-t border-salty-border bg-cream/40 px-5 py-3.5">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@saltydigital.ai"
              className="w-full rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[13px] outline-none focus:border-ember"
            />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="optional"
              className="w-full rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[13px] outline-none focus:border-ember"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Tier</label>
            <select
              value={tier}
              onChange={(e) => setTier(Number(e.target.value) as 1 | 2)}
              className="rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[13px] outline-none focus:border-ember"
            >
              <option value={1}>1 · first</option>
              <option value={2}>2 · escalation</option>
            </select>
          </div>
          <button
            onClick={() => act(async () => {
              const r = await addAlertContact({ email, name, tier })
              if (r.ok) { setEmail(''); setName('') }
              return r
            })}
            disabled={pending || !email.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ember-mid bg-ember-light px-3 py-1.5 text-[12.5px] font-semibold text-ember transition-colors hover:bg-ember-mid disabled:opacity-50"
          >
            <UserPlus className="h-3.5 w-3.5" /> Add
          </button>
          <button
            onClick={() => act(sendTestAlert)}
            disabled={pending || contacts.filter((c) => c.is_active).length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[12.5px] font-medium text-salty-secondary transition-colors hover:bg-cream disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" /> Send test
          </button>
        </div>
      </Card>

      {/* ── Thresholds ── */}
      <Card title="When to alert">
        <div className="divide-y divide-salty-border px-5">
          <Toggle
            checked={s.notify_enabled}
            onChange={(v) => setS({ ...s, notify_enabled: v })}
            label="Send email alerts"
            hint="Off: incidents are still recorded and shown on /health, but nobody is emailed."
          />
          <div className="flex flex-wrap items-center gap-4 py-3">
            <label className="text-[13px] font-medium text-salty-text">Alert on</label>
            <select
              value={s.notify_min_severity}
              onChange={(e) => setS({ ...s, notify_min_severity: e.target.value as 'warn' | 'down' })}
              className="rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[13px] outline-none focus:border-ember"
            >
              <option value="down">Outages only (down)</option>
              <option value="warn">Outages and warnings</option>
            </select>
            <span className="text-[12px] text-salty-muted">
              Advisory warnings (an unset optional key) never alert either way.
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 py-3">
            <label className="text-[13px] font-medium text-salty-text">Escalate to tier 2 after</label>
            <input
              type="number"
              min={1}
              max={1440}
              value={s.escalate_after_minutes}
              onChange={(e) => setS({ ...s, escalate_after_minutes: Number(e.target.value) })}
              className="w-24 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[13px] outline-none focus:border-ember"
            />
            <span className="text-[13px] text-salty-text">minutes still open</span>
          </div>
        </div>
      </Card>

      {/* ── Auto-remediation ── */}
      <Card
        title="Auto-remediation"
        sub="The system can attempt a fix before escalating. It may only run allow-listed actions defined in the code — never an action a model invented."
      >
        <div className="divide-y divide-salty-border px-5">
          <Toggle
            checked={s.remediation_enabled}
            onChange={(v) => setS({ ...s, remediation_enabled: v })}
            label="Attempt automatic fixes"
            hint="Runs the deterministic runbook for a failing check (e.g. requeue failed enrichment jobs), then re-checks. Free — no model call involved."
          />
          <div className="flex flex-wrap items-center gap-3 py-3">
            <label className="text-[13px] font-medium text-salty-text">Give up after</label>
            <input
              type="number"
              min={0}
              max={20}
              value={s.max_remediation_attempts}
              onChange={(e) => setS({ ...s, max_remediation_attempts: Number(e.target.value) })}
              disabled={!s.remediation_enabled}
              className="w-20 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[13px] outline-none focus:border-ember disabled:opacity-50"
            />
            <span className="text-[13px] text-salty-text">attempts per incident</span>
          </div>
          <Toggle
            checked={s.ai_triage_enabled}
            onChange={(v) => setS({ ...s, ai_triage_enabled: v })}
            disabled={!s.remediation_enabled}
            label="Let AI pick the action when no runbook matches"
            hint="Walks the model ladder below, cheapest first. The model chooses from the same allow-list; anything else it returns is discarded and the incident escalates to a human."
          />
          <div className="py-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-salty-muted">Model ladder</p>
            {ladderTiers.length === 0 ? (
              <p className="text-[12.5px] text-salty-muted">
                No model key configured. Set <code className="font-mono">GEMINI_API_KEY</code>,{' '}
                <code className="font-mono">GROQ_API_KEY</code>, or <code className="font-mono">ANTHROPIC_API_KEY</code>.
              </p>
            ) : (
              <ol className="space-y-1">
                {ladderTiers.map((t) => (
                  <li key={t.tier} className="flex items-center gap-2 text-[12.5px] text-salty-secondary">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-stone text-[10px] font-bold text-salty-muted">
                      {t.tier}
                    </span>
                    <span className="font-mono">{t.model}</span>
                    <span
                      className={`rounded border px-1.5 py-px text-[10px] font-semibold ${
                        t.free
                          ? 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]'
                          : 'border-[#EAD9A6] bg-[#FFF8E6] text-[#8A6830]'
                      }`}
                    >
                      {t.free ? 'free' : 'paid'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </Card>

      <button
        onClick={() => act(() => saveAlertSettings({
          notifyEnabled: s.notify_enabled,
          escalateAfterMinutes: s.escalate_after_minutes,
          notifyMinSeverity: s.notify_min_severity,
          remediationEnabled: s.remediation_enabled,
          maxRemediationAttempts: s.max_remediation_attempts,
          aiTriageEnabled: s.ai_triage_enabled,
        }))}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {pending ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  )
}
