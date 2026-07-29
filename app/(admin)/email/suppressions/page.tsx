import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { RemoveSuppressionButton } from './remove-button'
import { AddSuppressionForm } from './add-suppression-form'

interface Suppression {
  email: string
  reason: string
  event_type: string | null
  created_at: string
}

const REASON_STYLES: Record<string, { cls: string; label: string }> = {
  complained: { cls: 'bg-[#FDEDED] text-[#BF4A3A]', label: 'Complained' },
  bounced: { cls: 'bg-[#FFF8E6] text-[#8A6830]', label: 'Bounced' },
  manual: { cls: 'bg-stone text-salty-secondary', label: 'Manual' },
}

function ReasonBadge({ reason }: { reason: string }) {
  const { cls, label } = REASON_STYLES[reason] ?? { cls: 'bg-stone text-salty-secondary', label: reason }
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

export default async function SuppressionsPage() {
  await requireAdmin(2)
  const db = createServiceClient()

  const { data } = await db
    .from('email_suppressions')
    .select('email, reason, event_type, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  const rows = (data as Suppression[] | null) ?? []

  return (
    <div className="p-7 space-y-7">
      <div>
        <Link href="/email" className="mb-2 inline-flex items-center gap-1.5 text-[12px] text-salty-muted hover:text-salty-text">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Email
        </Link>
        <h1 className="font-sora text-[20px] font-bold text-salty-text">Email Suppressions</h1>
        <p className="text-[13px] text-salty-muted">
          Addresses that hard-bounced or reported spam. They&apos;re automatically excluded from every
          send to protect your sending reputation. Remove one to allow email again.
        </p>
      </div>

      <AddSuppressionForm />

      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-salty-border bg-cream">
              {['Email', 'Reason', 'Added', ''].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[13px] text-salty-muted">No suppressed addresses yet</td></tr>
            ) : (
              rows.map(r => (
                <tr key={r.email} className="border-b border-salty-border last:border-0 hover:bg-cream">
                  <td className="px-4 py-3 text-[13px] font-medium text-salty-text">{r.email}</td>
                  <td className="px-4 py-3"><ReasonBadge reason={r.reason} /></td>
                  <td className="px-4 py-3 whitespace-nowrap text-[12px] text-salty-secondary">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right"><RemoveSuppressionButton email={r.email} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
