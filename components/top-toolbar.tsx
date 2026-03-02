"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Download, Aperture } from "lucide-react"

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
    <header className="relative flex h-12 shrink-0 items-center border-b border-border bg-card">
      {/* Progress bar at top */}
      {isAnalyzing && (
        <div className="absolute top-0 left-0 right-0 z-10">
          <Progress
            value={analysisProgress}
            className="h-[2px] rounded-none bg-border [&>[data-slot=progress-indicator]]:bg-primary"
          />
        </div>
      )}

      {/* Left: Logo */}
      <div className="flex items-center gap-2 px-4">
        <Aperture className="h-[18px] w-[18px] text-primary" />
        <span className="text-[13px] font-semibold tracking-tight text-foreground">
          ChromaLens
        </span>
      </div>

      {/* Center: File name */}
      <div className="flex flex-1 items-center justify-center gap-2">
        {fileName ? (
          <>
            <span className="text-[12px] text-muted-foreground">
              {fileName}
            </span>
            {isSaved && (
              <span className="text-[11px] text-muted-foreground/60">
                {"-- "}已保存
              </span>
            )}
          </>
        ) : (
          <span className="text-[12px] text-muted-foreground">
            未选择文件
          </span>
        )}
      </div>

      {/* Right: Color space + Export */}
      <div className="flex items-center gap-2 px-4">
        {colorSpace && (
          <Badge
            variant="secondary"
            className="rounded-md border-border bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
          >
            {colorSpace}
          </Badge>
        )}
        <Button
          size="sm"
          className="h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Download className="mr-1 h-3 w-3" />
          导出
        </Button>
      </div>
    </header>
  )
}
