"use client"

/**
 * 集成方法（后续替换 page.tsx 时参考）：
 *
 *   const flow = useAnalyzeFlow({
 *     buildRawDataPayload,
 *     buildPreviewBlob: async () => {
 *       if (fileType === "nef") {
 *         const resp = await fetch(rawParser.result!.previewObjectUrl!)
 *         return compressPreviewBlob(await resp.blob())
 *       }
 *       return buildJpgPreviewBlob(currentFile!)
 *     },
 *     userIntent,
 *     selectedStyle,
 *     convertToReport: convertToDiagnosticReport,
 *     onParamsResolved: (recommended, modified) => {
 *       const next = { ...getDefaultParams() }
 *       Object.assign(next, recommended)
 *       setParams(next)
 *     },
 *   })
 *
 *   // 替换原 11 个 useState 与 handleAnalyze 函数体
 *   <RightPanel
 *     report={flow.report}
 *     aiRecommendedParams={flow.aiRecommendedParams}
 *     aiModifiedKeys={flow.aiModifiedKeys}
 *     ...
 *   />
 *   <CenterCanvas diagnostics={flow.diagnostics} isAnalyzing={flow.isAnalyzing} ... />
 *   onAnalyze={flow.analyze}
 *
 *   // refine 路径里 setDownloadUrl/setSessionId/setDiagnostics... 全部改为 flow.applyFinalResult(data, payloadForReport)
 *   // handleFileUpload 里 reset 改为 flow.reset()
 *   // handleRegenerate 里 setDownloadUrl(null) 改为 flow.clearDownloadUrl()
 */

/**
 * useAnalyzeFlow.ts
 *
 * 封装 /api/analyze SSE 流的全部状态机：
 *   isAnalyzing / progress / stage / events
 *   sessionId / analysisRawPayload / downloadUrl
 *   diagnostics / report / aiRecommendedParams / aiModifiedKeys
 *
 * 把 page.tsx 上 11 个 useState + 100+ 行 handleAnalyze 集中到一处。
 * 调色参数（params）仍在 page.tsx 持有，本 hook 以回调通知更新。
 */

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import {
  analyzeWithSSE,
  type SSEFinalEvent,
  type SSEProgressEvent,
} from "@/lib/api"
import type { DiagnosticReport, RawDataPayload } from "@/lib/image-analysis"
import type { ImageDiagnostics } from "@/components/center-canvas"

export interface UseAnalyzeFlowOptions {
  /** 拿到当前请求的物理数据 payload（NEF/JPG 各自实现） */
  buildRawDataPayload: () => Promise<RawDataPayload>
  /** 构造 multipart 中要上传的预览图 blob */
  buildPreviewBlob: () => Promise<Blob>
  /** 用户输入与风格预设 */
  userIntent: string
  selectedStyle: string
  /** 把 SSE final 事件映射为 UI 诊断报告（page.tsx 提供，依赖 fileType 闭包） */
  convertToReport: (
    data: SSEFinalEvent,
    rawPayload: RawDataPayload
  ) => { diagnostics: ImageDiagnostics; report: DiagnosticReport }
  /** 当 SSE 返回 final 事件时，回调通知 page.tsx 同步参数（params）状态 */
  onParamsResolved: (
    aiParams: Record<string, number>,
    modifiedKeys: Set<string>
  ) => void
}

export interface AnalyzeFlowState {
  isAnalyzing: boolean
  analysisProgress: number
  analysisStage: { stage: number; message: string } | null
  analysisEvents: string[]
  sessionId: string | null
  analysisRawPayload: RawDataPayload | null
  downloadUrl: string | null
  diagnostics: ImageDiagnostics | null
  report: DiagnosticReport | null
  aiRecommendedParams: Record<string, number> | null
  aiModifiedKeys: Set<string>
}

export interface UseAnalyzeFlowReturn extends AnalyzeFlowState {
  /** 触发分析（替代之前的 handleAnalyze） */
  analyze: () => Promise<void>
  /** 上传新文件时调用，重置分析侧状态 */
  reset: () => void
  /** 仅清空 downloadUrl（参数本地修改后用） */
  clearDownloadUrl: () => void
  /** refine 完成后注入新结果（替代 page.tsx 里直接 setSessionId/setDownloadUrl 等） */
  applyFinalResult: (data: SSEFinalEvent, rawPayload: RawDataPayload) => void
}

const INITIAL_STATE: AnalyzeFlowState = {
  isAnalyzing: false,
  analysisProgress: 0,
  analysisStage: null,
  analysisEvents: [],
  sessionId: null,
  analysisRawPayload: null,
  downloadUrl: null,
  diagnostics: null,
  report: null,
  aiRecommendedParams: null,
  aiModifiedKeys: new Set(),
}

