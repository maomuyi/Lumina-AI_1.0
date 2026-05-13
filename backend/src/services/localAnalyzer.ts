import type { RawDataForPrompt } from './prompt.js';
import { resolveStyleIntentProfile } from './styleProfiles.js';
import type { LLMResponse } from '../utils/parseAI.js';

type LightroomParams = Record<string, number | number[]>;

export type SceneLabel =
    | 'portrait_natural'
    | 'portrait_low_light'
    | 'landscape_clear'
    | 'landscape_overcast'
    | 'jpg_burned'
    | 'low_light'
    | 'film_soft'
    | 'general_raw'
    | 'general_jpg';

export const SCENE_CHIP_MAP: Record<SceneLabel, string[]> = {
    portrait_natural: ['肤色更干净', '背景再冷一点', '降低脸部高光', '胶片感弱一点'],
    portrait_low_light: ['保留肤色质感', '暗部更通透', '降低噪点', '暖色再多一点'],
    landscape_clear: ['天空更蓝', '高光再压一点', '暗部更通透', '整体更电影感'],
    landscape_overcast: ['阴天通透感', '增加层次感', '突出主体色', '降低灰度'],
    jpg_burned: ['保守一点', '降低饱和度', '减少颗粒', '避免高光过曝'],
    low_light: ['暗部更通透', '降低噪点', '保留氛围', '高光别太刺眼'],
    film_soft: ['胶片颗粒弱一点', '高光更柔', '绿色再淡一点', '肤色更暖'],
    general_raw: ['高光再压一点', '暗部更通透', '整体更自然', '对比强一点'],
    general_jpg: ['保守一点', '降低饱和度', '减少颗粒', '避免断层'],
};

const SCENE_DISPLAY_NAME: Record<SceneLabel, string> = {
    portrait_natural: '人像/肤色优先',
    portrait_low_light: '暗光人像',
    landscape_clear: '晴朗风景',
    landscape_overcast: '阴天风景',
    jpg_burned: 'JPG 高光风险',
    low_light: '暗光/霓虹风格',
    film_soft: '复古胶片',
    general_raw: 'RAW 通用调色',
    general_jpg: 'JPG 保守调色',
};

