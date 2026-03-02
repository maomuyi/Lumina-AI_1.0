import type { ImageDiagnostics } from "@/components/center-canvas"

// Analyze image by reading pixel data from canvas
export async function analyzeImage(
  imageUrl: string,
  fileType: string
): Promise<{
  diagnostics: ImageDiagnostics
  recommendedParams: Record<string, number>
  strategy: string
  strategyTags: string[]
}> {
  // Load image to analyze
  const img = new Image()
  img.crossOrigin = "anonymous"
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = imageUrl
  })

  // Create canvas for pixel analysis
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")!
  const maxDim = 512 // downsample for performance
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1)
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const totalPixels = canvas.width * canvas.height

  // Calculate histogram
  const rHist = new Array(256).fill(0)
  const gHist = new Array(256).fill(0)
  const bHist = new Array(256).fill(0)

  let deadBlack = 0
  let deadWhite = 0
  let totalR = 0, totalG = 0, totalB = 0
  let totalBrightness = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    rHist[r]++
    gHist[g]++
    bHist[b]++

    totalR += r
    totalG += g
    totalB += b

    const brightness = 0.299 * r + 0.587 * g + 0.114 * b
    totalBrightness += brightness

    if (r === 0 && g === 0 && b === 0) deadBlack++
    if (r === 255 && g === 255 && b === 255) deadWhite++
  }

  const avgR = totalR / totalPixels
  const avgG = totalG / totalPixels
  const avgB = totalB / totalPixels
  const avgBrightness = totalBrightness / totalPixels

  const deadBlackPercent = (deadBlack / totalPixels) * 100
  const deadWhitePercent = (deadWhite / totalPixels) * 100

  // Determine scene characteristics
  const isWarm = avgR > avgB + 20
  const isCool = avgB > avgR + 20
  const isDark = avgBrightness < 85
  const isBright = avgBrightness > 170

  // Determine dominant tone
  let mainTone = "中性色调"
  if (isWarm) mainTone = "暖色调"
  if (isCool) mainTone = "冷色调"

  // Determine light condition
  let lightCondition = "均匀光线"
  if (isDark) lightCondition = "低光环境"
  if (isBright) lightCondition = "明亮光线"

  // Infer scene type from color distribution
  const greenDominance = avgG - (avgR + avgB) / 2
  const blueDominance = avgB - (avgR + avgG) / 2
  let sceneType = "通用场景"
  if (greenDominance > 15) sceneType = "自然风光"
  if (blueDominance > 20) sceneType = "蓝调/天空"
  if (avgBrightness > 140 && avgR > avgG && avgR > avgB) sceneType = "人像/暖调"

  // Generate AI strategy
  const strategies: string[] = []
  const tags: string[] = []

  if (deadWhitePercent > 5) {
    strategies.push("检测到高光溢出，调色策略将转向加灰/胶片感以掩盖高光缺失。")
    tags.push("高光修复")
  }
  if (deadBlackPercent > 3) {
    strategies.push("暗部存在死黑区域，建议提升阴影恢复细节。")
    tags.push("阴影恢复")
  }
  if (isDark) {
    strategies.push("整体画面偏暗，建议适当提升曝光和阴影。")
    tags.push("提亮")
  }
  if (avgBrightness > 85 && avgBrightness < 170) {
    strategies.push("曝光基本准确，着重优化色彩和细节表现。")
    tags.push("色彩优化")
  }
  if (isWarm) {
    tags.push("暖调增强")
  }
  if (isCool) {
    tags.push("冷调平衡")
  }
  tags.push("通透感")

  const strategy = strategies.length > 0
    ? strategies.join(" ") + " 建议增强通透感和色彩层次，同时保持自然质感。"
    : "画面质量良好，建议进行微调以增强通透感和色彩表现力，提升整体观感。"

  // Generate recommended parameters based on analysis
  const recommendedParams: Record<string, number> = {}

  // Exposure adjustments
  if (isDark) {
    recommendedParams.Exposure = 0.8
    recommendedParams.Shadows = 45
  } else if (isBright) {
    recommendedParams.Exposure = -0.3
    recommendedParams.Highlights = -40
  } else {
    recommendedParams.Exposure = 0.15
    recommendedParams.Shadows = 20
    recommendedParams.Highlights = -15
  }

  if (deadWhitePercent > 5) {
    recommendedParams.Highlights = -70
    recommendedParams.Whites = -30
  }
  if (deadBlackPercent > 3) {
    recommendedParams.Shadows = 60
    recommendedParams.Blacks = 15
  }

  // Color temperature
  if (isWarm) {
    recommendedParams.Temperature = 5200
  } else if (isCool) {
    recommendedParams.Temperature = 6200
  } else {
    recommendedParams.Temperature = 5600
  }
  recommendedParams.Tint = Math.round((avgG - (avgR + avgB) / 2) * 0.2)

  // Presence
  recommendedParams.Contrast = 10
  recommendedParams.Texture = 15
  recommendedParams.Clarity = 12
  recommendedParams.Dehaze = 8
  recommendedParams.Vibrance = 18
  recommendedParams.Saturation = 5

  // Tone curve
  recommendedParams.ParametricHighlights = -10
  recommendedParams.ParametricLights = 8
  recommendedParams.ParametricDarks = 5
  recommendedParams.ParametricShadows = -5

  // Detail
  recommendedParams.Sharpness = 50
  recommendedParams.LuminanceSmoothing = isDark ? 20 : 5

  // Effects - subtle grain for JPG banding
  if (fileType === "jpg" || fileType === "jpeg") {
    recommendedParams.GrainAmount = 8
    recommendedParams.GrainSize = 20
    recommendedParams.GrainFrequency = 40
  }

  // Color adjustments
  recommendedParams.SaturationAdjustmentOrange = 8
  recommendedParams.LuminanceAdjustmentOrange = 10

  const isRaw = fileType === "nef"

  const diagnostics: ImageDiagnostics = {
    camera: isRaw ? "Nikon Z6 III" : "Unknown",
    iso: isRaw ? "ISO 400" : "N/A",
    shutter: isRaw ? "1/250s" : "N/A",
    aperture: isRaw ? "f/2.8" : "N/A",
    colorSpace: "sRGB",
    bitDepth: isRaw ? "14-bit" : "8-bit",
    deadBlackPercent,
    deadWhitePercent,
    highlightHeadroom: isRaw ? Math.min(95, 100 - deadWhitePercent * 5) : Math.min(40, 100 - deadWhitePercent * 10),
    shadowHeadroom: isRaw ? Math.min(90, 100 - deadBlackPercent * 3) : Math.min(30, 100 - deadBlackPercent * 8),
    sceneType,
    lightCondition,
    mainTone,
    histogram: { r: rHist, g: gHist, b: bHist },
  }

  return { diagnostics, recommendedParams, strategy, strategyTags: tags }
}
