import type { ReactNode } from 'react'
import { createV2Client, isV2Configured } from '@/lib/supabase/v2'
import { maskEmail } from '@/lib/privacy'
import { verifyBetaUnsubscribeToken } from '@/lib/unsubscribe'
import { unsubscribeBetaAction } from './actions'

interface Props {
  searchParams: Promise<{ id?: string; t?: string; done?: string }>
}

export const dynamic = 'force-dynamic'

function Card({ title, body, cta }: { title: string; body: string; cta?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-ember font-sora text-[22px] font-bold text-white">S</div>
          <div className="text-center">
            <h1 className="font-sora text-[22px] font-bold tracking-tight text-salty-text">Salty</h1>
            <p className="mt-1 text-[13px] text-salty-muted">Email preferences</p>
          </div>
        </div>
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-6 text-center shadow-sm">
          <h2 className="mb-1 font-sora text-[15px] font-bold text-salty-text">{title}</h2>
          <p className="text-[13px] leading-5 text-salty-muted">{body}</p>
          {cta}
        </div>
      </div>
    </div>
  )
}

export default async function BetaUnsubscribePage({ searchParams }: Props) {
  const { id, t, done } = await searchParams

  if (!id || !t || !verifyBetaUnsubscribeToken(id, t)) {
    return <Card title="Invalid link" body="This unsubscribe link is invalid or has been tampered with." />
  }

  let alreadyDone = done === '1'
  let email: string | null = null

  if (isV2Configured()) {
    try {
      const db = createV2Client()
      const { data } = await db.from('beta_signups').select('email, unsubscribed_at').eq('id', id).maybeSingle()
      if (!data) return <Card title="Invalid link" body="This unsubscribe link is invalid or has been tampered with." />
      email = typeof data.email === 'string' ? data.email : null
      if (data.unsubscribed_at) alreadyDone = true
    } catch {
      // v2 unreachable — fall through and still let the explicit-click action try.
    }
  }

  if (alreadyDone) {
    return <Card title="You're unsubscribed" body="You won't receive further Salty beta emails at this address." />
  }

  const shown = email ? maskEmail(email) : 'this address'
  return (
    <Card
      title="Unsubscribe from Salty beta emails?"
      body={`We'll stop sending beta and waitlist emails to ${shown}.`}
      cta={
        <form action={unsubscribeBetaAction.bind(null, id, t)} className="mt-4">
          <button type="submit" className="text-[13px] font-medium text-ember hover:underline">Unsubscribe</button>
        </form>
      }
    />
  )
}