const STYLE_PROFILES: Record<string, Partial<LightroomParams>> = {
    japanese: {
        Temperature: 6200,
        Tint: -4,
        Exposure2012: 0.35,
        Contrast2012: -14,
        Highlights2012: -35,
        Shadows2012: 32,
        Whites2012: 20,
        Blacks2012: -10,
        Texture: -4,
        Clarity2012: -8,
        Dehaze: -8,
        Vibrance: 22,
        Saturation: -5,
        HueAdjustmentRed: 4,
        HueAdjustmentOrange: -4,
        HueAdjustmentYellow: -18,
        HueAdjustmentGreen: -25,
        HueAdjustmentAqua: -15,
        HueAdjustmentBlue: -10,
        HueAdjustmentPurple: 0,
        HueAdjustmentMagenta: 0,
        SaturationAdjustmentRed: 2,
        SaturationAdjustmentOrange: -8,
        SaturationAdjustmentYellow: -20,
        SaturationAdjustmentGreen: -32,
        SaturationAdjustmentAqua: 8,
        SaturationAdjustmentBlue: 18,
        SaturationAdjustmentPurple: -12,
        SaturationAdjustmentMagenta: -10,
        LuminanceAdjustmentRed: 8,
        LuminanceAdjustmentOrange: 18,
        LuminanceAdjustmentYellow: 20,
        LuminanceAdjustmentGreen: 18,
        LuminanceAdjustmentAqua: 14,
        LuminanceAdjustmentBlue: 20,
        LuminanceAdjustmentPurple: 6,
        LuminanceAdjustmentMagenta: 8,
        SplitToningShadowHue: 205,
        SplitToningShadowSaturation: 5,
        SplitToningHighlightHue: 48,
        SplitToningHighlightSaturation: 10,
        SplitToningBalance: 20,
        Sharpness: 38,
        SharpenRadius: 1,
        SharpenDetail: 18,
        SharpenEdgeMasking: 18,
        GrainAmount: 8,
        GrainSize: 18,
        GrainFrequency: 45,
        PostCropVignetteAmount: 0,
    },
    film: {
        Temperature: 5600,
        Tint: 7,
        Exposure2012: 0.08,
        Contrast2012: -12,
        Highlights2012: -45,
        Shadows2012: 24,
        Whites2012: -10,
        Blacks2012: 16,
        Texture: -6,
        Clarity2012: -10,
        Dehaze: -8,
        Vibrance: 10,
        Saturation: -8,
        HueAdjustmentRed: 6,
        HueAdjustmentOrange: -6,
        HueAdjustmentYellow: -18,
        HueAdjustmentGreen: -35,
        HueAdjustmentAqua: -20,
        HueAdjustmentBlue: -12,
        HueAdjustmentPurple: 4,
        HueAdjustmentMagenta: 8,
        SaturationAdjustmentRed: 4,
        SaturationAdjustmentOrange: -4,
        SaturationAdjustmentYellow: -22,
        SaturationAdjustmentGreen: -28,
        SaturationAdjustmentAqua: -10,
        SaturationAdjustmentBlue: -12,
        SaturationAdjustmentPurple: -8,
        SaturationAdjustmentMagenta: -6,
        LuminanceAdjustmentRed: 4,
        LuminanceAdjustmentOrange: 10,
        LuminanceAdjustmentYellow: 8,
        LuminanceAdjustmentGreen: -4,
        LuminanceAdjustmentAqua: 0,
        LuminanceAdjustmentBlue: -8,
        LuminanceAdjustmentPurple: 0,
        LuminanceAdjustmentMagenta: 2,
        SplitToningShadowHue: 215,
        SplitToningShadowSaturation: 12,
        SplitToningHighlightHue: 48,
        SplitToningHighlightSaturation: 14,
        SplitToningBalance: 5,
        Sharpness: 32,
        SharpenRadius: 1.1,
        SharpenDetail: 12,
        SharpenEdgeMasking: 24,
        GrainAmount: 32,
        GrainSize: 32,
        GrainFrequency: 48,
        PostCropVignetteAmount: -8,
    },
    cyberpunk: {
        Temperature: 4400,
        Tint: 18,
        Exposure2012: -0.05,
        Contrast2012: 32,
        Highlights2012: -40,
        Shadows2012: 22,
        Whites2012: 15,
        Blacks2012: -28,
        Texture: 10,
        Clarity2012: 18,
        Dehaze: 12,
        Vibrance: 36,
        Saturation: 8,
        HueAdjustmentRed: -8,
        HueAdjustmentOrange: -12,
        HueAdjustmentYellow: -35,
        HueAdjustmentGreen: -55,
        HueAdjustmentAqua: -25,
        HueAdjustmentBlue: -12,
        HueAdjustmentPurple: 18,
        HueAdjustmentMagenta: 16,
        SaturationAdjustmentRed: 10,
        SaturationAdjustmentOrange: -18,
        SaturationAdjustmentYellow: -45,
        SaturationAdjustmentGreen: -30,
        SaturationAdjustmentAqua: 32,
        SaturationAdjustmentBlue: 44,
        SaturationAdjustmentPurple: 38,
        SaturationAdjustmentMagenta: 42,
        LuminanceAdjustmentRed: -4,
        LuminanceAdjustmentOrange: 6,
        LuminanceAdjustmentYellow: -6,
        LuminanceAdjustmentGreen: -15,
        LuminanceAdjustmentAqua: -4,
        LuminanceAdjustmentBlue: -8,
        LuminanceAdjustmentPurple: -6,
        LuminanceAdjustmentMagenta: 4,
        SplitToningShadowHue: 200,
        SplitToningShadowSaturation: 28,
        SplitToningHighlightHue: 320,
        SplitToningHighlightSaturation: 22,
        SplitToningBalance: -20,
        Sharpness: 48,
        SharpenRadius: 1,
        SharpenDetail: 32,
        SharpenEdgeMasking: 10,
        GrainAmount: 12,
        GrainSize: 20,
        GrainFrequency: 55,
        PostCropVignetteAmount: -12,
    },
    grey: {
        Temperature: 5200,
        Tint: -2,
        Exposure2012: 0.05,
        Contrast2012: -10,
        Highlights2012: -42,
        Shadows2012: 24,
        Whites2012: -18,
        Blacks2012: -6,
        Texture: 4,
        Clarity2012: 4,
        Dehaze: -5,
        Vibrance: -32,
        Saturation: -24,
        HueAdjustmentRed: 0,
        HueAdjustmentOrange: -8,
        HueAdjustmentYellow: -18,
        HueAdjustmentGreen: -28,
        HueAdjustmentAqua: -18,
        HueAdjustmentBlue: -10,
        HueAdjustmentPurple: -8,
        HueAdjustmentMagenta: -6,
        SaturationAdjustmentRed: -18,
        SaturationAdjustmentOrange: -14,
        SaturationAdjustmentYellow: -34,
        SaturationAdjustmentGreen: -40,
        SaturationAdjustmentAqua: -28,
        SaturationAdjustmentBlue: -24,
        SaturationAdjustmentPurple: -30,
        SaturationAdjustmentMagenta: -28,
        LuminanceAdjustmentRed: 4,
        LuminanceAdjustmentOrange: 8,
        LuminanceAdjustmentYellow: 10,
        LuminanceAdjustmentGreen: 6,
        LuminanceAdjustmentAqua: 4,
        LuminanceAdjustmentBlue: 2,
        LuminanceAdjustmentPurple: 0,
        LuminanceAdjustmentMagenta: 2,
        SplitToningShadowHue: 220,
        SplitToningShadowSaturation: 4,
        SplitToningHighlightHue: 45,
        SplitToningHighlightSaturation: 3,
        SplitToningBalance: 0,
        Sharpness: 42,
        SharpenRadius: 1,
        SharpenDetail: 18,
        SharpenEdgeMasking: 22,
        GrainAmount: 16,
        GrainSize: 24,
        GrainFrequency: 50,
        PostCropVignetteAmount: -6,
    },
    cinematic: {
        Temperature: 4900,
        Tint: 4,
        Exposure2012: -0.08,
        Contrast2012: 28,
        Highlights2012: -50,
        Shadows2012: 24,
        Whites2012: 5,
        Blacks2012: -30,
        Texture: 8,
        Clarity2012: 14,
        Dehaze: 10,
        Vibrance: 18,
        Saturation: -4,
        HueAdjustmentRed: 2,
        HueAdjustmentOrange: -4,
        HueAdjustmentYellow: -26,
        HueAdjustmentGreen: -45,
        HueAdjustmentAqua: -30,
        HueAdjustmentBlue: -22,
        HueAdjustmentPurple: -6,
        HueAdjustmentMagenta: -8,
        SaturationAdjustmentRed: 4,
        SaturationAdjustmentOrange: -6,
        SaturationAdjustmentYellow: -28,
        SaturationAdjustmentGreen: -34,
        SaturationAdjustmentAqua: 12,
        SaturationAdjustmentBlue: 22,
        SaturationAdjustmentPurple: -8,
        SaturationAdjustmentMagenta: -8,
        LuminanceAdjustmentRed: 0,
        LuminanceAdjustmentOrange: 12,
        LuminanceAdjustmentYellow: -4,
        LuminanceAdjustmentGreen: -12,
        LuminanceAdjustmentAqua: -8,
        LuminanceAdjustmentBlue: -14,
        LuminanceAdjustmentPurple: -4,
        LuminanceAdjustmentMagenta: -4,
        SplitToningShadowHue: 220,
        SplitToningShadowSaturation: 18,
        SplitToningHighlightHue: 42,
        SplitToningHighlightSaturation: 16,
        SplitToningBalance: -25,
        Sharpness: 46,
        SharpenRadius: 1,
        SharpenDetail: 26,
        SharpenEdgeMasking: 18,
        GrainAmount: 14,
        GrainSize: 22,
        GrainFrequency: 52,
        PostCropVignetteAmount: -18,
    },
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 0): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function signed(value: number): string {
    const v = Math.abs(value) >= 10 ? Math.round(value) : round(value, 2);
    return v > 0 ? `+${v}` : String(v);
}

