export interface DiagnosticReport {
  score: {
    total: number
    grade: "S" | "A" | "B" | "C" | "D"
    tag: string
    title: string
    subtitle: string
    confidence: string
    dimensions: {
      label: string
      value: number
      note: string
    }[]
  }
  thinkingSteps: {
    label: string
    completed: boolean
  }[]
  module1: {
    headline: string
    summary: string
    cards: {
      title: string
      value: string
      description: string
      status: "good" | "warning" | "danger"
    }[]
  }
  module2: {
    headline: string
    description: string
    metrics: {
      label: string
      value: string
      note: string
    }[]
    riskItems: {
      label: string
      value: string
      severity: "safe" | "warning" | "danger"
      note: string
    }[]
  }
  module3: {
    headline: string
    description: string
    coreActions: {
      param: string
      value: string
      reason: string
    }[]
  }
}

export interface RawDataPayload {
  file_type: "NEF" | "JPG"
  exif: {
    camera_model?: string
    iso?: number
    shutter?: string
    aperture?: number
    focal_length?: number
  }
  sensor_physics: {
    bit_depth: number
    shadow_survival_rate: number
    highlight_clipping_rate: number
    raw_channel_multipliers?: number[]
    banding_risk: "low" | "medium" | "high"
    black_level?: number
    sensor_white_level?: number
  }
  linear_histogram: number[]
  color_space?: string
  icc_profile?: string
}

const JPEG_ANALYSIS_MAX_EDGE = 1600
const JPEG_UPLOAD_MAX_EDGE = 1920
const JPEG_UPLOAD_QUALITY = 0.86

interface JpegMeta {
  cameraModel?: string
  iso?: number
  shutter?: string
  aperture?: number
  focalLength?: number
  colorSpace: string
  iccProfile: string
}

function formatExposureTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown"
  if (seconds >= 1) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  const denominator = Math.round(1 / seconds)
  if (denominator > 0) return `1/${denominator}`
  return `${seconds.toFixed(4)}s`
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0
  }
  return numerator / denominator
}

function downsampleHistogram(hist256: number[]): number[] {
  const hist64 = new Array(64).fill(0)
  for (let i = 0; i < hist256.length; i++) {
    hist64[Math.floor(i / 4)] += hist256[i]
  }
  return hist64
}

function estimateBandingRisk(hist256: number[]): "low" | "medium" | "high" {
  const nonZeroBins = hist256.filter((v) => v > 0).length
  let longestZeroRun = 0
  let currentZeroRun = 0

  for (const value of hist256) {
    if (value === 0) {
      currentZeroRun += 1
      if (currentZeroRun > longestZeroRun) longestZeroRun = currentZeroRun
    } else {
      currentZeroRun = 0
    }
  }

  const fillRatio = nonZeroBins / hist256.length
  if (fillRatio < 0.4 || longestZeroRun >= 20) return "high"
  if (fillRatio < 0.65 || longestZeroRun >= 10) return "medium"
  return "low"
}

