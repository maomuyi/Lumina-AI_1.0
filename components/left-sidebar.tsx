"use client"

import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Upload, ImageIcon, Sparkles, Loader2 } from "lucide-react"

interface LeftSidebarProps {
  onFileUpload: (file: File) => void
  selectedPlatform: string
  onPlatformChange: (platform: string) => void
  userIntent: string
  onUserIntentChange: (intent: string) => void
  onAnalyze: () => void
  isAnalyzing: boolean
  uploadedFileName: string | null
  uploadedFileType: string | null
}

export function LeftSidebar({
  onFileUpload,
  selectedPlatform,
  onPlatformChange,
  userIntent,
  onUserIntentChange,
  onAnalyze,
  isAnalyzing,
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

          {/* Divider */}
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
                像素蛋糕
                <span className="ml-1 rounded-sm bg-primary/10 px-1 text-[9px] text-primary/50">
                  SOON
                </span>
              </button>
            </div>
          </div>

          {/* Divider */}
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
              placeholder={"描述想要的氛围或色彩倾向...\n例如：日系清新、电影感、赛博朋克"}
              value={userIntent}
              onChange={(e) => onUserIntentChange(e.target.value)}
              className="min-h-[80px] resize-none rounded-lg border-border bg-secondary/40 text-[12px] text-foreground placeholder:text-muted-foreground/30 focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/20"
            />
            <Button
              onClick={onAnalyze}
              disabled={!uploadedFileName || isAnalyzing}
              className="mt-3 h-9 w-full rounded-lg bg-primary text-[12px] font-semibold text-primary-foreground shadow-[0_0_20px_rgba(108,142,255,0.2)] transition-all hover:bg-primary/90 hover:shadow-[0_0_30px_rgba(108,142,255,0.3)] disabled:opacity-30 disabled:shadow-none"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  分析中...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  智能分析
                </>
              )}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
