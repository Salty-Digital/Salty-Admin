'use client'

import { useState, useTransition } from 'react'
import { Loader2, Send, Radio } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TemplatePicker } from '@/components/ui/template-picker'
import { NOTIFICATION_TEMPLATES } from '@/lib/message-templates'
import { sendToUserAction, broadcastAction } from './actions'
import { useAccessLevel } from '@/components/admin-provider'
import { TICKET_CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'

const SCREENS = ['', 'tickets', 'friends', 'settings', 'feedback']

function Alert({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-[13px] ${
      type === 'success' ? 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]' : 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A]'
    }`}>
      {msg}
    </div>
  )
}

const labelCls = 'block text-[12px] font-semibold uppercase tracking-[0.06em] text-salty-muted mb-1.5'
const inputCls = 'w-full rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20 font-sans'

export function NotifComposer({ users }: { users: { id: string; email: string }[] }) {
  const level = useAccessLevel()
  const canBroadcast = level <= 2

  // Single user state
  const [userId,  setUserId]  = useState('')
  const [s_title, setSTitle]  = useState('')
  const [s_body,  setSBody]   = useState('')
  const [s_screen,setSScreen] = useState('')
  const [s_result,setSResult] = useState<{ type: 'success'|'error'; msg: string }|null>(null)
  const [sPending, startS] = useTransition()

  // Broadcast state
  const [b_title, setBTitle]   = useState('')
  const [b_body,  setBBody]    = useState('')
  const [b_cat,   setBCat]     = useState('')
  const [b_result,setBResult]  = useState<{ type: 'success'|'error'; msg: string }|null>(null)
  const [bPending, startB] = useTransition()

  function applySingleTemplate(id: string) {
    const t = NOTIFICATION_TEMPLATES.find(t => t.id === id)
    if (!t) return
    if ((s_title.trim() || s_body.trim()) && !window.confirm('Replace the current title and message with this template?')) return
    setSTitle(t.title)
    setSBody(t.body)
    setSScreen(t.screen ?? '')
    setSResult(null)
  }

  function applyBroadcastTemplate(id: string) {
    const t = NOTIFICATION_TEMPLATES.find(t => t.id === id)
    if (!t) return
    if ((b_title.trim() || b_body.trim()) && !window.confirm('Replace the current title and message with this template?')) return
    setBTitle(t.title)
    setBBody(t.body)
    setBResult(null)
  }

  function sendSingle() {
    if (!userId || !s_title || !s_body) return setSResult({ type: 'error', msg: 'User, title and body are required.' })
    setSResult(null)
    startS(async () => {
      try {
        await sendToUserAction(userId, s_title, s_body, s_screen || undefined)
        setSResult({ type: 'success', msg: 'Notification sent!' })
        setSTitle(''); setSBody(''); setSScreen('')
      } catch (e) {
        setSResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  function sendBroadcast() {
    if (!b_title || !b_body) return setBResult({ type: 'error', msg: 'Title and body are required.' })
    setBResult(null)
    startB(async () => {
      try {
        const res = await broadcastAction(b_title, b_body, b_cat || undefined)
        setBResult({ type: 'success', msg: `Sent to ${res.count} user${res.count !== 1 ? 's' : ''}!` })
        setBTitle(''); setBBody(''); setBCat('')
      } catch (e) {
        setBResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  return (
    <Tabs defaultValue="single">
      <TabsList className="bg-stone">
        <TabsTrigger value="single">Send to User</TabsTrigger>
        {canBroadcast && <TabsTrigger value="broadcast">Broadcast</TabsTrigger>}
      </TabsList>

      {/* Single user */}
      <TabsContent value="single">
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4 max-w-lg">
          <div>
            <label className={labelCls}>Template</label>
            <TemplatePicker options={NOTIFICATION_TEMPLATES} onPick={applySingleTemplate} className={inputCls} />
            <p className="mt-1.5 text-[12px] text-salty-muted">Pre-fills title, message, and deep link — then edit before sending. Text in [brackets] is a placeholder.</p>
          </div>
          <div>
            <label className={labelCls}>Recipient</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls}>
              <option value="">Select a user…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Title</label>
            <input value={s_title} onChange={e => setSTitle(e.target.value)} placeholder="e.g. Your ticket is ready" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Message</label>
            <textarea value={s_body} onChange={e => setSBody(e.target.value)} rows={3} placeholder="Notification body…" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Deep Link Screen (optional)</label>
            <select value={s_screen} onChange={e => setSScreen(e.target.value)} className={inputCls}>
              {SCREENS.map(s => <option key={s} value={s}>{s || '(none)'}</option>)}
            </select>
          </div>
          {s_result && <Alert {...s_result} />}
          <button
            onClick={sendSingle}
            disabled={sPending}
            className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60 transition-colors"
          >
            {sPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sPending ? 'Sending…' : 'Send Notification'}
          </button>
        </div>
      </TabsContent>

      {/* Broadcast */}
      {canBroadcast && (
        <TabsContent value="broadcast">
          <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 space-y-4 max-w-lg">
            <div className="rounded-lg border border-[#FFF8E6] bg-[#FFF8E6] px-3 py-2 text-[12px] text-[#8A6830]">
              Broadcast sends to ALL users (or filtered by category). Use carefully.
            </div>
            <div>
              <label className={labelCls}>Template</label>
              <TemplatePicker options={NOTIFICATION_TEMPLATES} onPick={applyBroadcastTemplate} className={inputCls} />
              <p className="mt-1.5 text-[12px] text-salty-muted">Pre-fills the title and message — then edit before sending. Text in [brackets] is a placeholder.</p>
            </div>
            <div>
              <label className={labelCls}>Filter — category (optional)</label>
              <select value={b_cat} onChange={e => setBCat(e.target.value)} className={inputCls}>
                <option value="">All users</option>
                {TICKET_CATEGORIES.map(c => <option key={c} value={c}>Users with {CATEGORY_LABELS[c] ?? c} tickets</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Title</label>
              <input value={b_title} onChange={e => setBTitle(e.target.value)} placeholder="Broadcast title" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Message</label>
              <textarea value={b_body} onChange={e => setBBody(e.target.value)} rows={3} placeholder="Broadcast body…" className={inputCls} />
            </div>
            {b_result && <Alert {...b_result} />}
            <button
              onClick={sendBroadcast}
              disabled={bPending}
              className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60 transition-colors"
            >
              {bPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              {bPending ? 'Broadcasting…' : 'Broadcast'}
            </button>
          </div>
        </TabsContent>
      )}
    </Tabs>
  )
}
