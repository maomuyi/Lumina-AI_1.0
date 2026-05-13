"use client"

import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  EMPTY_REFERENCE_IMAGE,
  REFERENCE_MATCH_DEFAULT_STRENGTH,
  type ReferenceImageState,
} from "@/lib/reference-color-match"
import { Upload, ImageIcon, Sparkles, Loader2, ImagePlus, ShieldCheck, SlidersHorizontal, X } from "lucide-react"

const STYLE_PRESETS = [
  { key: "auto", label: "AI 智能匹配" },
  { key: "japanese", label: "日系清新" },
  { key: "film", label: "胶片质感" },
  { key: "cyberpunk", label: "赛博朋克" },
  { key: "grey", label: "高级灰" },
  { key: "cinematic", label: "电影感" },
]

function formatDisplayFileName(fileName: string | null, maxBaseLength = 18): string {
  if (!fileName) return ""

  const dotIndex = fileName.lastIndexOf(".")
  const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1
  const extension = hasExtension ? fileName.slice(dotIndex) : ""
  const baseName = hasExtension ? fileName.slice(0, dotIndex) : fileName

  if (baseName.length <= maxBaseLength) return fileName

  const headLength = Math.max(8, Math.ceil(maxBaseLength * 0.6))
  const tailLength = Math.max(4, maxBaseLength - headLength)
  return `${baseName.slice(0, headLength)}...${baseName.slice(-tailLength)}${extension}`
}

interface LeftSidebarProps {
  onFileUpload: (file: File) => void
  selectedPlatform: string
  onPlatformChange: (platform: string) => void
  userIntent: string
  onUserIntentChange: (intent: string) => void
  selectedStyle: string
  onStyleChange: (style: string) => void
  referenceImage: ReferenceImageState
  referenceMatchStrength: number
  hasAnalysis?: boolean
  onReferenceFileUpload: (file: File) => void
  onReferenceRemove: () => void
  onReferenceMatchStrengthChange: (strength: number) => void
  referenceDisabledReason?: string | null
  onAnalyze: () => void
  canAnalyze: boolean
  analyzeDisabledReason?: string | null
  isAnalyzing: boolean
  analysisStage: { stage: number; message: string } | null
  analysisProgress: number
  analysisEvents: string[]
  uploadedFileName: string | null
  uploadedFileType: string | null
}

