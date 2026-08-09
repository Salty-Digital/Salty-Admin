'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { CATEGORY_COLORS } from '@/lib/categories'

interface DataPoint {
  name: string
  value: number
}

const COLORS = CATEGORY_COLORS

export function CategoryDonutChart({ data }: { data: DataPoint[] }) {
  // recharts renders raw SVG with internal ids/animation that don't match between the server
  // and the client's first paint. Render the chart only after mount so the server emits just
  // the sized placeholder — eliminates the hydration mismatch entirely.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const total = data.reduce((s, d) => s + d.value, 0)
  const top = data[0]

  return (
    <div className="flex items-center gap-5 px-5 py-5">
      <div className="relative shrink-0" style={{ width: 110, height: 110 }}>
        {mounted && (
          <PieChart id="category-donut-chart" width={110} height={110}>
            <Pie
              data={data}
              cx={55}
              cy={55}
              innerRadius={36}
              outerRadius={50}
              dataKey="value"
              strokeWidth={0}
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name.toLowerCase()] ?? '#EAE6DE'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ fontSize: 12, fontFamily: 'DM Sans', border: '1px solid #E5E0D8', borderRadius: 8 }}
              formatter={(v: number) => [`${v} tickets`, '']}
            />
          </PieChart>
        )}
        {/* Centre label */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-sora text-[18px] font-bold text-salty-text leading-none">
            {total > 0 ? `${Math.round((top?.value ?? 0) / total * 100)}%` : '—'}
          </span>
          <span className="text-[10px] text-salty-muted capitalize mt-0.5">{top?.name ?? ''}</span>
        </div>
      </div>

      <div className="flex-1 space-y-1.5">
        {data.slice(0, 5).map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: COLORS[d.name.toLowerCase()] ?? '#EAE6DE' }}
            />
            <span className="flex-1 text-[12px] capitalize text-salty-secondary">{d.name}</span>
            <span className="font-sora text-[13px] font-bold text-salty-text">
              {total > 0 ? `${Math.round(d.value / total * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
