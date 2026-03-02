"use client"

import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
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
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0 p-0">
          {/* Upload Section */}
          <div className="p-4">
            <h3 className="mb-3 text-[13px] font-medium text-foreground">
              上传照片
            </h3>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-[#C7C7CC] bg-secondary/50 px-4 py-6 transition-colors hover:border-primary/40 hover:bg-accent"
            >
              {uploadedFileName ? (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                    <ImageIcon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="max-w-full truncate text-[12px] font-medium text-foreground">
                    {uploadedFileName}
                  </span>
                  {uploadedFileType && (
                    <span className="rounded-[4px] bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                      {uploadedFileType}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    点击重新选择
                  </span>
                </>
              ) : (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary/10">
                    <Upload className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>
                  <span className="text-[12px] text-muted-foreground">
                    拖拽或点击上传
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">
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
            <p className="mt-2 text-[11px] text-muted-foreground/60">
              单文件最大 50MB
            </p>
          </div>

          <Separator />

          {/* Platform Selection */}
          <div className="p-4">
            <h3 className="mb-3 text-[13px] font-medium text-foreground">
              调色平台
            </h3>
            <div className="flex rounded-lg bg-secondary p-0.5">
              <button
                onClick={() => onPlatformChange("lightroom")}
                className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium transition-all ${
                  selectedPlatform === "lightroom"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Lightroom
              </button>
              <button
                disabled
                className="flex-1 rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground/40 cursor-not-allowed"
              >
                像素蛋糕
                <span className="ml-1 text-[10px]">soon</span>
              </button>
            </div>
          </div>

          <Separator />

          {/* AI Intent */}
          <div className="p-4">
            <h3 className="mb-3 text-[13px] font-medium text-foreground">
              AI 意图
            </h3>
            <Textarea
              placeholder="描述想要的氛围或色彩倾向...&#10;例如：日系清新、电影感、赛博朋克"
              value={userIntent}
              onChange={(e) => onUserIntentChange(e.target.value)}
              className="min-h-[80px] resize-none rounded-lg border-0 bg-secondary text-[12px] text-foreground placeholder:text-muted-foreground/50 focus-visible:ring-1 focus-visible:ring-primary/30"
            />
            <Button
              onClick={onAnalyze}
              disabled={!uploadedFileName || isAnalyzing}
              className="mt-3 h-8 w-full rounded-lg bg-primary text-[12px] font-medium text-primary-foreground shadow-none hover:bg-primary/90 disabled:opacity-40"
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
