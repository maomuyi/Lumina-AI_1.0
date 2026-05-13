import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldSearchStyleContext } from '../src/services/styleIntent.js';
import { buildStyleContext } from '../src/services/styleContext.js';
import { buildRefinePrompt } from '../src/services/prompt.js';
import { searchStyleContext } from '../src/services/styleSearch.js';

const ORIGINAL_ENV = {
    STYLE_WEB_SEARCH_ENABLED: process.env.STYLE_WEB_SEARCH_ENABLED,
    STYLE_SEARCH_PROVIDER: process.env.STYLE_SEARCH_PROVIDER,
    STYLE_SEARCH_API_KEY: process.env.STYLE_SEARCH_API_KEY,
};

afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.STYLE_WEB_SEARCH_ENABLED;
    delete process.env.STYLE_SEARCH_PROVIDER;
    delete process.env.STYLE_SEARCH_API_KEY;
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (value !== undefined) process.env[key] = value;
    }
});

describe('style intent detection', () => {
    it('does not search for simple local parameter tweaks', () => {
        expect(shouldSearchStyleContext('亮一点')).toBe(false);
        expect(shouldSearchStyleContext('肤色自然一点')).toBe(false);
    });

    it('searches for style and trend requests', () => {
        expect(shouldSearchStyleContext('调成最近流行的小红书低饱和胶片感')).toBe(true);
        expect(shouldSearchStyleContext('Kodak Portra 400 但不要太黄')).toBe(true);
    });
});

describe('style context building', () => {
    it('returns null for empty search results', () => {
        expect(buildStyleContext('小红书低饱和', 'query', [])).toBeNull();
    });

    it('sanitizes and summarizes search results into compact style context', () => {
        const context = buildStyleContext(
            '小红书低饱和清透胶片感',
            'query',
            [{
                title: '小红书低饱和清透胶片 Lightroom 风格',
                content: `低饱和 清透 胶片 高光柔和 绿色降低饱和度 ${'x'.repeat(900)}`,
                url: 'https://example.com/style',
            }],
            '2026-05-09T00:00:00.000Z'
        );

        expect(context).not.toBeNull();
        expect(context?.visual_traits.join(' ')).toContain('低饱和');
        expect(context?.lightroom_biases.Vibrance).toBeLessThan(0);
        expect(context?.source_titles[0].length).toBeLessThanOrEqual(90);
        expect(JSON.stringify(context)).not.toContain('x'.repeat(500));
    });
});

describe('style context prompt injection', () => {
    it('keeps existing refine prompt shape when no style context exists', () => {
        const prompt = buildRefinePrompt({ Exposure2012: 0.2 }, '亮一点', '文件类型: NEF');

        expect(prompt).toContain('[上一轮输出的 lightroom_params]');
        expect(prompt).not.toContain('联网风格参考');
    });

    it('adds guarded style context when available', () => {
        const context = buildStyleContext(
            'Portra 400 但不要太黄',
            'query',
            [{ title: 'Kodak Portra 400 look', content: 'film portra warm soft grain', url: 'https://example.com' }],
            '2026-05-09T00:00:00.000Z'
        );
        const prompt = buildRefinePrompt({ Exposure2012: 0.2 }, 'Portra 400 但不要太黄', '文件类型: NEF', context);

        expect(prompt).toContain('[联网风格参考，不可覆盖物理数据边界]');
        expect(prompt).toContain('不得复刻任何付费 XMP/DNG/LUT 参数');
        expect(prompt).toContain('Portra 400');
    });
});

describe('style search service', () => {
    it('returns null without a search API key', async () => {
        process.env.STYLE_WEB_SEARCH_ENABLED = 'true';
        process.env.STYLE_SEARCH_PROVIDER = 'tavily';
        delete process.env.STYLE_SEARCH_API_KEY;

        await expect(searchStyleContext('小红书低饱和胶片感')).resolves.toBeNull();
    });

    it('returns null when Tavily returns no results', async () => {
        process.env.STYLE_WEB_SEARCH_ENABLED = 'true';
        process.env.STYLE_SEARCH_PROVIDER = 'tavily';
        process.env.STYLE_SEARCH_API_KEY = 'tvly-test';
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })));

        await expect(searchStyleContext('小红书低饱和胶片感')).resolves.toBeNull();
    });

    it('supports keyless DuckDuckGo style search', async () => {
        process.env.STYLE_WEB_SEARCH_ENABLED = 'true';
        process.env.STYLE_SEARCH_PROVIDER = 'duckduckgo';
        delete process.env.STYLE_SEARCH_API_KEY;
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.includes('api.duckduckgo.com')) {
                return new Response(JSON.stringify({ RelatedTopics: [] }), { status: 200 });
            }
            return new Response(`
                <html><body><table>
                    <tr>
                        <td><a class="result-link" href="https://example.com">Low saturation film Lightroom look</a></td>
                        <td class="result-snippet">muted low saturation film grain soft highlights green desaturated</td>
                    </tr>
                </table></body></html>
            `, { status: 200 });
        }));

        const result = await searchStyleContext('低饱和胶片感');

        expect(result).not.toBeNull();
        expect(result?.visual_traits.join(' ')).toContain('低饱和');
        expect(result?.source_titles[0]).toContain('Low saturation');
    });
});
