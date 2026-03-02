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
      { values: data.r, color: "rgba(255, 59, 48, 0.45)", key: "r" },
      { values: data.g, color: "rgba(52, 199, 89, 0.45)", key: "g" },
      { values: data.b, color: "rgba(0, 122, 255, 0.45)", key: "b" },
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
      <div className="flex h-20 items-center justify-center rounded-md bg-secondary">
        <span className="text-[11px] text-muted-foreground">
          等待图像分析...
        </span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-md bg-[#1D1D1F]">
      <svg viewBox="0 0 256 80" className="h-20 w-full" preserveAspectRatio="none">
        {paths}
      </svg>
    </div>
  )
}