export function useAnalyzeFlow(
  opts: UseAnalyzeFlowOptions
): UseAnalyzeFlowReturn {
  const [state, setState] = useState<AnalyzeFlowState>(INITIAL_STATE)
  const streamedTextRef = useRef("")

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
    streamedTextRef.current = ""
  }, [])

  const clearDownloadUrl = useCallback(() => {
    setState((s) => ({ ...s, downloadUrl: null }))
  }, [])

  const applyFinalResult = useCallback(
    (data: SSEFinalEvent, rawPayload: RawDataPayload) => {
      const { diagnostics: d, report: r } = opts.convertToReport(data, rawPayload)
      const recommended = Object.fromEntries(
        Object.entries(data.lightroom_params).filter(
          ([, v]) => typeof v === "number"
        )
      ) as Record<string, number>
      const modifiedKeys = new Set<string>(Object.keys(recommended))

      opts.onParamsResolved(recommended, modifiedKeys)

      setState((s) => ({
        ...s,
        analysisProgress: 100,
        sessionId: data.session_id ?? null,
        downloadUrl: data.download_url,
        analysisRawPayload: rawPayload,
        diagnostics: d,
        report: r,
        aiRecommendedParams: recommended,
        aiModifiedKeys: modifiedKeys,
      }))
    },
    [opts]
  )

  const analyze = useCallback(async () => {
    setState((s) => ({
      ...s,
      isAnalyzing: true,
      analysisProgress: 0,
      downloadUrl: null,
      analysisRawPayload: null,
      analysisEvents: [],
    }))
    streamedTextRef.current = ""

    const pushAnalysisEvent = (message: string) => {
      setState((s) => {
        if (s.analysisEvents.length > 0 && s.analysisEvents[s.analysisEvents.length - 1] === message) {
          return s
        }
        return { ...s, analysisEvents: [...s.analysisEvents.slice(-5), message] }
      })
    }
    const applyProgressEvent = (event: SSEProgressEvent) => {
      const pct = Math.max(0, Math.min(100, Math.round(event.progress)))
      const stageIdx = pct < 35 ? 0 : pct < 75 ? 1 : 2
      setState((s) => ({
        ...s,
        analysisProgress: pct > s.analysisProgress ? pct : s.analysisProgress,
        analysisStage: { stage: stageIdx, message: event.message },
      }))
      pushAnalysisEvent(event.message)
    }

    try {
      setState((s) => ({
        ...s,
        analysisStage: { stage: 0, message: "正在准备图像底层数据..." },
        analysisProgress: 8,
      }))
      pushAnalysisEvent("已开始分析任务，正在准备底层数据...")
      const rawPayload = await opts.buildRawDataPayload()

      setState((s) => ({
        ...s,
        analysisStage: { stage: 1, message: "数据轨准备完成，正在压缩与上传预览图..." },
        analysisProgress: 18,
      }))
      pushAnalysisEvent("数据轨准备完成，正在压缩并上传预览图...")

      const previewBlob = await opts.buildPreviewBlob()

      setState((s) => ({
        ...s,
        analysisStage: { stage: 2, message: "分析引擎正在生成调色方案，请稍候..." },
        analysisProgress: 30,
      }))
      pushAnalysisEvent(
        rawPayload.file_type === "NEF"
          ? "分析任务已提交，正在进行视觉+RAW 物理双层判断..."
          : "分析任务已提交，正在进行 JPG 视觉语义分析..."
      )

      await analyzeWithSSE(previewBlob, rawPayload, opts.userIntent, opts.selectedStyle, {
        onText(text) {
          streamedTextRef.current += text
          setState((s) => ({
            ...s,
            analysisProgress: Math.min(92, s.analysisProgress + 0.3),
          }))
        },
        onProgress: applyProgressEvent,
        onFinal(data) {
          applyFinalResult(data, rawPayload)
          setTimeout(() => {
            setState((s) => ({
              ...s,
              analysisProgress: 0,
              isAnalyzing: false,
              analysisStage: null,
              analysisEvents: [],
            }))
          }, 500)
          toast.success("分析完成", {
            description: "分析引擎已生成诊断报告与调色建议",
          })
        },
        onError(message) {
          throw new Error(message)
        },
      })
    } catch (err) {
      setState((s) => ({
        ...s,
        isAnalyzing: false,
        analysisProgress: 0,
        analysisStage: null,
        analysisEvents: [],
      }))
      toast.error("分析失败", {
        description: err instanceof Error ? err.message : "请稍后重试",
      })
    }
  }, [opts, applyFinalResult])

  return {
    ...state,
    analyze,
    reset,
    clearDownloadUrl,
    applyFinalResult,
  }
}
