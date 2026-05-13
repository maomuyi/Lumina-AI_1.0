import { getDefaultParams, LIGHTROOM_GROUPS } from "./lightroom-params"

export const REFERENCE_MATCH_DEFAULT_STRENGTH = 70
const ANALYSIS_MAX_EDGE = 512
const ORANGE_CHANNEL_WEIGHT = 0.3

export type ReferenceFileType = "jpg" | "png" | "nef"

export interface ReferenceImageState {
  fileName: string | null
  fileType: ReferenceFileType | null
  previewUrl: string | null
  previewBlob: Blob | null
  status: "idle" | "parsing" | "ready" | "error"
  error?: string
}

export interface ReferenceMatchResult {
  params: Record<string, number>
  changedKeys: string[]
  summary: string
  debugStats: {
    target: ImageColorStats
    reference: ImageColorStats
  }
}

export interface ReferenceBlendResult {
  params: Record<string, number>
  changedKeys: string[]
}

export const EMPTY_REFERENCE_IMAGE: ReferenceImageState = {
  fileName: null,
  fileType: null,
  previewUrl: null,
  previewBlob: null,
  status: "idle",
}

type Lab = {
  l: number
  a: number
  b: number
}

type Hsl = {
  h: number
  s: number
  l: number
}

type ColorBucket =
  | "Red"
  | "Orange"
  | "Yellow"
  | "Green"
  | "Aqua"
  | "Blue"
  | "Purple"
  | "Magenta"

interface ChannelAccumulator {
  count: number
  sumSin: number
  sumCos: number
  sumS: number
  sumL: number
}

export interface HslChannelStats {
  count: number
  ratio: number
  meanHue: number
  meanSaturation: number
  meanLightness: number
}

export interface ImageColorStats {
  pixelCount: number
  lab: {
    mean: Lab
    std: Lab
    percentiles: {
      p05: number
      p20: number
      p50: number
      p80: number
      p95: number
    }
  }
  hsl: {
    meanSaturation: number
    meanLightness: number
    channels: Partial<Record<ColorBucket, HslChannelStats>>
  }
}

const COLOR_BUCKETS: ColorBucket[] = [
  "Red",
  "Orange",
  "Yellow",
  "Green",
  "Aqua",
  "Blue",
  "Purple",
  "Magenta",
]

const HSL_PARAM_PREFIX: Record<ColorBucket, string> = {
  Red: "Red",
  Orange: "Orange",
  Yellow: "Yellow",
  Green: "Green",
  Aqua: "Aqua",
  Blue: "Blue",
  Purple: "Purple",
  Magenta: "Magenta",
}

const DEFAULT_PARAMS = getDefaultParams()
const PARAM_BOUNDS = Object.fromEntries(
  LIGHTROOM_GROUPS.flatMap((group) =>
    group.params.map((param) => [param.key, [param.min, param.max] as const])
  )
) as Record<string, readonly [number, number]>

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function meaningfulDelta(key: string): number {
  if (key === "Temperature") return 35
  if (key === "Exposure2012") return 0.01
  return 0.75
}

function roundParam(key: string, value: number): number {
  if (key === "Temperature") return Math.round(value / 10) * 10
  if (key === "Exposure2012") return round(value, 2)
  if (key === "SharpenRadius") return round(value, 1)
  return Math.round(value)
}

export function clampLightroomParam(key: string, value: number): number {
  const [min, max] = PARAM_BOUNDS[key] ?? [-100, 100]
  return roundParam(key, clamp(value, min, max))
}

function setParam(params: Record<string, number>, key: string, value: number): void {
  const clamped = clampLightroomParam(key, value)
  const baseline = DEFAULT_PARAMS[key] ?? 0
  if (Math.abs(clamped - baseline) < meaningfulDelta(key)) return
  params[key] = clamped
}

function srgbChannelToLinear(value: number): number {
  const normalized = clamp(value, 0, 255) / 255
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4
}

function labPivot(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116)
}

export function srgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbChannelToLinear(r)
  const lg = srgbChannelToLinear(g)
  const lb = srgbChannelToLinear(b)

  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / 1.00000
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883

  const fx = labPivot(x)
  const fy = labPivot(y)
  const fz = labPivot(z)

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = clamp(r, 0, 255) / 255
  const gn = clamp(g, 0, 255) / 255
  const bn = clamp(b, 0, 255) / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness }
  }

  const saturation = delta / (1 - Math.abs((2 * lightness) - 1))
  let hue = 0
  if (max === rn) hue = 60 * (((gn - bn) / delta) % 6)
  if (max === gn) hue = 60 * (((bn - rn) / delta) + 2)
  if (max === bn) hue = 60 * (((rn - gn) / delta) + 4)
  if (hue < 0) hue += 360

  return { h: hue, s: saturation, l: lightness }
}

