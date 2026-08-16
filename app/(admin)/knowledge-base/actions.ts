'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { assertUUID, assertString } from '@/lib/validate'
import { askKnowledgeBase, corpusMeta } from '@/lib/kb/ask'

import type { Citation } from '@/lib/kb/ask'

type Result =
  | { ok: true; answer: string; toolsUsed: string[]; citations: Citation[] }
  | { ok: false; error: string }

/**
 * Ask the knowledge-base assistant.
 *
 * Read-only: it answers from the shipped corpus and touches no data. Gated at level 2 to match the
 * page itself. Every call is written to llm_call_log as `knowledge-base.ask`, so the spend shows up
 * attributed on /llm-costs rather than appearing as unexplained Anthropic usage.
 */
export async function askKnowledgeBaseAction(question: string): Promise<Result> {
  await requireAdmin(2)
  const result = await askKnowledgeBase(question)
  return result.ok
    ? { ok: true, answer: result.answer, toolsUsed: result.toolsUsed ?? [], citations: result.citations ?? [] }
    : { ok: false, error: result.error ?? 'Unknown error.' }
}

/**
 * Save an answer to the FAQ.
 *
 * Stores the corpus timestamp alongside it, so a saved answer can later be shown as possibly stale
 * rather than quietly presenting itself as current.
 */
export async function saveAnswerAction(
  question: string,
  answer: string,
  toolsUsed: string[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin(2)
    const q = assertString(question, 'Question', 1000)
    const a = assertString(answer, 'Answer', 20_000)

    const db = createServiceClient()
    const { error } = await db.from('kb_saved_answers').insert({
      question: q,
      answer: a,
      tools_used: toolsUsed.slice(0, 10),
      corpus_generated_at: corpusMeta().generatedAt,
      saved_by: admin.id,
    })
    if (error) return { ok: false, error: error.message }

    await logAudit(admin.id, 'save_kb_answer', 'kb_saved_answer', undefined, { question: q.slice(0, 200) })
    revalidatePath('/knowledge-base')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Remove a saved answer — the review mechanism that makes saving them safe. */
export async function deleteSavedAnswerAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const admin = await requireAdmin(2)
    const answerId = assertUUID(id, 'Answer ID')
    const db = createServiceClient()
    const { error } = await db.from('kb_saved_answers').delete().eq('id', answerId)
    if (error) return { ok: false, error: error.message }
    await logAudit(admin.id, 'delete_kb_answer', 'kb_saved_answer', answerId)
    revalidatePath('/knowledge-base')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
