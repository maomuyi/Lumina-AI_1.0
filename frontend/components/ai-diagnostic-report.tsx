"use client"

import type { DiagnosticReport } from "@/lib/image-analysis"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, ScanSearch } from "lucide-react"

interface AiDiagnosticReportProps {
  report: DiagnosticReport
}

function scoreTone(score: number): {
  color: string
  softBg: string
  ring: string
} {
  const normalized = Math.min(100, Math.max(0, score))
  const hue = (normalized / 100) * 120
  return {
    color: `hsl(${hue} 78% 47%)`,
    softBg: `hsl(${hue} 70% 22% / 0.20)`,
    ring: `hsl(${hue} 78% 47% / 0.45)`,
  }
}

export function AiDiagnosticReport({ report }: AiDiagnosticReportProps) {
  const completedSteps = report.thinkingSteps.filter((step) => step.completed).length

  return (
    <div className="rounded-lg bg-secondary/45 ring-1 ring-border">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex items-center gap-2 text-[11px] font-semibold text-foreground/85">
          <ScanSearch className="h-3.5 w-3.5 text-primary" />
          分析图片过程
        </span>
        <span className="shrink-0 rounded-full bg-background/45 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/70">
          {completedSteps}/{report.thinkingSteps.length}
        </span>
      </div>
      <div className="border-t border-border/50 px-3 pb-3 pt-2">
        <div className="space-y-2">
          {report.thinkingSteps.map((step, index) => (
            <div key={`${step.label}-${index}`} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
              <span className="text-[11px] leading-relaxed text-foreground/70">
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DiagnosticScoreCard({ report }: AiDiagnosticReportProps) {
  const tone = scoreTone(report.score.total)

  return (
    <div
      className="relative overflow-hidden rounded-xl p-4 ring-1"
      style={{
        background: `linear-gradient(160deg, ${tone.softBg}, rgba(255,255,255,0.02))`,
        boxShadow: `inset 0 0 0 1px ${tone.ring}`,
      }}
    >
      <div
        className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full border-2 opacity-50"
        style={{ borderColor: tone.ring }}
      />
      <div
        className="pointer-events-none absolute right-6 top-4 -rotate-[11deg] font-mono text-[42px] font-extrabold tracking-tight"
        style={{ color: tone.color }}
      >
        {report.score.total}
      </div>

      <div className="pr-24">
        <p className="text-[10px] tracking-widest text-muted-foreground/70">专业审片指标</p>
        <h2 className="mt-0.5 text-[15px] font-semibold text-foreground">
          {report.score.title}
        </h2>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border text-[14px] font-bold"
            style={{ borderColor: tone.ring, color: tone.color, background: tone.softBg }}
          >
            {report.score.grade}
          </span>
          <Badge
            variant="outline"
            className="border-[1.5px] bg-transparent text-[11px]"
            style={{ borderColor: tone.ring, color: tone.color }}
          >
            {report.score.tag}
          </Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: tone.color, background: tone.softBg }}
          >
            {report.score.confidence}
          </span>
          <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] text-muted-foreground">
            不是照片好坏分
          </span>
        </div>
        <p className="mt-2 max-w-[210px] text-[10px] leading-relaxed text-muted-foreground/70">
          {report.score.subtitle}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {report.score.dimensions.map((dimension) => (
          <ScoreDimension
            key={dimension.label}
            label={dimension.label}
            value={dimension.value}
            note={dimension.note}
            tone={scoreTone(dimension.value)}
          />
        ))}
      </div>
    </div>
  )
}

function ScoreDimension({
  label,
  value,
  note,
  tone,
}: {
  label: string
  value: number
  note: string
  tone: {
    color: string
    softBg: string
    ring: string
  }
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))

  return (
    <div className="rounded-lg bg-card/45 p-2.5 ring-1 ring-border/70">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[12px] font-bold" style={{ color: tone.color }}>
          {clamped}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, backgroundColor: tone.color }}
        />
      </div>
      <p className="mt-1.5 line-clamp-2 text-[9px] leading-snug text-muted-foreground/65">
        {note}
      </p>
    </div>
  )
}