function addParam(params: LightroomParams, key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    if (Math.abs(value) < 0.01) return;
    params[key] = round(value, Math.abs(value) < 10 ? 2 : 0);
}

function mergeParam(params: LightroomParams, key: string, delta: number): void {
    const current = typeof params[key] === 'number' ? params[key] as number : 0;
    addParam(params, key, current + delta);
}

function setParam(params: LightroomParams, key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    params[key] = round(value, Math.abs(value) < 10 ? 2 : 0);
}

function histogramStats(hist: number[]): {
    peakNorm: number;
    leftTail: number;
    rightTail: number;
    midWeight: number;
} {
    if (!Array.isArray(hist) || hist.length === 0) {
        return { peakNorm: 0.5, leftTail: 0, rightTail: 0, midWeight: 1 };
    }
    const total = Math.max(1, hist.reduce((sum, value) => sum + value, 0));
    const peakIndex = hist.reduce((bestIdx, value, idx) => (value > hist[bestIdx] ? idx : bestIdx), 0);
    const tailSize = Math.max(2, Math.ceil(hist.length * 0.08));
    const midStart = Math.floor(hist.length * 0.35);
    const midEnd = Math.ceil(hist.length * 0.65);

    return {
        peakNorm: hist.length > 1 ? peakIndex / (hist.length - 1) : 0.5,
        leftTail: hist.slice(0, tailSize).reduce((sum, value) => sum + value, 0) / total,
        rightTail: hist.slice(-tailSize).reduce((sum, value) => sum + value, 0) / total,
        midWeight: hist.slice(midStart, midEnd).reduce((sum, value) => sum + value, 0) / total,
    };
}

