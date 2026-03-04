"use client"

import { useState } from "react"
import type { DiagnosticReport } from "@/lib/image-analysis"
import { Badge } from "@/components/ui/badge"
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Shield,
  AlertTriangle,
  Zap,
  ArrowRight,
} from "lucide-react"

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
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const tone = scoreTone(report.score.total)

  return (
    <div className="flex flex-col gap-4">
      <div
        className="relative overflow-hidden rounded-xl p-4 ring-1"
        style={{
          background: `linear-gradient(160deg, ${tone.softBg}, rgba(255,255,255,0.02))`,
          boxShadow: `inset 0 0 0 1px ${tone.ring}`,
        }}
      >
        <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full border-2 opacity-50" style={{ borderColor: tone.ring }} />
        <div className="pointer-events-none absolute right-6 top-4 -rotate-[11deg] font-mono text-[42px] font-extrabold tracking-tight" style={{ color: tone.color }}>
          {report.score.total}
        </div>
        <div className="pr-24">
          <p className="text-[10px] tracking-widest text-muted-foreground/70">老师批注评分</p>
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
        </div>
      </div>

      {/* AI Thinking Process (collapsible) */}
      <div className="rounded-lg bg-secondary/50 ring-1 ring-border">
        <button
          onClick={() => setThinkingOpen(!thinkingOpen)}
          className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {thinkingOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          AI 思考过程
          <span className="ml-auto text-[10px] text-muted-foreground/50">
            {report.thinkingSteps.filter((s) => s.completed).length}/{report.thinkingSteps.length}
          </span>
        </button>
        {thinkingOpen && (
          <div className="border-t border-border/50 px-3 pb-3 pt-2">
            <div className="space-y-2">
              {report.thinkingSteps.map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                  <span className="text-[11px] leading-relaxed text-foreground/70">
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Module 1: Core Conclusion */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-[12px] font-semibold text-foreground">
            核心结论
          </h3>
        </div>
        <div className="rounded-lg bg-glow-primary p-3 ring-1 ring-primary/10">
          <p className="text-[13px] font-medium leading-relaxed text-foreground/90">
            {report.module1.headline}
          </p>
          <p className="mt-1.5 whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">
            {report.module1.summary}
          </p>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-3 gap-2">
          {report.module1.cards.map((card) => (
            <StatusCard
              key={card.title}
              title={card.title}
              value={card.value}
              description={card.description}
              status={card.status}
            />
          ))}
        </div>
      </div>

      {/* Module 2: Physics Data */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-info" />
          <h3 className="text-[12px] font-semibold text-foreground">
            {report.module2.headline}
          </h3>
        </div>
        <p className="whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">
          {report.module2.description}
        </p>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2">
          {report.module2.metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-lg bg-secondary/60 p-2.5 ring-1 ring-border"
            >
              <p className="font-mono text-[15px] font-bold text-foreground">
                {m.value}
              </p>
              <p className="mt-0.5 text-[10px] font-medium text-muted-foreground">
                {m.label}
              </p>
            </div>
          ))}
        </div>

        {/* Risk items */}
        <div className="space-y-1.5">
          {report.module2.riskItems.map((risk) => (
            <div
              key={risk.label}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 ring-1 ring-border"
            >
              <RiskBadge severity={risk.severity} />
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-foreground/80">
                    {risk.label}
                  </span>
                  <span className="font-mono text-[11px] font-semibold text-foreground">
                    {risk.value}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {risk.note}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Module 3: Core Actions */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <ArrowRight className="h-3.5 w-3.5 text-warning" />
          <h3 className="text-[12px] font-semibold text-foreground">
            {report.module3.headline}
          </h3>
        </div>
        <p className="whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">
          {report.module3.description}
        </p>

        <div className="space-y-1.5">
          {report.module3.coreActions.map((action) => (
            <div
              key={action.param}
              className="flex items-center gap-3 rounded-lg bg-secondary/40 px-3 py-2.5 ring-1 ring-border"
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {action.param}
                </span>
                <span className="font-mono text-[13px] font-bold text-primary">
                  {action.value}
                </span>
              </div>
              <span className="flex-1 break-words text-[10px] leading-relaxed text-muted-foreground/75">
                {action.reason}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatusCard({
  title,
  value,
  description,
  status,
}: {
  title: string
  value: string
  description: string
  status: "good" | "warning" | "danger"
}) {
  const statusColors = {
    good: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
  }

  const bgColors = {
    good: "bg-success/5",
    warning: "bg-warning/5",
    danger: "bg-destructive/5",
  }

  return (
    <div className={`rounded-lg p-2.5 ring-1 ring-border ${bgColors[status]}`}>
      <p className="text-[10px] font-medium text-muted-foreground">{title}</p>
      <p className={`mt-1 text-[13px] font-bold ${statusColors[status]}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground/60">
        {description}
      </p>
    </div>
  )
}

function RiskBadge({ severity }: { severity: "safe" | "warning" | "danger" }) {
  if (severity === "safe") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="h-3 w-3 text-success" />
      </span>
    )
  }
  if (severity === "warning") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/10">
        <AlertTriangle className="h-3 w-3 text-warning" />
      </span>
    )
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/10">
      <AlertTriangle className="h-3 w-3 text-destructive" />
    </span>
  )
}
