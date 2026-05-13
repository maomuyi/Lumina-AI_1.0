/**
 * canvas-utils.ts
 *
 * Center canvas 的纯函数工具集（与 React 解耦，便于单测和复用）。
 */

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5]
export const MAX_ZOOM = 12
export const WHEEL_ZOOM_FACTOR = 0.001

export interface Size {
  w: number
  h: number
}

export interface PreviewLook {
  filter: string
  isBlackWhite: boolean
  warmthOverlay: React.CSSProperties
  tintOverlay: React.CSSProperties
  styleOverlay: React.CSSProperties
  toneOverlay: React.CSSProperties
  grainOverlay: React.CSSProperties
  vignette: React.CSSProperties
}

export type PreviewMode = "adjusted" | "original" | "split"

export function getMinZoom(naturalSize: Size): number {
  if (!naturalSize.w || !naturalSize.h) return 0.01
  return Math.max(0.0008, 1 / Math.max(naturalSize.w, naturalSize.h))
}

export function clampZoom(z: number, naturalSize: Size): number {
  return Math.min(MAX_ZOOM, Math.max(getMinZoom(naturalSize), z))
}

export function snapToStep(z: number, direction: "in" | "out", naturalSize: Size): number {
  if (direction === "in") {
    for (const s of ZOOM_STEPS) {
      if (s > z + 0.01) return s
    }
    return clampZoom(z * 1.25, naturalSize)
  } else {
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_STEPS[i] < z - 0.01) return ZOOM_STEPS[i]
    }
    return clampZoom(z / 1.25, naturalSize)
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function aspectRatio(size: Size): number {
  if (!size.w || !size.h) return 0
  return size.w / size.h
}

export function aspectMismatch(a: Size, b: Size, tolerance = 0.03): boolean {
  if (!a.w || !a.h || !b.w || !b.h) return false
  const ratioA = aspectRatio(a)
  const ratioB = aspectRatio(b)
  const baseline = Math.max(ratioA, ratioB, 1)
  return Math.abs(ratioA - ratioB) / baseline > tolerance
}

function paramValue(params: Record<string, number>, key: string, fallback = 0): number {
  const value = params[key]
  return Number.isFinite(value) ? value : fallback
}

const HSL_SATURATION_KEYS = [
  "SaturationAdjustmentRed",
  "SaturationAdjustmentOrange",
  "SaturationAdjustmentYellow",
  "SaturationAdjustmentGreen",
  "SaturationAdjustmentAqua",
  "SaturationAdjustmentBlue",
  "SaturationAdjustmentPurple",
  "SaturationAdjustmentMagenta",
]

function hsla(hue: number, saturation: number, lightness: number, alpha: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360
  return `hsla(${normalizedHue}, ${clamp(saturation, 0, 100)}%, ${clamp(lightness, 0, 100)}%, ${clamp(alpha, 0, 1)})`
}

/**
 * 把 30+ Lightroom 参数粗略映射为浏览器 CSS filter 链
 * 注意：仅近似预览，与导入 Lightroom 实际效果存在偏差。
 */
