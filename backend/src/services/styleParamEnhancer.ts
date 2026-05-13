import type { RawDataForPrompt } from './prompt.js';
import {
    applyStyleIntentProfile,
    resolveStyleIntentProfile,
    type LightroomParams,
} from './styleProfiles.js';

const HSL_SATURATION_KEYS = [
    'SaturationAdjustmentRed',
    'SaturationAdjustmentOrange',
    'SaturationAdjustmentYellow',
    'SaturationAdjustmentGreen',
    'SaturationAdjustmentAqua',
    'SaturationAdjustmentBlue',
    'SaturationAdjustmentPurple',
    'SaturationAdjustmentMagenta',
];

function textOf(...parts: string[]): string {
    return parts.join(' ').toLowerCase();
}

function has(text: string, pattern: RegExp): boolean {
    return pattern.test(text);
}

function current(params: LightroomParams, key: string): number {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function set(params: LightroomParams, key: string, value: number): void {
    params[key] = value;
}

function merge(params: LightroomParams, key: string, delta: number, min = -100, max = 100): void {
    set(params, key, Math.max(min, Math.min(max, current(params, key) + delta)));
}

function applyBlackWhite(params: LightroomParams): void {
    set(params, 'Vibrance', -100);
    set(params, 'Saturation', -100);
    for (const key of HSL_SATURATION_KEYS) set(params, key, -100);
    set(params, 'SplitToningShadowSaturation', 0);
    set(params, 'SplitToningHighlightSaturation', 0);
    merge(params, 'Contrast2012', 16);
    merge(params, 'Blacks2012', -14);
    merge(params, 'Clarity2012', 8);
}

function applySimpleLocalIntent(params: LightroomParams, text: string): void {
    if (has(text, /亮一点|更亮|提亮|bright|brighter/)) {
        merge(params, 'Exposure2012', 0.28, -5, 5);
        merge(params, 'Shadows2012', 12);
        merge(params, 'Whites2012', 6);
    }
    if (has(text, /暗一点|更暗|压暗|moody|darker/)) {
        merge(params, 'Exposure2012', -0.22, -5, 5);
        merge(params, 'Blacks2012', -12);
        merge(params, 'Contrast2012', 8);
    }
    if (has(text, /冷|蓝|清冷|cool|blue/)) {
        merge(params, 'Temperature', -520, 2000, 50000);
        merge(params, 'SaturationAdjustmentBlue', 14);
        merge(params, 'SplitToningShadowHue', 215, 0, 359);
        merge(params, 'SplitToningShadowSaturation', 8, 0, 100);
    }
    if (has(text, /暖|夕阳|温暖|gold|warm/)) {
        merge(params, 'Temperature', 560, 2000, 50000);
        merge(params, 'SplitToningHighlightHue', 42, 0, 359);
        merge(params, 'SplitToningHighlightSaturation', 10, 0, 100);
    }
    if (has(text, /强一点|更明显|更浓|more|stronger/)) {
        merge(params, 'Contrast2012', 12);
        merge(params, 'Vibrance', 10);
        merge(params, 'Dehaze', 4);
    }
    if (has(text, /弱一点|自然|柔和|soft|less/)) {
        merge(params, 'Contrast2012', -8);
        merge(params, 'Saturation', -8);
        merge(params, 'Clarity2012', -5);
    }
    if (has(text, /肤色|皮肤|人像|portrait|skin|face/)) {
        merge(params, 'Vibrance', 8);
        set(params, 'SaturationAdjustmentOrange', Math.min(current(params, 'SaturationAdjustmentOrange'), 2));
        set(params, 'LuminanceAdjustmentOrange', Math.max(current(params, 'LuminanceAdjustmentOrange'), 16));
        set(params, 'Clarity2012', Math.min(current(params, 'Clarity2012'), 5));
    }
}

export function enhanceParamsForStyleIntent(
    params: LightroomParams,
    intent: string,
    style = '',
    rawData?: RawDataForPrompt,
    referenceParams?: LightroomParams
): LightroomParams {
    const next: LightroomParams = { ...params };
    const text = textOf(intent, style);

    if (has(text, /黑白|黑白风格|单色|灰度|灰阶|black\s*and\s*white|black\s*&\s*white|\bb&w\b|monochrome|grayscale/)) {
        applyBlackWhite(next);
        return next;
    }

    const profile = resolveStyleIntentProfile(intent, style);
    if (profile) {
        return applyStyleIntentProfile(next, profile, rawData, referenceParams);
    }

    applySimpleLocalIntent(next, text);
    return next;
}
