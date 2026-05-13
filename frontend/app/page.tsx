"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { TopToolbar } from "@/components/top-toolbar"
import { LeftSidebar } from "@/components/left-sidebar"
import { CenterCanvas, type ImageDiagnostics } from "@/components/center-canvas"
import { RightPanel } from "@/components/right-panel"
import { getDefaultParams } from "@/lib/lightroom-params"
import {
  buildJpgDataPayload,
  buildJpgPreviewBlob,
  compressPreviewBlob,
  type DiagnosticReport,
  type RawDataPayload,
} from "@/lib/image-analysis"
import {
  analyzeReferenceColorMatch,
  blendReferenceMatchParams,
  EMPTY_REFERENCE_IMAGE,
  REFERENCE_MATCH_DEFAULT_STRENGTH,
  type ReferenceFileType,
  type ReferenceImageState,
} from "@/lib/reference-color-match"
import {
  analyzeWithSSE,
  refineWithSSE,
  generateXmp,
  getDownloadUrl,
  type SSEFinalEvent,
  type SSEProgressEvent,
} from "@/lib/api"
import {
  appendRefineVersion,
  createRefineHistory,
  diffNumericParams,
  getChildVersionId,
  getCurrentRefineVersion,
  getForwardVersionId,
  getNextRefineVersionId,
  getParentVersionId,
  getVersionDownloadUrl,
  getVersionReport,
  loadRefineHistory,
  rebuildParamsForVersion,
  saveRefineHistory,
  setCurrentRefineVersion,
  updateHistoryScene,
  type ChangedParam,
  type RefineHistoryState,
} from "@/lib/refine-history"
import { useRawParser } from "@/hooks/useRawParser"
import { Toaster, toast } from "sonner"

const DEFAULT_QUICK_CHIPS = [
  "高光再压一点",
  "暗部更通透",
  "整体更自然",
  "对比强一点",
]

type AnalysisEngine = "local" | "api" | null
type AssistantRunStatus = {
  status: "idle" | "running" | "error"
  targetVersionId: string | null
  prompt: string
  message: string
  progress: number
  stage: number
  events: string[]
  lastError: string | null
}

const IDLE_ASSISTANT_RUN_STATUS: AssistantRunStatus = {
  status: "idle",
  targetVersionId: null,
  prompt: "",
  message: "",
  progress: 0,
  stage: 0,
  events: [],
  lastError: null,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((sum, n) => sum + n, 0) / arr.length
}

function numericParamsFromFinal(data: SSEFinalEvent): Record<string, number> {
  return Object.fromEntries(
    Object.entries(data.lightroom_params).filter(([, value]) => typeof value === "number")
  ) as Record<string, number>
}

function paramsWithDefaults(data: SSEFinalEvent): Record<string, number> {
  return {
    ...getDefaultParams(),
    ...numericParamsFromFinal(data),
  }
}

function modifiedKeysFromParams(params: Record<string, number>): Set<string> {
  return new Set(Object.keys(params))
}

function normalizedChangedParams(
  data: SSEFinalEvent,
  before: Record<string, number>,
  after: Record<string, number>
): ChangedParam[] {
  const fromBackend = data.changed_params?.filter((item) =>
    Number.isFinite(item.before) && Number.isFinite(item.after)
  ) ?? []

  if (fromBackend.length > 0) return fromBackend
  return diffNumericParams(before, after)
}

function reportSummaryFromFinal(data: SSEFinalEvent): string {
  if (data.report_summary?.trim()) return data.report_summary.trim()
  return data.diagnostic_report.module_3_strategy
    .replace("【💡 美化建议】", "")
    .trim()
}

function scoreTag(total: number): string {
  return total >= 90 ? "高潜力素材" :
    total >= 80 ? "专业可调" :
      total >= 70 ? "稳妥可调" :
        total >= 62 ? "谨慎调整" : "高风险素材"
}

