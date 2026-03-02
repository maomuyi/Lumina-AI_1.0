"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ParamSlider } from "@/components/param-slider"
import { LIGHTROOM_GROUPS } from "@/lib/lightroom-params"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Download, RefreshCw, FileDown, Loader2 } from "lucide-react"

interface RightPanelProps {
  params: Record<string, number>
  aiRecommendedParams: Record<string, number> | null
  aiModifiedKeys: Set<string>
  aiStrategy: string | null
  strategyTags: string[]
  onParamChange: (key: string, value: number) => void
  onGenerateXMP: () => void
  onDownloadXMP: () => void
  onRegenerate: () => void
  isGenerating: boolean
  hasAnalysis: boolean
  xmpReady: boolean
  isAnalyzing: boolean
}

export function RightPanel({
  params,
  aiRecommendedParams,
  aiModifiedKeys,
  aiStrategy,
  strategyTags,
  onParamChange,
  onGenerateXMP,
  onDownloadXMP,
  onRegenerate,
  isGenerating,
  hasAnalysis,
  xmpReady,
  isAnalyzing,
}: RightPanelProps) {
  const defaultOpenGroups = ["basic", "presence", "tone_curve"]

  return (
    <aside className="flex w-[340px] shrink-0 flex-col bg-card">
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {/* AI Strategy Section */}
          {(aiStrategy || isAnalyzing) && (
            <>
              <div className="p-4">
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  AI 调色策略
                </h3>
                {isAnalyzing && !aiStrategy ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                ) : aiStrategy ? (
                  <>
                    <p className="text-[12px] leading-relaxed text-foreground">
                      {aiStrategy}
                    </p>
                    {strategyTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {strategyTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-border bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
              </div>
              <Separator />
            </>
          )}

          {/* Parameter Controls - Lightroom Style */}
          <div className="p-4">
            <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              参数建议
            </h3>

            {isAnalyzing && !hasAnalysis ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-2 flex-1" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                ))}
              </div>
            ) : (
              <Accordion
                type="multiple"
                defaultValue={defaultOpenGroups}
                className="space-y-0"
              >
                {LIGHTROOM_GROUPS.map((group) => (
                  <AccordionItem
                    key={group.key}
                    value={group.key}
                    className="border-b border-border"
                  >
                    <AccordionTrigger className="py-2.5 text-[12px] font-medium text-foreground hover:no-underline [&>svg]:h-3 [&>svg]:w-3">
                      <div className="flex items-center gap-2">
                        {group.label}
                        {/* Show dot if any param in group is AI-modified */}
                        {group.params.some((p) =>
                          aiModifiedKeys.has(p.key)
                        ) && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[#007AFF]" />
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2 pt-0">
                      <div className="space-y-0">
                        {group.params.map((param) => (
                          <ParamSlider
                            key={param.key}
                            param={param}
                            value={params[param.key] ?? param.defaultValue}
                            aiRecommendedValue={
                              aiRecommendedParams?.[param.key]
                            }
                            isAiModified={aiModifiedKeys.has(param.key)}
                            onChange={onParamChange}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Bottom Action Bar */}
      {hasAnalysis && (
        <div className="flex flex-col gap-2 border-t border-border p-4">
          <Button
            onClick={onGenerateXMP}
            disabled={isGenerating}
            className="h-8 w-full rounded-lg bg-primary text-[12px] font-medium text-primary-foreground shadow-none hover:bg-primary/90"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                生成 XMP 预设
              </>
            )}
          </Button>
          {xmpReady && (
            <Button
              variant="outline"
              onClick={onDownloadXMP}
              className="h-8 w-full rounded-lg border-border text-[12px] font-medium text-foreground hover:bg-secondary"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              下载预设
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onRegenerate}
            disabled={isGenerating}
            className="h-7 w-full text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            重新生成
          </Button>
        </div>
      )}
    </aside>
  )
}
