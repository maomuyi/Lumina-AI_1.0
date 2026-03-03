"use client"

import { useCallback, useState, useRef, useEffect } from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import type { LightroomParam } from "@/lib/lightroom-params"

interface ParamSliderProps {
  param: LightroomParam
  value: number
  aiRecommendedValue?: number
  isAiModified?: boolean
  onChange: (key: string, value: number) => void
}

export function ParamSlider({
  param,
  value,
  aiRecommendedValue,
  isAiModified,
  onChange,
}: ParamSliderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [showTooltip, setShowTooltip] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Flash animation when AI modifies this param
  useEffect(() => {
    if (isAiModified) {
      setFlashActive(true)
      const timer = setTimeout(() => setFlashActive(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [isAiModified, value])

  const handleSliderChange = useCallback(
    (vals: number[]) => {
      onChange(param.key, vals[0])
    },
    [onChange, param.key]
  )

  const handleDoubleClick = useCallback(() => {
    onChange(param.key, param.defaultValue)
  }, [onChange, param.key, param.defaultValue])

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
      onChange(param.key, clamped)
    }
  }, [inputValue, onChange, param])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleInputConfirm()
      if (e.key === "Escape") setIsEditing(false)
    },
    [handleInputConfirm]
  )

  // Calculate the position of the AI recommended dot
  const aiDotPosition =
    aiRecommendedValue !== undefined
      ? ((aiRecommendedValue - param.min) / (param.max - param.min)) * 100
      : null

  const isModified = value !== param.defaultValue

  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-1 py-[4px] transition-colors duration-500 ${
        flashActive ? "bg-glow-primary" : "hover:bg-secondary/30"
      }`}
    >
      {/* Label */}
      <span
        className={`w-[72px] shrink-0 text-[11px] leading-none transition-colors ${
          isModified
            ? "font-medium text-foreground/90"
            : "text-muted-foreground"
        }`}
      >
        {param.label}
      </span>

      {/* Slider */}
      <div className="relative flex-1">
        <SliderPrimitive.Root
          value={[value]}
          min={param.min}
          max={param.max}
          step={param.step}
          onValueChange={handleSliderChange}
          onDoubleClick={handleDoubleClick}
          onPointerDown={() => setShowTooltip(true)}
          onPointerUp={() => setShowTooltip(false)}
          className="relative flex h-4 w-full touch-none select-none items-center"
        >
          <SliderPrimitive.Track className="relative h-[3px] w-full overflow-hidden rounded-full bg-border">
            <SliderPrimitive.Range
              className="absolute h-full bg-primary/70 transition-colors"
              style={{
                // For bipolar sliders (min < 0), range should start from center
                ...(param.min < 0
                  ? {
                      left:
                        value >= 0
                          ? `${((-param.min) / (param.max - param.min)) * 100}%`
                          : `${((value - param.min) / (param.max - param.min)) * 100}%`,
                      right:
                        value >= 0
                          ? `${((param.max - value) / (param.max - param.min)) * 100}%`
                          : `${((-param.min) / (param.max - param.min)) * 100}%`,
                      width: "auto",
                    }
                  : {}),
              }}
            />
          </SliderPrimitive.Track>

          <SliderPrimitive.Thumb className="block h-3 w-3 cursor-grab rounded-full border-2 border-primary bg-background shadow-[0_0_8px_rgba(108,142,255,0.3)] ring-0 transition-shadow hover:shadow-[0_0_12px_rgba(108,142,255,0.5)] focus-visible:outline-none focus-visible:ring-0 active:cursor-grabbing">
            {/* Value tooltip */}
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 font-mono text-[10px] text-background shadow-lg">
                {formatValue(value, param)}
              </div>
            )}
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>

        {/* AI recommended dot */}
        {aiDotPosition !== null && (
          <div
            className="pointer-events-none absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_6px_rgba(108,142,255,0.6)]"
            style={{ left: `${aiDotPosition}%`, marginTop: "6px" }}
          />
        )}
      </div>

      {/* Value input */}
      {isEditing ? (
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputConfirm}
          onKeyDown={handleKeyDown}
          className="w-[48px] shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-right font-mono text-[11px] text-foreground outline-none ring-1 ring-primary/30"
        />
      ) : (
        <button
          onClick={handleInputStart}
          className={`w-[48px] shrink-0 rounded-md px-1.5 py-0.5 text-right font-mono text-[11px] transition-colors ${
            isModified
              ? "text-foreground/90 hover:bg-secondary"
              : "text-muted-foreground hover:bg-secondary"
          }`}
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
