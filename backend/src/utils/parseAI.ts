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

function sanitizeRawText(input: string): string {
    return input
        .replace(/^\uFEFF/, '')
        .replace(/\r/g, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");
}

function parseCandidate(candidate: string): LLMResponse | null {
    const sanitized = sanitizeRawText(candidate).trim();
    if (!sanitized) return null;
    try {
        return normalizeResponse(JSON.parse(sanitized));
    } catch {
        return null;
    }
}

function extractBalancedObject(rawText: string): string | null {
    const s = sanitizeRawText(rawText);
    const start = s.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < s.length; i += 1) {
        const ch = s[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            depth += 1;
        } else if (ch === '}') {
            depth -= 1;
            if (depth === 0) {
                return s.slice(start, i + 1);
            }
        }
    }

    return null;
}

function repairPossiblyTruncatedJson(rawText: string): string | null {
    const s = sanitizeRawText(rawText);
    const start = s.indexOf('{');
    if (start === -1) return null;

    const core = s.slice(start).trim();
    if (!core) return null;

    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (let i = 0; i < core.length; i += 1) {
        const ch = core[i];

        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === '{') {
            stack.push('}');
        } else if (ch === '[') {
            stack.push(']');
        } else if (ch === '}' || ch === ']') {
            if (stack.length === 0) continue;
            const expected = stack[stack.length - 1];
            if (expected === ch) {
                stack.pop();
            }
        }
    }

    let repaired = core;
    // 去掉结尾明显不完整的逗号
    repaired = repaired.replace(/,\s*$/, '');
    // 去掉对象/数组闭合前多余逗号
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');

    if (inString) {
        repaired += '"';
    }
    while (stack.length > 0) {
        repaired += stack.pop();
    }
    return repaired;
}

function asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function normalizeActions(value: unknown): string[] {
    if (Array.isArray(value)) {
        const cleaned = value
            .map((item) => String(item ?? '').trim())
            .filter(Boolean);
        if (cleaned.length > 0) return cleaned;
    }
    if (typeof value === 'string' && value.trim()) {
        return value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
    }
    return [...DEFAULT_SAFE_PRESET.diagnostic_report.module_4_core_actions];
}

function normalizeParams(value: unknown): Record<string, number | number[]> {
    const obj = asObject(value);
    if (!obj) return {};

    const result: Record<string, number | number[]> = {};
    for (const [key, rawVal] of Object.entries(obj)) {
        if (Array.isArray(rawVal)) {
            const nums = rawVal
                .map((item) => Number(item))
                .filter((num) => Number.isFinite(num));
            if (nums.length > 0) {
                result[key] = nums;
            }
            continue;
        }

        const num = Number(rawVal);
        if (Number.isFinite(num)) {
            result[key] = num;
        }
    }

    return result;
}

function normalizeResponse(value: unknown): LLMResponse {
    const root = asObject(value);
    const report = asObject(root?.diagnostic_report);
    const module1 = typeof report?.module_1_diagnosis === 'string'
        ? report.module_1_diagnosis.trim()
        : DEFAULT_SAFE_PRESET.diagnostic_report.module_1_diagnosis;
    const module2 = typeof report?.module_2_physics === 'string'
        ? report.module_2_physics.trim()
        : DEFAULT_SAFE_PRESET.diagnostic_report.module_2_physics;
    const module3 = typeof report?.module_3_strategy === 'string'
        ? report.module_3_strategy.trim()
        : DEFAULT_SAFE_PRESET.diagnostic_report.module_3_strategy;
    const module4 = normalizeActions(report?.module_4_core_actions);
    const params = normalizeParams(root?.lightroom_params);

    return {
        diagnostic_report: {
            module_1_diagnosis: module1 || DEFAULT_SAFE_PRESET.diagnostic_report.module_1_diagnosis,
            module_2_physics: module2 || DEFAULT_SAFE_PRESET.diagnostic_report.module_2_physics,
            module_3_strategy: module3 || DEFAULT_SAFE_PRESET.diagnostic_report.module_3_strategy,
            module_4_core_actions: module4,
        },
        lightroom_params: params,
    };
}

/**
 * 三层防御解析 LLM 原始输出。
 * 第一层：直接 JSON.parse
 * 第二层：提取 ```json ... ``` 代码块
 * 第三层：提取最外层 { ... } 对象
 * 全失败：返回安全预设
 */
export function safeParseAIResponse(rawText: string): LLMResponse {
    const direct = parseCandidate(rawText);
    if (direct) return direct;

    // code block 提取
    const mdMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (mdMatch?.[1]) {
        const fromCodeBlock = parseCandidate(mdMatch[1]);
        if (fromCodeBlock) return fromCodeBlock;
    }

    // 提取平衡对象
    const balanced = extractBalancedObject(rawText);
    if (balanced) {
        const parsed = parseCandidate(balanced);
        if (parsed) return parsed;
    }

    // 截断修复（优先救回 diagnostic_report/lightroom_params）
    const repaired = repairPossiblyTruncatedJson(rawText);
    if (repaired) {
        const parsed = parseCandidate(repaired);
        if (parsed) return parsed;
    }

    console.error('[AI Parse Failed] Raw text preview:', rawText.slice(0, 300));
    return DEFAULT_SAFE_PRESET;
}