export function detectScene(rawData: RawDataForPrompt, intent = '', style = 'auto'): SceneLabel {
    const text = `${intent} ${style}`.toLowerCase();
    const iso = rawData.exif.iso ?? 200;
    const sp = rawData.sensor_physics;
    const stats = histogramStats(rawData.linear_histogram);
    const isPortrait = /人像|肤色|皮肤|portrait|face|skin|婚纱|写真/.test(text);
    const isLandscape = /天空|蓝天|风景|landscape|sky|山|海|旅行|树|草地/.test(text);

    if (rawData.file_type === 'JPG' && sp.highlight_clipping_rate > 0.05) return 'jpg_burned';
    if (isPortrait && (iso >= 1600 || sp.shadow_survival_rate < 0.9)) return 'portrait_low_light';
    if (isPortrait) return 'portrait_natural';
    if (isLandscape && (stats.peakNorm > 0.58 || sp.highlight_clipping_rate > 0.025)) return 'landscape_clear';
    if (isLandscape) return 'landscape_overcast';
    if (/夜景|暗光|低光|night|neon|赛博|cyber/.test(text) || iso >= 1600) return 'low_light';
    if (/胶片|复古|film|retro/.test(text)) return 'film_soft';
    return rawData.file_type === 'NEF' ? 'general_raw' : 'general_jpg';
}