function parseJpegMetadata(buffer: ArrayBuffer): JpegMeta {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { colorSpace: "unknown", iccProfile: "unknown" }
  }

  let offset = 2
  let cameraMake: string | undefined
  let cameraModel: string | undefined
  let iso: number | undefined
  let shutter: string | undefined
  let aperture: number | undefined
  let focalLength: number | undefined
  let exifColorSpace: string | undefined
  let iccProfile = "unknown"

  const readAscii = (segment: Uint8Array, start: number, length: number): string => {
    const end = Math.min(segment.length, start + length)
    const chars: number[] = []
    for (let i = start; i < end; i++) {
      if (segment[i] === 0) break
      chars.push(segment[i])
    }
    return String.fromCharCode(...chars).trim()
  }

  const parseExifSegment = (segment: Uint8Array) => {
    if (segment.length < 8) return
    const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength)
    const byteOrder = String.fromCharCode(segment[0], segment[1])
    const littleEndian = byteOrder === "II"
    if (!littleEndian && byteOrder !== "MM") return
    if (view.getUint16(2, littleEndian) !== 42) return

    const typeSize: Record<number, number> = {
      1: 1,
      2: 1,
      3: 2,
      4: 4,
      5: 8,
    }

    const readEntryValue = (entryOffset: number, type: number, count: number): number[] => {
      const unitSize = typeSize[type]
      if (!unitSize || count <= 0) return []

      const byteCount = unitSize * count
      const valueOffset = byteCount <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, littleEndian)
      if (valueOffset < 0 || valueOffset + byteCount > segment.length) return []

      const values: number[] = []
      for (let i = 0; i < count; i++) {
        const pos = valueOffset + i * unitSize
        if (type === 1 || type === 2) values.push(view.getUint8(pos))
        if (type === 3) values.push(view.getUint16(pos, littleEndian))
        if (type === 4) values.push(view.getUint32(pos, littleEndian))
        if (type === 5) {
          const numerator = view.getUint32(pos, littleEndian)
          const denominator = view.getUint32(pos + 4, littleEndian)
          values.push(safeRatio(numerator, denominator))
        }
      }

      return values
    }

    const parseIfd = (
      ifdOffset: number
    ): Map<number, { type: number; count: number; values: number[]; entryOffset: number }> => {
      const tags = new Map<number, { type: number; count: number; values: number[]; entryOffset: number }>()
      if (ifdOffset <= 0 || ifdOffset + 2 > segment.length) return tags
      const entryCount = view.getUint16(ifdOffset, littleEndian)
      for (let i = 0; i < entryCount; i++) {
        const entryOffset = ifdOffset + 2 + i * 12
        if (entryOffset + 12 > segment.length) break
        const tag = view.getUint16(entryOffset, littleEndian)
        const type = view.getUint16(entryOffset + 2, littleEndian)
        const count = view.getUint32(entryOffset + 4, littleEndian)
        const values = readEntryValue(entryOffset, type, count)
        tags.set(tag, { type, count, values, entryOffset })
      }
      return tags
    }

    const ifd0Offset = view.getUint32(4, littleEndian)
    const ifd0 = parseIfd(ifd0Offset)
    const makeTag = ifd0.get(0x010f)
    const modelTag = ifd0.get(0x0110)
    const exifIfdTag = ifd0.get(0x8769)

    if (makeTag) {
      const makeOffset = makeTag.count <= 4 ? makeTag.entryOffset + 8 : makeTag.values[0]
      if (Number.isFinite(makeOffset)) {
        cameraMake = readAscii(segment, makeOffset, makeTag.count)
      }
    }

    if (modelTag) {
      const modelOffset = modelTag.count <= 4 ? modelTag.entryOffset + 8 : modelTag.values[0]
      if (Number.isFinite(modelOffset)) {
        cameraModel = readAscii(segment, modelOffset, modelTag.count)
      }
    }

    const exifIfdOffset = exifIfdTag?.values[0]
    if (!exifIfdOffset || !Number.isFinite(exifIfdOffset)) return

    const exifIfd = parseIfd(exifIfdOffset)
    const isoTag = exifIfd.get(0x8827)
    const exposureTag = exifIfd.get(0x829a)
    const apertureTag = exifIfd.get(0x829d)
    const focalTag = exifIfd.get(0x920a)
    const colorSpaceTag = exifIfd.get(0xa001)

    if (isoTag?.values[0]) iso = Math.round(isoTag.values[0])
    if (exposureTag?.values[0]) shutter = formatExposureTime(exposureTag.values[0])
    if (apertureTag?.values[0]) aperture = Number(apertureTag.values[0].toFixed(2))
    if (focalTag?.values[0]) focalLength = Number(focalTag.values[0].toFixed(2))
    if (colorSpaceTag?.values[0] === 1) exifColorSpace = "sRGB"
    if (colorSpaceTag?.values[0] === 65535) exifColorSpace = "uncalibrated"
  }

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2
      continue
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3]
    const segmentStart = offset + 4
    const segmentEnd = offset + 2 + segmentLength

    if (segmentLength < 2 || segmentEnd > bytes.length) break

    if (marker === 0xe2) {
      const iccHeader = "ICC_PROFILE\u0000"
      const possibleIcc = String.fromCharCode(...bytes.slice(segmentStart, segmentStart + iccHeader.length))
      if (possibleIcc === iccHeader) {
        iccProfile = "embedded"
      }
    }

    if (marker === 0xe1) {
      const exifHeader = String.fromCharCode(...bytes.slice(segmentStart, segmentStart + 6))
      if (exifHeader === "Exif\u0000\u0000") {
        parseExifSegment(bytes.slice(segmentStart + 6, segmentEnd))
      }
    }

    offset = segmentEnd
  }

  const modelParts = [cameraMake, cameraModel].filter(Boolean)
  const normalizedColorSpace =
    exifColorSpace ?? (iccProfile === "embedded" ? "icc-managed" : "unknown")

  return {
    cameraModel: modelParts.length > 0 ? modelParts.join(" ").trim() : undefined,
    iso,
    shutter,
    aperture,
    focalLength,
    colorSpace: normalizedColorSpace,
    iccProfile,
  }
}

