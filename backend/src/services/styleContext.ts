export interface StyleSearchResult {
    title: string;
    url?: string;
    content: string;
}

export interface StyleContext {
    style_name: string;
    source_query: string;
    source_titles: string[];
    visual_traits: string[];
    lightroom_biases: Record<string, number>;
    hsl_tendencies: string[];
    quality_warnings: string[];
    retrieved_at: string;
}

const MAX_SOURCE_TITLE_LENGTH = 90;
const MAX_CONTENT_LENGTH = 420;

function compactText(value: string, maxLength: number): string {
    return value
        .replace(/\s+/g, ' ')
        .replace(/[{}<>]/g, '')
        .trim()
        .slice(0, maxLength);
}

function includesAny(text: string, words: string[]): boolean {
    return words.some((word) => text.includes(word));
}

function pushUnique(target: string[], value: string): void {
    if (!target.includes(value)) target.push(value);
}

function inferTraits(text: string): string[] {
    const traits: string[] = [];
    if (includesAny(text, ['低饱和', 'low saturation', 'desaturated', 'muted'])) {
        pushUnique(traits, '整体低饱和，优先用 Vibrance 与 HSL 控制色彩密度');
    }
    if (includesAny(text, ['清透', '通透', 'airy', 'bright', 'clean'])) {
        pushUnique(traits, '高光柔和通透，阴影保留空气感，不做硬黑位');
    }
    if (includesAny(text, ['胶片', 'film', 'portra', 'kodak', 'fuji', 'grain'])) {
        pushUnique(traits, '胶片化低微反差，轻颗粒，色彩过渡偏柔');
    }
    if (includesAny(text, ['日杂', 'editorial', 'magazine'])) {
        pushUnique(traits, '杂志感强调干净肤色、克制对比和可印刷的中间调');
    }
    if (includesAny(text, ['电影', 'cinematic', 'teal', 'orange'])) {
        pushUnique(traits, '电影感使用冷暖分离和受控暗部，不牺牲肤色');
    }
    if (includesAny(text, ['复古', 'vintage', 'ccd'])) {
        pushUnique(traits, '复古质感允许轻微褪色、颗粒和黑位抬升');
    }

    return traits.length ? traits : ['按检索资料归纳为风格倾向，仅作为参数偏置参考'];
}

function inferBiases(text: string): Record<string, number> {
    const biases: Record<string, number> = {};

    if (includesAny(text, ['低饱和', 'low saturation', 'desaturated', 'muted'])) {
        biases.Vibrance = -8;
        biases.Saturation = -5;
    }
    if (includesAny(text, ['清透', '通透', 'airy', 'bright', 'clean'])) {
        biases.Highlights2012 = -12;
        biases.Shadows2012 = 10;
        biases.Whites2012 = 6;
        biases.Clarity2012 = -4;
    }
    if (includesAny(text, ['胶片', 'film', 'portra', 'kodak', 'fuji', 'grain'])) {
        biases.Contrast2012 = -6;
        biases.GrainAmount = 14;
        biases.Clarity2012 = Math.min(biases.Clarity2012 ?? 0, -4);
    }
    if (includesAny(text, ['电影', 'cinematic'])) {
        biases.Contrast2012 = Math.max(biases.Contrast2012 ?? 0, 8);
        biases.Blacks2012 = -6;
    }
    if (includesAny(text, ['复古', 'vintage', 'ccd'])) {
        biases.Blacks2012 = Math.max(biases.Blacks2012 ?? 0, 8);
        biases.GrainAmount = Math.max(biases.GrainAmount ?? 0, 18);
    }

    return biases;
}

function inferHslTendencies(text: string): string[] {
    const tendencies: string[] = [];
    if (includesAny(text, ['小红书', '清透', '低饱和', '日杂', 'portra'])) {
        tendencies.push('降低绿色和黄色饱和度，避免环境色污染肤色');
        tendencies.push('提高橙色明度并克制橙色饱和，保持皮肤干净');
    }
    if (includesAny(text, ['电影', 'cinematic', 'teal'])) {
        tendencies.push('暗部可轻微偏青蓝，高光和肤色保持暖调');
    }
    if (includesAny(text, ['胶片', 'film', 'kodak', 'fuji'])) {
        tendencies.push('黄色轻微偏橙，蓝色降低亮度以获得胶片密度');
    }

    return tendencies.length ? tendencies : ['HSL 只做轻量风格偏置，不覆盖照片自身色彩结构'];
}

export function buildStyleContext(
    intent: string,
    sourceQuery: string,
    results: StyleSearchResult[],
    retrievedAt = new Date().toISOString()
): StyleContext | null {
    const cleanResults = results
        .map((result) => ({
            title: compactText(result.title, MAX_SOURCE_TITLE_LENGTH),
            content: compactText(result.content, MAX_CONTENT_LENGTH),
            url: result.url,
        }))
        .filter((result) => result.title || result.content)
        .slice(0, 5);

    if (cleanResults.length === 0) return null;

    const combinedText = `${intent} ${cleanResults.map((item) => `${item.title} ${item.content}`).join(' ')}`.toLowerCase();

    return {
        style_name: compactText(intent, 60) || '用户指定风格',
        source_query: sourceQuery,
        source_titles: cleanResults.map((item) => item.title).filter(Boolean),
        visual_traits: inferTraits(combinedText).slice(0, 5),
        lightroom_biases: inferBiases(combinedText),
        hsl_tendencies: inferHslTendencies(combinedText).slice(0, 4),
        quality_warnings: [
            '联网风格只作为审美参考，RAW/JPG 物理数据和 clamp 规则优先级更高',
            '不得复刻付费 XMP/DNG/LUT 参数，只能抽象为光影、色彩与质感倾向',
            '人像场景必须保护肤色，避免全局饱和和清晰度过度提升',
        ],
        retrieved_at: retrievedAt,
    };
}

export function formatStyleContextForPrompt(context: StyleContext): string {
    return JSON.stringify(context, null, 2);
}
