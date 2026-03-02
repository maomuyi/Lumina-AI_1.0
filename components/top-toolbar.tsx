"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import Image from "next/image"
import { Download, Sparkles } from "lucide-react"

interface TopToolbarProps {
  fileName: string | null
  colorSpace: string | null
  isAnalyzing: boolean
  analysisProgress: number
  isSaved: boolean
}

export function TopToolbar({
  fileName,
  colorSpace,
  isAnalyzing,
  analysisProgress,
  isSaved,
}: TopToolbarProps) {
  return (
    <header className="relative flex h-12 shrink-0 items-center border-b border-border bg-card/80 backdrop-blur-xl">
      {/* Progress bar at top - glowing accent */}
      {isAnalyzing && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <Progress
            value={analysisProgress}
            className="h-[2px] rounded-none bg-transparent [&>[data-slot=progress-indicator]]:bg-primary [&>[data-slot=progress-indicator]]:shadow-[0_0_12px_rgba(108,142,255,0.5)]"
          />
        </div>
      )}

      {/* Left: Logo */}
      <div className="flex items-center gap-2.5 px-5">
        <Image
          src="/images/lumina-logo.jpg"
          alt="Lumina AI"
          width={20}
          height={20}
          className="rounded-md"
        />
        <span className="text-[13px] font-semibold tracking-tight text-foreground">
          Lumina
        </span>
        <Badge className="rounded-[4px] border-0 bg-primary/15 px-1.5 py-0 text-[10px] font-medium text-primary">
          AI
        </Badge>
      </div>

      {/* Center: File name + status */}
      <div className="flex flex-1 items-center justify-center gap-2.5">
        {fileName ? (
          <>
            <span className="max-w-[300px] truncate text-[12px] font-medium text-muted-foreground">
              {fileName}
            </span>
            {isAnalyzing && (
              <span className="flex items-center gap-1 text-[11px] text-primary">
                <Sparkles className="h-3 w-3 glow-pulse" />
                <span>AI 分析中</span>
              </span>
            )}
            {isSaved && !isAnalyzing && (
              <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                已保存
              </span>
            )}
          </>
        ) : (
          <span className="text-[12px] text-muted-foreground/50">
            Lumina AI - 智能调色工具
          </span>
        )}
      </div>

      {/* Right: Color space + Export */}
      <div className="flex items-center gap-2.5 px-5">
        {colorSpace && (
          <Badge
            variant="secondary"
            className="rounded-md border-0 bg-secondary px-2 py-0.5 text-[10px] font-mono font-normal text-muted-foreground"
          >
            {colorSpace}
          </Badge>
        )}
        <Button
          size="sm"
          className="h-7 rounded-lg bg-primary/15 px-3 text-[12px] font-medium text-primary shadow-none transition-all hover:bg-primary/25 hover:shadow-[0_0_12px_rgba(108,142,255,0.15)]"
        >
          <Download className="mr-1.5 h-3 w-3" />
          导出
        </Button>
      </div>
    </header>
  )
}
