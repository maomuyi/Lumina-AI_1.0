"use client"

import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, ImageIcon, Sparkles, Loader2 } from "lucide-react"

const STYLE_PRESETS = [
  { key: "auto", label: "AI 智能匹配" },
  { key: "japanese", label: "日系清新" },
  { key: "film", label: "胶片质感" },
  { key: "cyberpunk", label: "赛博朋克" },
  { key: "grey", label: "高级灰" },
  { key: "cinematic", label: "电影感" },
]

interface LeftSidebarProps {
  onFileUpload: (file: File) => void
  selectedPlatform: string
  onPlatformChange: (platform: string) => void
  userIntent: string
  onUserIntentChange: (intent: string) => void
  selectedStyle: string
  onStyleChange: (style: string) => void
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

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border/80 bg-sidebar">
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
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
              className="group flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-7 transition-all hover:border-primary/30 hover:bg-glow-primary"
            >
              {uploadedFileName ? (
                <>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                    <ImageIcon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="max-w-full truncate text-[12px] font-medium text-foreground">
                    {uploadedFileName}
                  </span>
                  {uploadedFileType && (
                    <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
                      {uploadedFileType}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    点击重新选择
                  </span>
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

          {/* Style Presets */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                风格预设
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => onStyleChange(preset.key)}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                    selectedStyle === preset.key
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
                  分析中...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  开始生成调色方案
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