export function LeftSidebar({
  onFileUpload,
  selectedPlatform,
  onPlatformChange,
  userIntent,
  onUserIntentChange,
  selectedStyle,
  onStyleChange,
  referenceImage = EMPTY_REFERENCE_IMAGE,
  referenceMatchStrength = REFERENCE_MATCH_DEFAULT_STRENGTH,
  hasAnalysis = false,
  onReferenceFileUpload = () => undefined,
  onReferenceRemove = () => undefined,
  onReferenceMatchStrengthChange = () => undefined,
  referenceDisabledReason = null,
  onAnalyze,
  canAnalyze,
  analyzeDisabledReason,
  isAnalyzing,
  analysisStage,
  analysisProgress,
  analysisEvents,
  uploadedFileName,
  uploadedFileType,
}: LeftSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const hasUploadedFile = Boolean(uploadedFileName)
  const referenceHasFile = referenceImage.status !== "idle"
  const referenceIsReady = referenceImage.status === "ready"
  const displayUploadedFileName = formatDisplayFileName(uploadedFileName, 14)
  const displayReferenceFileName = formatDisplayFileName(referenceImage.fileName, 16)
  const analyzeButtonLabel = !hasUploadedFile
    ? "上传照片后生成"
    : isAnalyzing
      ? "正在生成 V1..."
      : hasAnalysis
        ? "重新生成 V1"
        : "生成初始调色方案"

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) onFileUpload(file)
    },
    [onFileUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFileUpload(file)
    },
    [onFileUpload]
  )

  const handleReferenceFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onReferenceFileUpload(file)
      e.target.value = ""
    },
    [onReferenceFileUpload]
  )

  const handleReferenceDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const file = e.dataTransfer.files[0]
      if (file) onReferenceFileUpload(file)
    },
    [onReferenceFileUpload]
  )

  return (
    <aside className="flex min-h-0 w-[260px] shrink-0 flex-col overflow-hidden border-r border-border/80 bg-sidebar">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col pb-4">
          {/* Upload Section */}
          <div className="p-4 pb-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                上传照片
              </span>
            </div>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className={`group flex cursor-pointer rounded-xl border border-dashed border-border bg-secondary/40 transition-all hover:border-primary/30 hover:bg-glow-primary ${
                hasUploadedFile
                  ? "items-center gap-3 px-3 py-3"
                  : "flex-col items-center justify-center gap-2.5 px-4 py-7"
              }`}
            >
              {hasUploadedFile ? (
                <>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                    <ImageIcon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      title={uploadedFileName ?? undefined}
                      className="truncate text-[12px] font-medium text-foreground"
                    >
                      {displayUploadedFileName}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      {uploadedFileType && (
                        <span className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
                          {uploadedFileType}
                        </span>
                      )}
                      <span className="truncate text-[11px] text-muted-foreground">
                        点击重新选择
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary ring-1 ring-border transition-all group-hover:bg-primary/10 group-hover:ring-primary/20">
                    <Upload className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-[12px] font-medium text-muted-foreground">
                    拖拽或点击上传
                  </span>
                  <span className="text-[11px] text-muted-foreground/40">
                    支持 JPG / NEF 格式
                  </span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.nef"
              onChange={handleFileSelect}
              className="hidden"
            />
            <p className="mt-2.5 text-center text-[10px] text-muted-foreground/40">
              单文件最大 50MB
            </p>
          </div>

          <div className="mx-4 h-px bg-border" />

          {/* Platform Selection */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                调色平台
              </span>
            </div>
            <div className="flex rounded-lg bg-secondary/60 p-[3px] ring-1 ring-border">
              <button
                onClick={() => onPlatformChange("lightroom")}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${
                  selectedPlatform === "lightroom"
                    ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Lightroom
              </button>
              <button
                disabled
                className="flex-1 cursor-not-allowed rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground/30"
              >
                {"像素蛋糕 "}
                <span className="ml-1 rounded-sm bg-primary/10 px-1 text-[9px] text-primary/50">
                  SOON
                </span>
              </button>
            </div>
          </div>

          <div className="mx-4 h-px bg-border" />

          {/* Reference Image */}
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                参考风格
              </span>
              <span className="text-[10px] text-muted-foreground/45">可选</span>
            </div>

            <div
              onDrop={handleReferenceDrop}
              onDragOver={handleDragOver}
              onClick={() => referenceInputRef.current?.click()}
              className={`group flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border border-dashed px-3 py-3 transition-all ${
                referenceImage.status === "error"
                  ? "border-destructive/35 bg-destructive/5"
                  : referenceIsReady
                    ? "border-primary/25 bg-primary/10"
                    : "border-border bg-secondary/35 hover:border-primary/30 hover:bg-glow-primary"
              }`}
            >
              {referenceIsReady ? (
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                  {referenceImage.previewUrl ? (
                    <img
                      src={referenceImage.previewUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-border"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                      <ImageIcon className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p
                      title={referenceImage.fileName ?? undefined}
                      className="truncate text-[12px] font-medium text-foreground"
                    >
                      {displayReferenceFileName}
                    </p>
                    <p className="text-[10px] text-primary/70">
                      本地追色已就绪
                    </p>
                  </div>
                </div>
              ) : referenceImage.status === "parsing" ? (
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p
                      title={referenceImage.fileName ?? undefined}
                      className="truncate text-[12px] font-medium text-foreground"
                    >
                      {displayReferenceFileName}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      正在本地解析参考图
                    </p>
                  </div>
                </div>
              ) : referenceImage.status === "error" ? (
                <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 ring-1 ring-destructive/20">
                    <ImageIcon className="h-4 w-4 text-destructive" />
                  </div>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <p
                      title={referenceImage.fileName ?? undefined}
                      className="truncate text-[12px] font-medium text-foreground"
                    >
                      {referenceImage.fileName
                        ? displayReferenceFileName
                        : "参考图解析失败"}
                    </p>
                    <p className="line-clamp-2 text-[10px] text-destructive/80">
                      {referenceImage.error ?? "请移除后重新上传"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary ring-1 ring-border transition-all group-hover:bg-primary/10 group-hover:ring-primary/20">
                    <ImagePlus className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground">
                      上传参考图
                    </p>
                    <p className="text-[10px] text-muted-foreground/40">
                      JPG / PNG / NEF
                    </p>
                  </div>
                </div>
              )}
            </div>

            <input
              ref={referenceInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.nef"
              onChange={handleReferenceFileSelect}
              className="hidden"
            />

            {referenceHasFile && (
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onReferenceRemove}
                  disabled={isAnalyzing}
                  className="h-7 flex-1 rounded-md text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <X className="mr-1 h-3 w-3" />
                  移除参考图
                </Button>
              </div>
            )}

            <div className="mt-3 rounded-lg bg-secondary/35 px-3 py-2 ring-1 ring-border/70">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3 w-3 text-muted-foreground/70" />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    匹配强度
                  </span>
                </div>
                <span className="text-[10px] font-semibold text-foreground">
                  {referenceMatchStrength}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={referenceMatchStrength}
                disabled={!referenceIsReady || isAnalyzing}
                onChange={(e) => onReferenceMatchStrengthChange(Number(e.target.value))}
                className="h-1.5 w-full accent-primary disabled:opacity-35"
              />
            </div>

            <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground/50">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-primary/45" />
              <span>参考图仅用于本地色彩特征提取，不上传服务器。</span>
            </div>

            {referenceDisabledReason && (
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/65">
                {referenceDisabledReason}
              </p>
            )}
          </div>

          <div className="mx-4 h-px bg-border" />

          {/* Style Presets */}
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                风格预设
              </span>
              {referenceHasFile && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary/70 ring-1 ring-primary/15">
                  由参考图接管
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => onStyleChange(preset.key)}
                  disabled={referenceHasFile || isAnalyzing}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
                    selectedStyle === preset.key && !referenceHasFile
                      ? "bg-primary/15 text-primary ring-1 ring-primary/25"
                      : "bg-secondary/60 text-muted-foreground ring-1 ring-border hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mx-4 h-px bg-border" />

          {/* AI Intent */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                AI 意图
              </span>
              <Sparkles className="h-3 w-3 text-primary/40" />
            </div>
            <Textarea
              placeholder={"描述想要的氛围或色彩倾向...\n例如：把天空调蓝一点，人脸亮一点"}
              value={userIntent}
              onChange={(e) => onUserIntentChange(e.target.value)}
              className="min-h-[72px] resize-none rounded-lg border-border bg-secondary/40 text-[12px] text-foreground placeholder:text-muted-foreground/30 focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/20"
            />

            {/* Analyze button with staged loading */}
            <Button
              onClick={onAnalyze}
              disabled={!canAnalyze || isAnalyzing}
              className="mt-3 h-10 w-full rounded-lg bg-primary text-[12px] font-semibold text-primary-foreground shadow-[0_0_20px_rgba(108,142,255,0.2)] transition-all hover:bg-primary/90 hover:shadow-[0_0_30px_rgba(108,142,255,0.3)] disabled:opacity-30 disabled:shadow-none"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {analyzeButtonLabel}
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {analyzeButtonLabel}
                </>
              )}
            </Button>

            {!canAnalyze && analyzeDisabledReason && (
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground/55">
                {analyzeDisabledReason}
              </p>
            )}

            {/* Staged loading indicator */}
            {isAnalyzing && analysisStage && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-glow-primary p-3">
                <div className="mt-0.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
                <div className="flex-1">
                  <p className="text-[10px] font-medium text-primary/70">
                    进度 {Math.max(0, Math.min(100, Math.round(analysisProgress)))}%
                  </p>
                  <p className="text-[11px] leading-relaxed text-primary/90">
                    {analysisStage.message}
                  </p>
                  {analysisEvents.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {analysisEvents.slice(-3).map((event, idx) => (
                        <p key={`${event}-${idx}`} className="text-[10px] text-primary/65">
                          • {event}
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                          i <= analysisStage.stage
                            ? "bg-primary/60"
                            : "bg-border"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
