'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Sparkles, Loader2, CornerDownLeft, Database, FileCode, Bookmark, Check, Trash2 } from 'lucide-react'
import { askKnowledgeBaseAction, saveAnswerAction, deleteSavedAnswerAction } from './actions'
import type { Citation } from '@/lib/kb/ask'

export interface SavedAnswer {
  id: string
  question: string
  answer: string
  tools_used: string[]
  corpus_generated_at: string | null
  created_at: string
}

/**
 * Ask-the-codebase panel.
 *
 * Answers come from the shipped corpus (see lib/kb/ask.ts), so the assistant knows what exists in
 * both repos and why, but not the line-by-line source. The footer says so — an assistant that
 * quietly implies it has read the code is worse than one that states its limit.
 */

const SUGGESTIONS: Record<'mobile' | 'admin', string[]> = {
  mobile: [
    'Is anything broken right now?',
    'Is the enrichment queue backed up?',
    'What happens if I rotate TOKEN_ENCRYPTION_KEY?',
    'Why would a user\'s inbox never get scanned?',
    'How do I add a new enrichment kind?',
  ],
  admin: [
    'Are inboxes actually being scanned?',
    'Which providers are failing this week?',
    'How is admin access enforced, and where is the real boundary?',
    'Why can a total on a dashboard be silently wrong?',
  ],
}

const TOOL_LABEL: Record<string, string> = {
  enrichment_backlog: 'enrichment queue',
  ticket_enrichment_status: 'ticket enrichment',
  scan_health: 'scan health',
  recent_scan_failures: 'scan failures',
  open_incidents: 'open incidents',
  provider_usage: 'provider usage',
  table_counts: 'table counts',
}

