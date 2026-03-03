"use client"

import { useCallback, useState, useRef, useEffect, useMemo } from "react"
import type { LightroomParam } from "@/lib/lightroom-params"

interface ParamSliderProps {
  param: LightroomParam
  value: number
  aiRecommendedValue?: number
  isAiModified?: boolean
  onChange: (key: string, value: number) => void
}

/**
 * HSL 色相滑块的颜色映射。
 * Lightroom 中每种颜色的轨道都有对应的色彩标识。
 */
const HSL_COLOR_MAP: Record<string, string> = {
  // 色相
  HueAdjustmentRed: "#e25555",
  HueAdjustmentOrange: "#e89040",
  HueAdjustmentYellow: "#d4c35a",
  HueAdjustmentGreen: "#6abf69",
  HueAdjustmentAqua: "#52c4c4",
  HueAdjustmentBlue: "#4b8fd6",
  HueAdjustmentPurple: "#9472c4",
  HueAdjustmentMagenta: "#c75b9b",
  // 饱和度
  SaturationAdjustmentRed: "#e25555",
  SaturationAdjustmentOrange: "#e89040",
  SaturationAdjustmentYellow: "#d4c35a",
  SaturationAdjustmentGreen: "#6abf69",
  SaturationAdjustmentAqua: "#52c4c4",
  SaturationAdjustmentBlue: "#4b8fd6",
  SaturationAdjustmentPurple: "#9472c4",
  SaturationAdjustmentMagenta: "#c75b9b",
  // 明度
  LuminanceAdjustmentRed: "#e25555",
  LuminanceAdjustmentOrange: "#e89040",
  LuminanceAdjustmentYellow: "#d4c35a",
  LuminanceAdjustmentGreen: "#6abf69",
  LuminanceAdjustmentAqua: "#52c4c4",
  LuminanceAdjustmentBlue: "#4b8fd6",
  LuminanceAdjustmentPurple: "#9472c4",
  LuminanceAdjustmentMagenta: "#c75b9b",
}

/**
 * Lightroom 风格参数滑块
 *
 * 设计特点：
 * - 填充式轨道（fill-style），无传统圆形 thumb
 * - 双极滑块从中心点向左/右填充
 * - HSL 滑块使用对应颜色
 * - 极紧凑的行高（22px）
 * - 双击重置为默认值
 * - 点击数值可手动输入
 */