export function bucketHue(hue: number): ColorBucket {
  const normalized = ((hue % 360) + 360) % 360
  if (normalized < 15 || normalized >= 345) return "Red"
  if (normalized < 45) return "Orange"
  if (normalized < 75) return "Yellow"
  if (normalized < 165) return "Green"
  if (normalized < 195) return "Aqua"
  if (normalized < 255) return "Blue"
  if (normalized < 285) return "Purple"
  return "Magenta"
}

function circularHueDiff(referenceHue: number, targetHue: number): number {
  let diff = referenceHue - targetHue
  while (diff > 180) diff -= 360
  while (diff < -180) diff += 360
  return diff
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 50
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1)
  return sorted[index]
}

function emptyChannelAccumulators(): Record<ColorBucket, ChannelAccumulator> {
  return Object.fromEntries(
    COLOR_BUCKETS.map((bucket) => [
      bucket,
      { count: 0, sumSin: 0, sumCos: 0, sumS: 0, sumL: 0 },
    ])
  ) as Record<ColorBucket, ChannelAccumulator>
}

async function imageDataFromBlob(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })
  const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error("无法创建参考图色彩分析上下文")
  }

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return ctx.getImageData(0, 0, width, height)
}

export async function extractImageColorStats(blob: Blob): Promise<ImageColorStats> {
  const imageData = await imageDataFromBlob(blob)
  const { data } = imageData
  const lValues: number[] = []
  const channelAcc = emptyChannelAccumulators()

  let pixelCount = 0
  let sumL = 0
  let sumA = 0
  let sumB = 0
  let sumL2 = 0
  let sumA2 = 0
  let sumB2 = 0
  let sumS = 0
  let sumHslL = 0

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 16) continue

    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const lab = srgbToLab(r, g, b)
    const hsl = rgbToHsl(r, g, b)
    const bucket = bucketHue(hsl.h)
    const radians = (hsl.h * Math.PI) / 180

    pixelCount += 1
    sumL += lab.l
    sumA += lab.a
    sumB += lab.b
    sumL2 += lab.l * lab.l
    sumA2 += lab.a * lab.a
    sumB2 += lab.b * lab.b
    sumS += hsl.s
    sumHslL += hsl.l
    lValues.push(lab.l)

    channelAcc[bucket].count += 1
    channelAcc[bucket].sumSin += Math.sin(radians)
    channelAcc[bucket].sumCos += Math.cos(radians)
    channelAcc[bucket].sumS += hsl.s
    channelAcc[bucket].sumL += hsl.l
  }

  if (pixelCount === 0) {
    throw new Error("参考图没有可分析的像素")
  }

  lValues.sort((a, b) => a - b)
  const mean = {
    l: sumL / pixelCount,
    a: sumA / pixelCount,
    b: sumB / pixelCount,
  }

  const channels: Partial<Record<ColorBucket, HslChannelStats>> = {}
  for (const bucket of COLOR_BUCKETS) {
    const acc = channelAcc[bucket]
    if (acc.count === 0) continue
    let meanHue = (Math.atan2(acc.sumSin, acc.sumCos) * 180) / Math.PI
    if (meanHue < 0) meanHue += 360
    channels[bucket] = {
      count: acc.count,
      ratio: acc.count / pixelCount,
      meanHue,
      meanSaturation: acc.sumS / acc.count,
      meanLightness: acc.sumL / acc.count,
    }
  }

  return {
    pixelCount,
    lab: {
      mean,
      std: {
        l: Math.sqrt(Math.max(0, (sumL2 / pixelCount) - (mean.l * mean.l))),
        a: Math.sqrt(Math.max(0, (sumA2 / pixelCount) - (mean.a * mean.a))),
        b: Math.sqrt(Math.max(0, (sumB2 / pixelCount) - (mean.b * mean.b))),
      },
      percentiles: {
        p05: percentile(lValues, 0.05),
        p20: percentile(lValues, 0.20),
        p50: percentile(lValues, 0.50),
        p80: percentile(lValues, 0.80),
        p95: percentile(lValues, 0.95),
      },
    },
    hsl: {
      meanSaturation: sumS / pixelCount,
      meanLightness: sumHslL / pixelCount,
      channels,
    },
  }
}