export function AskPanel({ app, corpus, saved }: {
  app: 'mobile' | 'admin'
  corpus: { generatedAt: string; edgeFunctions: number; migrations: number }
  saved: SavedAnswer[]
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [tools, setTools] = useState<string[]>([])
  const [citations, setCitations] = useState<Citation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [openSaved, setOpenSaved] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const ask = (q: string) => {
    const trimmed = q.trim()
    if (!trimmed || pending) return
    setError(null)
    setAnswer(null)
    setTools([])
    setCitations([])
    start(async () => {
      const res = await askKnowledgeBaseAction(trimmed)
      if (res.ok) {
        setAnswer(res.answer)
        setTools(res.toolsUsed)
        setCitations(res.citations)
      } else setError(res.error)
    })
  }

  const ageDays = Math.floor((Date.now() - Date.parse(corpus.generatedAt)) / 86_400_000)

  return (
    <section id="ask" className="scroll-mt-6 overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="border-b border-salty-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-sora text-[15px] font-bold text-salty-text">
          <Sparkles className="h-4 w-4 text-ember" /> Ask the codebase
        </h2>
        <p className="mt-0.5 text-[12px] text-salty-muted">
          Answers span both repos — {corpus.edgeFunctions} edge functions and {corpus.migrations} migrations.
        </p>
      </div>

      <div className="space-y-3 px-5 py-4">
        <div className="flex gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(question)
            }}
            rows={2}
            placeholder="e.g. Why did six mailbox credentials stop working?"
            className="flex-1 resize-y rounded-[10px] border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none"
          />
          <button
            onClick={() => ask(question)}
            disabled={pending || !question.trim()}
            className="flex shrink-0 items-center gap-1.5 self-start rounded-[10px] bg-ember px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
            {pending ? 'Thinking' : 'Ask'}
          </button>
        </div>

        {!answer && !pending && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS[app].map((s) => (
              <button
                key={s}
                onClick={() => { setQuestion(s); ask(s) }}
                className="rounded-full border border-salty-border bg-cream px-2.5 py-1 text-[11.5px] text-salty-secondary transition-colors hover:border-ember hover:text-ember"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-[10px] border border-[#EBCFCA] bg-[#FDF3F1] px-3.5 py-2.5 text-[12.5px] text-[#BF4A3A]">
            {error}
          </div>
        )}

        {answer && (
          <div className="rounded-[10px] border border-salty-border bg-cream/40 px-4 py-3">
            {tools.length > 0 && (
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                <Database className="h-3 w-3 text-[#3E8A5A]" />
                <span className="text-[11px] font-medium text-salty-muted">Checked live:</span>
                {tools.map((t) => (
                  <span key={t} className="rounded-full bg-[#E3F1E8] px-2 py-0.5 text-[10.5px] font-semibold text-[#3E8A5A]">
                    {TOOL_LABEL[t] ?? t}
                  </span>
                ))}
              </div>
            )}

            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-salty-text">{answer}</p>

            {citations.length > 0 && (
              <div className="mt-3 border-t border-salty-border pt-2.5">
                <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
                  Referenced
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {citations.map((c) =>
                    c.kind === 'page' && c.href ? (
                      <Link
                        key={`p-${c.href}`}
                        href={c.href}
                        className="rounded-full border border-salty-border bg-warm-white px-2 py-0.5 text-[11px] font-medium text-ember hover:underline"
                      >
                        {c.label}
                      </Link>
                    ) : (
                      <span
                        key={`f-${c.label}`}
                        className="flex items-center gap-1 rounded-full border border-salty-border bg-warm-white px-2 py-0.5 font-mono text-[10.5px] text-salty-secondary"
                      >
                        <FileCode className="h-2.5 w-2.5" /> {c.label}
                      </span>
                    ),
                  )}
                </div>
              </div>
            )}

            <div className="mt-3 flex items-center gap-4">
              <button
                onClick={() => { setAnswer(null); setQuestion(''); setTools([]); setCitations([]); setSavedOk(false) }}
                className="text-[11.5px] font-medium text-ember hover:underline"
              >
                Ask something else
              </button>
              <button
                onClick={() => start(async () => {
                  const r = await saveAnswerAction(question, answer, tools)
                  if (r.ok) setSavedOk(true)
                  else setError(r.error ?? 'Could not save.')
                })}
                disabled={pending || savedOk}
                className="flex items-center gap-1 text-[11.5px] font-medium text-salty-secondary hover:text-ember disabled:opacity-60"
              >
                {savedOk
                  ? <><Check className="h-3 w-3 text-[#3E8A5A]" /> Saved to FAQ</>
                  : <><Bookmark className="h-3 w-3" /> Save to FAQ</>}
              </button>
            </div>
          </div>
        )}

        {saved.length > 0 && !answer && !pending && (
          <div className="border-t border-salty-border pt-3">
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
              Saved answers · {saved.length}
            </p>
            <div className="space-y-1">
              {saved.map((s) => {
                const stale = !!s.corpus_generated_at
                  && Date.parse(s.corpus_generated_at) < Date.parse(corpus.generatedAt)
                const isOpen = openSaved === s.id
                return (
                  <div key={s.id} className="rounded-[10px] border border-salty-border bg-warm-white">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        onClick={() => setOpenSaved(isOpen ? null : s.id)}
                        className="flex-1 text-left text-[12.5px] font-medium text-salty-text hover:text-ember"
                      >
                        {s.question}
                      </button>
                      {stale && (
                        <span
                          title="Saved against an older corpus — re-ask to confirm it still holds."
                          className="rounded-full bg-[#FBF1DE] px-1.5 py-0.5 text-[10px] font-semibold text-[#8A6830]"
                        >
                          may be stale
                        </span>
                      )}
                      <button
                        onClick={() => start(async () => { await deleteSavedAnswerAction(s.id) })}
                        disabled={pending}
                        title="Delete this saved answer"
                        className="text-salty-muted hover:text-[#BF4A3A] disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {isOpen && (
                      <p className="whitespace-pre-wrap border-t border-salty-border px-3 py-2.5 text-[12.5px] leading-relaxed text-salty-secondary">
                        {s.answer}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-salty-muted">
          Knows the structure and intent of both repos — every edge function, migration and route —
          but not the line-by-line source, so it will point you at a file rather than quote it.
          Snapshot is {ageDays === 0 ? 'from today' : `${ageDays} day${ageDays === 1 ? '' : 's'} old`};
          refresh with <code className="font-mono">npm run kb:index</code>. Cmd/Ctrl+Enter to send.
        </p>
      </div>
    </section>
  )
}