export function getSceneChips(sceneLabel: SceneLabel | string): string[] {
    return SCENE_CHIP_MAP[sceneLabel as SceneLabel] ?? SCENE_CHIP_MAP.general_raw;
}

function inferScene(intent: string, style: string, rawData: RawDataForPrompt): string {
    return SCENE_DISPLAY_NAME[detectScene(rawData, intent, style)];
}

function intentHas(intent: string, pattern: RegExp): boolean {
    return pattern.test(intent.toLowerCase());
}

function isBlackWhiteIntent(intent: string): boolean {
    return intentHas(intent, /黑白|黑白风格|单色|灰度|灰阶|black\s*and\s*white|black\s*&\s*white|\bb&w\b|monochrome|grayscale/);
}

function applyBlackWhite(params: LightroomParams): void {
    params.Vibrance = -100;
    params.Saturation = -100;
    for (const key of [
        'SaturationAdjustmentRed',
        'SaturationAdjustmentOrange',
        'SaturationAdjustmentYellow',
        'SaturationAdjustmentGreen',
        'SaturationAdjustmentAqua',
        'SaturationAdjustmentBlue',
        'SaturationAdjustmentPurple',
        'SaturationAdjustmentMagenta',
    ]) {
        params[key] = -100;
    }
    params.SplitToningShadowSaturation = 0;
    params.SplitToningHighlightSaturation = 0;
    mergeParam(params, 'Contrast2012', 10);
    mergeParam(params, 'Blacks2012', -6);
    mergeParam(params, 'Clarity2012', 4);
}

function applyStyle(params: LightroomParams, style: string, strength = 1.0): void {
    const profile = STYLE_PROFILES[style];
    if (!profile) return;
    const amount = clamp(strength, 0, 1);
    for (const [key, value] of Object.entries(profile)) {
        if (typeof value === 'number') {
            const current = typeof params[key] === 'number' ? params[key] as number : 0;
            setParam(params, key, (current * (1 - amount)) + (value * amount));
        }
    }
}

