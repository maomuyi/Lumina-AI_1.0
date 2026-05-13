"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import {
  ZOOM_STEPS,
  MAX_ZOOM,
  WHEEL_ZOOM_FACTOR,
  getMinZoom,
  clampZoom,
  snapToStep,
  clamp,
  aspectMismatch,
  buildPreviewLook,
  adjustedLayerStyle,
  type PreviewMode,
  type PreviewLook,
} from "@/lib/canvas-utils"
import { DiagnosticsPanel } from "@/components/diagnostics-panel"
import type { ImageDiagnostics as DiagType } from "@/components/diagnostics-panel"
import { Button } from "@/components/ui/button"
import {
  Maximize2,
  ImageIcon,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react"

export type { ImageDiagnostics } from "@/components/diagnostics-panel"

interface CenterCanvasProps {
  imageUrl: string | null
  fileType: string | null
  isAnalyzing: boolean
  diagnostics: DiagType | null
  params: Record<string, number>
  hasAnalysis: boolean
  rawPreviewInfo?: {
    rawWidth: number
    rawHeight: number
    previewWidth: number
    previewHeight: number
    aspectMismatch: boolean
  } | null
  versionComparison?: {
    currentLabel: string
  } | null
}


export function CenterCanvas({
  imageUrl,
  fileType,
  isAnalyzing,
  diagnostics,
  params,
  hasAnalysis,
  rawPreviewInfo,
  versionComparison,
}: CenterCanvasProps) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("adjusted")
  const [splitPercent, setSplitPercent] = useState(50)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false)

  // Zoom & pan state
  const [scale, setScale] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [isFitMode, setIsFitMode] = useState(true)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [isHandToolActive, setIsHandToolActive] = useState(false)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [framePixelSize, setFramePixelSize] = useState({ w: 0, h: 0 })

  const containerRef = useRef<HTMLDivElement>(null)
  const imageFrameRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const previewSize = useMemo(
    () =>
      rawPreviewInfo
        ? { w: rawPreviewInfo.previewWidth, h: rawPreviewInfo.previewHeight }
        : { w: 0, h: 0 },
    [rawPreviewInfo]
  )
  const imageSize = useMemo(() => {
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      return naturalSize
    }
    if (previewSize.w > 0 && previewSize.h > 0) {
      return previewSize
    }
    return naturalSize
  }, [naturalSize, previewSize])
  const previewAspectMismatch = useMemo(() => {
    if (!rawPreviewInfo) return false
    if (naturalSize.w > 0 && naturalSize.h > 0) {
      return aspectMismatch(
        { w: naturalSize.w, h: naturalSize.h },
        { w: rawPreviewInfo.rawWidth, h: rawPreviewInfo.rawHeight }
      )
    }
    return rawPreviewInfo.aspectMismatch
  }, [naturalSize, rawPreviewInfo])
  const canPan = Boolean(imageUrl) && (isHandToolActive || scale > fitScale + 0.001)
  const canPreviewAdjustment = Boolean(imageUrl) && hasAnalysis
  const versionComparisonKey = versionComparison?.currentLabel ?? ""

  const updateFramePixelSize = useCallback(() => {
    const frame = imageFrameRef.current
    if (!frame) return

    const next = { w: frame.offsetWidth, h: frame.offsetHeight }
    if (!next.w || !next.h) return

    setFramePixelSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
  }, [])

  const getCurrentFramePixelSize = useCallback(() => {
    const frame = imageFrameRef.current
    return {
      w: frame?.offsetWidth || framePixelSize.w,
      h: frame?.offsetHeight || framePixelSize.h,
    }
  }, [framePixelSize.h, framePixelSize.w])

  const actual100Scale = useMemo(() => {
    const frameW = getCurrentFramePixelSize().w
    if (!naturalSize.w || !frameW) return 1
    return clampZoom(naturalSize.w / frameW, imageSize)
  }, [getCurrentFramePixelSize, imageSize, naturalSize.w])

  const clampPanToBounds = useCallback(
    (nextPan: { x: number; y: number }, nextScale = scale) => {
      const frameSize = getCurrentFramePixelSize()
      if (!containerRef.current || !frameSize.w || !frameSize.h) return nextPan

      const rect = containerRef.current.getBoundingClientRect()
      const scaledW = frameSize.w * nextScale
      const scaledH = frameSize.h * nextScale
      const maxX = Math.max(0, (scaledW - rect.width) / 2)
      const maxY = Math.max(0, (scaledH - rect.height) / 2)

      return {
        x: Math.min(maxX, Math.max(-maxX, nextPan.x)),
        y: Math.min(maxY, Math.max(-maxY, nextPan.y)),
      }
    },
    [getCurrentFramePixelSize, scale]
  )

  // Compute fit scale when image loads or container resizes
  const computeFitScale = useCallback(() => 1, [])

  useEffect(() => {
    const fs = computeFitScale()
    setFitScale(fs)
    if (isFitMode) {
      setScale(fs)
      setPan({ x: 0, y: 0 })
    } else {
      setPan((p) => clampPanToBounds(p, scale))
    }
  }, [computeFitScale, isFitMode, clampPanToBounds, scale])

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
      } else {
        setPan((p) => clampPanToBounds(p, scale))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [computeFitScale, isFitMode, clampPanToBounds, scale])

  useEffect(() => {
    if (!imageUrl) {
      setFramePixelSize({ w: 0, h: 0 })
      return
    }

    const frame = imageFrameRef.current
    if (!frame) return

    updateFramePixelSize()
    const ro = new ResizeObserver(updateFramePixelSize)
    ro.observe(frame)
    return () => ro.disconnect()
  }, [imageUrl, imageSize.h, imageSize.w, updateFramePixelSize])

  useEffect(() => {
    if (!canPreviewAdjustment || !versionComparisonKey) return
    setPreviewMode("split")
    setSplitPercent(50)
  }, [canPreviewAdjustment, versionComparisonKey])

  // Image load handler
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
      // Reset to fit mode on new image
      setIsFitMode(true)
      setPan({ x: 0, y: 0 })
      requestAnimationFrame(updateFramePixelSize)
    },
    [updateFramePixelSize]
  )

  // Reset on new image
  useEffect(() => {
    setIsFitMode(true)
    setPan({ x: 0, y: 0 })
    setScale(1)
    setNaturalSize({ w: 0, h: 0 })
    setFramePixelSize({ w: 0, h: 0 })
    setSplitPercent(50)
  }, [imageUrl])

  const updateSplitFromClientX = useCallback((clientX: number) => {
    const rect = imageFrameRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const next = ((clientX - rect.left) / rect.width) * 100
    setSplitPercent(clamp(next, 2, 98))
  }, [])

  const handleSplitPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (previewMode !== "split" || !canPreviewAdjustment) return
      e.preventDefault()
      e.stopPropagation()
      setIsDraggingSplit(true)
      updateSplitFromClientX(e.clientX)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [previewMode, canPreviewAdjustment, updateSplitFromClientX]
  )

  const handleSplitPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingSplit) return
      e.preventDefault()
      e.stopPropagation()
      updateSplitFromClientX(e.clientX)
    },
    [isDraggingSplit, updateSplitFromClientX]
  )

  const handleSplitPointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingSplit) return
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingSplit(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [isDraggingSplit])

  const handleSplitKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (previewMode !== "split") return
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      setSplitPercent((value) => clamp(value - (e.shiftKey ? 10 : 2), 2, 98))
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      setSplitPercent((value) => clamp(value + (e.shiftKey ? 10 : 2), 2, 98))
    } else if (e.key === "Home") {
      e.preventDefault()
      setSplitPercent(2)
    } else if (e.key === "End") {
      e.preventDefault()
      setSplitPercent(98)
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setSplitPercent(50)
    }
  }, [previewMode])

  // Wheel zoom (pinch-to-zoom on trackpad maps to wheel events)
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (!containerRef.current || !imageSize.w) return
      e.preventDefault()

      const nextScaleRatio = Math.exp(-e.deltaY * WHEEL_ZOOM_FACTOR * 1.2)
      const rect = containerRef.current.getBoundingClientRect()
      const cursorX = e.clientX - rect.left - rect.width / 2
      const cursorY = e.clientY - rect.top - rect.height / 2

      setScale((prev) => {
        const next = clampZoom(prev * nextScaleRatio, imageSize)
        const ratio = next / prev
        setPan((p) => ({
          ...clampPanToBounds({
            x: cursorX - ratio * (cursorX - p.x),
            y: cursorY - ratio * (cursorY - p.y),
          }, next),
        }))
        setIsFitMode(false)
        return next
      })
    },
    [imageSize, clampPanToBounds]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [handleWheel])

  // Mouse drag to pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!imageUrl) return
      if (e.button !== 0 && e.button !== 1) return
      if (!canPan) return
      e.preventDefault()
      setIsPanning(true)
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      }
    },
    [imageUrl, pan, canPan]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      setPan(clampPanToBounds({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      }))
    },
    [isPanning, clampPanToBounds]
  )

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Double-click: toggle between fit and 100%
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return
      if (!imageSize.w) return

      const rect = containerRef.current.getBoundingClientRect()
      const cursorX = e.clientX - rect.left - rect.width / 2
      const cursorY = e.clientY - rect.top - rect.height / 2
      const nearScale = (target: number) => Math.abs(scale - target) < 0.03
      const setZoomAroundCursor = (nextScale: number) => {
        const ratio = nextScale / scale
        setPan(
          clampPanToBounds({
            x: cursorX - ratio * (cursorX - pan.x),
            y: cursorY - ratio * (cursorY - pan.y),
          }, nextScale)
        )
        setScale(nextScale)
        setIsFitMode(false)
      }

      // 商业化双击节奏：Fit -> 100% -> 200% -> Fit
      if (isFitMode || nearScale(fitScale)) {
        setZoomAroundCursor(actual100Scale)
      } else if (nearScale(actual100Scale)) {
        setZoomAroundCursor(clampZoom(actual100Scale * 2, imageSize))
      } else {
        setIsFitMode(true)
        setScale(fitScale)
        setPan({ x: 0, y: 0 })
      }
    },
    [scale, fitScale, isFitMode, pan, clampPanToBounds, imageSize, actual100Scale]
  )

  // Toolbar actions
  const handleFit = useCallback(() => {
    setIsFitMode(true)
    setScale(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleZoom100 = useCallback(() => {
    setScale(actual100Scale)
    setIsFitMode(false)
    setPan((p) => clampPanToBounds(p, actual100Scale))
  }, [actual100Scale, clampPanToBounds])

  const handleZoomIn = useCallback(() => {
    setScale((prev) => {
      const next = clampZoom(snapToStep(prev, "in", imageSize), imageSize)
      setPan((p) => clampPanToBounds(p, next))
      setIsFitMode(false)
      return next
    })
  }, [imageSize, clampPanToBounds])

  const handleZoomOut = useCallback(() => {
    setScale((prev) => {
      const next = clampZoom(snapToStep(prev, "out", imageSize), imageSize)
      setPan((p) => clampPanToBounds(p, next))
      setIsFitMode(false)
      return next
    })
  }, [imageSize, clampPanToBounds])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const isMeta = e.metaKey || e.ctrlKey

      if (e.code === "Space" && imageUrl) {
        e.preventDefault()
        setIsHandToolActive(true)
        return
      }
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
    const keyupHandler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setIsHandToolActive(false)
      }
    }
    const blurHandler = () => setIsHandToolActive(false)
    window.addEventListener("keydown", handler)
    window.addEventListener("keyup", keyupHandler)
    window.addEventListener("blur", blurHandler)
    return () => {
      window.removeEventListener("keydown", handler)
      window.removeEventListener("keyup", keyupHandler)
      window.removeEventListener("blur", blurHandler)
    }
  }, [handleZoomIn, handleZoomOut, handleFit, handleZoom100, imageUrl])

  const displayPercent = naturalSize.w && framePixelSize.w
    ? Math.max(1, Math.round((framePixelSize.w * scale / naturalSize.w) * 100))
    : Math.round(scale * 100)
  const previewLook = buildPreviewLook(params)
  const splitBeforeLabel = "原图"
  const splitAfterLabel = versionComparison?.currentLabel ?? "XMP 预览"
  const cursorStyle = isDraggingSplit
    ? "col-resize"
    : isPanning
    ? "grabbing"
    : canPan
      ? "grab"
      : imageUrl
        ? "zoom-in"
      : "default"

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas-bg">
      {/* Image preview area */}
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ cursor: cursorStyle }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={imageUrl ? handleDoubleClick : undefined}
      >
        {imageUrl ? (
          <>
            {/* Transformed image preview */}
            <div
              ref={imageFrameRef}
              className="relative max-h-full max-w-full select-none overflow-hidden rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.5)] ring-1 ring-white/5"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transformOrigin: "center center",
                transition: isPanning || isDraggingSplit ? "none" : "transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                aspectRatio: imageSize.w && imageSize.h ? `${imageSize.w} / ${imageSize.h}` : undefined,
                width: "auto",
                height: "auto",
              }}
            >
              <img
                src={imageUrl}
                alt="上传的照片"
                draggable={false}
                onLoad={handleImageLoad}
                className="block h-full w-full select-none"
                style={{
                  objectFit: "contain",
                  imageRendering: scale > 2 ? "pixelated" : "auto",
                  opacity: previewMode === "adjusted" && canPreviewAdjustment ? 0 : 1,
                }}
              />

              {canPreviewAdjustment && previewMode !== "original" && (
                <PreviewLookLayer
                  imageUrl={imageUrl}
                  look={previewLook}
                  scale={scale}
                  alt={`${splitAfterLabel} 调色预览`}
                  style={adjustedLayerStyle(previewLook, previewMode, splitPercent)}
                />
              )}

              {canPreviewAdjustment && previewMode === "split" && (
                <>
                  <div
                    className="absolute inset-y-0 z-20 flex w-9 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
                    role="slider"
                    aria-label={`${splitBeforeLabel} 和 ${splitAfterLabel} 对比比例`}
                    aria-valuemin={2}
                    aria-valuemax={98}
                    aria-valuenow={Math.round(splitPercent)}
                    tabIndex={0}
                    onPointerDown={handleSplitPointerDown}
                    onPointerMove={handleSplitPointerMove}
                    onPointerUp={handleSplitPointerUp}
                    onPointerCancel={handleSplitPointerUp}
                    onKeyDown={handleSplitKeyDown}
                    style={{ left: `${splitPercent}%` }}
                  >
                    <div className="h-full w-px bg-white/75 shadow-[0_0_12px_rgba(0,0,0,0.7)]" />
                    <div className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 shadow-[0_4px_18px_rgba(0,0,0,0.45)] ring-1 ring-white/25 backdrop-blur">
                      <div className="h-4 w-px bg-white/75" />
                    </div>
                  </div>
                  <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white/80 backdrop-blur">
                    {splitBeforeLabel}
                  </span>
                  <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-primary/80 px-2 py-1 text-[10px] font-semibold text-primary-foreground backdrop-blur">
                    {splitAfterLabel}
                  </span>
                </>
              )}
            </div>

            {canPreviewAdjustment && (
              <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-card/90 px-1.5 py-1 shadow-lg ring-1 ring-border backdrop-blur-md">
                <PreviewModeButton
                  active={previewMode === "original"}
                  label="原图"
                  onClick={() => setPreviewMode("original")}
                />
                <PreviewModeButton
                  active={previewMode === "adjusted"}
                  label="XMP 预览"
                  onClick={() => setPreviewMode("adjusted")}
                  icon={<Sparkles className="h-3 w-3" />}
                />
                <PreviewModeButton
                  active={previewMode === "split"}
                  label={versionComparison ? "版本对比" : "对比"}
                  onClick={() => setPreviewMode("split")}
                />
              </div>
            )}

            {fileType === "nef" && previewAspectMismatch && (
              <div className="absolute left-4 top-4 z-10 max-w-[300px] rounded-lg bg-warning/10 px-3 py-2 shadow-lg ring-1 ring-warning/25 backdrop-blur-md">
                <p className="text-[11px] font-semibold text-warning">
                  NEF 内嵌预览比例与 RAW 画幅不一致
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-warning/80">
                  当前按浏览器实际加载尺寸显示预览：{imageSize.w}×{imageSize.h}；
                  RAW 原始尺寸：{rawPreviewInfo?.rawWidth}×{rawPreviewInfo?.rawHeight}。这通常来自机内预览方向/裁切，不是画布二次裁剪。
                </p>
              </div>
            )}

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
                className={`h-6 rounded-full px-2 text-[11px] font-medium transition-all ${isFitMode
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
                className={`flex h-6 min-w-[48px] items-center justify-center rounded-full px-2 text-[11px] font-mono font-medium transition-all ${Math.abs(scale - 1) < 0.01 && !isFitMode
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


      <DiagnosticsPanel diagnostics={diagnostics as DiagType | null} isAnalyzing={isAnalyzing} fileType={fileType} />
    </div>
  )
}

function PreviewModeButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-all ${
        active
          ? "bg-primary/15 text-primary ring-1 ring-primary/25"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function PreviewLookLayer({
  imageUrl,
  look,
  scale,
  alt,
  style,
}: {
  imageUrl: string
  look: PreviewLook
  scale: number
  alt: string
  style?: React.CSSProperties
}) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={style}>
      <img
        src={imageUrl}
        alt={alt}
        draggable={false}
        className="block h-full w-full select-none"
        style={{
          objectFit: "contain",
          imageRendering: scale > 2 ? "pixelated" : "auto",
        }}
      />
      <div className="pointer-events-none absolute inset-0" style={look.warmthOverlay} />
      <div className="pointer-events-none absolute inset-0" style={look.tintOverlay} />
      <div className="pointer-events-none absolute inset-0" style={look.styleOverlay} />
      <div className="pointer-events-none absolute inset-0" style={look.toneOverlay} />
      <div className="pointer-events-none absolute inset-0" style={look.grainOverlay} />
      <div className="pointer-events-none absolute inset-0" style={look.vignette} />
    </div>
  )
}
