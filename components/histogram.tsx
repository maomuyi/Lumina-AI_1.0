"use client"

import { useMemo } from "react"

interface HistogramProps {
  data: {
    r: number[]
    g: number[]
    b: number[]
  } | null
}

export function Histogram({ data }: HistogramProps) {
  const paths = useMemo(() => {
    if (!data) return null

    const width = 256
    const height = 80
    const channels = [
      { values: data.r, color: "rgba(255, 107, 107, 0.5)", key: "r" },
      { values: data.g, color: "rgba(81, 207, 102, 0.5)", key: "g" },
      { values: data.b, color: "rgba(108, 142, 255, 0.5)", key: "b" },
    ]

    return channels.map(({ values, color, key }) => {
      const max = Math.max(...values, 1)
      const points = values.map((v, i) => {
        const x = (i / 255) * width
        const y = height - (v / max) * height
        return `${x},${y}`
      })
      const d = `M0,${height} L${points.join(" L")} L${width},${height} Z`
      return <path key={key} d={d} fill={color} />
    })
  }, [data])

  if (!data) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg bg-secondary ring-1 ring-border">
        <span className="text-[11px] text-muted-foreground/40">
          等待图像分析...
        </span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg bg-background ring-1 ring-border">
      <svg viewBox="0 0 256 80" className="h-20 w-full" preserveAspectRatio="none">
        {/* Subtle grid lines */}
        <line x1="0" y1="20" x2="256" y2="20" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        <line x1="0" y1="40" x2="256" y2="40" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        <line x1="0" y1="60" x2="256" y2="60" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        {paths}
      </svg>
    </div>
  )
}