function buildBaseParams(rawData: RawDataForPrompt, userIntent: string, style: string): LightroomParams {
    const params: LightroomParams = {};
    const sp = rawData.sensor_physics;
    const stats = histogramStats(rawData.linear_histogram);
    const iso = rawData.exif.iso ?? 200;

    const exposure = clamp((0.5 - stats.peakNorm) * 1.4 - sp.highlight_clipping_rate * 2.2, -1.2, 1.2);
    const shadowLift = clamp((1 - sp.shadow_survival_rate) * 120 + Math.max(0, 0.38 - stats.peakNorm) * 70, 0, 42);
    const highlightPull = clamp(sp.highlight_clipping_rate * -760 - stats.rightTail * 130, -55, 0);
    const whiteControl = clamp(sp.highlight_clipping_rate > 0.03 ? -18 - sp.highlight_clipping_rate * 150 : 6 - stats.rightTail * 40, -38, 14);
    const blackAnchor = clamp(-10 - Math.max(0, exposure) * 16 + stats.leftTail * 40, -34, 10);
    const contrast = clamp(8 + (0.38 - stats.midWeight) * 28 - sp.highlight_clipping_rate * 120, -14, 22);

    addParam(params, 'Exposure2012', exposure);
    addParam(params, 'Highlights2012', highlightPull);
    addParam(params, 'Shadows2012', rawData.file_type === 'JPG' ? Math.min(shadowLift, 40) : shadowLift);
    addParam(params, 'Whites2012', whiteControl);
    addParam(params, 'Blacks2012', blackAnchor);
    addParam(params, 'Contrast2012', contrast);

    const multipliers = sp.raw_channel_multipliers ?? [];
    if (multipliers.length >= 3) {
        const redBias = multipliers[0] - 1;
        const blueBias = multipliers[2] - 1;
        addParam(params, 'Temperature', clamp(5500 + (blueBias - redBias) * 1400, 4200, 7200));
        addParam(params, 'Tint', clamp((redBias - blueBias) * 20, -24, 24));
    }

    addParam(params, 'Texture', rawData.file_type === 'NEF' ? 8 : 4);
    addParam(params, 'Clarity2012', iso >= 1600 ? 0 : 5);
    addParam(params, 'Vibrance', rawData.color_space === 'P3' ? 8 : 14);
    addParam(params, 'ColorNoiseReduction', iso >= 800 ? 35 : 25);

    if (iso >= 1600 || sp.shadow_survival_rate < 0.9) {
        addParam(params, 'LuminanceSmoothing', clamp(18 + (iso / 6400) * 30, 20, 55));
        addParam(params, 'Dehaze', -3);
    } else {
        addParam(params, 'Dehaze', rawData.file_type === 'NEF' ? 4 : 0);
    }

    if (sp.banding_risk === 'high' || rawData.file_type === 'JPG') {
        addParam(params, 'GrainAmount', sp.banding_risk === 'high' ? 24 : 12);
        addParam(params, 'GrainSize', 24);
        addParam(params, 'GrainFrequency', 48);
    }

    applyStyle(params, style);

    if (intentHas(userIntent, /冷|蓝|清冷|cool|blue/)) {
        mergeParam(params, 'Temperature', -450);
        mergeParam(params, 'SaturationAdjustmentBlue', 10);
    }
    if (intentHas(userIntent, /暖|夕阳|温暖|warm|gold/)) {
        mergeParam(params, 'Temperature', 520);
        mergeParam(params, 'SplitToningHighlightHue', 42);
        mergeParam(params, 'SplitToningHighlightSaturation', 8);
    }
    if (intentHas(userIntent, /肤色|皮肤|人脸|人像|skin|face|portrait/)) {
        mergeParam(params, 'Vibrance', 8);
        mergeParam(params, 'SaturationAdjustmentOrange', -4);
        mergeParam(params, 'LuminanceAdjustmentOrange', 16);
        addParam(params, 'Clarity2012', Math.min(typeof params.Clarity2012 === 'number' ? params.Clarity2012 : 0, 5));
    }
    if (intentHas(userIntent, /通透|干净|明亮|bright|clean/)) {
        mergeParam(params, 'Exposure2012', 0.18);
        mergeParam(params, 'Shadows2012', 10);
        mergeParam(params, 'Blacks2012', -8);
    }
    if (intentHas(userIntent, /胶片|颗粒|复古|film|grain|retro/)) {
        mergeParam(params, 'GrainAmount', 18);
        mergeParam(params, 'Highlights2012', -8);
        mergeParam(params, 'Blacks2012', 8);
    }
    if (isBlackWhiteIntent(userIntent)) {
        applyBlackWhite(params);
    }

    return params;
}

function action(key: string, value: number | number[], reason: string): string {
    const display = Array.isArray(value)
        ? '曲线'
        : key === 'Temperature'
            ? `${Math.round(value)}K`
            : signed(value);
    return `【${key}】${display}：${reason}`;
}