function computeEditabilityScore(
  rawPayload: RawDataPayload,
  coreActionCount: number
): DiagnosticReport["score"] {
  const sp = rawPayload.sensor_physics
  const isRaw = rawPayload.file_type === "NEF"
  const hist = rawPayload.linear_histogram ?? []
  const totalHist = Math.max(1, hist.reduce((sum, v) => sum + v, 0))
  const leftTail = hist.slice(0, Math.min(3, hist.length)).reduce((sum, v) => sum + v, 0) / totalHist
  const rightTail = hist.slice(Math.max(0, hist.length - 3)).reduce((sum, v) => sum + v, 0) / totalHist
  const peakIdx = hist.length
    ? hist.reduce((best, val, idx) => (val > hist[best] ? idx : best), 0)
    : 0
  const peakNorm = hist.length > 1 ? peakIdx / (hist.length - 1) : 0.5

  const clipPenalty = clamp(sp.highlight_clipping_rate * 1200, 0, 55)
  const shadowPenalty = clamp((1 - sp.shadow_survival_rate) * 800, 0, 35)
  const bitDepthPenalty = sp.bit_depth <= 8 ? 12 : sp.bit_depth <= 10 ? 6 : 0
  const highlightShadow = clamp(100 - clipPenalty - shadowPenalty - bitDepthPenalty, 0, 100)

  const tailPenalty = clamp((leftTail + rightTail) * 900, 0, 40)
  const imbalancePenalty = clamp(Math.abs(peakNorm - 0.5) * 60, 0, 20)
  const exposureStability = clamp(100 - tailPenalty - imbalancePenalty, 0, 100)

  const multipliers = sp.raw_channel_multipliers ?? []
  const hasChannels = multipliers.length >= 3
  const wbDeviation = hasChannels ? avg([Math.abs(multipliers[0] - 1), Math.abs(multipliers[2] - 1)]) : 0.5
  const wbPenalty = clamp(wbDeviation * 70, 0, 35)
  const gamutPenalty = (rawPayload.color_space === "unknown" ? 8 : 0) + (rawPayload.icc_profile === "unknown" ? 5 : 0)
  const colorStability = clamp(100 - wbPenalty - gamutPenalty, 0, 100)

  const iso = rawPayload.exif.iso ?? 200
  const isoPenalty =
    iso >= 6400 ? 30 :
      iso >= 3200 ? 22 :
        iso >= 1600 ? 14 :
          iso >= 800 ? 8 : 0
  const bandingPenalty =
    sp.banding_risk === "high" ? 25 :
      sp.banding_risk === "medium" ? 10 : 0
  const jpgPenalty = rawPayload.file_type === "JPG" ? 6 : 0
  const imageQualityRisk = clamp(100 - isoPenalty - bandingPenalty - jpgPenalty, 0, 100)

  const actionability = clamp(60 + coreActionCount * 3, 0, 100)
  const total = Math.round(clamp(
    0.4 * highlightShadow +
    0.24 * exposureStability +
    0.18 * colorStability +
    0.15 * imageQualityRisk +
    0.03 * actionability,
    0,
    100
  ))

  const grade: "S" | "A" | "B" | "C" | "D" =
    total >= 92 ? "S" :
      total >= 84 ? "A" :
      total >= 74 ? "B" :
        total >= 62 ? "C" : "D"

  return {
    total,
    grade,
    tag: scoreTag(total),
    title: "底片可调潜力",
    subtitle: "基于底片数据与调色风险，不代表最终成片审美",
    confidence: isRaw ? "RAW 高可信" : "JPG 参考级",
    dimensions: [
      {
        label: "光影余量",
        value: Math.round(highlightShadow),
        note: isRaw
          ? `高光溢出 ${(sp.highlight_clipping_rate * 100).toFixed(1)}%，暗部存活 ${(sp.shadow_survival_rate * 100).toFixed(1)}%，${sp.bit_depth}-bit。`
          : `基于 JPG 亮部/暗部像素统计，非 RAW 物理宽容度。`,
      },
      {
        label: "曝光稳定性",
        value: Math.round(exposureStability),
        note: `直方图尾部 ${((leftTail + rightTail) * 100).toFixed(1)}%，主峰 ${(peakNorm * 100).toFixed(0)}%。`,
      },
      {
        label: "色彩稳定性",
        value: Math.round(colorStability),
        note: hasChannels
          ? `通道偏移 ${(wbDeviation * 100).toFixed(1)}%，色彩信息 ${rawPayload.color_space ?? "unknown"}。`
          : `缺少可靠通道倍率，色彩稳定性按保守值估计。`,
      },
      {
        label: "画质风险",
        value: Math.round(imageQualityRisk),
        note: isRaw
          ? `ISO ${iso}，断层风险 ${sp.banding_risk}。`
          : `ISO ${iso}，断层风险 ${sp.banding_risk}，包含 JPG 压缩惩罚。`,
      },
    ],
  }
}

function withReferenceMatchReport(
  report: DiagnosticReport,
  summary: string,
  strength: number,
  changedCount: number
): DiagnosticReport {
  return {
    ...report,
    thinkingSteps: [
      ...report.thinkingSteps,
      {
        label: `本地参考图追色：已提取 LAB/HSL 特征并融合 ${strength}% 强度`,
        completed: true,
      },
    ],
    module3: {
      ...report.module3,
      description: `${report.module3.description}\n参考图追色：${summary}`,
      coreActions: [
        {
          param: "ReferenceMatch",
          value: `${strength}% / ${changedCount}项`,
          reason: summary,
        },
        ...report.module3.coreActions,
      ],
    },
  }
}

