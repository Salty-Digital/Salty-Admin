'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Siren, CheckCircle2, PlayCircle, Wrench, BellOff } from 'lucide-react'
import { runCycleNow, resolveIncident } from './actions'

export interface IncidentView {
  id: string
  check_name: string
  severity: 'warn' | 'down'
  status: 'open' | 'resolved'
  detail: string | null
  first_seen_at: string
  resolved_at: string | null
  notified_tier1_at: string | null
  notified_tier2_at: string | null
  remediation_count: number
}

export interface RemediationView {
  id: string
  check_name: string
  action: string
  decided_by: string
  status: string
  detail: string | null
  ran_at: string
}

function since(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function IncidentsPanel({
  open,
  recent,
  remediations,
  notifyEnabled,
  contactCount,
}: {
  open: IncidentView[]
  recent: IncidentView[]
  remediations: RemediationView[]
  notifyEnabled: boolean
  contactCount: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  const run = () =>
    startTransition(async () => {
      setMessage(null)
      const res = await runCycleNow()
      setMessage(res.ok ? (res.summary ?? 'Done.') : `Failed: ${res.error}`)
    })

  const resolve = (id: string) =>
    startTransition(async () => {
      const res = await resolveIncident(id)
      if (!res.ok) setMessage(`Failed: ${res.error}`)
    })

  const alertsOff = !notifyEnabled || contactCount === 0

  return (
    <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-salty-border px-5 py-3">
        <Siren className="h-4 w-4 text-ember" />
        <h2 className="font-sora text-[14px] font-bold text-salty-text">Incidents &amp; alerts</h2>
        {open.length > 0 && (
          <span className="rounded-md border border-[#EBB9B0] bg-[#FDEDED] px-2 py-0.5 text-[11px] font-semibold text-[#BF4A3A]">
            {open.length} open
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link href="/settings/alerts" className="text-[12px] font-medium text-ember hover:underline">
            Alert settings →
          </Link>
          <button
            onClick={run}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ember-mid bg-ember-light px-2.5 py-1 text-[11.5px] font-semibold text-ember transition-colors hover:bg-ember-mid disabled:opacity-50"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {pending ? 'Running…' : 'Run cycle now'}
          </button>
        </div>
      </div>

      {alertsOff && (
        <p className="flex items-center gap-2 border-b border-salty-border bg-[#FFF8E6] px-5 py-2.5 text-[12px] text-[#8A6830]">
          <BellOff className="h-3.5 w-3.5 shrink-0" />
          {contactCount === 0
            ? 'No alert recipients configured — incidents are recorded but nobody is emailed.'
            : 'Notifications are switched off in alert settings — incidents are recorded but nobody is emailed.'}
          <Link href="/settings/alerts" className="font-semibold underline">
            Fix
          </Link>
        </p>
      )}

      {message && (
        <p className="border-b border-salty-border bg-cream/60 px-5 py-2.5 text-[12px] text-salty-secondary">{message}</p>
      )}

      {open.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-[13px] text-salty-muted">
          <CheckCircle2 className="h-4 w-4 text-[#3E8A5A]" /> No open incidents.
        </p>
      ) : (
        open.map((i) => (
          <div key={i.id} className="flex items-start justify-between gap-4 border-b border-salty-border px-5 py-3 last:border-0">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-mono text-[12.5px] font-medium text-salty-text">
                {i.check_name}
                <span
                  className={`rounded border px-1.5 py-px text-[10px] font-bold uppercase ${
                    i.severity === 'down'
                      ? 'border-[#EBB9B0] bg-[#FDEDED] text-[#BF4A3A]'
                      : 'border-[#EAD9A6] bg-[#FFF8E6] text-[#8A6830]'
                  }`}
                >
                  {i.severity}
                </span>
              </p>
              <p className="truncate text-[11.5px] text-salty-muted">{i.detail}</p>
              <p className="mt-0.5 text-[11px] text-salty-muted">
                open {since(i.first_seen_at)}
                {i.notified_tier1_at && ' · on-call notified'}
                {i.notified_tier2_at && ' · escalated'}
                {i.remediation_count > 0 && ` · ${i.remediation_count} auto-fix attempt(s)`}
              </p>
            </div>
            <button
              onClick={() => resolve(i.id)}
              disabled={pending}
              className="shrink-0 rounded-md border border-salty-border bg-warm-white px-2.5 py-1 text-[11.5px] font-medium text-salty-secondary transition-colors hover:bg-cream disabled:opacity-50"
            >
              Mark resolved
            </button>
          </div>
        ))
      )}

      {remediations.length > 0 && (
        <div className="border-t border-salty-border bg-cream/40 px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
            <Wrench className="h-3 w-3" /> Recent auto-fix attempts
          </p>
          <div className="space-y-1">
            {remediations.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate text-salty-secondary">
                  <span className="font-mono">{r.action}</span> on {r.check_name}
                  {r.detail && <span className="text-salty-muted"> — {r.detail}</span>}
                </span>
                <span
                  className={`shrink-0 text-[11px] font-semibold ${
                    r.status === 'succeeded' ? 'text-[#3E8A5A]' : r.status === 'failed' ? 'text-[#BF4A3A]' : 'text-salty-muted'
                  }`}
                >
                  {r.status} · {r.decided_by}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <details className="border-t border-salty-border px-5 py-2.5">
          <summary className="cursor-pointer text-[11.5px] font-medium text-salty-muted">
            Incident history ({recent.length})
          </summary>
          <div className="mt-2 space-y-1">
            {recent.map((i) => (
              <div key={i.id} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="min-w-0 truncate text-salty-secondary">
                  <span className="font-mono">{i.check_name}</span>
                  <span className="text-salty-muted"> — {i.detail}</span>
                </span>
                <span className="shrink-0 text-[11px] text-salty-muted">
                  {new Date(i.first_seen_at).toLocaleString()}
                  {i.resolved_at ? ` → resolved` : ' · open'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
