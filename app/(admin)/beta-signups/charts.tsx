'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const dayTick = (v: string) => {
  const d = new Date(v)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** Daily signups bar chart. Mount-gated to avoid a recharts SSR hydration mismatch. */
export function SignupsBarChart({ data }: { data: { day: string; count: number }[] }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div style={{ height: 240 }} />

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={dayTick} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
          formatter={(v: number) => [v, 'Signups']}
        />
        <Bar dataKey="count" fill="#E8581A" radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Cumulative total signups over time. */
export function CumulativeAreaChart({ data }: { data: { day: string; total: number }[] }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div style={{ height: 240 }} />

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="beta-cumulative" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C8A96E" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#C8A96E" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={dayTick} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
          formatter={(v: number) => [v, 'Total signups']}
        />
        <Area type="monotone" dataKey="total" stroke="#C8A96E" strokeWidth={2} fill="url(#beta-cumulative)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
