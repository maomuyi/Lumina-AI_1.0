"use client"

import { useState, useCallback, useRef } from "react"
import { TopToolbar } from "@/components/top-toolbar"
import { LeftSidebar } from "@/components/left-sidebar"
import { CenterCanvas, type ImageDiagnostics } from "@/components/center-canvas"
import { RightPanel } from "@/components/right-panel"
import { getDefaultParams } from "@/lib/lightroom-params"
import { generateXMP, downloadXMP } from "@/lib/xmp-generator"
import { analyzeImage, type DiagnosticReport } from "@/lib/image-analysis"
import { Toaster, toast } from "sonner"

export default function HomePage() {
  // File state
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileType, setFileType] = useState<string | null>(null)

  // Platform & style
  const [selectedPlatform, setSelectedPlatform] = useState("lightroom")
  const [selectedStyle, setSelectedStyle] = useState("auto")

  // User intent
  const [userIntent, setUserIntent] = useState("")

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisStage, setAnalysisStage] = useState<{
    stage: number
    message: string
  } | null>(null)
  const [diagnostics, setDiagnostics] = useState<ImageDiagnostics | null>(null)

  // AI output
  const [report, setReport] = useState<DiagnosticReport | null>(null)
  const [aiRecommendedParams, setAiRecommendedParams] = useState<Record<string, number> | null>(null)
  const [aiModifiedKeys, setAiModifiedKeys] = useState<Set<string>>(new Set())

  // Parameters
  const [params, setParams] = useState<Record<string, number>>(getDefaultParams())

  // XMP state
  const [isGenerating, setIsGenerating] = useState(false)
  const [xmpReady, setXmpReady] = useState(false)
  const xmpContentRef = useRef<string>("")

  // Handle file upload
  const handleFileUpload = useCallback((file: File) => {
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

    // Reset state
    setDiagnostics(null)
    setReport(null)
    setAiRecommendedParams(null)
    setAiModifiedKeys(new Set())
    setParams(getDefaultParams())
    setXmpReady(false)
    setAnalysisStage(null)

    // Read file
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    setFileName(file.name)
    setFileType(ext === "jpeg" ? "jpg" : ext)

    toast.success("文件已加载", {
      description: file.name,
    })
  }, [])

  // Handle analysis
  const handleAnalyze = useCallback(async () => {
    if (!imageUrl || !fileType) return

    setIsAnalyzing(true)
    setAnalysisProgress(0)
    setXmpReady(false)

    try {
      // Progress animation
      const progressInterval = setInterval(() => {
        setAnalysisProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval)
            return 90
          }
          return prev + Math.random() * 12
        })
      }, 250)

      // Stage callback
      const onStageChange = (stage: number, message: string) => {
        setAnalysisStage({ stage, message })
      }

      // Perform analysis
      const result = await analyzeImage(imageUrl, fileType, userIntent, onStageChange)

      clearInterval(progressInterval)
      setAnalysisProgress(100)

      // Apply results
      setDiagnostics(result.diagnostics)
      setReport(result.report)
      setAiRecommendedParams(result.recommendedParams)

      // Apply recommended params
      const newParams = { ...getDefaultParams() }
      const modifiedKeys = new Set<string>()

      for (const [key, value] of Object.entries(result.recommendedParams)) {
        newParams[key] = value
        modifiedKeys.add(key)
      }

      setParams(newParams)
      setAiModifiedKeys(modifiedKeys)

      setTimeout(() => {
        setAnalysisProgress(0)
        setIsAnalyzing(false)
        setAnalysisStage(null)
      }, 500)

      toast.success("分析完成", {
        description: "AI 已生成诊断报告与调色建议",
      })
    } catch {
      setIsAnalyzing(false)
      setAnalysisProgress(0)
      setAnalysisStage(null)
      toast.error("分析失败", {
        description: "请稍后重试",
      })
    }
  }, [imageUrl, fileType, userIntent])

  // Handle param change
  const handleParamChange = useCallback((key: string, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }, [])

  // Generate XMP
  const handleGenerateXMP = useCallback(() => {
    setIsGenerating(true)
    setTimeout(() => {
      const xmp = generateXMP(params)
      xmpContentRef.current = xmp
      setXmpReady(true)
      setIsGenerating(false)
      toast.success("XMP 预设已生成", {
        description: "可以下载并导入 Lightroom",
      })
    }, 800)
  }, [params])

  // Download XMP
  const handleDownloadXMP = useCallback(() => {
    if (xmpContentRef.current && fileName) {
      downloadXMP(xmpContentRef.current, fileName)
      toast.success("下载成功")
    }
  }, [fileName])

  // Regenerate
  const handleRegenerate = useCallback(() => {
    if (imageUrl && fileType) {
      setXmpReady(false)
      handleAnalyze()
    }
  }, [imageUrl, fileType, handleAnalyze])

  // Handle refinement from multi-round chat
  const handleRefinement = useCallback(
    (text: string) => {
      // In MVP, we re-run analysis with the refinement as user intent
      setUserIntent(text)
      toast.info("收到反馈", {
        description: `"${text}" - 正在重新生成调色方案`,
      })
      if (imageUrl && fileType) {
        setXmpReady(false)
        // Delay to allow state update
        setTimeout(() => {
          handleAnalyze()
        }, 100)
      }
    },
    [imageUrl, fileType, handleAnalyze]
  )

  const hasAnalysis = diagnostics !== null

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <Toaster
        position="bottom-center"
        toastOptions={{
          className:
            "bg-card text-foreground border border-border shadow-[0_4px_24px_rgba(0,0,0,0.4)]",
        }}
      />

      {/* Top Toolbar */}
      <TopToolbar
        fileName={fileName}
        colorSpace={diagnostics?.colorSpace ?? null}
        isAnalyzing={isAnalyzing}
        analysisProgress={analysisProgress}
        isSaved={xmpReady}
      />

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <LeftSidebar
          onFileUpload={handleFileUpload}
          selectedPlatform={selectedPlatform}
          onPlatformChange={setSelectedPlatform}
          userIntent={userIntent}
          onUserIntentChange={setUserIntent}
          selectedStyle={selectedStyle}
          onStyleChange={setSelectedStyle}
          onAnalyze={handleAnalyze}
          isAnalyzing={isAnalyzing}
          analysisStage={analysisStage}
          uploadedFileName={fileName}
          uploadedFileType={fileType}
        />

        {/* Center canvas */}
        <CenterCanvas
          imageUrl={imageUrl}
          fileType={fileType}
          isAnalyzing={isAnalyzing}
          diagnostics={diagnostics}
        />

        {/* Right panel */}
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
          isGenerating={isGenerating}
          hasAnalysis={hasAnalysis}
          xmpReady={xmpReady}
          isAnalyzing={isAnalyzing}
        />
      </div>
    </div>
  )
}