export function ParamSlider({
  param,
  value,
  aiRecommendedValue,
  isAiModified,
  onChange,
}: ParamSliderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [flashActive, setFlashActive] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // AI 修改闪烁
  useEffect(() => {
    if (isAiModified) {
      setFlashActive(true)
      const timer = setTimeout(() => setFlashActive(false), 1200)
      return () => clearTimeout(timer)
    }
  }, [isAiModified, value])

  // 获取 HSL 颜色或默认主题色
  const accentColor = useMemo(
    () => HSL_COLOR_MAP[param.key] || undefined,
    [param.key]
  )

  const isBipolar = param.min < 0
  const range = param.max - param.min
  const normalizedValue = (value - param.min) / range // 0~1
  const centerNorm = isBipolar ? -param.min / range : 0

  // ── 拖拽处理 ──────────────────────────────────────────────────────
  const valueFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return value
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      let raw = param.min + ratio * range
      // 按步进对齐
      raw = Math.round(raw / param.step) * param.step
      return Math.max(param.min, Math.min(param.max, raw))
    },
    [param.min, param.max, param.step, range, value]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) return
      e.preventDefault()
        ; (e.target as HTMLElement).setPointerCapture(e.pointerId)
      setIsDragging(true)
      const newVal = valueFromEvent(e.clientX)
      onChange(param.key, newVal)
    },
    [isEditing, valueFromEvent, onChange, param.key]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return
      const newVal = valueFromEvent(e.clientX)
      onChange(param.key, newVal)
    },
    [isDragging, valueFromEvent, onChange, param.key]
  )

  const handlePointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // 双击重置
  const handleDoubleClick = useCallback(() => {
    onChange(param.key, param.defaultValue)
  }, [onChange, param.key, param.defaultValue])

  // 数值编辑
  const handleInputStart = useCallback(() => {
    setIsEditing(true)
    setInputValue(formatValue(value, param))
    setTimeout(() => inputRef.current?.select(), 0)
  }, [value, param])

  const handleInputConfirm = useCallback(() => {
    setIsEditing(false)
    const num = parseFloat(inputValue)
    if (!isNaN(num)) {
      const clamped = Math.min(param.max, Math.max(param.min, num))
      onChange(param.key, Math.round(clamped / param.step) * param.step)
    }
  }, [inputValue, onChange, param])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleInputConfirm()
      if (e.key === "Escape") setIsEditing(false)
    },
    [handleInputConfirm]
  )

  // ── 计算填充区域样式 ──────────────────────────────────────────────
  const fillStyle = useMemo(() => {
    const fillColor = accentColor || "var(--color-primary)"
    const fillOpacity = accentColor ? 0.7 : 0.55

    if (isBipolar) {
      // 双极：从中心向左或向右填充
      const left = value >= 0 ? centerNorm * 100 : normalizedValue * 100
      const right = value >= 0 ? (1 - normalizedValue) * 100 : (1 - centerNorm) * 100
      return {
        left: `${left}%`,
        right: `${right}%`,
        backgroundColor: fillColor,
        opacity: fillOpacity,
      }
    }
    // 单极：从左到右填充
    return {
      left: 0,
      width: `${normalizedValue * 100}%`,
      backgroundColor: fillColor,
      opacity: fillOpacity,
    }
  }, [isBipolar, normalizedValue, centerNorm, value, accentColor])

  // AI 推荐位置
  const aiDotNorm =
    aiRecommendedValue !== undefined
      ? ((aiRecommendedValue - param.min) / range) * 100
      : null

  const isModified = value !== param.defaultValue

  return (
    <div
      className={`group relative flex h-[22px] items-center transition-colors duration-700 ${flashActive
          ? "bg-primary/8"
          : ""
        }`}
    >
      {/* 参数名 */}
      <span
        className={`relative z-10 w-[76px] shrink-0 select-none pl-2 text-[11px] leading-none ${isModified
            ? "font-medium text-foreground/90"
            : "text-muted-foreground"
          }`}
      >
        {param.label}
      </span>

      {/* Lightroom 风格填充式滑块 */}
      <div
        ref={trackRef}
        className={`relative flex-1 h-full cursor-ew-resize select-none ${isDragging ? "cursor-grabbing" : ""
          }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* 轨道底色 */}
        <div className="absolute inset-0 bg-white/[0.04]" />

        {/* 填充区域 */}
        <div
          className="absolute inset-y-0 transition-all duration-75"
          style={fillStyle}
        />

        {/* 中心线（双极滑块） */}
        {isBipolar && (
          <div
            className="absolute top-[3px] bottom-[3px] w-px bg-white/[0.12]"
            style={{ left: `${centerNorm * 100}%` }}
          />
        )}

        {/* 当前值指示线 */}
        <div
          className={`absolute top-[2px] bottom-[2px] w-[1.5px] transition-all duration-75 ${isDragging ? "bg-white/80" : "bg-white/40"
            }`}
          style={{ left: `${normalizedValue * 100}%`, transform: "translateX(-0.75px)" }}
        />

        {/* AI 推荐标记点 */}
        {aiDotNorm !== null && (
          <div
            className="absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_6px_rgba(108,142,255,0.6)]"
            style={{ left: `${aiDotNorm}%` }}
          />
        )}
      </div>

      {/* 数值显示/编辑 */}
      {isEditing ? (
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputConfirm}
          onKeyDown={handleKeyDown}
          className="relative z-10 w-[44px] shrink-0 bg-secondary px-1.5 text-right font-mono text-[10px] text-foreground outline-none ring-1 ring-primary/30"
        />
      ) : (
        <button
          onClick={handleInputStart}
          className={`relative z-10 w-[44px] shrink-0 pr-2 text-right font-mono text-[10px] transition-colors ${isModified
              ? "text-foreground/80"
              : "text-muted-foreground/60"
            } hover:text-foreground`}
        >
          {formatValue(value, param)}
        </button>
      )}
    </div>
  )
}

function formatValue(value: number, param: LightroomParam): string {
  if (param.step < 1) {
    return value.toFixed(param.step < 0.1 ? 2 : 1)
  }
  return Math.round(value).toString()
}
