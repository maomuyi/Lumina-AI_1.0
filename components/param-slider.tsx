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
      const timer = setTimeout(() => setFlashActive(false), 800)
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
    <div className="group flex items-center gap-2 px-0 py-[3px]">
      {/* Label */}
      <span
        className={`w-[72px] shrink-0 text-[11px] leading-none ${
          isModified ? "font-medium text-foreground" : "text-muted-foreground"
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
          className="relative flex w-full touch-none items-center select-none h-4"
        >
          <SliderPrimitive.Track
            className={`relative h-[3px] w-full overflow-hidden rounded-full transition-colors duration-300 ${
              flashActive ? "bg-[#007AFF]/20" : "bg-[#E5E5EA]"
            }`}
          >
            <SliderPrimitive.Range
              className={`absolute h-full transition-colors duration-300 ${
                flashActive ? "bg-[#007AFF]" : "bg-[#007AFF]"
              }`}
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

          <SliderPrimitive.Thumb className="block h-3 w-3 rounded-full border border-[#007AFF] bg-card shadow-sm ring-0 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-0 cursor-grab active:cursor-grabbing">
            {/* Value tooltip */}
            {showTooltip && (
              <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-mono text-primary-foreground whitespace-nowrap">
                {formatValue(value, param)}
              </div>
            )}
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>

        {/* AI recommended dot */}
        {aiDotPosition !== null && (
          <div
            className="pointer-events-none absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#007AFF]"
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
          className="w-[52px] shrink-0 rounded-[4px] bg-secondary px-1.5 py-0.5 text-right font-mono text-[11px] text-foreground outline-none ring-1 ring-primary/30"
        />
      ) : (
        <button
          onClick={handleInputStart}
          className="w-[52px] shrink-0 rounded-[4px] bg-secondary/60 px-1.5 py-0.5 text-right font-mono text-[11px] text-foreground transition-colors hover:bg-secondary"
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
