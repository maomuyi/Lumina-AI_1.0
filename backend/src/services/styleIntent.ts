import { shouldTreatAsStyleIntent } from './styleProfiles.js';

const STYLE_KEYWORDS = [
    '最近流行',
    '流行',
    '趋势',
    '小红书',
    'ins',
    'instagram',
    '日杂',
    '杂志',
    '胶片感',
    '胶片',
    'film',
    'portra',
    'kodak',
    'fuji',
    'fujifilm',
    '电影感',
    'cinematic',
    '预设',
    'preset',
    '参考',
    'reference',
    '复古',
    'vintage',
    '港风',
    '韩系',
    '森系',
    'citywalk',
    'ccd',
];

const STYLE_PATTERNS = [
    /像.{1,24}(摄影师|博主|电影|杂志|预设|风格)/i,
    /(photographer|creator|influencer|editorial).{0,24}(style|look|preset)/i,
    /(lightroom|lr).{0,24}(preset|look|style)/i,
];

export function shouldSearchStyleContext(intent: string): boolean {
    const text = intent.trim().toLowerCase();
    if (!text) return false;

    if (shouldTreatAsStyleIntent(intent)) return true;

    if (STYLE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) {
        return true;
    }

    return STYLE_PATTERNS.some((pattern) => pattern.test(text));
}