function buildActions(params: LightroomParams, rawData: RawDataForPrompt): string[] {
    const isRaw = rawData.file_type === 'NEF';
    const preferred = [
        'Exposure2012',
        'Highlights2012',
        'Shadows2012',
        'Whites2012',
        'Blacks2012',
        'Temperature',
        'Tint',
        'Vibrance',
        'LuminanceSmoothing',
        'GrainAmount',
    ];
    const reasons: Record<string, string> = {
        Exposure2012: '按直方图主峰回校中间调，避免整体曝光偏移。',
        Highlights2012: isRaw
            ? '压回 RAW 高光溢出风险，保留亮部纹理。'
            : '按 JPG 亮部溢出迹象保守压高光，避免压缩图继续发白。',
        Shadows2012: isRaw
            ? '在 RAW 暗部存活率允许范围内抬升阴影。'
            : '按 JPG 暗部压缩迹象小幅提亮，避免拉出脏噪与色块。',
        Whites2012: isRaw
            ? '控制 RAW 白场冲击力，避免高光断层。'
            : '控制 JPG 白场冲击力，降低压缩高光断层可见性。',
        Blacks2012: '重新锚定黑位，防止提亮后画面发灰。',
        Temperature: '依据通道倍率和用户风格倾向校正白平衡。',
        Tint: '修正绿/洋红轴，稳定中性灰与肤色观感。',
        Vibrance: '使用自然饱和度提升色彩，减少肤色过冲。',
        LuminanceSmoothing: '按 ISO 与暗部质量介入降噪。',
        GrainAmount: '用颗粒打散压缩色阶，降低断层可见性。',
    };

    const actions = preferred
        .filter((key) => key in params)
        .map((key) => action(key, params[key], reasons[key] ?? '按本地规则引擎进行参数校准。'));

    if (actions.length >= 6) return actions.slice(0, 8);

    actions.push(action('Contrast2012', params.Contrast2012 ?? 0, '根据中间调重量补偿微反差。'));
    actions.push(action('Texture', params.Texture ?? 0, '保留边缘质感，同时避免过度锐化。'));
    actions.push(action('ColorNoiseReduction', params.ColorNoiseReduction ?? 25, '稳定暗部色噪，保护输出观感。'));

    return actions.slice(0, 8);
}

export function buildLocalAnalysis(
    rawData: RawDataForPrompt,
    userIntent: string,
    style: string
): LLMResponse {
    const sp = rawData.sensor_physics;
    const stats = histogramStats(rawData.linear_histogram);
    const scene = inferScene(userIntent, style, rawData);
    const params = buildBaseParams(rawData, userIntent, style);
    const iso = rawData.exif.iso ?? 'unknown';
    const isRaw = rawData.file_type === 'NEF';

    return {
        diagnostic_report: {
            module_1_diagnosis: isRaw
                ? `【🖼 画面诊断】本地规则引擎判定为${scene}。RAW 直方图主峰位于${round(stats.peakNorm * 100)}%亮度区，当前主要矛盾是高光保护、暗部可救度与用户风格之间的平衡。方案先稳定曝光基线，再输出可导入 Lightroom 的 XMP 参数。`
                : `【🖼 画面诊断】本地规则引擎判定为${scene}。JPG 直方图主峰位于${round(stats.peakNorm * 100)}%亮度区；此路径不做 RAW 物理宽容度判断，只依据预览图、压缩特征与用户意图生成保守调色建议。`,
            module_2_physics: isRaw
                ? `【🔬 底层剖析】file_type=${rawData.file_type}，bit_depth=${sp.bit_depth}，ISO=${iso}，highlight_clipping_rate=${round(sp.highlight_clipping_rate * 100, 2)}%，shadow_survival_rate=${round(sp.shadow_survival_rate * 100, 1)}%，banding_risk=${sp.banding_risk}，hist_peak=${round(stats.peakNorm * 100)}%。`
                : `【🔬 底层剖析】JPG visual_stats：bit_depth=8，ISO=${iso}，estimated_highlight_clip=${round(sp.highlight_clipping_rate * 100, 2)}%，estimated_shadow_integrity=${round(sp.shadow_survival_rate * 100, 1)}%，banding_risk=${sp.banding_risk}，hist_peak=${round(stats.peakNorm * 100)}%。这些指标来自压缩图像素统计，不等同 RAW 传感器物理余量。`,
            module_3_strategy: isRaw
                ? `【💡 美化建议】基线校准使用 RAW 直方图主峰与通道倍率；光影重映射优先压高光、补阴影、锚黑位；颜色分级按${style === 'auto' ? '自动风格' : style}与用户意图微调；画质防御按 ISO、位深和断层风险介入降噪/颗粒。`
                : `【💡 美化建议】JPG 路径先走视觉语义和压缩特征判断；参数以保守、可逆、不过度拉扯为原则，颜色分级按${style === 'auto' ? '自动风格' : style}与用户意图微调，并用降噪/颗粒降低压缩断层可见性。`,
            module_4_core_actions: buildActions(params, rawData),
        },
        lightroom_params: params,
    };
}

