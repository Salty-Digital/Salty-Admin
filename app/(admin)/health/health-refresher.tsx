'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Pause, Play } from 'lucide-react'

// Re-runs the server component on an interval so /health stays live without a manual reload.
export function HealthRefresher({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter()
  const [on, setOn] = useState(true)

  useEffect(() => {
    if (!on) return
    const id = setInterval(() => router.refresh(), seconds * 1000)
    return () => clearInterval(id)
  }, [router, seconds, on])

  return (
    <button
      onClick={() => setOn((v) => !v)}
      title={on ? `Auto-refreshing every ${seconds}s — click to pause` : 'Auto-refresh paused — click to resume'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-2.5 py-1 text-[11.5px] font-medium text-salty-secondary transition-colors hover:bg-cream"
    >
      {on ? <RefreshCw className="h-3.5 w-3.5 text-[#3E8A5A]" /> : <Play className="h-3.5 w-3.5" />}
      {on ? `Live · ${seconds}s` : 'Paused'}
      {on && <Pause className="h-3 w-3 opacity-60" />}
    </button>
  )
}
