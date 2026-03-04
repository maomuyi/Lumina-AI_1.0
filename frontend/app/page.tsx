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
  analyzeWithSSE,
  refineWithSSE,
  generateXmp,
  getDownloadUrl,
  type SSEFinalEvent,
  type SSEProgressEvent,
} from "@/lib/api"
import { useRawParser } from "@/hooks/useRawParser"
import { Toaster, toast } from "sonner"

export default function HomePage() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileType, setFileType] = useState<string | null>(null)
  const [currentFile, setCurrentFile] = useState<File | null>(null)

  const [selectedPlatform, setSelectedPlatform] = useState("lightroom")
  const [selectedStyle, setSelectedStyle] = useState("auto")
  const [userIntent, setUserIntent] = useState("")

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
  const [analysisRawPayload, setAnalysisRawPayload] = useState<RawDataPayload | null>(null)

  const rawParser = useRawParser()
  const streamedTextRef = useRef("")
  const lastParserErrorRef = useRef<string | null>(null)
  const uploadedFileUrlRef = useRef<string | null>(null)
  const nefPreviewUrlRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (uploadedFileUrlRef.current) URL.revokeObjectURL(uploadedFileUrlRef.current)
      if (nefPreviewUrlRef.current) URL.revokeObjectURL(nefPreviewUrlRef.current)
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
      setAnalysisRawPayload(null)
      setAnalysisStage(null)
      setAnalysisEvents([])
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
        thinkingSteps: [
          { label: `提取底层数据：已读取${sp.bit_depth}-bit数据并分析线性直方图`, completed: true },
          { label: "检测画质风险：已扫描高光溢出与暗部压缩", completed: true },
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
          headline: "底层数据剖析",
          description: dr.module_2_physics.replace("【🔬 底层剖析】", ""),
          metrics: [
            {
              label: "暗部存活率",
              value: `${(survivalRate * 100).toFixed(1)}%`,
              note: isRaw ? "RAW 底片数据完整" : "JPG 有压缩损耗",
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
              label: "物理死白",
              value: `${(clippingRate * 100).toFixed(1)}%`,
              severity: clippingRate > 0.05 ? "danger" : clippingRate > 0.01 ? "warning" : "safe",
              note: clippingRate > 0.05 ? "高光区域已明显溢出" : "高光保留较好",
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

      setAnalysisStage({ stage: 2, message: "AI 正在深度推理，请稍候..." })
      setAnalysisProgress(30)
      pushAnalysisEvent("已提交到模型，正在进行视觉+数据双轨推理...")

      await analyzeWithSSE(previewBlob, rawPayload, userIntent, selectedStyle, {
        onText(text) {
          streamedTextRef.current += text
          setAnalysisProgress((prev) => Math.min(92, prev + 0.3))
        },
        onProgress(event) {
          applyProgressEvent(event)
        },
        onFinal(data) {
          setAnalysisProgress(100)
          setSessionId(data.session_id ?? null)
          setDownloadUrl(data.download_url)
          setAnalysisRawPayload(rawPayload)

          const { diagnostics: d, report: r } = convertToDiagnosticReport(data, rawPayload)
          setDiagnostics(d)
          setReport(r)

          const newParams = { ...getDefaultParams() }
          const modifiedKeys = new Set<string>()
          for (const [key, value] of Object.entries(data.lightroom_params)) {
            if (typeof value === "number") {
              newParams[key] = value
              modifiedKeys.add(key)
            }
          }
          setParams(newParams)
          setAiRecommendedParams(
            Object.fromEntries(
              Object.entries(data.lightroom_params).filter(([, v]) => typeof v === "number")
            ) as Record<string, number>
          )
          setAiModifiedKeys(modifiedKeys)

          setTimeout(() => {
            setAnalysisProgress(0)
            setIsAnalyzing(false)
            setAnalysisStage(null)
            setAnalysisEvents([])
          }, 500)

          toast.success("分析完成", {
            description: "AI 已生成诊断报告与调色建议",
          })
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
      const { download_url } = await generateXmp(params)
      setDownloadUrl(download_url)
      toast.success("XMP 已生成", { description: "已根据当前参数生成最新文件" })
    } catch (err) {
      toast.error("生成失败", {
        description: err instanceof Error ? err.message : "请稍后重试",
      })
    } finally {
      setIsGeneratingXmp(false)
    }
  }, [diagnostics, params])

  const handleDownloadXMP = useCallback(() => {
    if (!downloadUrl) return
    const fullUrl = getDownloadUrl(downloadUrl)
    const a = document.createElement("a")
    a.href = fullUrl
    a.download = fileName?.replace(/\.[^.]+$/, "") + ".xmp" || "Lumina.xmp"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success("下载成功")
  }, [downloadUrl, fileName])

  const handleRegenerate = useCallback(() => {
    if (!fileType) return
    setDownloadUrl(null)
    handleAnalyze()
  }, [fileType, handleAnalyze])

  const handleRefinement = useCallback(
    async (text: string) => {
      setUserIntent(text)

      if (sessionId) {
        setIsAnalyzing(true)
        setAnalysisProgress(0)
        setAnalysisStage({ stage: 2, message: `AI 正在根据"${text}"重新调整参数...` })
        setAnalysisEvents([`已收到微调指令：“${text}”`])
        streamedTextRef.current = ""

        try {
          const payloadForReport = analysisRawPayload ?? (await buildRawDataPayload())
          await refineWithSSE(sessionId, text, {
            onText() {
              setAnalysisProgress((prev) => Math.min(90, prev + 1))
            },
            onProgress(event) {
              const pct = Math.max(0, Math.min(100, Math.round(event.progress)))
              const stageIdx = pct < 35 ? 0 : pct < 75 ? 1 : 2
              setAnalysisProgress((prev) => (pct > prev ? pct : prev))
              setAnalysisStage({ stage: stageIdx, message: event.message })
              setAnalysisEvents((prev) => {
                if (prev.length > 0 && prev[prev.length - 1] === event.message) return prev
                return [...prev.slice(-5), event.message]
              })
            },
            onFinal(data) {
              setAnalysisProgress(100)
              setDownloadUrl(data.download_url)
              if (data.session_id) {
                setSessionId(data.session_id)
              }

              const newParams = { ...getDefaultParams() }
              const modifiedKeys = new Set<string>()
              for (const [key, value] of Object.entries(data.lightroom_params)) {
                if (typeof value === "number") {
                  newParams[key] = value
                  modifiedKeys.add(key)
                }
              }
              setParams(newParams)
              setAiRecommendedParams(
                Object.fromEntries(
                  Object.entries(data.lightroom_params).filter(([, v]) => typeof v === "number")
                ) as Record<string, number>
              )
              setAiModifiedKeys(modifiedKeys)

              const { diagnostics: d, report: r } = convertToDiagnosticReport(data, payloadForReport)
              setDiagnostics(d)
              setReport(r)

              setTimeout(() => {
                setAnalysisProgress(0)
                setIsAnalyzing(false)
                setAnalysisStage(null)
                setAnalysisEvents([])
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
          setIsAnalyzing(false)
          setAnalysisProgress(0)
          setAnalysisStage(null)
          setAnalysisEvents([])
          toast.error("微调失败", {
            description: err instanceof Error ? err.message : "请稍后重试",
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
    [sessionId, analysisRawPayload, buildRawDataPayload, convertToDiagnosticReport, fileType, handleAnalyze]
  )

  const hasAnalysis = diagnostics !== null
  const xmpReady = downloadUrl !== null
  const isNef = fileType === "nef"

  const canAnalyze =
    Boolean(fileName) &&
    (!isNef || (rawParser.state === "done" && Boolean(rawParser.result?.previewObjectUrl)))
  const analyzeDisabledReason =
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
        />

        <RightPanel
          params={params}
          aiRecommendedParams={aiRecommendedParams}
          aiModifiedKeys={aiModifiedKeys}
          report={report}
          onParamChange={handleParamChange}
          onGenerateXMP={handleGenerateXMP}
          onDownloadXMP={handleDownloadXMP}
          onRegenerate={handleRegenerate}
          onRefinement={handleRefinement}
          isGenerating={isGeneratingXmp}
          hasAnalysis={hasAnalysis}
          xmpReady={xmpReady}
          isAnalyzing={isAnalyzing}
        />
      </div>
    </div>
  )
}
