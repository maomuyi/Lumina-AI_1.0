"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Histogram } from "@/components/histogram"
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
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
  Minus,
  Plus,
  RotateCcw,
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

// Zoom presets
const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]
const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const WHEEL_ZOOM_FACTOR = 0.001

function clampZoom(z: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

function snapToStep(z: number, direction: "in" | "out"): number {
  if (direction === "in") {
    for (const s of ZOOM_STEPS) {
      if (s > z + 0.01) return s
    }
    return clampZoom(z * 1.25)
  } else {
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_STEPS[i] < z - 0.01) return ZOOM_STEPS[i]
    }
    return clampZoom(z / 1.25)
  }
}

export function CenterCanvas({
  imageUrl,
  fileType,
  isAnalyzing,
  diagnostics,
}: CenterCanvasProps) {
  const [diagOpen, setDiagOpen] = useState(true)

  // Zoom & pan state
  const [scale, setScale] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [isFitMode, setIsFitMode] = useState(true)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })

  const containerRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Compute fit scale when image loads or container resizes
  const computeFitScale = useCallback(() => {
    if (!containerRef.current || !naturalSize.w) return 1
    const rect = containerRef.current.getBoundingClientRect()
    const padX = 80
    const padY = 80
    const availW = rect.width - padX
    const availH = rect.height - padY
    const s = Math.min(availW / naturalSize.w, availH / naturalSize.h, 1)
    return Math.max(s, MIN_ZOOM)
  }, [naturalSize])

  useEffect(() => {
    const fs = computeFitScale()
    setFitScale(fs)
    if (isFitMode) {
      setScale(fs)
      setPan({ x: 0, y: 0 })
    }
  }, [computeFitScale, isFitMode])

  // Observe container resize
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const fs = computeFitScale()
      setFitScale(fs)
      if (isFitMode) {
        setScale(fs)
        setPan({ x: 0, y: 0 })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [computeFitScale, isFitMode])

  // Image load handler
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      // Reset to fit mode on new image
      setIsFitMode(true)
      setPan({ x: 0, y: 0 })
    },
    []
  )

  // Reset on new image
  useEffect(() => {
    setIsFitMode(true)
    setPan({ x: 0, y: 0 })
    setScale(1)
  }, [imageUrl])

  // Wheel zoom (pinch-to-zoom on trackpad maps to wheel events)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!containerRef.current || !naturalSize.w) return
      e.preventDefault()

      const delta = -e.deltaY * WHEEL_ZOOM_FACTOR
      const rect = containerRef.current.getBoundingClientRect()
      const cursorX = e.clientX - rect.left - rect.width / 2
      const cursorY = e.clientY - rect.top - rect.height / 2

      setScale((prev) => {
        const next = clampZoom(prev * (1 + delta * prev))
        // Adjust pan so zoom focuses on cursor
        const ratio = next / prev
        setPan((p) => ({
          x: cursorX - ratio * (cursorX - p.x),
          y: cursorY - ratio * (cursorY - p.y),
        }))
        setIsFitMode(false)
        return next
      })
    },
    [naturalSize]
  )

  // Mouse drag to pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan when zoomed in beyond fit, or on middle button
      if (e.button === 1 || scale > fitScale + 0.01) {
        e.preventDefault()
        setIsPanning(true)
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: pan.x,
          panY: pan.y,
        }
      }
    },
    [scale, fitScale, pan]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      })
    },
    [isPanning]
  )

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Double-click: toggle between fit and 100%
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return

      if (Math.abs(scale - 1) < 0.01 && !isFitMode) {
        // At 100% -> go to fit
        setIsFitMode(true)
        setScale(fitScale)
        setPan({ x: 0, y: 0 })
      } else {
        // Go to 100% centered on cursor
        const rect = containerRef.current.getBoundingClientRect()
        const cursorX = e.clientX - rect.left - rect.width / 2
        const cursorY = e.clientY - rect.top - rect.height / 2
        const ratio = 1 / scale
        setPan({
          x: cursorX - ratio * (cursorX - pan.x),
          y: cursorY - ratio * (cursorY - pan.y),
        })
        setScale(1)
        setIsFitMode(false)
      }
    },
    [scale, fitScale, isFitMode, pan]
  )

  // Toolbar actions
  const handleFit = useCallback(() => {
    setIsFitMode(true)
    setScale(fitScale)
    setPan({ x: 0, y: 0 })
  }, [fitScale])

  const handleZoom100 = useCallback(() => {
    setScale(1)
    setIsFitMode(false)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleZoomIn = useCallback(() => {
    setScale((prev) => {
      const next = clampZoom(snapToStep(prev, "in"))
      setIsFitMode(false)
      return next
    })
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((prev) => {
      const next = clampZoom(snapToStep(prev, "out"))
      setIsFitMode(false)
      return next
    })
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const isMeta = e.metaKey || e.ctrlKey

      if (isMeta && (e.key === "=" || e.key === "+")) {
        e.preventDefault()
        handleZoomIn()
      } else if (isMeta && e.key === "-") {
        e.preventDefault()
        handleZoomOut()
      } else if (isMeta && e.key === "0") {
        e.preventDefault()
        handleFit()
      } else if (isMeta && e.key === "1") {
        e.preventDefault()
        handleZoom100()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleZoomIn, handleZoomOut, handleFit, handleZoom100])

  const displayPercent = Math.round(scale * 100)
  const cursorStyle = isPanning
    ? "grabbing"
    : scale > fitScale + 0.01
      ? "grab"
      : "default"

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas-bg">
      {/* Image preview area */}
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ cursor: cursorStyle }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={imageUrl ? handleDoubleClick : undefined}
      >
        {imageUrl ? (
          <>
            {/* Transformed image */}
            <img
              src={imageUrl}
              alt="上传的照片"
              draggable={false}
              onLoad={handleImageLoad}
              className="select-none rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/5"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: "center center",
                transition: isPanning ? "none" : "transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                maxWidth: "none",
                width: naturalSize.w || "auto",
                height: naturalSize.h || "auto",
                imageRendering: scale > 2 ? "pixelated" : "auto",
              }}
            />

            {/* Zoom controls - floating pill */}
            <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-card/90 px-1.5 py-1 shadow-lg ring-1 ring-border backdrop-blur-md">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomOut}
                className="h-6 w-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
              >
                <Minus className="h-3 w-3" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleFit}
                className={`h-6 rounded-full px-2 text-[11px] font-medium transition-all ${
                  isFitMode
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Maximize2 className="mr-1 h-3 w-3" />
                Fit
              </Button>

              {/* Zoom percentage indicator */}
              <button
                onClick={handleZoom100}
                className={`flex h-6 min-w-[48px] items-center justify-center rounded-full px-2 text-[11px] font-mono font-medium transition-all ${
                  Math.abs(scale - 1) < 0.01 && !isFitMode
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {displayPercent}%
              </button>

              <Button
                variant="ghost"
                size="sm"
                onClick={handleZoomIn}
                className="h-6 w-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
              </Button>

              {/* Reset pan */}
              {(Math.abs(pan.x) > 2 || Math.abs(pan.y) > 2) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPan({ x: 0, y: 0 })}
                  className="h-6 w-6 rounded-full p-0 text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              )}
            </div>
          </>
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
                            {"死黑 "}
                            {diagnostics.deadBlackPercent.toFixed(1)}%
                          </span>
                        )}
                        {diagnostics.deadWhitePercent > 5 && (
                          <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {"死白 "}
                            {diagnostics.deadWhitePercent.toFixed(1)}%
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
