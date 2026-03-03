/**
 * parseAI.ts — LLM 返回体三层防御解析
 *
 * 禁止在其他地方直接 JSON.parse() LLM 的原始文本。
 */

export interface LLMResponse {
    diagnostic_report: {
        module_1_diagnosis: string;
        module_2_physics: string;
        module_3_strategy: string;
        module_4_core_actions: string[];
    };
    lightroom_params: Record<string, number | number[]>;
}

const DEFAULT_SAFE_PRESET: LLMResponse = {
    diagnostic_report: {
        module_1_diagnosis: '【🖼 画面诊断】AI 返回异常，已使用安全预设。',
        module_2_physics: '【🔬 底层剖析】无法获取物理分析数据。',
        module_3_strategy: '【💡 美化建议】建议手动微调或重新生成。',
        module_4_core_actions: ['系统已自动使用零调整安全预设。'],
    },
    lightroom_params: {},
};

/**
 * 三层防御解析 LLM 原始输出。
 * 第一层：直接 JSON.parse
 * 第二层：提取 ```json ... ``` 代码块
 * 第三层：提取最外层 { ... } 对象
 * 全失败：返回安全预设
 */
export function safeParseAIResponse(rawText: string): LLMResponse {
    // 第一层
    try {
        return JSON.parse(rawText) as LLMResponse;
    } catch {
        // continue
    }

    // 第二层：markdown code block
    const mdMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch?.[1]) {
        try {
            return JSON.parse(mdMatch[1]) as LLMResponse;
        } catch {
            // continue
        }
    }

    // 第三层：提取最外层 JSON 对象
    const braceStart = rawText.indexOf('{');
    const braceEnd = rawText.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
        try {
            return JSON.parse(rawText.slice(braceStart, braceEnd + 1)) as LLMResponse;
        } catch {
            // continue
        }
    }

    console.error('[AI Parse Failed] Raw text preview:', rawText.slice(0, 300));
    return DEFAULT_SAFE_PRESET;
}
