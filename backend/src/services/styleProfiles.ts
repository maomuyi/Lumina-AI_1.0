import type { RawDataForPrompt } from './prompt.js';
import { PARAM_DEFAULTS } from '../utils/clampParams.js';

export type StyleIntensity = 'visible';
export type LightroomParams = Record<string, number | number[]>;

export interface StyleIntentProfile {
    id: string;
    label: string;
    intensity: StyleIntensity;
    patterns: RegExp[];
    searchTerms: string[];
    visualTraits: string[];
    lightroomBiases: Record<string, number>;
    minVisibleDeltas: Record<string, number>;
    hslTendencies: string[];
    textureTendencies: string[];
    riskLimits: string[];
}

type NumericParams = Record<string, number>;

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

function profile(input: Omit<StyleIntentProfile, 'intensity'>): StyleIntentProfile {
    return { ...input, intensity: 'visible' };
}

const STYLE_PROFILES: StyleIntentProfile[] = [
    profile({
        id: 'black_white',
        label: '黑白高级灰',
        patterns: [/黑白|单色|灰度|灰阶|高级灰|black\s*and\s*white|black\s*&\s*white|\bb&w\b|monochrome|grayscale/i],
        searchTerms: ['black and white fine art Lightroom contrast grain'],
        visualTraits: ['去除色彩干扰', '增强明暗结构', '用黑位和微反差建立高级灰层次'],
        lightroomBiases: {
            Vibrance: -100,
            Saturation: -100,
            Contrast2012: 18,
            Blacks2012: -16,
            Clarity2012: 8,
            Texture: 6,
            GrainAmount: 12,
        },
        minVisibleDeltas: {
            Saturation: 100,
            Vibrance: 100,
            Contrast2012: 14,
            Blacks2012: 12,
        },
        hslTendencies: ['全部 HSL 饱和度压到 -100，避免残留色偏'],
        textureTendencies: ['用轻颗粒和微反差支撑黑白质感'],
        riskLimits: ['高 ISO 场景降低清晰度，避免噪点变硬'],
    }),
    profile({
        id: 'xiaohongshu_clean',
        label: '小红书清透低饱和',
        patterns: [/小红书|低饱和|清透|通透|日杂|日系|韩系|clean|airy|muted|low\s*saturation|korean|japanese/i],
        searchTerms: ['xiaohongshu low saturation clean airy Lightroom look', 'japanese magazine clean muted color grading'],
        visualTraits: ['整体低饱和但亮部干净', '绿色与黄色降密度', '肤色提亮但不过橙'],
        lightroomBiases: {
            Exposure2012: 0.28,
            Highlights2012: -24,
            Shadows2012: 18,
            Whites2012: 10,
            Blacks2012: -12,
            Contrast2012: -8,
            Clarity2012: -8,
            Dehaze: -7,
            Vibrance: -10,
            Saturation: -12,
            SaturationAdjustmentGreen: -34,
            SaturationAdjustmentYellow: -28,
            SaturationAdjustmentOrange: -7,
            LuminanceAdjustmentOrange: 18,
        },
        minVisibleDeltas: {
            Highlights2012: 18,
            Shadows2012: 14,
            Saturation: 10,
            SaturationAdjustmentGreen: 22,
            SaturationAdjustmentYellow: 18,
            LuminanceAdjustmentOrange: 12,
        },
        hslTendencies: ['降低绿色/黄色饱和度', '提高橙色明度并压低橙色饱和'],
        textureTendencies: ['降低清晰度和去朦胧，让空气感更明显'],
        riskLimits: ['JPG/8-bit 不继续推高全局饱和', '肤色场景优先保护橙色通道'],
    }),
    profile({
        id: 'portra_film',
        label: 'Portra / Kodak 柔性胶片',
        patterns: [/portra|kodak|胶片|胶片感|film|grain|fuji|fujifilm|富士/i],
        searchTerms: ['Kodak Portra film Lightroom soft highlights grain', 'Fuji film color grading Lightroom look'],
        visualTraits: ['高光柔化', '黑位轻微抬升', '颗粒和暖色高光建立胶片密度'],
        lightroomBiases: {
            Contrast2012: -12,
            Highlights2012: -24,
            Shadows2012: 8,
            Blacks2012: 18,
            Clarity2012: -8,
            Dehaze: -6,
            Saturation: -8,
            GrainAmount: 28,
            GrainSize: 30,
            GrainFrequency: 52,
            SplitToningShadowHue: 215,
            SplitToningShadowSaturation: 10,
            SplitToningHighlightHue: 45,
            SplitToningHighlightSaturation: 12,
            SaturationAdjustmentGreen: -18,
            LuminanceAdjustmentBlue: -10,
        },
        minVisibleDeltas: {
            Highlights2012: 16,
            Blacks2012: 14,
            GrainAmount: 22,
            SplitToningShadowSaturation: 8,
            SplitToningHighlightSaturation: 8,
        },
        hslTendencies: ['绿色轻降饱和', '蓝色降明度', '黄色轻微向暖色密度靠拢'],
        textureTendencies: ['颗粒必须可见但不脏', '降低硬清晰度'],
        riskLimits: ['高 ISO 时颗粒不能和噪点叠加过强'],
    }),
    profile({
        id: 'cinematic_teal_orange',
        label: '电影感青橙',
        patterns: [/电影感|青橙|青蓝|teal|orange|cinematic|大片/i],
        searchTerms: ['cinematic teal orange Lightroom color grading shadows highlights'],
        visualTraits: ['暗部偏青蓝', '高光和肤色偏暖', '黑位更稳，局部对比更强'],
        lightroomBiases: {
            Contrast2012: 20,
            Highlights2012: -26,
            Shadows2012: 8,
            Blacks2012: -18,
            Dehaze: 8,
            Temperature: -220,
            SaturationAdjustmentBlue: 24,
            SaturationAdjustmentAqua: 12,
            SaturationAdjustmentOrange: -6,
            SplitToningShadowHue: 215,
            SplitToningShadowSaturation: 18,
            SplitToningHighlightHue: 42,
            SplitToningHighlightSaturation: 12,
            SplitToningBalance: -18,
        },
        minVisibleDeltas: {
            Contrast2012: 16,
            Blacks2012: 14,
            SaturationAdjustmentBlue: 18,
            SplitToningShadowSaturation: 14,
            SplitToningHighlightSaturation: 9,
        },
        hslTendencies: ['蓝/青通道增强', '橙色不过饱和，保护肤色'],
        textureTendencies: ['适度去朦胧和黑位下压形成电影密度'],
        riskLimits: ['人像不能让肤色被青色污染', '高光溢出时避免高光发灰'],
    }),
    profile({
        id: 'ccd_vintage',
        label: 'CCD / 港风复古',
        patterns: [/ccd|复古|港风|vintage|retro|怀旧/i],
        searchTerms: ['CCD vintage Hong Kong style Lightroom faded grain warm'],
        visualTraits: ['黑位抬升', '暖色偏移', '轻褪色和颗粒塑造怀旧感'],
        lightroomBiases: {
            Contrast2012: -10,
            Highlights2012: -18,
            Shadows2012: 10,
            Blacks2012: 24,
            Temperature: 420,
            Saturation: -10,
            Vibrance: -5,
            GrainAmount: 26,
            GrainSize: 28,
            SplitToningHighlightHue: 48,
            SplitToningHighlightSaturation: 14,
            SaturationAdjustmentGreen: -24,
            SaturationAdjustmentBlue: -12,
        },
        minVisibleDeltas: {
            Blacks2012: 18,
            Temperature: 300,
            GrainAmount: 20,
            SaturationAdjustmentGreen: 16,
        },
        hslTendencies: ['压绿和蓝，保留暖色记忆点'],
        textureTendencies: ['颗粒和褪色必须能在预览中感知'],
        riskLimits: ['JPG 高断层风险时用颗粒打散，不暴力拉曲线'],
    }),
    profile({
        id: 'cyberpunk_neon',
        label: '赛博霓虹',
        patterns: [/赛博|霓虹|cyberpunk|neon|夜景霓虹/i],
        searchTerms: ['cyberpunk neon Lightroom blue magenta night color grading'],
        visualTraits: ['蓝紫/洋红通道增强', '暗部密度更高', '霓虹高饱和更突出'],
        lightroomBiases: {
            Contrast2012: 22,
            Blacks2012: -18,
            Dehaze: 10,
            Vibrance: 28,
            SaturationAdjustmentBlue: 38,
            SaturationAdjustmentPurple: 30,
            SaturationAdjustmentMagenta: 34,
            SplitToningShadowHue: 225,
            SplitToningShadowSaturation: 18,
            SplitToningHighlightHue: 310,
            SplitToningHighlightSaturation: 14,
        },
        minVisibleDeltas: {
            Vibrance: 20,
            SaturationAdjustmentBlue: 24,
            SaturationAdjustmentMagenta: 24,
            SplitToningShadowSaturation: 14,
        },
        hslTendencies: ['蓝紫洋红通道大幅增强，暖色保持可辨识'],
        textureTendencies: ['黑位压实，去朦胧增强夜景光源边缘'],
        riskLimits: ['人像场景限制洋红污染肤色'],
    }),
];

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}

