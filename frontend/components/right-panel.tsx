"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { ParamSlider } from "@/components/param-slider"
import { AiDiagnosticReport } from "@/components/ai-diagnostic-report"
import { LIGHTROOM_GROUPS } from "@/lib/lightroom-params"
import type { DiagnosticReport } from "@/lib/image-analysis"
import { getForwardVersionId, getParentVersionId } from "@/lib/refine-history"
import type { ChangedParam, RefineHistoryState, RefineVersion } from "@/lib/refine-history"
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileDown,
  FileText,
  History,
  Info,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Redo2,
  Send,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  UserRound,
} from "lucide-react"

type ViewTab = "chat" | "params"
type AnalysisEngine = "local" | "api" | null
type AssistantInputIntent = "refine" | "explain"

type AssistantRunStatus = {
  status: "idle" | "running" | "error"
  targetVersionId: string | null
  prompt: string
  message: string
  progress: number
  stage: number
  events: string[]
  lastError: string | null
}

type AssistantHighlight = {
  label: string
  value: string
  reason: string
  paramKey?: string
}

type LocalExplainTurn = {
  id: string
  question: string
  answer: string
  highlights: AssistantHighlight[]
  createdAt: string
}

type ChatItem =
  | { id: string; type: "v1"; createdAt: string }
  | { id: string; type: "user"; createdAt: string; text: string; intent: AssistantInputIntent }
  | { id: string; type: "version"; createdAt: string; version: RefineVersion }
  | { id: string; type: "explain"; createdAt: string; answer: string; highlights: AssistantHighlight[] }

const PARAM_LABELS = Object.fromEntries(
  LIGHTROOM_GROUPS.flatMap((group) =>
    group.params.map((param) => [param.key, param.label])
  )
) as Record<string, string>

const STYLE_LABELS: Record<string, string> = {
  auto: "AI 智能匹配",
  japanese: "日系清新",
  film: "胶片质感",
  cyberpunk: "赛博朋克",
  grey: "高级灰",
  cinematic: "电影感",
}

const FALLBACK_CHIPS = ["高光再压一点", "天空更蓝", "整体更冷", "肤色自然", "胶片感强一点"]

