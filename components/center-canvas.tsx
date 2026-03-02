"use client"

import { useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Histogram } from "@/components/histogram"
import {
  Maximize2,
  ZoomIn,
  Camera,
  Sun,
  Aperture,
  Timer,
  Palette,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react"

export interface ImageDiagnostics {
  camera: string
  iso: string
  shutter: string
  aperture: string
  colorSpace: string
  bitDepth: string
  deadBlackPercent: number
  deadWhitePercent: number
  highlightHeadroom: number
  shadowHeadroom: number
  sceneType: string
  lightCondition: string
  mainTone: string
  histogram: { r: number[]; g: number[]; b: number[] } | null
}

interface CenterCanvasProps {
  imageUrl: string | null
  fileType: string | null
  isAnalyzing: boolean
  diagnostics: ImageDiagnostics | null
}

export function CenterCanvas({
  imageUrl,
  fileType,
  isAnalyzing,
  diagnostics,
}: CenterCanvasProps) {
  const [zoom, setZoom] = useState<"fit" | "100">("fit")
  const [diagOpen, setDiagOpen] = useState(true)

  const toggleZoom = useCallback(() => {
    setZoom((z) => (z === "fit" ? "100" : "fit"))
  }, [])

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas-bg">
      {/* Image preview area */}
      <div className="relative flex flex-1 items-center justify-center overflow-auto p-6">
        {imageUrl ? (
          <div className="relative">
            {/* Format badge */}
            <div className="absolute left-3 top-3 z-10">
              <Badge
                className="rounded-md border-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-card-foreground backdrop-blur-md"
                style={{ backgroundColor: "rgba(255,255,255,0.72)" }}
              >
                {fileType === "nef" ? "RAW" : "JPG"}
              </Badge>
              {fileType === "nef" && (
                <Badge
                  className="ml-1.5 rounded-md border-0 px-1.5 py-0.5 text-[10px] font-medium text-card-foreground backdrop-blur-md"
                  style={{ backgroundColor: "rgba(255,255,255,0.72)" }}
                >
                  16-bit
                </Badge>
              )}
            </div>

            {/* Image */}
            <img
              src={imageUrl}
              alt="上传的照片"
              className={`rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] ${
                zoom === "fit"
                  ? "max-h-[calc(100vh-260px)] max-w-full object-contain"
                  : "max-w-none"
              }`}
              style={{ border: "1px solid #D1D1D6" }}
            />

            {/* Zoom controls */}
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-card px-1.5 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleZoom}
                className={`h-6 rounded-md px-2 text-[11px] font-medium ${
                  zoom === "fit"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <Maximize2 className="mr-1 h-3 w-3" />
                Fit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleZoom}
                className={`h-6 rounded-md px-2 text-[11px] font-medium ${
                  zoom === "100"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <ZoomIn className="mr-1 h-3 w-3" />
                100%
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card shadow-sm">
              <Camera className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="text-[13px] text-muted-foreground">
              上传照片以开始调色
            </p>
          </div>
        )}
      </div>

      {/* Diagnostics panel (collapsible) */}
      {(diagnostics || isAnalyzing) && (
        <div className="mx-4 mb-4 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <button
            onClick={() => setDiagOpen(!diagOpen)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-foreground hover:bg-secondary/50"
          >
            {diagOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            图像诊断
          </button>

          {diagOpen && (
            <ScrollArea className="max-h-[280px]">
              <div className="px-4 pb-4">
                {isAnalyzing && !diagnostics ? (
                  <DiagnosticsSkeleton />
                ) : diagnostics ? (
                  <div className="grid grid-cols-2 gap-4">
                    {/* Basic Info */}
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        基础信息
                      </h4>
                      <div className="space-y-1.5">
                        <InfoRow
                          icon={<Camera className="h-3 w-3" />}
                          label="相机"
                          value={diagnostics.camera}
                        />
                        <InfoRow
                          icon={<Sun className="h-3 w-3" />}
                          label="ISO"
                          value={diagnostics.iso}
                        />
                        <InfoRow
                          icon={<Timer className="h-3 w-3" />}
                          label="快门"
                          value={diagnostics.shutter}
                        />
                        <InfoRow
                          icon={<Aperture className="h-3 w-3" />}
                          label="光圈"
                          value={diagnostics.aperture}
                        />
                        <InfoRow
                          icon={<Palette className="h-3 w-3" />}
                          label="色彩空间"
                          value={diagnostics.colorSpace}
                        />
                      </div>
                    </div>

                    {/* Histogram */}
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        直方图
                      </h4>
                      <Histogram data={diagnostics.histogram} />
                      <div className="flex gap-3">
                        {diagnostics.deadBlackPercent > 3 && (
                          <span className="flex items-center gap-1 text-[11px] text-[#007AFF]">
                            <AlertTriangle className="h-3 w-3" />
                            死黑 {diagnostics.deadBlackPercent.toFixed(1)}%
                          </span>
                        )}
                        {diagnostics.deadWhitePercent > 5 && (
                          <span className="flex items-center gap-1 text-[11px] text-destructive">
                            <AlertTriangle className="h-3 w-3" />
                            死白 {diagnostics.deadWhitePercent.toFixed(1)}%
                          </span>
                        )}
                        {diagnostics.deadBlackPercent <= 3 &&
                          diagnostics.deadWhitePercent <= 5 && (
                            <span className="text-[11px] text-success">
                              曝光正常
                            </span>
                          )}
                      </div>
                    </div>

                    {/* RAW Headroom */}
                    {fileType === "nef" && (
                      <div className="space-y-2">
                        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          RAW 宽容度
                        </h4>
                        <div className="space-y-2">
                          <HeadroomBar
                            label="高光余量"
                            value={diagnostics.highlightHeadroom}
                          />
                          <HeadroomBar
                            label="阴影余量"
                            value={diagnostics.shadowHeadroom}
                          />
                        </div>
                      </div>
                    )}

                    {/* AI Scene Recognition */}
                    <div className="space-y-2">
                      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        AI 场景识别
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        <SceneTag label={diagnostics.sceneType} />
                        <SceneTag label={diagnostics.lightCondition} />
                        <SceneTag label={diagnostics.mainTone} />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-12 text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] text-foreground">{value}</span>
    </div>
  )
}

function HeadroomBar({ label, value }: { label: string; value: number }) {
  const clampedValue = Math.min(100, Math.max(0, value))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] text-foreground">
          {clampedValue}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${clampedValue}%`,
            background:
              clampedValue > 60
                ? "linear-gradient(90deg, #34C759, #5AC8FA)"
                : clampedValue > 30
                  ? "linear-gradient(90deg, #FF9500, #FFCC00)"
                  : "linear-gradient(90deg, #FF3B30, #FF9500)",
          }}
        />
      </div>
    </div>
  )
}

function SceneTag({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
      {label}
    </span>
  )
}

function DiagnosticsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  )
}