function numeric(value: number | number[] | undefined, key?: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (key && Number.isFinite(PARAM_DEFAULTS[key])) return PARAM_DEFAULTS[key];
    return 0;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function isAbsoluteStyleTarget(key: string): boolean {
    return (
        key.endsWith('Hue') ||
        key.startsWith('SplitToning') ||
        key === 'GrainSize' ||
        key === 'GrainFrequency'
    );
}

function defaultVisibleFloor(key: string, desiredDelta: number): number {
    if (key === 'Temperature') return Math.min(Math.abs(desiredDelta), 180);
    if (key === 'Exposure2012') return Math.min(Math.abs(desiredDelta), 0.18);
    if (key === 'GrainAmount') return Math.min(Math.abs(desiredDelta), 18);
    if (key.startsWith('SaturationAdjustment')) return Math.min(Math.abs(desiredDelta), 12);
    if (key.startsWith('SplitToning') && key.endsWith('Saturation')) return Math.min(Math.abs(desiredDelta), 8);
    return Math.min(Math.abs(desiredDelta), 10);
}

function mergeNumericMaps(profiles: StyleIntentProfile[], field: 'lightroomBiases' | 'minVisibleDeltas'): NumericParams {
    const result: NumericParams = {};
    for (const candidate of profiles) {
        for (const [key, value] of Object.entries(candidate[field])) {
            if (field === 'minVisibleDeltas') {
                result[key] = Math.max(result[key] ?? 0, Math.abs(value));
            } else {
                result[key] = (result[key] ?? 0) + value;
            }
        }
    }
    return result;
}

export function resolveStyleIntentProfile(intent: string, style = ''): StyleIntentProfile | null {
    const text = `${intent} ${style}`.trim();
    if (!text) return null;

    const matches = STYLE_PROFILES.filter((candidate) =>
        candidate.patterns.some((pattern) => pattern.test(text))
    );
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    return {
        id: matches.map((item) => item.id).join('+'),
        label: matches.map((item) => item.label).join(' + '),
        intensity: 'visible',
        patterns: [],
        searchTerms: unique(matches.flatMap((item) => item.searchTerms)).slice(0, 6),
        visualTraits: unique(matches.flatMap((item) => item.visualTraits)).slice(0, 8),
        lightroomBiases: mergeNumericMaps(matches, 'lightroomBiases'),
        minVisibleDeltas: mergeNumericMaps(matches, 'minVisibleDeltas'),
        hslTendencies: unique(matches.flatMap((item) => item.hslTendencies)).slice(0, 6),
        textureTendencies: unique(matches.flatMap((item) => item.textureTendencies)).slice(0, 5),
        riskLimits: unique(matches.flatMap((item) => item.riskLimits)).slice(0, 6),
    };
}

export function shouldTreatAsStyleIntent(intent: string, style = ''): boolean {
    return Boolean(resolveStyleIntentProfile(intent, style));
}

export function buildStyleSearchQuery(intent: string, style = ''): string {
    const resolved = resolveStyleIntentProfile(intent, style);
    const terms = resolved?.searchTerms.slice(0, 2).join(' ') || 'photography color grading Lightroom visual traits';
    return `${intent} ${terms} photography color grading visual traits`;
}

export function formatStyleProfileForPrompt(profile: StyleIntentProfile): string {
    return JSON.stringify({
        style_name: profile.label,
        intensity: profile.intensity,
        visual_traits: profile.visualTraits,
        lightroom_biases: profile.lightroomBiases,
        minimum_visible_deltas: profile.minVisibleDeltas,
        hsl_tendencies: profile.hslTendencies,
        texture_tendencies: profile.textureTendencies,
        risk_limits: profile.riskLimits,
    }, null, 2);
}

export function applyStyleIntentProfile(
    params: LightroomParams,
    profile: StyleIntentProfile,
    rawData?: RawDataForPrompt,
    referenceParams?: LightroomParams
): LightroomParams {
    const next: LightroomParams = { ...params };

    if (profile.id.includes('black_white')) {
        next.Vibrance = -100;
        next.Saturation = -100;
        for (const key of HSL_SATURATION_KEYS) next[key] = -100;
        next.SplitToningShadowSaturation = 0;
        next.SplitToningHighlightSaturation = 0;
    }

    for (const [key, delta] of Object.entries(profile.lightroomBiases)) {
        const reference = numeric(referenceParams?.[key], key);
        const current = numeric(next[key], key);
        const absoluteTarget = isAbsoluteStyleTarget(key);
        const target = absoluteTarget ? delta : reference + delta;

        if (absoluteTarget) {
            next[key] = target;
            continue;
        }

        const desiredDelta = target - reference;
        const actualDelta = current - reference;
        const minimumDelta = profile.minVisibleDeltas[key] ?? defaultVisibleFloor(key, desiredDelta);
        const sameDirection =
            Math.sign(actualDelta || desiredDelta || 1) === Math.sign(desiredDelta || 1);
        const alreadyVisible = sameDirection && Math.abs(actualDelta) >= Math.abs(minimumDelta);

        if (!alreadyVisible) {
            next[key] = target;
        }
    }

    applySafetyLimits(next, profile, rawData);
    return next;
}

function applySafetyLimits(params: LightroomParams, profile: StyleIntentProfile, rawData?: RawDataForPrompt): void {
    const text = profile.id;
    const sp = rawData?.sensor_physics;
    const isJpgLike = rawData?.file_type === 'JPG' || (sp?.bit_depth ?? 14) <= 8;
    const highIso = (rawData?.exif.iso ?? 0) >= 1600;
    const weakShadows = (sp?.shadow_survival_rate ?? 1) < 0.9;
    const clippedHighlights = (sp?.highlight_clipping_rate ?? 0) > 0.05;
    const portraitSensitive = /xiaohongshu|portrait|korean|japanese/.test(text);

    if (portraitSensitive) {
        params.SaturationAdjustmentOrange = clamp(numeric(params.SaturationAdjustmentOrange), -18, 5);
        params.LuminanceAdjustmentOrange = clamp(numeric(params.LuminanceAdjustmentOrange), 0, 28);
        params.Clarity2012 = Math.min(numeric(params.Clarity2012), 5);
    }

    if (isJpgLike) {
        params.Shadows2012 = clamp(numeric(params.Shadows2012), -100, 45);
        params.Saturation = clamp(numeric(params.Saturation), -100, 24);
        params.Vibrance = clamp(numeric(params.Vibrance), -100, 38);
    }

    if (clippedHighlights) {
        params.Highlights2012 = Math.max(numeric(params.Highlights2012), -58);
        params.Whites2012 = Math.min(numeric(params.Whites2012), 4);
    }

    if (highIso || weakShadows) {
        params.Dehaze = Math.min(numeric(params.Dehaze), 0);
        params.Clarity2012 = Math.min(numeric(params.Clarity2012), 8);
        params.LuminanceSmoothing = Math.max(numeric(params.LuminanceSmoothing), 22);
    }
}

export const __STYLE_PROFILES_FOR_TEST__ = STYLE_PROFILES;
