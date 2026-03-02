"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
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
  FileImage,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ImageIcon,
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
      <div className="relative flex flex-1 items-center justify-center overflow-auto px-10 py-8">
        {imageUrl ? (
          <div className="relative">
            {/* Image with subtle shadow */}
            <img
              src={imageUrl}
              alt="上传的照片"
              className={`rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/5 ${
                zoom === "fit"
                  ? "max-h-[calc(100vh-300px)] max-w-[calc(100%-2rem)] object-contain"
                  : "max-w-none"
              }`}
            />

            {/* Zoom controls - floating pill */}
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-card/90 px-1 py-0.5 shadow-lg ring-1 ring-border backdrop-blur-md">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleZoom}
                className={`h-6 rounded-full px-2.5 text-[11px] font-medium transition-all ${
                  zoom === "fit"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Maximize2 className="mr-1 h-3 w-3" />
                Fit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleZoom}
                className={`h-6 rounded-full px-2.5 text-[11px] font-medium transition-all ${
                  zoom === "100"
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <ZoomIn className="mr-1 h-3 w-3" />
                100%
              </Button>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-secondary ring-1 ring-border">
              <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <p className="text-[14px] font-medium text-muted-foreground/60">
                上传照片以开始调色
              </p>
              <p className="text-[12px] text-muted-foreground/30">
                支持 JPG 和 NEF (RAW) 格式
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Diagnostics panel (collapsible) */}
      {(diagnostics || isAnalyzing) && (
        <div className="mx-6 mb-5 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-card/80 shadow-[0_4px_20px_rgba(0,0,0,0.25)] backdrop-blur-sm">
          <button
            onClick={() => setDiagOpen(!diagOpen)}
            className="flex w-full items-center gap-2 border-b border-border/40 px-4 py-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-secondary/30"
          >
            {diagOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>图像诊断</span>
            {diagnostics && (
              <span className="ml-auto rounded-md bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {fileType === "nef" ? "RAW" : "JPEG"} / {diagnostics.colorSpace}
              </span>
            )}
          </button>

          {diagOpen && (
            <ScrollArea className="max-h-[260px]">
              <div className="px-5 pb-5 pt-4">
                {isAnalyzing && !diagnostics ? (
                  <DiagnosticsSkeleton />
                ) : diagnostics ? (
                  <div className="grid grid-cols-3 gap-6">
                    {/* Basic Info */}
                    <div className="space-y-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        基础信息
                      </h4>
                      <div className="space-y-2">
                        <InfoRow
                          icon={<FileImage className="h-3 w-3" />}
                          label="格式"
                          value={
                            fileType === "nef"
                              ? "RAW (NEF) / 16-bit"
                              : "JPEG / 8-bit"
                          }
                        />
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
                    <div className="space-y-2.5">
                      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        直方图
                      </h4>
                      <Histogram data={diagnostics.histogram} />
                      <div className="flex gap-3">
                        {diagnostics.deadBlackPercent > 3 && (
                          <span className="flex items-center gap-1 rounded-md bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            死黑 {diagnostics.deadBlackPercent.toFixed(1)}%
                          </span>
                        )}
                        {diagnostics.deadWhitePercent > 5 && (
                          <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            死白 {diagnostics.deadWhitePercent.toFixed(1)}%
                          </span>
                        )}
                        {diagnostics.deadBlackPercent <= 3 &&
                          diagnostics.deadWhitePercent <= 5 && (
                            <span className="flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                              曝光正常
                            </span>
                          )}
                      </div>
                    </div>

                    {/* Third column: Scene + Headroom */}
                    <div className="space-y-4">
                      {/* AI Scene Recognition */}
                      <div className="space-y-2.5">
                        <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                          AI 场景识别
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          <SceneTag label={diagnostics.sceneType} />
                          <SceneTag label={diagnostics.lightCondition} />
                          <SceneTag label={diagnostics.mainTone} />
                        </div>
                      </div>

                      {/* RAW Headroom */}
                      {fileType === "nef" && (
                        <div className="space-y-2.5">
                          <h4 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                            RAW 宽容度
                          </h4>
                          <div className="space-y-2.5">
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
    <div className="flex items-center gap-2.5 text-[12px]">
      <span className="text-muted-foreground/50">{icon}</span>
      <span className="w-12 text-muted-foreground/70">{label}</span>
      <span className="font-mono text-[11px] text-foreground/80">{value}</span>
    </div>
  )
}

function HeadroomBar({ label, value }: { label: string; value: number }) {
  const clampedValue = Math.min(100, Math.max(0, value))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/70">{label}</span>
        <span className="font-mono text-[11px] text-foreground/80">
          {clampedValue}%
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${clampedValue}%`,
            background:
              clampedValue > 60
                ? "linear-gradient(90deg, #51CF66, #74C0FC)"
                : clampedValue > 30
                  ? "linear-gradient(90deg, #FFB84D, #FFD43B)"
                  : "linear-gradient(90deg, #FF6B6B, #FFB84D)",
          }}
        />
      </div>
    </div>
  )
}

function SceneTag({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground ring-1 ring-primary/10">
      {label}
    </span>
  )
}

function DiagnosticsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-16 bg-secondary" />
        <Skeleton className="h-4 w-full bg-secondary" />
        <Skeleton className="h-4 w-full bg-secondary" />
        <Skeleton className="h-4 w-3/4 bg-secondary" />
        <Skeleton className="h-4 w-full bg-secondary" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-16 bg-secondary" />
        <Skeleton className="h-20 w-full bg-secondary" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-16 bg-secondary" />
        <Skeleton className="h-5 w-16 rounded-md bg-secondary" />
        <Skeleton className="h-5 w-20 rounded-md bg-secondary" />
      </div>
    </div>
  )
}