function cleanText(value: string): string {
  return value
    .replace(/【[^】]+】/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function formatDelta(change: ChangedParam): string {
  const delta = change.after - change.before
  const rounded = Math.abs(delta) >= 10 ? Math.round(delta) : Math.round(delta * 100) / 100
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

function getEngineLabel(engine: AnalysisEngine): string {
  if (engine === "api") return "AI API"
  if (engine === "local") return "本地规则"
  return "分析引擎"
}

function getFileTypeLabel(fileType: string | null): string {
  if (!fileType) return "未上传"
  return fileType.toUpperCase()
}

function classifyAssistantInput(text: string): AssistantInputIntent {
  const trimmed = text.trim()
  if (!trimmed) return "refine"

  const actionPattern = /(帮我|请|把|调|改|生成|变|增强|减弱|加|减少|压|提|降|拉|推|更|再|冷|暖|亮|暗|蓝|绿|红|黄|对比|饱和|胶片|日系|电影感|肤色|高光|阴影)/
  const questionPattern = /(为什么|解释|什么意思|怎么理解|有什么作用|会怎样|是否|能不能讲讲|能不能解释|原因|区别|导入.*会|是什么|\?)/
  const explicitEditPattern = /(帮我|请|把|生成|改成|调成|调到|继续|顺便|同时)/
  const hasAction = actionPattern.test(trimmed)
  const hasQuestion = questionPattern.test(trimmed)
  const explicitQuestionOnly = hasQuestion && !explicitEditPattern.test(trimmed)

  if (hasAction && !explicitQuestionOnly) return "refine"
  if (hasQuestion) return "explain"
  return "refine"
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildV1Highlights(report: DiagnosticReport | null): AssistantHighlight[] {
  if (!report) return []
  return report.module3.coreActions.slice(0, 5).map((action, index) => ({
    label: action.param || `动作 ${index + 1}`,
    value: action.value || "建议",
    reason: action.reason,
    paramKey: action.param,
  }))
}

function getScoreTone(score: number): {
  label: string
  className: string
  accentClassName: string
  meterClassName: string
} {
  if (score >= 84) {
    return {
      label: "高可信",
      className: "text-success",
      accentClassName: "text-success",
      meterClassName: "bg-success",
    }
  }
  if (score >= 70) {
    return {
      label: "稳妥可调",
      className: "text-primary",
      accentClassName: "text-primary",
      meterClassName: "bg-primary",
    }
  }
  if (score >= 60) {
    return {
      label: "谨慎推进",
      className: "text-warning",
      accentClassName: "text-warning",
      meterClassName: "bg-warning",
    }
  }
  return {
    label: "高风险",
    className: "text-destructive",
    accentClassName: "text-destructive",
    meterClassName: "bg-destructive",
  }
}

function getRiskTone(severity?: "safe" | "warning" | "danger"): {
  label: string
  shellClassName: string
  borderClassName: string
  textClassName: string
  railClassName: string
  fillClassName: string
  level: number
} {
  if (severity === "danger") {
    return {
      label: "高风险",
      shellClassName: "border-white/[0.06] bg-white/[0.015]",
      borderClassName: "border-white/[0.08]",
      textClassName: "text-destructive",
      railClassName: "bg-white/[0.08]",
      fillClassName: "bg-destructive",
      level: 88,
    }
  }
  if (severity === "warning") {
    return {
      label: "需保护",
      shellClassName: "border-white/[0.06] bg-white/[0.015]",
      borderClassName: "border-white/[0.08]",
      textClassName: "text-warning",
      railClassName: "bg-white/[0.08]",
      fillClassName: "bg-warning",
      level: 64,
    }
  }
  return {
    label: "可控",
    shellClassName: "border-white/[0.06] bg-white/[0.015]",
    borderClassName: "border-white/[0.08]",
    textClassName: "text-success",
    railClassName: "bg-white/[0.08]",
    fillClassName: "bg-success",
    level: 36,
  }
}

function getV1CoreConclusion(report: DiagnosticReport | null): string {
  if (!report) return "正在建立 V1 初始调色判断。"
  const score = report.score
  const diagnosis = cleanText(report.module1.summary || report.module1.headline)
  const risk = report.module2.riskItems.find((item) => item.severity !== "safe")
  const riskText = risk ? `，但${cleanText(risk.label)}需要优先保护` : ""
  return `${score.title} ${score.total} 分，${diagnosis}${riskText}。`
}

function explainParamChange(change: ChangedParam): string {
  const label = PARAM_LABELS[change.key] ?? change.key
  if (/Temperature/i.test(change.key)) {
    return change.after < change.before
      ? "把整体白平衡往冷调拉，让天空和远景更干净。"
      : "把整体白平衡往暖调拉，让画面更有日照感。"
  }
  if (/Highlights/i.test(change.key)) return "保护亮部层次，避免云层或皮肤高光显得发硬。"
  if (/Shadows/i.test(change.key)) return "调整暗部可见度，让阴影信息更容易读出来。"
  if (/Vibrance|Saturation/i.test(change.key)) return "控制色彩存在感，让颜色更明确但不过度溢出。"
  if (/Contrast|Blacks|Whites/i.test(change.key)) return "重新分配明暗关系，让画面更有层次。"
  if (/Blue|Aqua/i.test(change.key)) return "主要影响天空、水面和远景冷色的存在感。"
  if (/Orange|Red|Yellow/i.test(change.key)) return "主要影响肤色、日照和暖色区域的观感。"
  return `${label} 被重新平衡，用来贴近你这一轮的视觉意图。`
}

function buildVersionHighlights(version: RefineVersion): AssistantHighlight[] {
  return version.changedParams.slice(0, 5).map((change) => ({
    label: PARAM_LABELS[change.key] ?? change.key,
    value: formatDelta(change),
    reason: change.reason || explainParamChange(change),
    paramKey: change.key,
  }))
}

function buildVersionText(version: RefineVersion): string {
  const changeText = version.changedParams.length
    ? `我重点动了 ${version.changedParams.slice(0, 3).map((change) => PARAM_LABELS[change.key] ?? change.key).join("、")}。`
    : "这轮没有明显参数位移，我保留了当前版本的基调。"
  return `${version.id} 已生成。我按你的要求完成了这一轮微调：${version.assistantSummary} ${changeText}`
}

function buildExplainAnswer(
  question: string,
  report: DiagnosticReport | null,
  currentVersion: RefineVersion | null
): { answer: string; highlights: AssistantHighlight[] } {
  const normalized = question.toLowerCase()
  const currentHighlights = currentVersion ? buildVersionHighlights(currentVersion) : buildV1Highlights(report)

  if (/(分|潜力|评分|score|61|风险)/i.test(normalized) && report) {
    return {
      answer: `这个 ${report.score.total} 分不是审美打分，而是“底片可调潜力”。我会看高光有没有余量、暗部是否还能救、色彩信息是否稳定、画质风险高不高。它的意思是：这张图可以继续调，但需要优先保护风险区域，不能一味把对比和饱和度推满。`,
      highlights: report.score.dimensions.slice(0, 4).map((item) => ({
        label: item.label,
        value: String(item.value),
        reason: item.note,
      })),
    }
  }

  if (/(高光|云|亮部|过曝)/.test(question)) {
    return {
      answer: "我压高光主要是为了保住最亮区域的层次。像云层、雪面、皮肤反光这类区域，一旦亮部被推死，导入 Lightroom 后会显得发白、发硬，也更难再找回细节。所以我会先把亮部压稳，再用阴影和色彩去补画面的通透感。",
      highlights: currentHighlights,
    }
  }

  if (/(导入|lightroom|xmp|预设)/i.test(question)) {
    return {
      answer: "导入 Lightroom 后，这个 XMP 会作为一套可继续编辑的参数预设生效。网页里的预览只帮助判断方向，真正的 RAW 渲染、相机 profile 和最终观感还是由 Lightroom 完成。你可以把它理解成：我先给你一版专业起点，你再在 Lightroom 里做最后审美确认。",
      highlights: currentHighlights,
    }
  }

  if (/(为什么|怎么理解|解释|作用|会怎样)/.test(question)) {
    return {
      answer: `这版的核心逻辑是：先保护画面里最容易出问题的区域，再把风格推到你要的方向。${report ? cleanText(report.module3.description) : "我会根据当前参数变化解释调色意图。"} 如果继续微调，我建议一次只改一个方向，比如先定冷暖，再定对比，最后处理颜色强度。`,
      highlights: currentHighlights,
    }
  }

  return {
    answer: "我可以解释当前版本的调色逻辑，也可以继续帮你生成新版本。简单说：解释类问题不会改参数；像“再冷一点”“高光压一点”这种明确调色指令，会生成新的 V2/V3。",
    highlights: currentHighlights,
  }
}

function getCurrentVersion(refineHistory: RefineHistoryState | null): RefineVersion | null {
  if (!refineHistory || refineHistory.currentVersionId === refineHistory.baseVersion.id) return null
  return refineHistory.versions.find((version) => version.id === refineHistory.currentVersionId) ?? null
}

function buildChatItems(
  refineHistory: RefineHistoryState | null,
  explainTurns: LocalExplainTurn[]
): ChatItem[] {
  const items: ChatItem[] = []
  const baseCreatedAt = refineHistory?.baseVersion.createdAt ?? new Date(0).toISOString()

  items.push({ id: "assistant-v1", type: "v1", createdAt: baseCreatedAt })

  for (const version of refineHistory?.versions ?? []) {
    items.push({
      id: `user-${version.id}`,
      type: "user",
      createdAt: version.createdAt,
      text: version.userIntent,
      intent: "refine",
    })
    items.push({
      id: `assistant-${version.id}`,
      type: "version",
      createdAt: version.createdAt,
      version,
    })
  }

  for (const turn of explainTurns) {
    items.push({
      id: `user-${turn.id}`,
      type: "user",
      createdAt: turn.createdAt,
      text: turn.question,
      intent: "explain",
    })
    items.push({
      id: `assistant-${turn.id}`,
      type: "explain",
      createdAt: turn.createdAt,
      answer: turn.answer,
      highlights: turn.highlights,
    })
  }

  return items.sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    if (timeDiff !== 0) return timeDiff
    if (a.type === "user" && b.type !== "user") return -1
    if (a.type !== "user" && b.type === "user") return 1
    return a.id.localeCompare(b.id)
  })
}

interface RightPanelProps {
  params: Record<string, number>
  aiRecommendedParams: Record<string, number> | null
  aiModifiedKeys: Set<string>
  report: DiagnosticReport | null
  refineHistory: RefineHistoryState | null
  onParamChange: (key: string, value: number) => void
  onGenerateXMP: () => void
  onDownloadXMP: () => void
  onRegenerate: () => void
  onRefinement: (text: string) => void
  onUndoRefinement: (versionId?: string) => void
  onRedoRefinement: (versionId?: string) => void
  onSelectVersion: (versionId: string) => void
  onDownloadVersion: (versionId?: string) => void
  isGenerating: boolean
  hasAnalysis: boolean
  xmpReady: boolean
  isAnalyzing: boolean
  assistantRunStatus: AssistantRunStatus
  quickChips: string[]
  currentVersionId: string | null
  latestRefineVersion: RefineVersion | null
  fileType: string | null
  selectedStyle: string
  referenceActive: boolean
  referenceMatchStrength: number
  analysisEngine: AnalysisEngine
}

export function RightPanel({
  params,
  aiRecommendedParams,
  aiModifiedKeys,
  report,
  refineHistory,
  onParamChange,
  onGenerateXMP,
  onDownloadXMP,
  onRegenerate,
  onRefinement,
  onUndoRefinement,
  onRedoRefinement,
  onSelectVersion,
  onDownloadVersion,
  isGenerating,
  hasAnalysis,
  xmpReady,
  isAnalyzing,
  assistantRunStatus,
  quickChips,
  currentVersionId,
  latestRefineVersion,
  fileType,
  selectedStyle,
  referenceActive,
  referenceMatchStrength,
  analysisEngine,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("chat")
  const [composerText, setComposerText] = useState("")
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)
  const [explainTurns, setExplainTurns] = useState<LocalExplainTurn[]>([])

  const currentVersion = getCurrentVersion(refineHistory)
  const chatItems = useMemo(() => buildChatItems(refineHistory, explainTurns), [refineHistory, explainTurns])
  const composerChips = useMemo(
    () => [...new Set([...quickChips, ...FALLBACK_CHIPS])].slice(0, 5),
    [quickChips]
  )

  useEffect(() => {
    if (!hasAnalysis) {
      setExplainTurns([])
      setComposerText("")
    }
  }, [hasAnalysis])

  useEffect(() => {
    if (assistantRunStatus.status === "error" && assistantRunStatus.prompt) {
      setComposerText(assistantRunStatus.prompt)
    }
  }, [assistantRunStatus.status, assistantRunStatus.prompt])

  const handleSubmit = (text: string = composerText) => {
    const trimmed = text.trim()
    if (!trimmed || !hasAnalysis || isAnalyzing) return

    const intent = classifyAssistantInput(trimmed)
    if (intent === "explain") {
      const createdAt = new Date().toISOString()
      const explanation = buildExplainAnswer(trimmed, report, currentVersion)
      setExplainTurns((prev) => [
        ...prev,
        {
          id: createId("explain"),
          question: trimmed,
          answer: explanation.answer,
          highlights: explanation.highlights,
          createdAt,
        },
      ])
      setComposerText("")
      return
    }

    onRefinement(trimmed)
    setComposerText("")
  }

  return (
    <aside className="flex min-h-0 w-[360px] max-w-full shrink-0 flex-col border-l border-border/80 bg-sidebar">
      <div className="shrink-0 border-b border-border bg-sidebar/95 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold text-foreground">调色助手</p>
              <p className="text-[10px] text-muted-foreground/60">
                {hasAnalysis ? "专业调色对话" : "等待首轮分析"}
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-secondary/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
            当前 {currentVersionId ?? "V1"}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <ContextChip label={xmpReady ? "XMP 已生成" : isGenerating ? "XMP 生成中" : "XMP 待生成"} active={xmpReady} />
          <ContextChip label={getFileTypeLabel(fileType)} />
          <ContextChip label={referenceActive ? `参考图追色 ${referenceMatchStrength}%` : `风格 ${STYLE_LABELS[selectedStyle] ?? selectedStyle}`} active={referenceActive} />
          <ContextChip label={getEngineLabel(analysisEngine)} />
        </div>
      </div>

      {hasAnalysis && (
        <div className="grid shrink-0 grid-cols-2 border-b border-border">
          <button
            onClick={() => setActiveTab("chat")}
            className={`flex items-center justify-center gap-1.5 border-b-2 py-2.5 text-[11px] font-semibold transition-all ${
              activeTab === "chat"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquareText className="h-3 w-3" />
            调色助手
          </button>
          <button
            onClick={() => setActiveTab("params")}
            className={`flex items-center justify-center gap-1.5 border-b-2 py-2.5 text-[11px] font-semibold transition-all ${
              activeTab === "params"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            参数面板
          </button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {activeTab === "chat" && (
          <div className="px-3 py-4">
            {isAnalyzing && !report ? (
              <ReportSkeleton />
            ) : hasAnalysis ? (
              <AssistantChatThread
                items={chatItems}
                report={report}
                refineHistory={refineHistory}
                assistantRunStatus={assistantRunStatus}
                currentVersionId={currentVersionId ?? "V1"}
                latestRefineVersion={latestRefineVersion}
                diagnosticOpen={diagnosticOpen}
                onDiagnosticToggle={() => setDiagnosticOpen((open) => !open)}
                onViewParams={(versionId) => {
                  onSelectVersion(versionId)
                  setActiveTab("params")
                }}
                onSelectVersion={onSelectVersion}
                onUndoRefinement={onUndoRefinement}
                onRedoRefinement={onRedoRefinement}
                onDownloadVersion={onDownloadVersion}
                onRetry={handleSubmit}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        )}

        {activeTab === "params" && hasAnalysis && (
          <div className="pt-1">
            {LIGHTROOM_GROUPS.map((group) => {
              const hasAiMods = group.params.some((p) => aiModifiedKeys.has(p.key))
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
                      aiRecommendedValue={aiRecommendedParams?.[param.key]}
                      isAiModified={aiModifiedKeys.has(param.key)}
                      onChange={onParamChange}
                    />
                  ))}
                </ParamGroup>
              )
            })}
          </div>
        )}
      </ScrollArea>

      <AssistantComposer
        value={composerText}
        onChange={setComposerText}
        onSubmit={handleSubmit}
        chips={composerChips}
        disabled={!hasAnalysis || isAnalyzing}
        running={isAnalyzing}
        hasAnalysis={hasAnalysis}
      />

      <div className="shrink-0 border-t border-border bg-sidebar/95 p-3 pt-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          {!xmpReady ? (
            <Button
              onClick={onGenerateXMP}
              disabled={!hasAnalysis || isGenerating}
              className="h-8 rounded-lg bg-primary text-[11px] font-semibold text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-30"
            >
              {isGenerating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
              )}
              生成当前 XMP
            </Button>
          ) : (
            <Button
              onClick={onDownloadXMP}
              className="h-8 rounded-lg bg-success text-[11px] font-bold text-foreground shadow-none hover:bg-success/90"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              下载当前版
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onRegenerate}
            disabled={!hasAnalysis || isGenerating || isAnalyzing}
            className="h-8 rounded-lg px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {xmpReady && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-secondary/35 px-2.5 py-2">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
            <p className="text-[10px] leading-relaxed text-muted-foreground/60">
              预设可导入 Lightroom Classic/CC，移动端等待 Adobe 云同步。
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}

function AssistantChatThread({
  items,
  report,
  refineHistory,
  assistantRunStatus,
  currentVersionId,
  latestRefineVersion,
  diagnosticOpen,
  onDiagnosticToggle,
  onViewParams,
  onSelectVersion,
  onUndoRefinement,
  onRedoRefinement,
  onDownloadVersion,
  onRetry,
}: {
  items: ChatItem[]
  report: DiagnosticReport | null
  refineHistory: RefineHistoryState | null
  assistantRunStatus: AssistantRunStatus
  currentVersionId: string
  latestRefineVersion: RefineVersion | null
  diagnosticOpen: boolean
  onDiagnosticToggle: () => void
  onViewParams: (versionId: string) => void
  onSelectVersion: (versionId: string) => void
  onUndoRefinement: (versionId?: string) => void
  onRedoRefinement: (versionId?: string) => void
  onDownloadVersion: (versionId?: string) => void
  onRetry: (text: string) => void
}) {
  const v1Report = (refineHistory?.baseVersion.report as DiagnosticReport | undefined) ?? report
  const hasPostV1Activity = items.some((item) => item.type !== "v1") || assistantRunStatus.status !== "idle"
  const [v1ManuallyExpanded, setV1ManuallyExpanded] = useState(false)
  const v1AnchorRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const lastItem = items[items.length - 1]
  const previousItemsLengthRef = useRef(items.length)
  const v1Expanded = !hasPostV1Activity || v1ManuallyExpanded
  const canMoveForward = (versionId: string) =>
    Boolean(refineHistory && getForwardVersionId(refineHistory, versionId))
  const canMoveBackward = (versionId: string) =>
    Boolean(refineHistory && getParentVersionId(refineHistory, versionId))

  useEffect(() => {
    if (!hasPostV1Activity) {
      setV1ManuallyExpanded(false)
    }
  }, [hasPostV1Activity])

  useEffect(() => {
    const previousItemsLength = previousItemsLengthRef.current
    previousItemsLengthRef.current = items.length
    const onlyV1Visible = items.length === 1 && items[0]?.type === "v1" && assistantRunStatus.status === "idle"

    if (onlyV1Visible && previousItemsLength <= 1) {
      v1AnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      return
    }

    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [
    items.length,
    lastItem?.id,
    assistantRunStatus.status,
    assistantRunStatus.message,
    assistantRunStatus.targetVersionId,
    currentVersionId,
  ])

  return (
    <div className="space-y-4" data-testid="assistant-chat-thread">
      {items.map((item) => {
        if (item.type === "v1") {
          return (
            <div key={item.id} ref={v1AnchorRef}>
              <V1DiagnosticMessage
                report={v1Report}
                current={currentVersionId === "V1"}
                expanded={v1Expanded}
                autoCollapsed={hasPostV1Activity && !v1ManuallyExpanded}
                collapsible={hasPostV1Activity}
                diagnosticOpen={diagnosticOpen}
                onDiagnosticToggle={onDiagnosticToggle}
                onExpandedChange={setV1ManuallyExpanded}
                onViewParams={() => onViewParams("V1")}
                onSelect={() => onSelectVersion("V1")}
                onDownload={() => onDownloadVersion("V1")}
              />
            </div>
          )
        }
        if (item.type === "user") {
          return <UserMessageBubble key={item.id} text={item.text} />
        }
        if (item.type === "version") {
          const version = item.version
          return (
            <VersionResultMessage
              key={item.id}
              version={version}
              current={currentVersionId === version.id}
              latest={latestRefineVersion?.id === version.id}
              canUndo={canMoveBackward(version.id)}
              canRedo={canMoveForward(version.id)}
              onViewParams={() => onViewParams(version.id)}
              onSelect={() => onSelectVersion(version.id)}
              onUndo={() => onUndoRefinement(version.id)}
              onRedo={() => onRedoRefinement(version.id)}
              onDownload={() => onDownloadVersion(version.id)}
            />
          )
        }
        return (
          <AssistantMessageBubble
            key={item.id}
            label="解释"
            text={item.answer}
            highlights={item.highlights}
          />
        )
      })}

      {assistantRunStatus.status === "running" && (
        <>
          <UserMessageBubble text={assistantRunStatus.prompt} />
          <AssistantRunningMessage status={assistantRunStatus} />
        </>
      )}

      {assistantRunStatus.status === "error" && (
        <>
          <UserMessageBubble text={assistantRunStatus.prompt} />
          <AssistantErrorMessage status={assistantRunStatus} onRetry={() => onRetry(assistantRunStatus.prompt)} />
        </>
      )}
      <div ref={bottomRef} data-testid="assistant-chat-bottom" />
    </div>
  )
}

function V1DiagnosticMessage({
  report,
  current,
  expanded,
  autoCollapsed,
  collapsible,
  diagnosticOpen,
  onDiagnosticToggle,
  onExpandedChange,
  onViewParams,
  onSelect,
  onDownload,
}: {
  report: DiagnosticReport | null
  current: boolean
  expanded: boolean
  autoCollapsed: boolean
  collapsible: boolean
  diagnosticOpen: boolean
  onDiagnosticToggle: () => void
  onExpandedChange: (expanded: boolean) => void
  onViewParams: () => void
  onSelect: () => void
  onDownload: () => void
}) {
  return (
    <div data-testid="v1-diagnostic-sequence">
      <V1UnifiedDiagnosticCard
        report={report}
        current={current}
        expanded={expanded}
        autoCollapsed={autoCollapsed}
        collapsible={collapsible}
        diagnosticOpen={diagnosticOpen}
        onDiagnosticToggle={onDiagnosticToggle}
        onExpandedChange={onExpandedChange}
        onViewParams={onViewParams}
        onSelect={onSelect}
        onDownload={onDownload}
      />
    </div>
  )
}

function V1UnifiedDiagnosticCard({
  report,
  current,
  expanded,
  autoCollapsed,
  collapsible,
  diagnosticOpen,
  onDiagnosticToggle,
  onExpandedChange,
  onViewParams,
  onSelect,
  onDownload,
}: {
  report: DiagnosticReport | null
  current: boolean
  expanded: boolean
  autoCollapsed: boolean
  collapsible: boolean
  diagnosticOpen: boolean
  onDiagnosticToggle: () => void
  onExpandedChange: (expanded: boolean) => void
  onViewParams: () => void
  onSelect: () => void
  onDownload: () => void
}) {
  const score = report?.score
  const tone = getScoreTone(score?.total ?? 0)
  const riskFocus = report?.module2.riskItems.find((item) => item.severity !== "safe") ?? report?.module2.riskItems[0]
  const highlights = buildV1Highlights(report).slice(0, 3)
  const confidence = score?.confidence ?? "诊断可信度待生成"
  const diagnosis = report ? cleanText(report.module1.summary || report.module1.headline) : "等待诊断报告生成。"
  const strategy = report ? cleanText(report.module3.description) : "我会先生成一版稳妥的 Lightroom 基线。"
  const conclusion = getV1CoreConclusion(report)
  const fallbackFocusNote = score?.dimensions[0]
    ? `${score.dimensions[0].label}：${score.dimensions[0].note}`
    : "整体风险可控，可以在这版基础上继续细调。"

  return (
    <div
      data-testid="v1-diagnostic-card"
      data-collapsed={!expanded}
      className="v1-card-enter group relative overflow-hidden rounded-[8px] border border-white/[0.06] bg-[#0b0d12] shadow-[0_14px_36px_rgba(0,0,0,0.24)] transition-[border-color,box-shadow] duration-200 hover:border-white/[0.1] hover:shadow-[0_18px_42px_rgba(0,0,0,0.3)]"
    >
      <div className="relative p-3">
        <V1ScoreHero
          current={current}
          autoCollapsed={autoCollapsed}
          score={score}
          tone={tone}
          confidence={confidence}
        />

        {!expanded ? (
          <V1CollapsedSummary
            conclusion={conclusion}
            score={score}
            tone={tone}
            onExpandedChange={onExpandedChange}
            onViewParams={onViewParams}
          />
        ) : (
          <div className="v1-panel-reveal" data-testid="v1-diagnostic-expanded">
            <V1MainJudgement conclusion={conclusion} diagnosis={diagnosis} strategy={strategy} />
            <V1ActionSummary highlights={highlights} />
            <V1RiskScan risk={riskFocus} fallbackNote={fallbackFocusNote} />
            <V1CardActions
              current={current}
              collapsible={collapsible}
              onSelect={onSelect}
              onViewParams={onViewParams}
              onDownload={onDownload}
              onDiagnosticToggle={onDiagnosticToggle}
              onExpandedChange={onExpandedChange}
            />

            {diagnosticOpen && report && (
              <div className="v1-panel-reveal mt-3 overflow-hidden rounded-[8px] border border-white/[0.06] bg-white/[0.015] p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/[0.05] pb-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold text-foreground/78">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">完整诊断</span>
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground/45">report</span>
                </div>
                <AiDiagnosticReport report={report} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function V1ScoreHero({
  current,
  autoCollapsed,
  score,
  tone,
  confidence,
}: {
  current: boolean
  autoCollapsed: boolean
  score: DiagnosticReport["score"] | undefined
  tone: ReturnType<typeof getScoreTone>
  confidence: string
}) {
  const scoreValue = Math.min(100, Math.max(0, score?.total ?? 0))

  return (
    <div className="v1-soft-reveal border-b border-white/[0.07] pb-3" data-testid="v1-score-hero">
      <div className="rounded-[8px] border border-white/[0.06] bg-white/[0.015] px-3 py-3">
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[10px] font-semibold text-foreground/84">
              V1 诊断
            </span>
            <span className="h-3 w-px shrink-0 bg-white/[0.08]" />
            <span className="truncate font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/45">
              Initial scan
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={`rounded-[6px] border px-1.5 py-0.5 text-[9px] font-medium ${
                current
                  ? "border-primary/25 bg-primary/10 text-primary"
                  : "border-white/[0.08] bg-white/[0.03] text-muted-foreground"
              }`}
            >
              {current ? "当前" : "存档"}
            </span>
            {autoCollapsed && (
              <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                已收起
              </span>
            )}
            <span className="rounded-[6px] border border-success/20 bg-success/10 px-1.5 py-0.5 text-[9px] font-medium text-success">
              可信诊断
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(108px,112px)_minmax(0,1fr)] items-stretch gap-3">
          <div className="relative flex h-full min-h-[188px] flex-col justify-between overflow-hidden rounded-[8px] border border-white/[0.06] bg-white/[0.02] p-2.5">
            <div className={`absolute inset-y-0 left-0 w-px ${tone.meterClassName}`} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/45">Score</p>
                <p className="mt-1 font-mono text-[36px] font-black leading-none text-foreground">
                  {score?.total ?? "--"}
                </p>
              </div>
              <span className="rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-bold text-foreground/82">
                {score?.grade ?? "?"}
              </span>
            </div>
            <div>
              <p className={`truncate text-[10px] font-semibold ${tone.accentClassName}`}>
                {score?.tag ?? tone.label}
              </p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div className={`h-full rounded-full ${tone.meterClassName}`} style={{ width: `${scoreValue}%` }} />
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
              Readout
            </p>
            <h3 className="mt-2 text-[15px] font-semibold leading-tight text-foreground/95">
              V1 初始调色诊断
            </h3>
            <p className="mt-1 text-[11px] font-medium leading-relaxed text-muted-foreground/72">
              底片可调潜力，不是审美评分
            </p>
            <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/58">
              {score?.subtitle ?? "我会先给你一版稳妥、可继续微调的 Lightroom 起点。"} · {confidence}
            </p>
            <div className="mt-3 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold text-muted-foreground/55">风险读数</p>
                  <p className={`mt-1 truncate text-[10px] font-medium ${tone.className}`}>{tone.label}</p>
                </div>
                <span className="font-mono text-[9px] text-muted-foreground/45">
                  {scoreValue}%
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                <div className={`h-full rounded-full ${tone.meterClassName}`} style={{ width: `${scoreValue}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function V1CollapsedSummary({
  conclusion,
  score,
  tone,
  onExpandedChange,
  onViewParams,
}: {
  conclusion: string
  score: DiagnosticReport["score"] | undefined
  tone: ReturnType<typeof getScoreTone>
  onExpandedChange: (expanded: boolean) => void
  onViewParams: () => void
}) {
  const scoreValue = Math.min(100, Math.max(0, score?.total ?? 0))

  return (
    <div className="v1-panel-reveal pt-3" data-testid="v1-diagnostic-collapsed">
      <div className="relative overflow-hidden rounded-[8px] border border-white/[0.06] bg-white/[0.015] p-2.5">
        <div className={`absolute inset-y-0 left-0 w-px ${tone.meterClassName}`} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground/45">EI</p>
            <div className="mt-1 flex items-end gap-1.5">
              <span className="font-mono text-[24px] font-black leading-none text-foreground">{score?.total ?? "--"}</span>
              <span className={`pb-0.5 text-[10px] font-semibold ${tone.className}`}>{score?.grade ?? "?"}</span>
            </div>
          </div>
          <span className="shrink-0 rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium text-foreground/78">
            {score?.tag ?? tone.label}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] font-medium leading-relaxed text-foreground/86">
          {conclusion}
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className={`h-full rounded-full ${tone.meterClassName} transition-[width] duration-700`} style={{ width: `${scoreValue}%` }} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <MiniAction
          label="展开 V1 诊断"
          icon={<ChevronDown className="h-3 w-3" />}
          onClick={() => onExpandedChange(true)}
        />
        <MiniAction label="查看参数" icon={<Eye className="h-3 w-3" />} onClick={onViewParams} />
      </div>
    </div>
  )
}

function V1MainJudgement({
  conclusion,
  diagnosis,
  strategy,
}: {
  conclusion: string
  diagnosis: string
  strategy: string
}) {
  return (
    <div className="v1-panel-reveal mt-3 overflow-hidden rounded-[8px] border border-white/[0.06] bg-white/[0.015]">
      <section className="px-3 py-3">
        <p className="text-[10px] font-semibold text-muted-foreground/55">
          这张图的调色起点
        </p>
        <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-foreground/95">
          {conclusion}
        </p>
      </section>

      <section className="border-t border-white/[0.06] px-3 py-3">
        <p className="text-[10px] font-semibold text-muted-foreground/55">
          画面判读
        </p>
        <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/76">
          {diagnosis}
        </p>
      </section>

      <section className="border-t border-white/[0.06] px-3 py-3">
        <p className="text-[10px] font-semibold text-muted-foreground/55">
          V1 的处理策略
        </p>
        <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-foreground/82">
          {strategy}
        </p>
      </section>
    </div>
  )
}

function V1ActionSummary({ highlights }: { highlights: AssistantHighlight[] }) {
  if (highlights.length === 0) return null
  return (
    <div className="v1-panel-reveal mt-3 overflow-hidden rounded-[8px] border border-white/[0.06] bg-white/[0.015]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.05] px-3 py-2">
        <p className="text-[10px] font-semibold text-muted-foreground/65">关键动作</p>
        <span className="font-mono text-[9px] text-muted-foreground/38">Params</span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {highlights.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="v1-action-tile min-w-0 px-3 py-2.5 transition-[background-color] duration-150 hover:bg-white/[0.03]"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <span className="min-w-0 truncate text-[10px] font-semibold text-foreground/88">{item.label}</span>
              <span className="shrink-0 rounded-[6px] border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                {item.value}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-muted-foreground/66">
              {item.reason}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function V1RiskScan({
  risk,
  fallbackNote,
}: {
  risk: DiagnosticReport["module2"]["riskItems"][number] | undefined
  fallbackNote: string
}) {
  const tone = getRiskTone(risk?.severity)
  const label = risk?.label ?? "整体风险"
  const value = risk?.value ?? "稳定"
  const note = risk?.note ?? fallbackNote

  return (
    <div className={`relative mt-3 overflow-hidden rounded-[8px] border p-2.5 ${tone.shellClassName}`}>
      <div className={`absolute inset-y-0 left-0 w-px ${tone.fillClassName}`} />
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55">我会特别留意</p>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <AlertTriangle className={`h-3 w-3 shrink-0 ${tone.textClassName}`} />
            <span className="min-w-0 truncate text-[11px] font-semibold text-foreground/88">{label}</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-[6px] border px-1.5 py-0.5 text-[9px] font-medium ${tone.borderClassName} ${tone.textClassName} bg-white/[0.03]`}>
          {tone.label}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className={`h-1.5 flex-1 overflow-hidden rounded-full ${tone.railClassName}`}>
          <div
            className={`h-full rounded-full ${tone.fillClassName} transition-[width] duration-700`}
            style={{ width: `${tone.level}%` }}
          />
        </div>
        <span className="font-mono text-[9px] text-muted-foreground/45">{value}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/72">
        {note}
      </p>
    </div>
  )
}

function V1CardActions({
  current,
  collapsible,
  onSelect,
  onViewParams,
  onDownload,
  onDiagnosticToggle,
  onExpandedChange,
}: {
  current: boolean
  collapsible: boolean
  onSelect: () => void
  onViewParams: () => void
  onDownload: () => void
  onDiagnosticToggle: () => void
  onExpandedChange: (expanded: boolean) => void
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.05] pt-3">
      {!current && <MiniAction label="设为当前" onClick={onSelect} />}
      <MiniAction label="查看参数" icon={<Eye className="h-3 w-3" />} onClick={onViewParams} />
      <MiniAction label="下载此版" icon={<Download className="h-3 w-3" />} onClick={onDownload} />
      <MiniAction label="查看完整诊断" icon={<FileText className="h-3 w-3" />} onClick={onDiagnosticToggle} />
      {collapsible && (
        <MiniAction
          label="收起"
          icon={<ChevronDown className="h-3 w-3 rotate-180" />}
          onClick={() => onExpandedChange(false)}
        />
      )}
    </div>
  )
}

function VersionResultMessage({
  version,
  current,
  latest,
  canUndo,
  canRedo,
  onViewParams,
  onSelect,
  onUndo,
  onRedo,
  onDownload,
}: {
  version: RefineVersion
  current: boolean
  latest: boolean
  canUndo: boolean
  canRedo: boolean
  onViewParams: () => void
  onSelect: () => void
  onUndo: () => void
  onRedo: () => void
  onDownload: () => void
}) {
  const highlights = buildVersionHighlights(version)

  return (
    <AssistantMessageShell dataVersionId={version.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <VersionPill versionId={version.id} current={current} />
            {latest && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                最新
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/45">{formatTime(version.createdAt)}</span>
          </div>
          <p className="mt-3 text-[12px] font-medium leading-relaxed text-foreground">
            {buildVersionText(version)}
          </p>
          {version.reportSummary && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80">
              {version.reportSummary}
            </p>
          )}
        </div>
      </div>

      <HighlightList highlights={highlights} />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {!current && <MiniAction label="设为当前" onClick={onSelect} />}
        <MiniAction label="查看参数" icon={<Eye className="h-3 w-3" />} onClick={onViewParams} />
        <MiniAction label="下载此版" icon={<Download className="h-3 w-3" />} onClick={onDownload} />
        <MiniAction label="上一版" icon={<Undo2 className="h-3 w-3" />} onClick={onUndo} disabled={!canUndo} />
        <MiniAction label="下一版" icon={<Redo2 className="h-3 w-3" />} onClick={onRedo} disabled={!canRedo} />
      </div>
    </AssistantMessageShell>
  )
}

function AssistantMessageBubble({
  label,
  text,
  highlights,
}: {
  label: string
  text: string
  highlights: AssistantHighlight[]
}) {
  return (
    <AssistantMessageShell>
      <div className="flex items-center gap-1.5">
        <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/20">
          {label}
        </span>
      </div>
      <p className="mt-3 text-[12px] font-medium leading-relaxed text-foreground">{text}</p>
      <HighlightList highlights={highlights.slice(0, 4)} />
    </AssistantMessageShell>
  )
}

function AssistantRunningMessage({ status }: { status: AssistantRunStatus }) {
  const progress = Math.max(0, Math.min(100, Math.round(status.progress)))
  return (
    <AssistantMessageShell>
      <div data-testid="assistant-run-status">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <VersionPill versionId={status.targetVersionId ?? "下一版"} current={false} />
            <p className="mt-3 text-[12px] font-semibold text-primary">
              正在生成 {status.targetVersionId ?? "下一版"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
              我在基于当前版本重新平衡白平衡、色彩和明暗关系。
            </p>
          </div>
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-medium text-primary/80">{status.message}</span>
            <span className="shrink-0 text-[10px] font-semibold text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </AssistantMessageShell>
  )
}

function AssistantErrorMessage({
  status,
  onRetry,
}: {
  status: AssistantRunStatus
  onRetry: () => void
}) {
  return (
    <AssistantMessageShell tone="error">
      <div data-testid="assistant-run-status" className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-destructive">微调失败，当前版本未被覆盖</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/80">
            {status.lastError ?? status.message}
          </p>
          <Button
            type="button"
            variant="ghost"
            onClick={onRetry}
            className="mt-3 h-7 rounded-md px-2 text-[10px] font-medium text-destructive hover:text-destructive"
          >
            重试这次微调
          </Button>
        </div>
      </div>
    </AssistantMessageShell>
  )
}

function UserMessageBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[86%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground shadow-[0_8px_20px_rgba(108,142,255,0.16)]">
        <div className="mb-1 flex items-center justify-end gap-1.5 text-[10px] text-primary-foreground/65">
          <span>你</span>
          <UserRound className="h-3 w-3" />
        </div>
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

function AssistantMessageShell({
  children,
  tone = "normal",
  dataVersionId,
}: {
  children: React.ReactNode
  tone?: "normal" | "error"
  dataVersionId?: string
}) {
  return (
    <div className="flex items-start gap-2" data-testid="assistant-message" data-version-id={dataVersionId}>
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${
        tone === "error"
          ? "bg-destructive/10 text-destructive ring-destructive/25"
          : "bg-primary/12 text-primary ring-primary/20"
      }`}>
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className={`min-w-0 flex-1 rounded-2xl rounded-tl-md px-3 py-3 ${
        tone === "error"
          ? "border border-destructive/25 bg-destructive/10"
          : "border border-border/70 bg-secondary/30"
      }`}>
        {children}
      </div>
    </div>
  )
}

function HighlightList({ highlights }: { highlights: AssistantHighlight[] }) {
  if (highlights.length === 0) return null
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground/65">关键动作</p>
      {highlights.map((item, index) => (
        <div key={`${item.label}-${index}`} className="rounded-lg bg-background/35 px-2.5 py-2 ring-1 ring-border/50">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[10px] font-semibold text-foreground/85">{item.label}</span>
            <span className="max-w-[45%] shrink-0 truncate text-right text-[10px] font-semibold text-primary">
              {item.value}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/70">{item.reason}</p>
        </div>
      ))}
    </div>
  )
}

function VersionPill({ versionId, current }: { versionId: string; current: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
      current
        ? "bg-primary/15 text-primary ring-primary/25"
        : "bg-secondary/80 text-foreground ring-border"
    }`}>
      {versionId}{current ? " 当前" : ""}
    </span>
  )
}

function MiniAction({
  label,
  icon,
  disabled = false,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className="h-7 min-w-0 rounded-[8px] border border-white/[0.06] bg-white/[0.02] px-2 text-[10px] font-medium text-muted-foreground shadow-none transition-colors hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-foreground disabled:opacity-35"
    >
      {icon && <span className="mr-1 shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
    </Button>
  )
}

function AssistantComposer({
  value,
  onChange,
  onSubmit,
  chips,
  disabled,
  running,
  hasAnalysis,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (text?: string) => void
  chips: string[]
  disabled: boolean
  running: boolean
  hasAnalysis: boolean
}) {
  return (
    <div className="shrink-0 border-t border-border bg-sidebar/95 p-3 pb-2">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={disabled}
            onClick={() => onSubmit(chip)}
            className="rounded-full bg-secondary/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground ring-1 ring-border transition-all hover:bg-primary/10 hover:text-primary hover:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-secondary/45 p-2 ring-1 ring-border focus-within:ring-primary/35">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder={hasAnalysis ? "问我这版为什么这样调，或告诉我下一步想怎么改..." : "生成 V1 后，我可以继续帮你解释和微调。"}
          disabled={disabled}
          rows={2}
          className="max-h-28 min-h-[52px] w-full resize-none bg-transparent px-1 text-[11px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/35 disabled:cursor-not-allowed disabled:opacity-45"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/40">Enter 发送 · Shift+Enter 换行</span>
          <Button
            size="sm"
            type="button"
            onClick={() => onSubmit()}
            disabled={disabled || !value.trim()}
            className="h-7 w-7 rounded-lg bg-primary/15 p-0 text-primary shadow-none hover:bg-primary/25 disabled:opacity-30"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ContextChip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
      active
        ? "bg-primary/12 text-primary ring-primary/20"
        : "bg-secondary/70 text-muted-foreground ring-border"
    }`}>
      {label}
    </span>
  )
}

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
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary ring-1 ring-border">
        <Sparkles className="h-6 w-6 text-muted-foreground/25" />
      </div>
      <p className="mt-4 text-[13px] font-medium text-muted-foreground/50">
        调色助手将在 V1 生成后启用
      </p>
      <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-muted-foreground/35">
        先在左侧上传照片并生成初始调色方案。
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
      <div className="space-y-2">
        <Skeleton className="h-24 w-full rounded-lg bg-secondary" />
        <Skeleton className="h-24 w-full rounded-lg bg-secondary" />
      </div>
      <Skeleton className="h-9 w-full rounded-lg bg-secondary" />
    </div>
  )
}
