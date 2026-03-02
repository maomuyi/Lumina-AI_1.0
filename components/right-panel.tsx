"use client"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { ParamSlider } from "@/components/param-slider"
import { LIGHTROOM_GROUPS } from "@/lib/lightroom-params"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Download, RefreshCw, FileDown, Loader2, Sparkles } from "lucide-react"

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
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-sidebar">
      <ScrollArea className="flex-1">
        <div className="flex flex-col">
          {/* AI Strategy Section */}
          {(aiStrategy || isAnalyzing) && (
            <>
              <div className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    AI 调色策略
                  </span>
                </div>
                {isAnalyzing && !aiStrategy ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full bg-secondary" />
                    <Skeleton className="h-4 w-3/4 bg-secondary" />
                    <Skeleton className="h-4 w-5/6 bg-secondary" />
                  </div>
                ) : aiStrategy ? (
                  <div className="rounded-lg bg-glow-primary p-3 ring-1 ring-primary/10">
                    <p className="text-[12px] leading-relaxed text-foreground/90">
                      {aiStrategy}
                    </p>
                    {strategyTags.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {strategyTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="mx-4 h-px bg-border" />
            </>
          )}

          {/* Parameter Controls - Lightroom Style */}
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                参数建议
              </span>
            </div>

            {isAnalyzing && !hasAnalysis ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-3 w-16 bg-secondary" />
                    <Skeleton className="h-2 flex-1 bg-secondary" />
                    <Skeleton className="h-3 w-10 bg-secondary" />
                  </div>
                ))}
              </div>
            ) : (
              <Accordion
                type="multiple"
                defaultValue={defaultOpenGroups}
                className="space-y-0"
              >
                {LIGHTROOM_GROUPS.map((group) => {
                  const hasAiMods = group.params.some((p) =>
                    aiModifiedKeys.has(p.key)
                  )
                  return (
                    <AccordionItem
                      key={group.key}
                      value={group.key}
                      className="border-b border-border/50"
                    >
                      <AccordionTrigger className="py-2.5 text-[12px] font-semibold text-foreground/90 hover:text-foreground hover:no-underline [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground">
                        <div className="flex items-center gap-2">
                          {group.label}
                          {hasAiMods && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(108,142,255,0.6)]" />
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
                  )
                })}
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
            className="h-9 w-full rounded-lg bg-primary text-[12px] font-semibold text-primary-foreground shadow-[0_0_20px_rgba(108,142,255,0.2)] transition-all hover:bg-primary/90 hover:shadow-[0_0_30px_rgba(108,142,255,0.3)]"
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
              className="h-8 w-full rounded-lg border-border bg-transparent text-[12px] font-medium text-foreground/80 hover:bg-secondary hover:text-foreground"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              下载预设
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onRegenerate}
            disabled={isGenerating}
            className="h-7 w-full text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            重新生成
          </Button>
        </div>
      )}
    </aside>
  )
}
