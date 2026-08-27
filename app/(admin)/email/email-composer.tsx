'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ExternalLink, Loader2, Mail, Rocket, Users } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TemplatePicker } from '@/components/ui/template-picker'
import { EMAIL_TEMPLATES } from '@/lib/message-templates'
import { countRecipientsAction, sendBroadcastAction, sendBetaInviteAction, sendSingleEmailAction, type BetaTemplate, type Segment } from './actions'

// Mirrors BETA_INVITE_SUBJECT in lib/emails/beta-invite.ts (kept local so the big
// server-side email module isn't pulled into the client bundle).
const DEFAULT_BETA_SUBJECT = "You're in — the Salty beta is live"
// The reminder leads on curiosity rather than an announcement: these people already know
// what Salty is, they just never installed it.
const DEFAULT_BETA_REMINDER_SUBJECT = "The shows you've forgotten you went to"

const TIERS = ['free', 'premium', 'family']
const ACTIVE_WINDOWS = [7, 30, 90]

const labelCls = 'block text-[12px] font-semibold uppercase tracking-[0.06em] text-salty-muted mb-1.5'
const inputCls = 'w-full rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20 font-sans'

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-[13px] ${
      type === 'success' ? 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]' : 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A]'
    }`}>
      {msg}
    </div>
  )
}

export function EmailComposer({ users }: { users: { id: string; email: string }[] }) {
  return (
    <Tabs defaultValue="single">
      <TabsList className="bg-stone">
        <TabsTrigger value="single">Send to User</TabsTrigger>
        <TabsTrigger value="broadcast">Broadcast</TabsTrigger>
        <TabsTrigger value="beta-invite">Beta invite</TabsTrigger>
      </TabsList>
      <TabsContent value="single">
        <SingleForm users={users} />
      </TabsContent>
      <TabsContent value="broadcast">
        <BroadcastForm />
      </TabsContent>
      <TabsContent value="beta-invite">
        <BetaInviteForm />
      </TabsContent>
    </Tabs>
  )
}

function SingleForm({ users }: { users: { id: string; email: string }[] }) {
  const [userId, setUserId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function applyTemplate(id: string) {
    const t = EMAIL_TEMPLATES.find(t => t.id === id)
    if (!t) return
    if ((subject.trim() || body.trim()) && !window.confirm('Replace the current subject and body with this template?')) return
    setSubject(t.subject)
    setBody(t.body)
    setResult(null)
  }

  function send() {
    setResult(null)
    if (!userId) return setResult({ type: 'error', msg: 'Select a recipient.' })
    if (!subject.trim() || !body.trim()) return setResult({ type: 'error', msg: 'Subject and body are required.' })
    startTransition(async () => {
      try {
        await sendSingleEmailAction(userId, subject.trim(), body.trim())
        const email = users.find(u => u.id === userId)?.email ?? 'user'
        setResult({ type: 'success', msg: `Email sent to ${email}.` })
        setSubject('')
        setBody('')
      } catch (e) {
        setResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4 max-w-xl">
      <div>
        <label className={labelCls}>Template</label>
        <TemplatePicker options={EMAIL_TEMPLATES} onPick={applyTemplate} className={inputCls} />
        <p className="mt-1.5 text-[12px] text-salty-muted">Pre-fills the subject and body — then edit before sending. Text in [brackets] is a placeholder.</p>
      </div>
      <div>
        <label className={labelCls}>Recipient</label>
        <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
          <option value="">Select a user…</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Body</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={7} placeholder="Write your message…&#10;&#10;Blank lines become paragraphs." className={inputCls} />
      </div>
      {result && <Alert {...result} />}
      <button
        onClick={send}
        disabled={pending}
        className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60 transition-colors"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        {pending ? 'Sending…' : 'Send Email'}
      </button>
    </div>
  )
}

function BroadcastForm() {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [segType, setSegType] = useState<Segment['type']>('all')
  const [tier, setTier] = useState('free')
  const [activeDays, setActiveDays] = useState(30)
  const [customRaw, setCustomRaw] = useState('')
  const [betaStatus, setBetaStatus] = useState<'all' | 'signed' | 'unsigned'>('all')

  const [count, setCount] = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  // Deduped, validated addresses parsed from the pasted custom list.
  const customEmails = useMemo(() => {
    const seen = new Set<string>()
    for (const piece of customRaw.split(/[\s,;]+/)) {
      const email = piece.trim().toLowerCase()
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) seen.add(email)
    }
    return [...seen]
  }, [customRaw])

  const segment: Segment = {
    type: segType,
    ...(segType === 'tier' ? { tier } : {}),
    ...(segType === 'active' ? { activeDays } : {}),
    ...(segType === 'custom' ? { emails: customEmails } : {}),
    ...(segType === 'beta' ? { betaStatus } : {}),
  }

  // Refresh the recipient count whenever the segment changes (debounced so typing a
  // custom list doesn't fire a query per keystroke).
  const customKey = customEmails.join(',')
  useEffect(() => {
    let cancelled = false
    setCountLoading(true)
    const timer = setTimeout(() => {
      countRecipientsAction(segment)
        .then(n => { if (!cancelled) setCount(n) })
        .catch(() => { if (!cancelled) setCount(null) })
        .finally(() => { if (!cancelled) setCountLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segType, tier, activeDays, customKey, betaStatus])

  function applyTemplate(id: string) {
    const t = EMAIL_TEMPLATES.find(t => t.id === id)
    if (!t) return
    if ((subject.trim() || body.trim()) && !window.confirm('Replace the current subject and body with this template?')) return
    setSubject(t.subject)
    setBody(t.body)
    setResult(null)
  }

  function attemptSend() {
    setResult(null)
    if (!subject.trim() || !body.trim()) {
      setResult({ type: 'error', msg: 'Subject and body are required.' })
      return
    }
    setConfirming(true)
  }

  function send() {
    setConfirming(false)
    setResult(null)
    startTransition(async () => {
      try {
        const res = await sendBroadcastAction(subject.trim(), body.trim(), segment)
        setResult({
          type: 'success',
          msg: `Sent to ${res.sent} of ${res.recipients} recipient${res.recipients !== 1 ? 's' : ''}${res.failed ? ` — ${res.failed} failed` : ''}.`,
        })
        setSubject('')
        setBody('')
      } catch (e) {
        setResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4 max-w-xl">
      <div className="rounded-lg border border-[#FFF8E6] bg-[#FFF8E6] px-3 py-2 text-[12px] text-[#8A6830]">
        Sends a real email via Resend to the selected users. Banned users are always excluded.
      </div>

      <div>
        <label className={labelCls}>Template</label>
        <TemplatePicker options={EMAIL_TEMPLATES} onPick={applyTemplate} className={inputCls} />
        <p className="mt-1.5 text-[12px] text-salty-muted">Pre-fills the subject and body — then edit before sending. Text in [brackets] is a placeholder.</p>
      </div>

      {/* Segment */}
      <div>
        <label className={labelCls}>Recipients</label>
        <div className="flex flex-wrap gap-2">
          {([['all', 'All users'], ['tier', 'By tier'], ['active', 'Active users'], ['custom', 'Custom list'], ['beta', 'Beta signups']] as const).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => setSegType(val)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                segType === val ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-cream text-salty-secondary hover:bg-stone'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {segType === 'tier' && (
        <div>
          <label className={labelCls}>Tier</label>
          <select value={tier} onChange={e => setTier(e.target.value)} className={inputCls}>
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      {segType === 'active' && (
        <div>
          <label className={labelCls}>Active within</label>
          <select value={activeDays} onChange={e => setActiveDays(Number(e.target.value))} className={inputCls}>
            {ACTIVE_WINDOWS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
      )}

      {segType === 'custom' && (
        <div>
          <label className={labelCls}>Recipient emails</label>
          <textarea
            value={customRaw}
            onChange={e => setCustomRaw(e.target.value)}
            rows={4}
            placeholder="Paste email addresses, separated by commas, spaces, or new lines…"
            className={inputCls}
          />
          <p className="mt-1.5 text-[12px] text-salty-muted">
            {customEmails.length} valid address{customEmails.length !== 1 ? 'es' : ''} entered. Every
            address is emailed; users who are banned or unsubscribed are skipped.
          </p>
        </div>
      )}

      {segType === 'beta' && (
        <div>
          <label className={labelCls}>Beta signup status</label>
          <div className="flex flex-wrap gap-2">
            {([['all', 'All beta signups'], ['unsigned', 'Not signed up yet'], ['signed', 'Already signed up']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setBetaStatus(val)}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  betaStatus === val ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-cream text-salty-secondary hover:bg-stone'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-salty-muted">
            From the v2 beta_signups waitlist. &quot;Signed up&quot; = the email exists in your main users.
            Beta-unsubscribed and bounced/complained addresses are skipped automatically.
          </p>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[13px] text-salty-secondary">
        <Users className="h-3.5 w-3.5" />
        {countLoading ? 'Counting recipients…' : (
          <span><strong className="text-salty-text">{count ?? '—'}</strong> recipient{count !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div>
        <label className={labelCls}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. What's new in Salty this week" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Body</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} placeholder="Write your update…&#10;&#10;Blank lines become paragraphs." className={inputCls} />
      </div>

      {result && <Alert {...result} />}

      {confirming ? (
        <div className="rounded-lg border border-[#F0C4C4] bg-[#FDEDED] p-3 space-y-2">
          <p className="text-[13px] text-[#BF4A3A]">
            Send this email to <strong>{count ?? 0}</strong> recipient{count !== 1 ? 's' : ''}? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={send} disabled={pending} className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {pending ? 'Sending…' : `Yes, send to ${count ?? 0}`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={pending} className="text-[12px] text-salty-muted hover:text-salty-text">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={attemptSend}
          disabled={pending || !count}
          className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60 transition-colors"
        >
          <Mail className="h-4 w-4" />
          Review & Send
        </button>
      )}
    </div>
  )
}

/**
 * Sends the pre-designed Salty beta invite (lib/emails/beta-invite.ts) — the full
 * TestFlight + Google Play onboarding email. There's no body to type: only the subject
 * is editable, and each recipient's first name is merged in server-side. Targets the beta
 * waitlist (default: not-signed-up), or a pasted list for sending yourself a test.
 */
function BetaInviteForm() {
  const [template, setTemplate] = useState<BetaTemplate>('invite')
  const [subject, setSubject] = useState(DEFAULT_BETA_SUBJECT)
  const [segType, setSegType] = useState<'beta' | 'custom'>('beta')
  const [betaStatus, setBetaStatus] = useState<'all' | 'signed' | 'unsigned'>('unsigned')
  const [customRaw, setCustomRaw] = useState('')

  const [count, setCount] = useState<number | null>(null)
  const [countLoading, setCountLoading] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  const customEmails = useMemo(() => {
    const seen = new Set<string>()
    for (const piece of customRaw.split(/[\s,;]+/)) {
      const email = piece.trim().toLowerCase()
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) seen.add(email)
    }
    return [...seen]
  }, [customRaw])

  const segment: Segment = segType === 'custom'
    ? { type: 'custom', emails: customEmails }
    : { type: 'beta', betaStatus }

  const customKey = customEmails.join(',')
  useEffect(() => {
    let cancelled = false
    setCountLoading(true)
    const timer = setTimeout(() => {
      countRecipientsAction(segment)
        .then(n => { if (!cancelled) setCount(n) })
        .catch(() => { if (!cancelled) setCount(null) })
        .finally(() => { if (!cancelled) setCountLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segType, betaStatus, customKey])

  function attemptSend() {
    setResult(null)
    if (!subject.trim()) return setResult({ type: 'error', msg: 'Subject is required.' })
    setConfirming(true)
  }

  function send() {
    setConfirming(false)
    setResult(null)
    startTransition(async () => {
      try {
        const res = await sendBetaInviteAction(subject.trim(), segment, template)
        setResult({
          type: 'success',
          msg: `Sent to ${res.sent} of ${res.recipients} recipient${res.recipients !== 1 ? 's' : ''}${res.failed ? ` — ${res.failed} failed` : ''}.`,
        })
      } catch (e) {
        setResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  return (
    <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4 max-w-xl">
      <div className="rounded-lg border border-[#E7DFFA] bg-[#F2ECFD] px-3 py-2.5 text-[12px] text-[#5B2FD4]">
        {template === 'invite'
          ? <>Sends the pre-designed <strong>Salty beta invite</strong> — install steps, first-session
              checklist, and in-app feedback guide. This is also what a NEW signup gets automatically.</>
          : <>Sends the shorter <strong>install reminder</strong> — one reason, one button, three lines.
              For people already on the list who never installed.</>}
        {' '}Each recipient&apos;s first name is filled in automatically. Banned and unsubscribed
        addresses are always excluded.
      </div>

      <div>
        <label className={labelCls}>Template</label>
        <div className="flex flex-wrap gap-2">
          {([['invite', 'Beta invite (onboarding)'], ['reminder', 'Install reminder']] as const).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => {
                setTemplate(val)
                setSubject(val === 'reminder' ? DEFAULT_BETA_REMINDER_SUBJECT : DEFAULT_BETA_SUBJECT)
              }}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                template === val ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-cream text-salty-secondary hover:bg-stone'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <a
          href={template === 'reminder' ? '/email/beta-reminder/preview' : '/email/beta-invite/preview'}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-[12px] text-ember underline"
        >
          Preview this email
        </a>
      </div>

      <div>
        <label className={labelCls}>Recipients</label>
        <div className="flex flex-wrap gap-2">
          {([['beta', 'Beta signups'], ['custom', 'Custom list (test)']] as const).map(([val, lbl]) => (
            <button
              key={val}
              type="button"
              onClick={() => setSegType(val)}
              className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                segType === val ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-cream text-salty-secondary hover:bg-stone'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {segType === 'beta' && (
        <div>
          <label className={labelCls}>Beta signup status</label>
          <div className="flex flex-wrap gap-2">
            {([['unsigned', 'Not signed up yet'], ['all', 'All beta signups'], ['signed', 'Already signed up']] as const).map(([val, lbl]) => (
              <button
                key={val}
                type="button"
                onClick={() => setBetaStatus(val)}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  betaStatus === val ? 'border-ember bg-ember-light text-ember' : 'border-salty-border bg-cream text-salty-secondary hover:bg-stone'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-salty-muted">
            Defaults to people on the v2 beta waitlist who haven&apos;t created an account yet.
            Beta-unsubscribed and bounced addresses are skipped automatically.
          </p>
        </div>
      )}

      {segType === 'custom' && (
        <div>
          <label className={labelCls}>Test recipient emails</label>
          <textarea
            value={customRaw}
            onChange={e => setCustomRaw(e.target.value)}
            rows={3}
            placeholder="Paste an address to send yourself a test, separated by commas, spaces, or new lines…"
            className={inputCls}
          />
          <p className="mt-1.5 text-[12px] text-salty-muted">
            {customEmails.length} valid address{customEmails.length !== 1 ? 'es' : ''} entered — handy
            for sending yourself a test before the real send. (No name on file, so the greeting reads &quot;Hey there,&quot;.)
          </p>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[13px] text-salty-secondary">
        <Users className="h-3.5 w-3.5" />
        {countLoading ? 'Counting recipients…' : (
          <span><strong className="text-salty-text">{count ?? '—'}</strong> recipient{count !== 1 ? 's' : ''}</span>
        )}
      </div>

      <div>
        <label className={labelCls}>Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject" className={inputCls} />
      </div>

      <div>
        <a
          href="/email/beta-invite/preview"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ember hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Preview the invite
        </a>
      </div>

      {result && <Alert {...result} />}

      {confirming ? (
        <div className="rounded-lg border border-[#F0C4C4] bg-[#FDEDED] p-3 space-y-2">
          <p className="text-[13px] text-[#BF4A3A]">
            Send the beta invite to <strong>{count ?? 0}</strong> recipient{count !== 1 ? 's' : ''}? This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={send} disabled={pending} className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {pending ? 'Sending…' : `Yes, send to ${count ?? 0}`}
            </button>
            <button onClick={() => setConfirming(false)} disabled={pending} className="text-[12px] text-salty-muted hover:text-salty-text">Cancel</button>
          </div>
        </div>
      ) : (
        <button
          onClick={attemptSend}
          disabled={pending || !count}
          className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60 transition-colors"
        >
          <Rocket className="h-4 w-4" />
          Review &amp; Send
        </button>
      )}
    </div>
  )
}