export function buildPreviewLook(params: Record<string, number>): PreviewLook {
  const exposure = paramValue(params, "Exposure2012")
  const contrastParam = paramValue(params, "Contrast2012")
  const highlights = paramValue(params, "Highlights2012")
  const shadows = paramValue(params, "Shadows2012")
  const whites = paramValue(params, "Whites2012")
  const blacks = paramValue(params, "Blacks2012")
  const texture = paramValue(params, "Texture")
  const clarity = paramValue(params, "Clarity2012")
  const dehaze = paramValue(params, "Dehaze")
  const vibrance = paramValue(params, "Vibrance")
  const saturation = paramValue(params, "Saturation")
  const temperature = paramValue(params, "Temperature", 5500)
  const tint = paramValue(params, "Tint")
  const vignetteAmount = paramValue(params, "PostCropVignetteAmount")
  const grainAmount = paramValue(params, "GrainAmount")
  const splitShadowHue = paramValue(params, "SplitToningShadowHue")
  const splitShadowSat = paramValue(params, "SplitToningShadowSaturation")
  const splitHighlightHue = paramValue(params, "SplitToningHighlightHue")
  const splitHighlightSat = paramValue(params, "SplitToningHighlightSaturation")
  const splitBalance = paramValue(params, "SplitToningBalance")
  const blueSat = paramValue(params, "SaturationAdjustmentBlue")
  const purpleSat = paramValue(params, "SaturationAdjustmentPurple")
  const magentaSat = paramValue(params, "SaturationAdjustmentMagenta")
  const greenSat = paramValue(params, "SaturationAdjustmentGreen")
  const yellowSat = paramValue(params, "SaturationAdjustmentYellow")
  const orangeLum = paramValue(params, "LuminanceAdjustmentOrange")

  const hslSatAverage =
    HSL_SATURATION_KEYS.reduce((sum, key) => sum + paramValue(params, key), 0) / HSL_SATURATION_KEYS.length
  const isBlackWhite = saturation <= -95 || hslSatAverage <= -80

  const brightness = clamp(
    1 + exposure * 0.24 + shadows * 0.0018 + whites * 0.002 + highlights * 0.001,
    0.35,
    2.25
  )
  const contrast = clamp(
    1 + contrastParam * 0.006 + clarity * 0.0022 + texture * 0.001 + dehaze * 0.003 - blacks * 0.0018,
    0.45,
    1.85
  )
  const saturate = isBlackWhite
    ? 0
    : clamp(1 + saturation * 0.006 + vibrance * 0.0045 + hslSatAverage * 0.0024, 0.2, 2.25)
  const tempShift = clamp((temperature - 5500) / 4500, -1, 1)
  const tintShift = clamp(tint / 150, -1, 1)
  const hueRotate = clamp(tint * 0.1 + tempShift * 9, -24, 24)
  const sepia = clamp(Math.abs(tempShift) * 0.1 + Math.max(0, tempShift) * 0.08, 0, 0.24)
  const warmthOpacity = clamp(Math.abs(tempShift) * 0.3, 0, 0.3)
  const tintOpacity = clamp(Math.abs(tintShift) * 0.18, 0, 0.18)
  const vignetteOpacity = clamp((Math.abs(Math.min(0, vignetteAmount)) / 100) * 0.36, 0, 0.36)
  const coolNeon = clamp((Math.max(0, blueSat) + Math.max(0, purpleSat) + Math.max(0, magentaSat)) / 300, 0, 1)
  const mutedGreen = clamp((Math.abs(Math.min(0, greenSat)) + Math.abs(Math.min(0, yellowSat))) / 200, 0, 1)
  const skinLift = clamp(Math.max(0, orangeLum) / 100, 0, 1)
  const styleOverlayOpacity = isBlackWhite ? 0 : clamp(coolNeon * 0.3 + mutedGreen * 0.18 + skinLift * 0.1, 0, 0.34)
  const toneOpacity = isBlackWhite ? 0 : clamp((splitShadowSat + splitHighlightSat) / 170, 0, 0.36)
  const toneBalance = clamp((splitBalance + 100) / 200, 0, 1)
  const grainOpacity = clamp(grainAmount / 100 * 0.22, 0, 0.22)

  return {
    filter: `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) grayscale(${isBlackWhite ? 1 : 0}) hue-rotate(${hueRotate}deg) sepia(${isBlackWhite ? 0 : sepia})`,
    isBlackWhite,
    warmthOverlay: {
      backgroundColor: tempShift >= 0 ? "rgba(255, 157, 74, 1)" : "rgba(86, 151, 255, 1)",
      opacity: isBlackWhite ? 0 : warmthOpacity,
      mixBlendMode: "soft-light",
    },
    tintOverlay: {
      backgroundColor: tintShift >= 0 ? "rgba(236, 92, 210, 1)" : "rgba(73, 214, 135, 1)",
      opacity: isBlackWhite ? 0 : tintOpacity,
      mixBlendMode: "soft-light",
    },
    styleOverlay: {
      background: coolNeon > 0.12
        ? `linear-gradient(135deg, rgba(28, 84, 255, 0.95), rgba(232, 46, 214, 0.8))`
        : `linear-gradient(135deg, rgba(255, 226, 184, 0.9), rgba(130, 168, 122, 0.45))`,
      opacity: styleOverlayOpacity,
      mixBlendMode: coolNeon > 0.12 ? "color" : "soft-light",
    },
    toneOverlay: {
      background: `linear-gradient(180deg, ${hsla(splitHighlightHue, 72, 68, clamp(splitHighlightSat / 100, 0, 0.8))} 0%, rgba(128,128,128,0) ${42 + toneBalance * 16}%, ${hsla(splitShadowHue, 74, 38, clamp(splitShadowSat / 100, 0, 0.8))} 100%)`,
      opacity: toneOpacity,
      mixBlendMode: "soft-light",
    },
    grainOverlay: {
      backgroundImage: [
        "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.65) 0 0.6px, transparent 0.9px)",
        "radial-gradient(circle at 72% 62%, rgba(0,0,0,0.55) 0 0.7px, transparent 1px)",
        "radial-gradient(circle at 45% 82%, rgba(255,255,255,0.45) 0 0.45px, transparent 0.8px)",
      ].join(", "),
      backgroundSize: "7px 7px, 11px 11px, 5px 5px",
      opacity: grainOpacity,
      mixBlendMode: "overlay",
    },
    vignette: {
      background: `radial-gradient(circle at center, transparent 48%, rgba(0,0,0,${vignetteOpacity}) 100%)`,
      opacity: vignetteOpacity > 0 ? 1 : 0,
    },
  }
}

export function adjustedLayerStyle(
  look: PreviewLook,
  mode: PreviewMode,
  splitPercent: number
): React.CSSProperties {
  return {
    filter: look.filter,
    clipPath: mode === "split" ? `inset(0 0 0 ${splitPercent}%)` : undefined,
  }
}
