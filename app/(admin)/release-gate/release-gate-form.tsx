'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save, Apple, Smartphone, AlertTriangle, ShieldCheck } from 'lucide-react'
import { updateReleaseGate } from './actions'

export interface GateRow {
  platform: string
  latest_build: number
  min_build: number
  store_url: string | null
  message: string | null
  updated_at: string
}

const labelCls = 'block text-[12px] font-semibold uppercase tracking-[0.06em] text-salty-muted mb-1.5'
const inputCls =
  'w-full rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20 font-sans'

function relativeTime(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function ReleaseGateForm({ row, meta }: { row: GateRow; meta?: { label: string; hint: string } }) {
  const router = useRouter()
  const label = meta?.label ?? row.platform
  const Icon = row.platform === 'ios' ? Apple : Smartphone

  const [minBuild, setMinBuild] = useState(String(row.min_build))
  const [storeUrl, setStoreUrl] = useState(row.store_url ?? '')
  const [message, setMessage] = useState(row.message ?? '')
  // Baseline of the last-saved values, so the Save button re-disables after a save
  // without needing the server prop to round-trip back into local state.
  const [baseline, setBaseline] = useState({
    minBuild: String(row.min_build),
    storeUrl: row.store_url ?? '',
    message: row.message ?? '',
  })
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [pending, start] = useTransition()

  const minBuildNum = Number(minBuild)
  const validNum = Number.isInteger(minBuildNum) && minBuildNum >= 0
  const forceOn = validNum && minBuildNum > 0
  const exceedsLatest = validNum && minBuildNum > row.latest_build
  const forceNoUrl = forceOn && storeUrl.trim() === ''

  const dirty =
    minBuild !== baseline.minBuild || storeUrl !== baseline.storeUrl || message !== baseline.message

  function save() {
    setResult(null)
    if (!validNum) {
      setResult({ type: 'error', msg: 'Min build must be a whole number ≥ 0.' })
      return
    }
    if (exceedsLatest) {
      setResult({ type: 'error', msg: `Min build can't exceed the latest build (${row.latest_build}).` })
      return
    }
    // Double-confirm when newly turning ON (or raising) a forced update — it blocks
    // real users out of the app until they update.
    if (forceOn && minBuild !== baseline.minBuild) {
      const ok = window.confirm(
        `Force-update ${label}: every user on a build below ${minBuildNum} will be blocked from using the app until they update. Continue?`,
      )
      if (!ok) return
    }
    start(async () => {
      try {
        await updateReleaseGate(row.platform, { minBuild, storeUrl, message })
        setBaseline({ minBuild, storeUrl, message })
        setResult({ type: 'success', msg: 'Saved.' })
        router.refresh()
      } catch (e) {
        setResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4">
      {/* Header: platform + latest build */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-stone">
            <Icon className="h-[18px] w-[18px] text-salty-text" />
          </div>
          <div>
            <p className="font-sora text-[15px] font-bold text-salty-text">{label}</p>
            {meta?.hint && <p className="text-[11px] text-salty-muted">{meta.hint}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">Latest build</p>
          <p className="font-sora text-[22px] font-bold text-salty-text leading-tight">{row.latest_build}</p>
          <p className="text-[10.5px] text-salty-muted">updated {relativeTime(row.updated_at)}</p>
        </div>
      </div>

      {/* Force-update status */}
      <div
        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] ${
          forceOn
            ? 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A]'
            : 'border-salty-border bg-cream text-salty-secondary'
        }`}
      >
        {forceOn ? (
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
        ) : (
          <ShieldCheck className="mt-px h-4 w-4 shrink-0" />
        )}
        <span>
          {forceOn
            ? `Forced update ON — builds below ${minBuildNum} are blocked from using the app.`
            : 'No forced update — users below the latest build see a dismissable prompt only.'}
        </span>
      </div>

      {/* min_build */}
      <div>
        <label className={labelCls}>Min build — force-update floor</label>
        <input
          type="number"
          min={0}
          max={row.latest_build}
          value={minBuild}
          onChange={(e) => setMinBuild(e.target.value)}
          className={inputCls}
        />
        {exceedsLatest ? (
          <p className="mt-1 text-[11.5px] text-[#BF4A3A]">
            Can’t exceed the latest build ({row.latest_build}) — that would lock out everyone.
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-salty-muted">
            0 = no forced update. Max is the latest build ({row.latest_build}).
          </p>
        )}
      </div>

      {/* store_url */}
      <div>
        <label className={labelCls}>Store URL</label>
        <input
          type="url"
          value={storeUrl}
          onChange={(e) => setStoreUrl(e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
        {forceNoUrl && (
          <p className="mt-1 text-[11.5px] text-[#BF4A3A]">
            Forced update with no store URL — blocked users won’t have a link to update.
          </p>
        )}
      </div>

      {/* message */}
      <div>
        <label className={labelCls}>Prompt message (optional)</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Shown in the update prompt. Leave blank for the app default."
          className={inputCls}
        />
      </div>

      {result && (
        <div
          className={`rounded-lg border px-3 py-2.5 text-[13px] ${
            result.type === 'success'
              ? 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]'
              : 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A]'
          }`}
        >
          {result.msg}
        </div>
      )}

      <button
        onClick={save}
        disabled={pending || !dirty || exceedsLatest || !validNum}
        className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60 transition-colors"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}