export default function HomePage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileType, setFileType] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<File | null>(null)

  const [selectedPlatform, setSelectedPlatform] = useState("lightroom")
  const [selectedStyle, setSelectedStyle] = useState("auto")
  const [userIntent, setUserIntent] = useState("")
  const [referenceImage, setReferenceImage] = useState<ReferenceImageState>(EMPTY_REFERENCE_IMAGE)
  const [referenceMatchStrength, setReferenceMatchStrength] = useState(REFERENCE_MATCH_DEFAULT_STRENGTH)

  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisStage, setAnalysisStage] = useState<{
    stage: number
    message: string
  } | null>(null)
  const [analysisEvents, setAnalysisEvents] = useState<string[]>([])
  const [diagnostics, setDiagnostics] = useState<ImageDiagnostics | null>(null)

  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [aiRecommendedParams, setAiRecommendedParams] = useState<Record<string, number> | null>(null)
  const [aiModifiedKeys, setAiModifiedKeys] = useState<Set<string>>(new Set())
  const [params, setParams] = useState<Record<string, number>>(getDefaultParams())

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [isGeneratingXmp, setIsGeneratingXmp] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [refineHistory, setRefineHistory] = useState<RefineHistoryState | null>(null)
  const [analysisRawPayload, setAnalysisRawPayload] = useState<RawDataPayload | null>(null)
  const [analysisEngine, setAnalysisEngine] = useState<AnalysisEngine>(null)
  const [assistantRunStatus, setAssistantRunStatus] = useState<AssistantRunStatus>(IDLE_ASSISTANT_RUN_STATUS)

  const rawParser = useRawParser()
  const referenceRawParser = useRawParser()
  const streamedTextRef = useRef("")
  const lastParserErrorRef = useRef<string | null>(null)
  const uploadedFileUrlRef = useRef<string | null>(null)
  const nefPreviewUrlRef = useRef<string | null>(null)
  const referencePreviewUrlRef = useRef<string | null>(null)

  const revokeReferencePreviewUrl = useCallback(() => {
    if (!referencePreviewUrlRef.current) return
    URL.revokeObjectURL(referencePreviewUrlRef.current)
    referencePreviewUrlRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      if (uploadedFileUrlRef.current) URL.revokeObjectURL(uploadedFileUrlRef.current)
      if (nefPreviewUrlRef.current) URL.revokeObjectURL(nefPreviewUrlRef.current)
      if (referencePreviewUrlRef.current) URL.revokeObjectURL(referencePreviewUrlRef.current)
    }
  }, [])

  useEffect(() => {
    if (fileType !== "nef") return
    if (rawParser.state !== "done" || !rawParser.result?.previewObjectUrl) return

    if (nefPreviewUrlRef.current && nefPreviewUrlRef.current !== rawParser.result.previewObjectUrl) {
      URL.revokeObjectURL(nefPreviewUrlRef.current)
    }
    nefPreviewUrlRef.current = rawParser.result.previewObjectUrl
    setImageUrl(rawParser.result.previewObjectUrl)
  }, [fileType, rawParser.state, rawParser.result])

  useEffect(() => {
    if (!rawParser.error || rawParser.error === lastParserErrorRef.current) return
    lastParserErrorRef.current = rawParser.error
    toast.error("RAW 解析失败", { description: rawParser.error })
  }, [rawParser.error])

  useEffect(() => {
    if (referenceImage.status !== "parsing" || referenceImage.fileType !== "nef") return
    if (referenceRawParser.state !== "error") return

    const message = referenceRawParser.error ?? "参考 RAW 解析失败"
    setReferenceImage((prev) => ({
      ...prev,
      status: "error",
      error: message,
    }))
    toast.error("参考图解析失败", { description: message })
  }, [referenceImage.status, referenceImage.fileType, referenceRawParser.state, referenceRawParser.error])

  useEffect(() => {
    if (referenceImage.status !== "parsing" || referenceImage.fileType !== "nef") return
    if (referenceRawParser.state !== "done" || !referenceRawParser.result) return

    let cancelled = false
    const previewUrl = referenceRawParser.result.previewObjectUrl

    async function finishReferenceRawPreview() {
      if (!previewUrl) {
        throw new Error("参考 RAW 未提取到可用于追色的预览图")
      }

      const response = await fetch(previewUrl)
      const previewBlob = await response.blob()
      if (cancelled) return

      referencePreviewUrlRef.current = previewUrl
      setReferenceImage((prev) => ({
        ...prev,
        previewUrl,
        previewBlob,
        status: "ready",
        error: undefined,
      }))
      toast.success("参考图已加载", { description: referenceImage.fileName ?? "RAW 参考图" })
    }

    void finishReferenceRawPreview().catch((err) => {
      if (cancelled) return
      const message = err instanceof Error ? err.message : "参考 RAW 解析失败"
      setReferenceImage((prev) => ({
        ...prev,
        status: "error",
        error: message,
      }))
      toast.error("参考图解析失败", { description: message })
    })

    return () => {
      cancelled = true
    }
  }, [
    referenceImage.status,
    referenceImage.fileType,
    referenceImage.fileName,
    referenceRawParser.state,
    referenceRawParser.result,
  ])

  useEffect(() => {
    if (!sessionId || refineHistory?.sessionId === sessionId) return
    let cancelled = false

    loadRefineHistory(sessionId)
      .then((history) => {
        if (cancelled || !history) return
        const restoredParams = rebuildParamsForVersion(history)
        const currentVersion = getCurrentRefineVersion(history)
        setRefineHistory(history)
        setParams(restoredParams)
        setReport(getVersionReport(history) as DiagnosticReport | null)
        setAiRecommendedParams(restoredParams)
        setAiModifiedKeys(
          currentVersion
            ? new Set(currentVersion.changedParams.map((item) => item.key))
            : modifiedKeysFromParams(history.baseVersion.params)
        )
        setDownloadUrl(getVersionDownloadUrl(history))
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [sessionId, refineHistory?.sessionId])

  const handleFileUpload = useCallback(
    (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || ""
      if (!["jpg", "jpeg", "nef"].includes(ext)) {
        toast.error("不支持的文件格式", {
          description: "请上传 JPG 或 NEF 格式的文件",
        })
        return
      }

      if (file.size > 50 * 1024 * 1024) {
        toast.error("文件过大", {
          description: "单文件最大 50MB",
        })
        return
      }

      if (uploadedFileUrlRef.current) {
        URL.revokeObjectURL(uploadedFileUrlRef.current)
        uploadedFileUrlRef.current = null
      }
      if (nefPreviewUrlRef.current) {
        URL.revokeObjectURL(nefPreviewUrlRef.current)
        nefPreviewUrlRef.current = null
      }

      setDiagnostics(null)
      setReport(null)
      setAiRecommendedParams(null)
      setAiModifiedKeys(new Set())
      setParams(getDefaultParams())
      setDownloadUrl(null)
      setSessionId(null)
      setRefineHistory(null)
      setAnalysisRawPayload(null)
      setAnalysisEngine(null)
      setAnalysisStage(null)
      setAnalysisEvents([])
      setAnalysisProgress(0)
      setIsAnalyzing(false)
      setAssistantRunStatus(IDLE_ASSISTANT_RUN_STATUS)
      rawParser.reset()

      setFileName(file.name)
      setFileType(ext === "jpeg" ? "jpg" : ext)
      setCurrentFile(file)

      if (ext === "nef") {
        setImageUrl(null)
        if (!rawParser.wasmAvailable && rawParser.wasmChecked) {
          toast.error("NEF 解析不可用", {
            description: "缺少 /wasm/raw_analyzer.js，请先执行 frontend/wasm/build.sh",
          })
        } else {
          rawParser.parse(file)
        }
      } else {
        const url = URL.createObjectURL(file)
        uploadedFileUrlRef.current = url
        setImageUrl(url)
      }

      toast.success("文件已加载", {
        description: file.name,
      })
    },
    [rawParser]
  )

  const handleReferenceRemove = useCallback(() => {
    revokeReferencePreviewUrl()
    referenceRawParser.reset()
    setReferenceImage(EMPTY_REFERENCE_IMAGE)
  }, [referenceRawParser, revokeReferencePreviewUrl])

  const handleReferenceFileUpload = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || ""
      if (!["jpg", "jpeg", "png", "nef"].includes(ext)) {
        toast.error("不支持的参考图格式", {
          description: "参考图支持 JPG / PNG / NEF",
        })
        return
      }

      if (file.size > 50 * 1024 * 1024) {
        toast.error("参考图过大", {
          description: "单文件最大 50MB",
        })
        return
      }

      const fileType = (ext === "jpeg" ? "jpg" : ext) as ReferenceFileType
      revokeReferencePreviewUrl()
      referenceRawParser.reset()
      setReferenceImage({
        fileName: file.name,
        fileType,
        previewUrl: null,
        previewBlob: null,
        status: "parsing",
      })

      if (fileType === "nef") {
        if (!referenceRawParser.wasmAvailable && referenceRawParser.wasmChecked) {
          const message = "NEF 参考图解析不可用：缺少 /wasm/raw_analyzer.js"
          setReferenceImage({
            fileName: file.name,
            fileType,
            previewUrl: null,
            previewBlob: null,
            status: "error",
            error: message,
          })
          toast.error("参考图解析失败", { description: message })
          return
        }

        referenceRawParser.parse(file)
        return
      }

      const previewUrl = URL.createObjectURL(file)
      referencePreviewUrlRef.current = previewUrl

      try {
        const bitmap = await createImageBitmap(file)
        bitmap.close()
        setReferenceImage({
          fileName: file.name,
          fileType,
          previewUrl,
          previewBlob: file,
          status: "ready",
        })
        toast.success("参考图已加载", { description: file.name })
      } catch (err) {
        revokeReferencePreviewUrl()
        const message = err instanceof Error ? err.message : "参考图无法读取"
        setReferenceImage({
          fileName: file.name,
          fileType,
          previewUrl: null,
          previewBlob: null,
          status: "error",
          error: message,
        })
        toast.error("参考图解析失败", { description: message })
      }
    },
    [
      referenceRawParser,
      revokeReferencePreviewUrl,
    ]
  )

  const buildRawDataPayload = useCallback(async (): Promise<RawDataPayload> => {
    if (fileType === "nef") {
      if (rawParser.state !== "done" || !rawParser.result) {
        throw new Error("NEF 解析未完成，请等待 RAW 解析结束")
      }

      const r = rawParser.result
      return {
        file_type: "NEF",
        exif: {
          camera_model: `${r.exif.camera_make} ${r.exif.camera_model}`.trim(),
          iso: r.exif.iso,
          shutter: r.exif.shutter,
          aperture: r.exif.aperture,
          focal_length: r.exif.focal_length,
        },
        sensor_physics: {
          bit_depth: r.physics.bit_depth,
          shadow_survival_rate: r.physics.shadow_survival_rate,
          highlight_clipping_rate: r.physics.highlight_clipping_rate,
          raw_channel_multipliers: r.physics.raw_channel_multipliers,
          banding_risk: r.physics.banding_risk,
          black_level: r.physics.black_level,
          sensor_white_level: r.physics.sensor_white_level,
        },
        linear_histogram: r.histogram64.histogram,
      }
    }

    if (!currentFile) {
      throw new Error("未找到 JPG 文件")
    }
    return buildJpgDataPayload(currentFile)
  }, [fileType, rawParser.state, rawParser.result, currentFile])

  const convertToDiagnosticReport = useCallback(
    (data: SSEFinalEvent, rawPayload: RawDataPayload): { diagnostics: ImageDiagnostics; report: DiagnosticReport } => {
      const dr = data.diagnostic_report
      const sp = rawPayload.sensor_physics
      const exifData = rawPayload.exif
      const isRaw = rawPayload.file_type === "NEF"
      const clippingRate = sp.highlight_clipping_rate ?? 0.02
      const survivalRate = sp.shadow_survival_rate ?? 0.85
      const histogramBase = isRaw && rawParser.result
        ? rawParser.result.histogram256.histogram
        : rawPayload.linear_histogram

      const diagnostics: ImageDiagnostics = {
        camera: exifData.camera_model ?? (isRaw ? "Unknown RAW" : "Unknown"),
        iso: exifData.iso ? `ISO ${exifData.iso}` : "N/A",
        shutter: exifData.shutter ?? "N/A",
        aperture: exifData.aperture ? `f/${exifData.aperture}` : "N/A",
        colorSpace: rawPayload.color_space ?? "unknown",
        bitDepth: `${sp.bit_depth}-bit`,
        deadBlackPercent: (1 - survivalRate) * 100,
        deadWhitePercent: clippingRate * 100,
        highlightHeadroom: isRaw
          ? Math.min(95, 100 - clippingRate * 500)
          : Math.min(40, 100 - clippingRate * 1000),
        shadowHeadroom: isRaw
          ? Math.min(90, survivalRate * 100)
          : Math.min(35, survivalRate * 50),
        sceneType: "AI 识别",
        lightCondition: "AI 分析",
        mainTone: "AI 判定",
        histogram: histogramBase.length
          ? { r: histogramBase, g: histogramBase, b: histogramBase }
          : null,
      }

      const report: DiagnosticReport = {
        score: computeEditabilityScore(rawPayload, dr.module_4_core_actions.length),
        thinkingSteps: [
          {
            label: isRaw
              ? `提取 RAW 底层数据：已读取${sp.bit_depth}-bit数据并分析线性直方图`
              : "读取 JPG 预览图：已提取亮度直方图与压缩特征",
            completed: true,
          },
          {
            label: isRaw
              ? "检测 RAW 光影余量：已扫描高光溢出与暗部存活"
              : "识别 JPG 视觉风险：已估计亮部溢出、暗部压缩与断层倾向",
            completed: true,
          },
          { label: "识别视觉语义：结合你的意图生成参数策略", completed: true },
        ],
        module1: {
          headline: dr.module_1_diagnosis
            .replace("【🖼 画面诊断】", "")
            .replace("【🖼️ 画面诊断】", ""),
          summary: dr.module_2_physics.replace("【🔬 底层剖析】", ""),
          cards: [
            {
              title: "底片潜能",
              value: isRaw ? "优秀" : "可用",
              description: isRaw
                ? "RAW 数据完整，动态范围更大"
                : "JPG 已压缩，保守调整更安全",
              status: isRaw ? "good" : "warning",
            },
            {
              title: "高光安全",
              value: clippingRate < 0.05 ? "安全" : "风险",
              description: `溢出率 ${(clippingRate * 100).toFixed(1)}%`,
              status: clippingRate < 0.05 ? "good" : clippingRate < 0.1 ? "warning" : "danger",
            },
            {
              title: "暗部质量",
              value: survivalRate > 0.95 ? "优异" : survivalRate > 0.85 ? "良好" : "受损",
              description: `存活率 ${(survivalRate * 100).toFixed(1)}%`,
              status: survivalRate > 0.95 ? "good" : survivalRate > 0.85 ? "warning" : "danger",
            },
          ],
        },
        module2: {
          headline: isRaw ? "RAW 底层数据剖析" : "JPG 视觉/压缩特征",
          description: dr.module_2_physics.replace("【🔬 底层剖析】", ""),
          metrics: [
            {
              label: isRaw ? "暗部存活率" : "暗部压缩估计",
              value: `${(survivalRate * 100).toFixed(1)}%`,
              note: isRaw ? "RAW 底片数据完整" : "来自 JPG 像素统计，不等同 RAW 宽容度",
            },
            {
              label: "感光度",
              value: exifData.iso ? `ISO ${exifData.iso}` : "N/A",
              note: "",
            },
            {
              label: "色彩深度",
              value: `${sp.bit_depth}-bit`,
              note: rawPayload.color_space ? `色域 ${rawPayload.color_space}` : "色域 unknown",
            },
          ],
          riskItems: [
            {
              label: isRaw ? "物理死白" : "亮部溢出估计",
              value: `${(clippingRate * 100).toFixed(1)}%`,
              severity: clippingRate > 0.05 ? "danger" : clippingRate > 0.01 ? "warning" : "safe",
              note: isRaw
                ? clippingRate > 0.05 ? "高光区域已明显溢出" : "高光保留较好"
                : clippingRate > 0.05 ? "JPG 亮部已有压缩/溢出迹象" : "JPG 亮部风险较低",
            },
            {
              label: "断层风险",
              value: sp.banding_risk,
              severity:
                sp.banding_risk === "high" ? "danger" : sp.banding_risk === "medium" ? "warning" : "safe",
              note: isRaw ? "RAW 梯度连续性更好" : "JPG 大面积渐变更易断层",
            },
          ],
        },
        module3: {
          headline: "调色操作与参数",
          description: dr.module_3_strategy.replace("【💡 美化建议】", ""),
          coreActions: dr.module_4_core_actions.map((action) => {
            const match = action.match(/【(.+?)】(.+?)[:：](.+)/)
            return match
              ? { param: match[1], value: match[2].trim(), reason: match[3].trim() }
              : { param: "建议", value: "", reason: action }
          }),
        },
      }

      return { diagnostics, report }
    },
    [rawParser.result]
  )

  const handleAnalyze = useCallback(async () => {
    if (!fileType) return

    if (fileType === "nef" && rawParser.state !== "done") {
      toast.error("NEF 仍在解析中", { description: "请等待 RAW 解析完成后再开始分析" })
      return
    }

    setIsAnalyzing(true)
    setAnalysisProgress(0)
    setDownloadUrl(null)
    setAnalysisRawPayload(null)
    setAnalysisEngine(null)
    setAnalysisEvents([])
    streamedTextRef.current = ""

    try {
      const pushAnalysisEvent = (message: string) => {
        setAnalysisEvents((prev) => {
          if (prev.length > 0 && prev[prev.length - 1] === message) return prev
          return [...prev.slice(-5), message]
        })
      }
      const applyProgressEvent = (event: SSEProgressEvent) => {
        const pct = Math.max(0, Math.min(100, Math.round(event.progress)))
        const stageIdx = pct < 35 ? 0 : pct < 75 ? 1 : 2
        if (event.stage.startsWith("local_rules")) setAnalysisEngine("local")
        if (event.stage.startsWith("llm")) setAnalysisEngine("api")
        setAnalysisProgress((prev) => (pct > prev ? pct : prev))
        setAnalysisStage({ stage: stageIdx, message: event.message })
        pushAnalysisEvent(event.message)
      }

      setAnalysisStage({ stage: 0, message: "正在准备图像底层数据..." })
      setAnalysisProgress(8)
      pushAnalysisEvent("已开始分析任务，正在准备底层数据...")
      const rawPayload = await buildRawDataPayload()

      setAnalysisStage({ stage: 1, message: "数据轨准备完成，正在压缩与上传预览图..." })
      setAnalysisProgress(18)
      pushAnalysisEvent("数据轨准备完成，正在压缩并上传预览图...")

      let previewBlob: Blob
      if (fileType === "nef") {
        const previewUrl = rawParser.result?.previewObjectUrl
        if (!previewUrl) {
          throw new Error("NEF 预览图缺失，请先完成 RAW 解析")
        }
        const resp = await fetch(previewUrl)
        const originalPreviewBlob = await resp.blob()
        previewBlob = await compressPreviewBlob(originalPreviewBlob)
      } else if (currentFile) {
        previewBlob = await buildJpgPreviewBlob(currentFile)
      } else {
        throw new Error("没有可用的预览图")
      }

      const referenceReady = referenceImage.status === "ready" && Boolean(referenceImage.previewBlob)
      setAnalysisStage({ stage: 2, message: "分析引擎正在生成调色方案，请稍候..." })
      setAnalysisProgress(30)
      pushAnalysisEvent(
        referenceReady
          ? "分析任务已提交；参考图会在浏览器内完成追色融合，不上传服务器..."
          : rawPayload.file_type === "NEF"
          ? "分析任务已提交，正在进行视觉+RAW 物理双层判断..."
          : "分析任务已提交，正在进行 JPG 视觉语义分析..."
      )

      await analyzeWithSSE(previewBlob, rawPayload, userIntent, referenceReady ? "auto" : selectedStyle, {
        onText(text) {
          streamedTextRef.current += text
          setAnalysisProgress((prev) => Math.min(92, prev + 0.3))
        },
        onProgress(event) {
          applyProgressEvent(event)
        },
        onFinal(data) {
          void (async () => {
            try {
              setAnalysisProgress(referenceReady ? 94 : 100)
              const nextSessionId = data.session_id ?? null
              let finalDownloadUrl = data.download_url
              let finalParams = paramsWithDefaults(data)
              let finalRecommended = numericParamsFromFinal(data)
              let modifiedKeys = modifiedKeysFromParams(finalRecommended)
              let referenceSummary: string | null = null
              let referenceChangedCount = 0

              if (referenceReady && referenceImage.previewBlob) {
                setAnalysisStage({ stage: 2, message: "正在本地提取参考图色彩特征并融合参数..." })
                setAnalysisProgress(96)
                pushAnalysisEvent("参考图追色仅在浏览器内执行，最终只提交融合后的 Lightroom 参数...")

                const referenceMatch = await analyzeReferenceColorMatch(
                  previewBlob,
                  referenceImage.previewBlob
                )
                const blended = blendReferenceMatchParams(
                  finalParams,
                  referenceMatch.params,
                  referenceMatchStrength
                )
                finalParams = blended.params
                referenceSummary = referenceMatch.summary
                referenceChangedCount = blended.changedKeys.length
                modifiedKeys = new Set([...modifiedKeys, ...blended.changedKeys])
                finalRecommended = { ...finalRecommended }
                for (const key of blended.changedKeys) {
                  finalRecommended[key] = finalParams[key]
                }

                if (blended.changedKeys.length > 0) {
                  setAnalysisProgress(98)
                  const generated = await generateXmp(finalParams, nextSessionId)
                  finalDownloadUrl = generated.download_url
                }
              }

              setAnalysisProgress(100)
              setSessionId(nextSessionId)
              setDownloadUrl(finalDownloadUrl)
              setAnalysisRawPayload(rawPayload)

              const { diagnostics: d, report: r } = convertToDiagnosticReport(data, rawPayload)
              const finalReport = referenceSummary
                ? withReferenceMatchReport(r, referenceSummary, referenceMatchStrength, referenceChangedCount)
                : r
              setDiagnostics(d)
              setReport(finalReport)
              setParams(finalParams)
              setAiRecommendedParams(finalRecommended)
              setAiModifiedKeys(modifiedKeys)

              if (nextSessionId) {
                const history = createRefineHistory(
                  nextSessionId,
                  finalParams,
                  finalDownloadUrl,
                  data.quick_chips?.length ? data.quick_chips : DEFAULT_QUICK_CHIPS,
                  data.scene_label,
                  finalReport
                )
                setRefineHistory(history)
                void saveRefineHistory(history)
              }

              setTimeout(() => {
                setAnalysisProgress(0)
                setIsAnalyzing(false)
                setAnalysisStage(null)
                setAnalysisEvents([])
              }, 500)

              toast.success("分析完成", {
                description: referenceSummary
                  ? "已生成参考图追色 XMP 预设"
                  : "分析引擎已生成诊断报告与调色建议",
              })
            } catch (err) {
              setIsAnalyzing(false)
              setAnalysisProgress(0)
              setAnalysisStage(null)
              setAnalysisEvents([])
              toast.error("参考图追色失败", {
                description: err instanceof Error ? err.message : "请移除参考图后重试",
              })
            }
          })()
        },
        onError(message) {
          throw new Error(message)
        },
      })
    } catch (err) {
      setIsAnalyzing(false)
      setAnalysisProgress(0)
      setAnalysisStage(null)
      setAnalysisEvents([])
      toast.error("分析失败", {
        description: err instanceof Error ? err.message : "请稍后重试",
      })
    }
  }, [
    fileType,
    rawParser.state,
    rawParser.result,
    buildRawDataPayload,
    userIntent,
    selectedStyle,
    referenceImage,
    referenceMatchStrength,
    convertToDiagnosticReport,
    currentFile,
    setAnalysisEvents,
  ])

  const handleParamChange = useCallback((key: string, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }))
    setDownloadUrl(null)
  }, [])

  const handleGenerateXMP = useCallback(async () => {
    if (!diagnostics) return
    setIsGeneratingXmp(true)
    try {
      const { download_url } = await generateXmp(params, sessionId)
      setDownloadUrl(download_url)
      toast.success("XMP 已生成", { description: "已根据当前参数生成最新文件" })
    } catch (err) {
      toast.error("生成失败", {
        description: err instanceof Error ? err.message : "请稍后重试",
      })
    } finally {
      setIsGeneratingXmp(false)
    }
  }, [diagnostics, params, sessionId])

  const handleDownloadXMP = useCallback((versionId?: string) => {
    const targetUrl =
      versionId && refineHistory
        ? getVersionDownloadUrl(refineHistory, versionId)
        : downloadUrl
    if (!targetUrl) return
    const fullUrl = getDownloadUrl(targetUrl)
    const a = document.createElement("a")
    a.href = fullUrl
    const baseName = fileName?.replace(/\.[^.]+$/, "") || "Lumina"
    a.download = versionId ? `${baseName}_${versionId}.xmp` : `${baseName}.xmp`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success("下载成功")
  }, [downloadUrl, fileName, refineHistory])

  const handleRegenerate = useCallback(() => {
    if (!fileType) return
    setDownloadUrl(null)
    handleAnalyze()
  }, [fileType, handleAnalyze])

  const handleRefinement = useCallback(
    async (text: string) => {
      setUserIntent(text)
      const paramsBeforeRefine = { ...params }
      const historyBeforeRefine = refineHistory
      const downloadUrlBeforeRefine = downloadUrl
      const reportBeforeRefine = report

      if (sessionId) {
        const targetVersionId = historyBeforeRefine ? getNextRefineVersionId(historyBeforeRefine) : "V2"
        const startMessage = `正在根据“${text}”调整当前版本`
        setAssistantRunStatus({
          status: "running",
          targetVersionId,
          prompt: text,
          message: startMessage,
          progress: 8,
          stage: 0,
          events: [`已收到微调指令：“${text}”`],
          lastError: null,
        })
        streamedTextRef.current = ""

        try {
          const payloadForReport = analysisRawPayload ?? (await buildRawDataPayload())
          await refineWithSSE(sessionId, text, {
            onText() {
              setAssistantRunStatus((prev) => ({
                ...prev,
                progress: Math.min(90, prev.progress + 1),
              }))
            },
            onProgress(event) {
              const pct = Math.max(0, Math.min(100, Math.round(event.progress)))
              const stageIdx = pct < 35 ? 0 : pct < 75 ? 1 : 2
              if (event.stage.startsWith("local_rules")) setAnalysisEngine("local")
              if (event.stage.startsWith("llm")) setAnalysisEngine("api")
              setAssistantRunStatus((prev) => {
                const events =
                  prev.events.length > 0 && prev.events[prev.events.length - 1] === event.message
                    ? prev.events
                    : [...prev.events.slice(-5), event.message]
                return {
                  ...prev,
                  message: event.message,
                  progress: pct > prev.progress ? pct : prev.progress,
                  stage: stageIdx,
                  events,
                }
              })
            },
            onFinal(data) {
              setAssistantRunStatus((prev) => ({
                ...prev,
                status: "running",
                message: `${targetVersionId} 已生成，正在写入版本链`,
                progress: 100,
                stage: 2,
                lastError: null,
              }))
              const nextSessionId = data.session_id ?? sessionId
              const newParams = paramsWithDefaults(data)
              const changedParams = normalizedChangedParams(data, paramsBeforeRefine, newParams)
              const modifiedKeys = new Set(changedParams.map((item) => item.key))
              const { diagnostics: d, report: r } = convertToDiagnosticReport(data, payloadForReport)

              setDownloadUrl(data.download_url)
              setSessionId(nextSessionId)
              setParams(newParams)
              setAiRecommendedParams(numericParamsFromFinal(data))
              setAiModifiedKeys(modifiedKeys)

              const baseHistory =
                historyBeforeRefine ??
                createRefineHistory(
                  nextSessionId,
                  paramsBeforeRefine,
                  downloadUrl ?? data.download_url,
                  data.quick_chips?.length ? data.quick_chips : DEFAULT_QUICK_CHIPS,
                  data.scene_label,
                  reportBeforeRefine ?? undefined
                )
              const historyWithScene = updateHistoryScene(
                baseHistory,
                data.scene_label,
                data.quick_chips?.length ? data.quick_chips : baseHistory.quickChips
              )
              const nextHistory = appendRefineVersion(historyWithScene, {
                parentId: historyWithScene.currentVersionId,
                userIntent: text,
                assistantSummary: data.assistant_summary ?? `已根据“${text}”生成新版本。`,
                changedParams,
                params: newParams,
                reportSummary: reportSummaryFromFinal(data),
                report: r,
                downloadUrl: data.download_url,
              })
              setRefineHistory(nextHistory)
              void saveRefineHistory(nextHistory)

              setDiagnostics(d)
              setReport(r)

              setTimeout(() => {
                setAssistantRunStatus(IDLE_ASSISTANT_RUN_STATUS)
              }, 500)

              toast.success("调整完成", {
                description: `已根据"${text}"重新生成调色方案`,
              })
            },
            onError(message) {
              throw new Error(message)
            },
          })
        } catch (err) {
          setRefineHistory(historyBeforeRefine)
          setParams(paramsBeforeRefine)
          setDownloadUrl(downloadUrlBeforeRefine)
          setReport(reportBeforeRefine)
          const message = err instanceof Error ? err.message : "请稍后重试"
          setAssistantRunStatus((prev) => ({
            ...prev,
            status: "error",
            message: "微调失败，当前版本未被覆盖",
            progress: 0,
            stage: 0,
            lastError: message,
            events: prev.events.length ? prev.events : [`微调指令：“${text}”`],
          }))
          toast.error("微调失败", {
            description: `${message}；当前版本未被覆盖。`,
          })
        }
      } else {
        toast.info("收到反馈", {
          description: `"${text}" - 正在重新生成调色方案`,
        })
        if (fileType) {
          setDownloadUrl(null)
          setTimeout(() => void handleAnalyze(), 100)
        }
      }
    },
    [
      sessionId,
      params,
      refineHistory,
      analysisRawPayload,
      buildRawDataPayload,
      convertToDiagnosticReport,
      fileType,
      handleAnalyze,
      downloadUrl,
      report,
    ]
  )

  const handleSelectRefineVersion = useCallback((versionId: string) => {
    if (!refineHistory) return

    const nextHistory = setCurrentRefineVersion(refineHistory, versionId, {
      redoVersionId: getChildVersionId(refineHistory, versionId),
    })
    const restoredParams = rebuildParamsForVersion(nextHistory, versionId)
    const selectedVersion = versionId === nextHistory.baseVersion.id
      ? null
      : nextHistory.versions.find((version) => version.id === versionId) ?? null

    setRefineHistory(nextHistory)
    setParams(restoredParams)
    setReport((getVersionReport(nextHistory, versionId) as DiagnosticReport | null) ?? report)
    setAiRecommendedParams(restoredParams)
    setAiModifiedKeys(
      selectedVersion
        ? new Set(selectedVersion.changedParams.map((item) => item.key))
        : modifiedKeysFromParams(nextHistory.baseVersion.params)
    )
    setDownloadUrl(getVersionDownloadUrl(nextHistory, versionId))
    void saveRefineHistory(nextHistory)
  }, [refineHistory, report])

  const handleUndoRefinement = useCallback((sourceVersionId?: string) => {
    if (!refineHistory) return
    const activeVersionId = sourceVersionId ?? refineHistory.currentVersionId
    const parentId = getParentVersionId(refineHistory, activeVersionId)
    if (!parentId) {
      toast.info("已经是基线版本", { description: "当前没有可以撤回的微调版本" })
      return
    }

    const nextHistory = setCurrentRefineVersion(refineHistory, parentId, {
      redoVersionId: activeVersionId,
    })
    const restoredParams = rebuildParamsForVersion(nextHistory, parentId)
    const parentVersion = getCurrentRefineVersion(nextHistory)

    setRefineHistory(nextHistory)
    setParams(restoredParams)
    setReport((getVersionReport(nextHistory, parentId) as DiagnosticReport | null) ?? report)
    setAiRecommendedParams(restoredParams)
    setAiModifiedKeys(
      parentVersion
        ? new Set(parentVersion.changedParams.map((item) => item.key))
        : modifiedKeysFromParams(nextHistory.baseVersion.params)
    )
    setDownloadUrl(getVersionDownloadUrl(nextHistory, parentId))
    void saveRefineHistory(nextHistory)

    toast.success("已撤回上一版", {
      description: `当前回到 ${parentId}，下载按钮已指向该版本 XMP`,
    })
  }, [refineHistory, report])

  const handleRedoRefinement = useCallback((sourceVersionId?: string) => {
    if (!refineHistory) return
    const activeVersionId = sourceVersionId ?? refineHistory.currentVersionId
    const forwardId = getForwardVersionId(refineHistory, activeVersionId)
    if (!forwardId) {
      toast.info("没有下一版", { description: "当前版本已经是这条版本链的最新版本" })
      return
    }

    const nextRedoId = getChildVersionId(refineHistory, forwardId)
    const nextHistory = setCurrentRefineVersion(refineHistory, forwardId, {
      redoVersionId: nextRedoId,
    })
    const restoredParams = rebuildParamsForVersion(nextHistory, forwardId)
    const forwardVersion = getCurrentRefineVersion(nextHistory)

    setRefineHistory(nextHistory)
    setParams(restoredParams)
    setReport((getVersionReport(nextHistory, forwardId) as DiagnosticReport | null) ?? report)
    setAiRecommendedParams(restoredParams)
    setAiModifiedKeys(
      forwardVersion
        ? new Set(forwardVersion.changedParams.map((item) => item.key))
        : modifiedKeysFromParams(nextHistory.baseVersion.params)
    )
    setDownloadUrl(getVersionDownloadUrl(nextHistory, forwardId))
    void saveRefineHistory(nextHistory)

    toast.success("已恢复下一版", {
      description: `当前回到 ${forwardId}，下载按钮已指向该版本 XMP`,
    })
  }, [refineHistory, report])

  const hasAnalysis = diagnostics !== null
  const xmpReady = downloadUrl !== null
  const latestRefineVersion = getCurrentRefineVersion(refineHistory)
  const currentVersionId = refineHistory?.currentVersionId ?? (hasAnalysis ? "V1" : null)
  const quickChips = refineHistory?.quickChips?.length ? refineHistory.quickChips : DEFAULT_QUICK_CHIPS
  const isNef = fileType === "nef"
  const rawPreviewInfo =
    isNef && rawParser.result?.previewDimensions
      ? {
        rawWidth: rawParser.result.exif.width,
        rawHeight: rawParser.result.exif.height,
        previewWidth: rawParser.result.previewDimensions.width,
        previewHeight: rawParser.result.previewDimensions.height,
        aspectMismatch: rawParser.result.previewDimensions.aspectMismatch,
      }
      : null

  const referenceDisabledReason =
    referenceImage.status === "parsing"
      ? `参考图正在本地解析：${referenceImage.fileName ?? "处理中..."}`
      : referenceImage.status === "error"
        ? referenceImage.error ?? "参考图解析失败，请移除后重新上传。"
        : null

  const canAnalyze =
    Boolean(fileName) &&
    (!isNef || (rawParser.state === "done" && Boolean(rawParser.result?.previewObjectUrl))) &&
    !referenceDisabledReason
  const mainAnalyzeDisabledReason =
    !fileName
      ? null
      : isNef && rawParser.wasmChecked && !rawParser.wasmAvailable
        ? "NEF 解析不可用：缺少 /wasm/raw_analyzer.js，请先执行 frontend/wasm/build.sh。"
        : isNef && rawParser.state === "parsing"
          ? `NEF 正在解析：${rawParser.progress?.stage ?? "处理中..."}`
          : isNef && rawParser.state === "error"
            ? rawParser.error ?? "NEF 解析失败，请重试。"
            : isNef && rawParser.state !== "done"
              ? "NEF 解析尚未完成，暂不能分析。"
              : isNef && rawParser.state === "done" && !rawParser.result?.previewObjectUrl
                ? "NEF 解析已完成，但未提取到预览图，无法提交分析。"
              : null
  const analyzeDisabledReason = mainAnalyzeDisabledReason ?? referenceDisabledReason

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Toaster
        position="bottom-center"
        toastOptions={{
          className:
            "bg-card text-foreground border border-border shadow-[0_4px_24px_rgba(0,0,0,0.4)]",
        }}
      />

      <TopToolbar
        fileName={fileName}
        colorSpace={diagnostics?.colorSpace ?? null}
        isAnalyzing={isAnalyzing}
        analysisProgress={analysisProgress}
        isSaved={xmpReady}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar
          onFileUpload={handleFileUpload}
          selectedPlatform={selectedPlatform}
          onPlatformChange={setSelectedPlatform}
          userIntent={userIntent}
          onUserIntentChange={setUserIntent}
          selectedStyle={selectedStyle}
          onStyleChange={setSelectedStyle}
          referenceImage={referenceImage}
          referenceMatchStrength={referenceMatchStrength}
          hasAnalysis={hasAnalysis}
          onReferenceFileUpload={handleReferenceFileUpload}
          onReferenceRemove={handleReferenceRemove}
          onReferenceMatchStrengthChange={setReferenceMatchStrength}
          referenceDisabledReason={referenceDisabledReason}
          onAnalyze={handleAnalyze}
          canAnalyze={canAnalyze}
          analyzeDisabledReason={analyzeDisabledReason}
          isAnalyzing={isAnalyzing}
          analysisStage={analysisStage}
          analysisProgress={analysisProgress}
          analysisEvents={analysisEvents}
          uploadedFileName={fileName}
          uploadedFileType={fileType}
        />

        <CenterCanvas
          imageUrl={imageUrl}
          fileType={fileType}
          isAnalyzing={isAnalyzing}
          diagnostics={diagnostics}
          params={params}
          hasAnalysis={hasAnalysis}
          rawPreviewInfo={rawPreviewInfo}
          versionComparison={currentVersionId ? { currentLabel: currentVersionId } : null}
        />

        <RightPanel
          params={params}
          aiRecommendedParams={aiRecommendedParams}
          aiModifiedKeys={aiModifiedKeys}
          report={report}
          refineHistory={refineHistory}
          onParamChange={handleParamChange}
          onGenerateXMP={handleGenerateXMP}
          onDownloadXMP={handleDownloadXMP}
          onRegenerate={handleRegenerate}
          onRefinement={handleRefinement}
          onUndoRefinement={handleUndoRefinement}
          onRedoRefinement={handleRedoRefinement}
          onSelectVersion={handleSelectRefineVersion}
          onDownloadVersion={handleDownloadXMP}
          isGenerating={isGeneratingXmp}
          hasAnalysis={hasAnalysis}
          xmpReady={xmpReady}
          isAnalyzing={assistantRunStatus.status === "running"}
          assistantRunStatus={assistantRunStatus}
          quickChips={quickChips}
          currentVersionId={currentVersionId}
          latestRefineVersion={latestRefineVersion}
          fileType={fileType}
          selectedStyle={selectedStyle}
          referenceActive={referenceImage.status === "ready"}
          referenceMatchStrength={referenceMatchStrength}
          analysisEngine={analysisEngine}
        />
      </div>
    </div>
  )
}
