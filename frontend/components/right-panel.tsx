"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { ParamSlider } from "@/components/param-slider"
import { AiDiagnosticReport } from "@/components/ai-diagnostic-report"
import { LIGHTROOM_GROUPS } from "@/lib/lightroom-params"
import type { DiagnosticReport } from "@/lib/image-analysis"
import {
  Download,
  RefreshCw,
  FileDown,
  Loader2,
  SlidersHorizontal,
  FileText,
  Sparkles,
  Send,
  Info,
  ChevronRight,
} from "lucide-react"

type ViewTab = "report" | "params"

const QUICK_CHIPS = [
  "肤色再提亮一点",
  "环境想要冷色调",
  "增加复古胶片颗粒感",
  "更加通透一些",
]

interface RightPanelProps {
  params: Record<string, number>
  aiRecommendedParams: Record<string, number> | null
  aiModifiedKeys: Set<string>
  report: DiagnosticReport | null
  onParamChange: (key: string, value: number) => void
  onGenerateXMP: () => void
  onDownloadXMP: () => void
  onRegenerate: () => void
  onRefinement: (text: string) => void
  isGenerating: boolean
  hasAnalysis: boolean
  xmpReady: boolean
  isAnalyzing: boolean
}

export function RightPanel({
  params,
  aiRecommendedParams,
  aiModifiedKeys,
  report,
  onParamChange,
  onGenerateXMP,
  onDownloadXMP,
  onRegenerate,
  onRefinement,
  isGenerating,
  hasAnalysis,
  xmpReady,
  isAnalyzing,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("report")
  const [refinementText, setRefinementText] = useState("")

  const handleSendRefinement = () => {
    if (!refinementText.trim()) return
    onRefinement(refinementText.trim())
    setRefinementText("")
  }

  return (
    <aside className="flex min-h-0 w-[360px] shrink-0 flex-col border-l border-border/80 bg-sidebar">
      {/* Tab switcher */}
      {hasAnalysis && (
        <div className="flex shrink-0 border-b border-border">
          <button
            onClick={() => setActiveTab("report")}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[11px] font-semibold transition-all ${activeTab === "report"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
          >
            <FileText className="h-3 w-3" />
            诊断报告
          </button>
          <button
            onClick={() => setActiveTab("params")}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[11px] font-semibold transition-all ${activeTab === "params"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            参数调节
          </button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col">
          {/* Report Tab */}
          {(activeTab === "report" || !hasAnalysis) && (
            <div className="p-4">
              {isAnalyzing && !report ? (
                <ReportSkeleton />
              ) : report ? (
                <AiDiagnosticReport report={report} />
              ) : (
                <EmptyState />
              )}
            </div>
          )}

          {/* Params Tab — Lightroom 风格 */}
          {activeTab === "params" && hasAnalysis && (
            <div className="pt-1">
              {LIGHTROOM_GROUPS.map((group) => {
                const hasAiMods = group.params.some((p) =>
                  aiModifiedKeys.has(p.key)
                )
                return (
                  <ParamGroup
                    key={group.key}
                    groupKey={group.key}
                    label={group.label}
                    hasAiMods={hasAiMods}
                    defaultOpen={["basic", "presence", "tone_curve"].includes(group.key)}
                  >
                    {group.params.map((param) => (
                      <ParamSlider
                        key={param.key}
                        param={param}
                        value={params[param.key] ?? param.defaultValue}
                        aiRecommendedValue={
                          aiRecommendedParams?.[param.key]
                        }
                        isAiModified={aiModifiedKeys.has(param.key)}
                        onChange={onParamChange}
                      />
                    ))}
                  </ParamGroup>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom Action Bar */}
      {hasAnalysis && (
        <div className="flex shrink-0 flex-col border-t border-border">
          {/* Multi-round refinement chat */}
          <div className="border-b border-border/50 p-3">
            <p className="mb-2 text-[10px] text-muted-foreground/60">
              对调色不满意？告诉 AI 你的想法：
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => onRefinement(chip)}
                  className="rounded-full bg-secondary/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground ring-1 ring-border transition-all hover:bg-primary/10 hover:text-primary hover:ring-primary/20"
                >
                  {chip}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={refinementText}
                onChange={(e) => setRefinementText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendRefinement()}
                placeholder="输入你想微调的想法..."
                className="flex-1 rounded-lg bg-secondary/60 px-3 py-2 text-[11px] text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground/30 focus:ring-primary/30"
              />
              <Button
                size="sm"
                onClick={handleSendRefinement}
                disabled={!refinementText.trim()}
                className="h-8 w-8 shrink-0 rounded-lg bg-primary/15 p-0 text-primary shadow-none hover:bg-primary/25 disabled:opacity-30"
              >
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Download & actions */}
          <div className="flex flex-col gap-2 p-3">
            {!xmpReady ? (
              <Button
                onClick={onGenerateXMP}
                disabled={isGenerating}
                className="h-10 w-full rounded-lg bg-primary text-[12px] font-semibold text-primary-foreground shadow-[0_0_20px_rgba(108,142,255,0.2)] transition-all hover:bg-primary/90 hover:shadow-[0_0_30px_rgba(108,142,255,0.3)]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <FileDown className="mr-1.5 h-3.5 w-3.5" />
                    生成 XMP 预设
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={onDownloadXMP}
                className="h-10 w-full rounded-lg bg-success text-[12px] font-bold text-foreground shadow-[0_0_20px_rgba(81,207,102,0.15)] transition-all hover:bg-success/90 hover:shadow-[0_0_30px_rgba(81,207,102,0.25)]"
              >
                <Download className="mr-1.5 h-4 w-4" />
                下载 Lightroom (.xmp) 预设
              </Button>
            )}

            {xmpReady && (
              <div className="flex items-start gap-1.5 rounded-lg bg-secondary/40 px-3 py-2">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
                <p className="text-[10px] leading-relaxed text-muted-foreground/60">
                  该预设支持导入 Mac/Win 端 Lightroom (Classic/CC)。手机端用户请在电脑端导入后，等待 Adobe 账号自动云同步至手机 APP。
                </p>
              </div>
            )}

            <Button
              variant="ghost"
              onClick={onRegenerate}
              disabled={isGenerating || isAnalyzing}
              className="h-7 w-full text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              重新生成
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}

/**
 * Lightroom 风格的可折叠参数组
 * 三角形 toggle + 紧凑 header + AI 修改指示点
 */
function ParamGroup({
  groupKey,
  label,
  hasAiMods,
  defaultOpen = false,
  children,
}: {
  groupKey: string
  label: string
  hasAiMods: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-white/[0.06]" data-group={groupKey}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-[6px] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground/80"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""
            }`}
        />
        {label}
        {hasAiMods && (
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(108,142,255,0.6)]" />
        )}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary ring-1 ring-border">
        <Sparkles className="h-6 w-6 text-muted-foreground/25" />
      </div>
      <p className="mt-4 text-[13px] font-medium text-muted-foreground/50">
        上传图片并开始分析
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground/30">
        AI 将为您生成专业诊断报告
      </p>
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full rounded-lg bg-secondary" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-3/4 bg-secondary" />
        <Skeleton className="h-16 w-full rounded-lg bg-secondary" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-20 rounded-lg bg-secondary" />
        <Skeleton className="h-20 rounded-lg bg-secondary" />
        <Skeleton className="h-20 rounded-lg bg-secondary" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/2 bg-secondary" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-14 rounded-lg bg-secondary" />
          <Skeleton className="h-14 rounded-lg bg-secondary" />
          <Skeleton className="h-14 rounded-lg bg-secondary" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/2 bg-secondary" />
        <Skeleton className="h-12 w-full rounded-lg bg-secondary" />
        <Skeleton className="h-12 w-full rounded-lg bg-secondary" />
      </div>
    </div>
  )
}
