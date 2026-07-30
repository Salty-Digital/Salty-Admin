'use client'

import { useEffect, useRef, useState } from 'react'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

const HEIGHT = 240

const dayTick = (v: string) => {
  const d = new Date(v)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function Empty() {
  return <div style={{ height: HEIGHT }} className="flex items-center justify-center text-[13px] text-salty-muted">No data</div>
}

/**
 * Measure the container width ourselves instead of using recharts' ResponsiveContainer.
 * ResponsiveContainer briefly reports width 0 on first paint, which makes AreaChart emit
 * `NaN` for the x attribute. We render the chart only once we have a real (>0) width.
 */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/** Daily/weekly bar chart of {day, count}. */
export function SignupsBarChart({ data, label = 'Signups', color = '#E8581A' }: {
  data: { day: string; count: number }[]; label?: string; color?: string
}) {
  const { ref, width } = useContainerWidth()
  if (!data || data.length === 0) return <Empty />
  return (
    <div ref={ref} style={{ width: '100%', height: HEIGHT }}>
      {width > 0 && (
        <BarChart width={width} height={HEIGHT} data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={dayTick} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
            formatter={(v: number) => [v, label]}
          />
          <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      )}
    </div>
  )
}

/** Area chart of {day, total} (cumulative counts, or per-day money when `money`). */
export function CumulativeAreaChart({ data, label = 'Total signups', color = '#C8A96E', money = false }: {
  data: { day: string; total: number }[]; label?: string; color?: string; money?: boolean
}) {
  const { ref, width } = useContainerWidth()
  if (!data || data.length === 0) return <Empty />
  const gradId = `grad-${label.replace(/\W+/g, '')}`
  return (
    <div ref={ref} style={{ width: '100%', height: HEIGHT }}>
      {width > 0 && (
        <AreaChart width={width} height={HEIGHT} data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={dayTick} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} width={money ? 52 : undefined} tickFormatter={money ? (v: number) => `$${v}` : undefined} />
          <Tooltip
            contentStyle={{ fontSize: 12 }}
            labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
            formatter={(v: number) => [money ? `$${v.toFixed(2)}` : v, label]}
          />
          <Area type="monotone" dataKey="total" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} isAnimationActive={false} />
        </AreaChart>
      )}
    </div>
  )
}
