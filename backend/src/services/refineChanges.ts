import type { LLMResponse } from '../utils/parseAI.js';
import { PARAM_DEFAULTS } from '../utils/clampParams.js';

type LightroomParams = Record<string, number | number[]>;

export interface ChangedParam {
    key: string;
    before: number;
    after: number;
    reason?: string;
}

const PARAM_LABELS: Record<string, string> = {
    Exposure2012: '曝光',
    Contrast2012: '对比度',
    Highlights2012: '高光',
    Shadows2012: '阴影',
    Whites2012: '白色',
    Blacks2012: '黑色',
    Temperature: '色温',
    Tint: '色调',
    Vibrance: '自然饱和度',
    Saturation: '饱和度',
    Clarity2012: '清晰度',
    Texture: '纹理',
    Dehaze: '去朦胧',
    LuminanceAdjustmentOrange: '橙色明度',
    LuminanceSmoothing: '明度降噪',
    ColorNoiseReduction: '颜色降噪',
    GrainAmount: '颗粒量',
    SplitToningShadowHue: '阴影色相',
    SplitToningShadowSaturation: '阴影染色',
    SplitToningHighlightHue: '高光色相',
    SplitToningHighlightSaturation: '高光染色',
    SplitToningBalance: '色调平衡',
    SaturationAdjustmentRed: '红色饱和度',
    SaturationAdjustmentOrange: '橙色饱和度',
    SaturationAdjustmentYellow: '黄色饱和度',
    SaturationAdjustmentGreen: '绿色饱和度',
    SaturationAdjustmentAqua: '青色饱和度',
    SaturationAdjustmentBlue: '蓝色饱和度',
    SaturationAdjustmentPurple: '紫色饱和度',
    SaturationAdjustmentMagenta: '洋红饱和度',
    LuminanceAdjustmentBlue: '蓝色明度',
    LuminanceAdjustmentGreen: '绿色明度',
};

const STYLE_PARAM_PRIORITY: Record<string, number> = {
    GrainAmount: 45,
    SplitToningShadowSaturation: 44,
    SplitToningHighlightSaturation: 43,
    Temperature: 42,
    SaturationAdjustmentGreen: 41,
    SaturationAdjustmentYellow: 40,
    SaturationAdjustmentBlue: 39,
    SaturationAdjustmentAqua: 38,
    SaturationAdjustmentMagenta: 37,
    SaturationAdjustmentPurple: 36,
    Contrast2012: 35,
    Blacks2012: 34,
    Highlights2012: 33,
    Vibrance: 32,
    Saturation: 31,
    Clarity2012: 30,
    Dehaze: 29,
    SplitToningShadowHue: 18,
    SplitToningHighlightHue: 17,
    SplitToningBalance: 16,
};

function round(value: number, digits = 2): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function formatDelta(value: number): string {
    const rounded = Math.abs(value) >= 10 ? Math.round(value) : round(value, 2);
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

function parseReasonMap(actions: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const action of actions) {
        const match = action.match(/【(.+?)】.*?[：:](.+)$/);
        if (!match) continue;
        map.set(match[1], match[2].trim());
    }
    return map;
}

function numericValueForDiff(key: string, value: number | number[] | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const fallback = PARAM_DEFAULTS[key];
    return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
}

function diffSortScore(item: ChangedParam): number {
    const delta = Math.abs(item.after - item.before);
    const priority = STYLE_PARAM_PRIORITY[item.key] ?? 0;

    if (item.key === 'Temperature') return priority + Math.min(delta / 120, 8);
    if (item.key.endsWith('Hue')) return priority + Math.min(delta / 45, 4);
    return priority + Math.min(delta / 3, 18);
}

export function buildChangedParams(
    before: LightroomParams,
    after: LightroomParams,
    diagnosticReport?: LLMResponse['diagnostic_report']
): ChangedParam[] {
    const reasonMap = parseReasonMap(diagnosticReport?.module_4_core_actions ?? []);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    return [...keys]
        .flatMap((key) => {
            const beforeValue = numericValueForDiff(key, before[key]);
            const afterValue = numericValueForDiff(key, after[key]);
            if (beforeValue === null || afterValue === null) return [];
            if (Math.abs(afterValue - beforeValue) < 0.01) return [];
            return [{
                key,
                before: round(beforeValue),
                after: round(afterValue),
                reason: reasonMap.get(key) ?? '根据本轮微调意图进行局部位移。',
            }];
        })
        .sort((a, b) => diffSortScore(b) - diffSortScore(a));
}

export function buildAssistantSummary(intent: string, changedParams: ChangedParam[]): string {
    if (changedParams.length === 0) {
        return `已根据“${intent}”检查当前预设，本轮没有产生明显参数位移。`;
    }

    const highlights = changedParams
        .slice(0, 3)
        .map((item) => `${PARAM_LABELS[item.key] ?? item.key} ${formatDelta(item.after - item.before)}`)
        .join(' / ');

    return `已根据“${intent}”生成新版本，重点调整：${highlights}。`;
}

export function buildReportSummary(
    report: LLMResponse['diagnostic_report'],
    assistantSummary: string
): string {
    const strategy = report.module_3_strategy
        .replace('【💡 美化建议】', '')
        .trim();
    if (!strategy) return assistantSummary;
    return strategy.length > 120 ? `${strategy.slice(0, 117)}...` : strategy;
}