export function buildReferenceMatchParamsFromStats(
  target: ImageColorStats,
  reference: ImageColorStats
): Record<string, number> {
  const params: Record<string, number> = {}
  const meanDiffL = reference.lab.mean.l - target.lab.mean.l
  const stdDiffL = reference.lab.std.l - target.lab.std.l
  const diffA = reference.lab.mean.a - target.lab.mean.a
  const diffB = reference.lab.mean.b - target.lab.mean.b
  const refP = reference.lab.percentiles
  const targetP = target.lab.percentiles
  const saturationDiff = (reference.hsl.meanSaturation - target.hsl.meanSaturation) * 100

  setParam(params, "Exposure2012", meanDiffL / 45)
  setParam(params, "Contrast2012", stdDiffL * 2.3)
  setParam(params, "Temperature", 5500 + (diffB * 95))
  setParam(params, "Tint", diffA * 1.15)
  setParam(params, "Highlights2012", (refP.p95 - targetP.p95) * 1.1)
  setParam(params, "Shadows2012", (refP.p20 - targetP.p20) * 0.9)
  setParam(params, "Whites2012", ((refP.p80 - targetP.p80) * 0.75) + ((refP.p95 - targetP.p95) * 0.25))
  setParam(params, "Blacks2012", (refP.p05 - targetP.p05) * 1.15)
  setParam(params, "Vibrance", saturationDiff * 0.9)
  setParam(params, "Saturation", saturationDiff * 0.45)

  for (const bucket of COLOR_BUCKETS) {
    const targetChannel = target.hsl.channels[bucket]
    const referenceChannel = reference.hsl.channels[bucket]
    if (!targetChannel || !referenceChannel) continue
    if (targetChannel.ratio < 0.003 || targetChannel.count < 16) continue

    const prefix = HSL_PARAM_PREFIX[bucket]
    const weight = bucket === "Orange" ? ORANGE_CHANNEL_WEIGHT : 1
    const hueShift = circularHueDiff(referenceChannel.meanHue, targetChannel.meanHue) * 0.8 * weight
    const saturationShift = (referenceChannel.meanSaturation - targetChannel.meanSaturation) * 100 * 0.85 * weight
    const luminanceShift = (referenceChannel.meanLightness - targetChannel.meanLightness) * 100 * 0.7 * weight

    setParam(params, `HueAdjustment${prefix}`, hueShift)
    setParam(params, `SaturationAdjustment${prefix}`, saturationShift)
    setParam(params, `LuminanceAdjustment${prefix}`, luminanceShift)
  }

  return params
}

function buildSummary(matchParams: Record<string, number>): string {
  const keys = Object.keys(matchParams)
  const hslCount = keys.filter((key) => /^(Hue|Saturation|Luminance)Adjustment/.test(key)).length
  const hasWhiteBalance = "Temperature" in matchParams || "Tint" in matchParams
  const hasTone = keys.some((key) =>
    ["Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012"].includes(key)
  )
  const parts = [
    hasWhiteBalance ? "白平衡" : null,
    hasTone ? "光影层次" : null,
    hslCount > 0 ? `${hslCount} 个 HSL 通道` : null,
  ].filter(Boolean)

  return parts.length > 0
    ? `已在本地提取参考图色彩特征，并生成 ${parts.join("、")} 的追色参数；橙色肤色通道按 30% 强度保护。`
    : "参考图与目标图色彩差异较小，本轮没有生成明显追色参数。"
}

export async function analyzeReferenceColorMatch(
  targetBlob: Blob,
  referenceBlob: Blob
): Promise<ReferenceMatchResult> {
  const [target, reference] = await Promise.all([
    extractImageColorStats(targetBlob),
    extractImageColorStats(referenceBlob),
  ])
  const params = buildReferenceMatchParamsFromStats(target, reference)
  const changedKeys = Object.keys(params).sort()

  return {
    params,
    changedKeys,
    summary: buildSummary(params),
    debugStats: { target, reference },
  }
}

export function blendReferenceMatchParams(
  baseParams: Record<string, number>,
  matchParams: Record<string, number>,
  strengthPercent: number
): ReferenceBlendResult {
  const strength = clamp(strengthPercent, 0, 100) / 100
  const params = { ...baseParams }
  const changedKeys: string[] = []

  if (strength <= 0) {
    return { params, changedKeys }
  }

  for (const [key, matchValue] of Object.entries(matchParams)) {
    if (!Number.isFinite(matchValue)) continue
    const baseValue = Number.isFinite(baseParams[key])
      ? baseParams[key]
      : DEFAULT_PARAMS[key]
    if (!Number.isFinite(baseValue)) continue

    const blended = clampLightroomParam(key, (baseValue * (1 - strength)) + (matchValue * strength))
    params[key] = blended

    if (Math.abs(blended - baseValue) >= meaningfulDelta(key)) {
      changedKeys.push(key)
    }
  }

  return { params, changedKeys: changedKeys.sort() }
}