export async function buildJpgDataPayload(file: File): Promise<RawDataPayload> {
  const bitmap = await createImageBitmap(file)

  const maxSide = Math.max(bitmap.width, bitmap.height)
  const scale = maxSide > JPEG_ANALYSIS_MAX_EDGE ? JPEG_ANALYSIS_MAX_EDGE / maxSide : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    throw new Error("无法创建图像分析上下文")
  }

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const { data } = ctx.getImageData(0, 0, width, height)
  const hist256 = new Array<number>(256).fill(0)

  let clippedHighlights = 0
  let deepShadows = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    hist256[luma] += 1

    if (r >= 250 || g >= 250 || b >= 250) clippedHighlights += 1
    if (r <= 5 && g <= 5 && b <= 5) deepShadows += 1

    sumR += r
    sumG += g
    sumB += b
  }

  const totalPixels = width * height
  const highlightClippingRate = clippedHighlights / totalPixels
  const shadowCrushRate = deepShadows / totalPixels
  const shadowSurvivalRate = Math.max(0, 1 - shadowCrushRate)
  const bandingRisk = estimateBandingRisk(hist256)
  const hist64 = downsampleHistogram(hist256)
  const avgR = sumR / totalPixels
  const avgG = sumG / totalPixels
  const avgB = sumB / totalPixels
  const greenBase = avgG > 0 ? avgG : 1
  const channelMultipliers = [avgR / greenBase, 1, avgB / greenBase, 1].map((n) =>
    Number(n.toFixed(4))
  )

  const meta = parseJpegMetadata(await file.arrayBuffer())

  return {
    file_type: "JPG",
    exif: {
      camera_model: meta.cameraModel,
      iso: meta.iso,
      shutter: meta.shutter,
      aperture: meta.aperture,
      focal_length: meta.focalLength,
    },
    sensor_physics: {
      bit_depth: 8,
      shadow_survival_rate: Number(shadowSurvivalRate.toFixed(6)),
      highlight_clipping_rate: Number(highlightClippingRate.toFixed(6)),
      raw_channel_multipliers: channelMultipliers,
      banding_risk: bandingRisk,
      black_level: 0,
      sensor_white_level: 255,
    },
    linear_histogram: hist64,
    color_space: meta.colorSpace,
    icc_profile: meta.iccProfile,
  }
}

export async function buildJpgPreviewBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const maxSide = Math.max(bitmap.width, bitmap.height)
  const scale = maxSide > JPEG_UPLOAD_MAX_EDGE ? JPEG_UPLOAD_MAX_EDGE / maxSide : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    throw new Error("无法创建预览压缩上下文")
  }

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_UPLOAD_QUALITY)
  })

  if (!blob) {
    throw new Error("JPG 预览压缩失败")
  }
  return blob
}

export async function compressPreviewBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const maxSide = Math.max(bitmap.width, bitmap.height)
  const scale = maxSide > JPEG_UPLOAD_MAX_EDGE ? JPEG_UPLOAD_MAX_EDGE / maxSide : 1
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    throw new Error("无法创建预览压缩上下文")
  }

  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const compressed = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_UPLOAD_QUALITY)
  })
  if (!compressed) {
    throw new Error("预览图压缩失败")
  }
  return compressed
}