export function buildLocalRefine(
    previousParams: LightroomParams,
    rawData: RawDataForPrompt,
    newIntent: string
): LLMResponse {
    const nextParams: LightroomParams = { ...previousParams };
    const adjustment = buildBaseParams(rawData, newIntent, 'auto');
    const styleProfile = resolveStyleIntentProfile(newIntent);
    const previousWeight = styleProfile ? 0 : 0.30;
    const adjustmentWeight = 1 - previousWeight;

    for (const [key, value] of Object.entries(adjustment)) {
        if (typeof value !== 'number') continue;
        const current = typeof nextParams[key] === 'number' ? nextParams[key] as number : 0;
        nextParams[key] = round(current * previousWeight + value * adjustmentWeight, Math.abs(value) < 10 ? 2 : 0);
    }

    if (intentHas(newIntent, /强一点|更明显|more|stronger/)) {
        for (const key of ['Contrast2012', 'Vibrance', 'Shadows2012']) {
            if (typeof nextParams[key] === 'number') nextParams[key] = round((nextParams[key] as number) * 1.15);
        }
    }
    if (intentHas(newIntent, /弱一点|自然|soft|less/)) {
        for (const key of ['Contrast2012', 'Vibrance', 'Saturation', 'Clarity2012']) {
            if (typeof nextParams[key] === 'number') nextParams[key] = round((nextParams[key] as number) * 0.75);
        }
    }
    if (isBlackWhiteIntent(newIntent)) {
        applyBlackWhite(nextParams);
    }

    return {
        diagnostic_report: {
            module_1_diagnosis: rawData.file_type === 'NEF'
                ? `【🖼 画面诊断】本地微调引擎已根据“${newIntent}”重新计算参数。此次不重传图片，沿用首轮 RAW 物理数据和上一轮参数作为边界。`
                : `【🖼 画面诊断】本地微调引擎已根据“${newIntent}”重新计算参数。此次不重传图片，沿用首轮 JPG 视觉/压缩特征和上一轮参数作为边界。`,
            module_2_physics: rawData.file_type === 'NEF'
                ? `【🔬 底层剖析】继续受 bit_depth=${rawData.sensor_physics.bit_depth}、highlight_clipping_rate=${round(rawData.sensor_physics.highlight_clipping_rate * 100, 2)}%、shadow_survival_rate=${round(rawData.sensor_physics.shadow_survival_rate * 100, 1)}%、banding_risk=${rawData.sensor_physics.banding_risk} 约束。`
                : `【🔬 底层剖析】继续受 JPG visual_stats 约束：estimated_highlight_clip=${round(rawData.sensor_physics.highlight_clipping_rate * 100, 2)}%、estimated_shadow_integrity=${round(rawData.sensor_physics.shadow_survival_rate * 100, 1)}%、banding_risk=${rawData.sensor_physics.banding_risk}。此处不等同 RAW 物理宽容度。`,
            module_3_strategy: styleProfile
                ? '【💡 美化建议】本轮识别为风格化请求，取消旧版 70/30 保守平滑；在底片安全边界内优先推动光影、HSL、冷暖、颗粒和分离色调产生可见差异。'
                : '【💡 美化建议】微调策略保留上一版光影骨架，只在用户意图相关的白平衡、饱和度、阴影、高光和质感参数上做局部位移，避免整套预设漂移。',
            module_4_core_actions: buildActions(nextParams, rawData),
        },
        lightroom_params: nextParams,
    };
}
