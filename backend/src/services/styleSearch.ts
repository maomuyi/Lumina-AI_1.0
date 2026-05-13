import crypto from 'node:crypto';
import Redis from 'ioredis';
import { buildStyleContext, type StyleContext, type StyleSearchResult } from './styleContext.js';
import { buildStyleSearchQuery } from './styleProfiles.js';

const STYLE_SEARCH_CACHE_TTL_SECONDS = parseInt(process.env.STYLE_SEARCH_CACHE_TTL_SECONDS || '604800', 10);
const STYLE_SEARCH_MAX_RESULTS = Math.max(1, Math.min(10, parseInt(process.env.STYLE_SEARCH_MAX_RESULTS || '5', 10)));
const STYLE_SEARCH_TIMEOUT_MS = parseInt(process.env.STYLE_SEARCH_TIMEOUT_MS || '8000', 10);

let redis: Redis | null = null;
let redisDisabled = false;

function cleanEnv(name: string): string {
    return (process.env[name] || '').trim();
}

function isEnabled(): boolean {
    return cleanEnv('STYLE_WEB_SEARCH_ENABLED').toLowerCase() === 'true';
}

function getProvider(): string {
    return cleanEnv('STYLE_SEARCH_PROVIDER') || 'duckduckgo';
}

function getRedis(): Redis {
    if (redisDisabled) throw new Error('Style search Redis cache disabled');
    if (!redis) {
        redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            connectTimeout: 500,
            retryStrategy: () => null,
        });
        redis.on('error', () => undefined);
    }
    return redis;
}

function normalizeIntent(intent: string): string {
    return intent.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

function cacheKey(intent: string): string {
    const hash = crypto.createHash('sha256').update(normalizeIntent(intent)).digest('hex').slice(0, 24);
    return `style-context:${hash}`;
}

function buildQuery(intent: string): string {
    return buildStyleSearchQuery(intent);
}

function isLowQualityPresetSeo(result: StyleSearchResult): boolean {
    const text = `${result.title} ${result.content} ${result.url ?? ''}`.toLowerCase();
    const commercialSignals = ['download', 'free preset', 'buy preset', 'coupon', 'bundle', 'etsy', 'gumroad'];
    const visualSignals = ['color', 'tone', 'light', 'shadow', 'highlight', 'grain', 'film', 'lightroom', 'style', 'look'];
    const commercialCount = commercialSignals.filter((word) => text.includes(word)).length;
    const hasVisualSignal = visualSignals.some((word) => text.includes(word));
    return commercialCount >= 2 && !hasVisualSignal;
}

async function getCachedStyleContext(intent: string): Promise<StyleContext | null> {
    if (redisDisabled) return null;
    try {
        const raw = await getRedis().get(cacheKey(intent));
        return raw ? JSON.parse(raw) as StyleContext : null;
    } catch {
        redisDisabled = true;
        redis?.disconnect();
        redis = null;
        return null;
    }
}

async function setCachedStyleContext(intent: string, context: StyleContext): Promise<void> {
    if (redisDisabled) return;
    try {
        await getRedis().set(cacheKey(intent), JSON.stringify(context), 'EX', STYLE_SEARCH_CACHE_TTL_SECONDS);
    } catch {
        redisDisabled = true;
        redis?.disconnect();
        redis = null;
    }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function toSearchResult(item: unknown): StyleSearchResult | null {
    const result = item as { title?: unknown; url?: unknown; content?: unknown; snippet?: unknown };
    const title = typeof result.title === 'string' ? result.title : '';
    const content =
        typeof result.content === 'string'
            ? result.content
            : typeof result.snippet === 'string'
                ? result.snippet
                : '';
    const url = typeof result.url === 'string' ? result.url : undefined;

    if (!title && !content) return null;
    return { title, content, url };
}

async function searchTavily(query: string): Promise<StyleSearchResult[]> {
    const apiKey = cleanEnv('STYLE_SEARCH_API_KEY');
    if (!apiKey) return [];

    const response = await fetchWithTimeout(
        'https://api.tavily.com/search',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                query,
                max_results: STYLE_SEARCH_MAX_RESULTS,
                search_depth: 'basic',
                include_answer: false,
                include_raw_content: false,
            }),
        },
        STYLE_SEARCH_TIMEOUT_MS
    );

    if (!response.ok) {
        throw new Error(`Tavily search failed: ${response.status}`);
    }

    const payload = await response.json() as { results?: unknown[] };
    return (payload.results || [])
        .map(toSearchResult)
        .filter((item): item is StyleSearchResult => Boolean(item));
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, ' ');
}

function stripTags(text: string): string {
    return decodeHtmlEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractDuckDuckGoAbstracts(payload: unknown): StyleSearchResult[] {
    const data = payload as {
        AbstractText?: unknown;
        Heading?: unknown;
        AbstractURL?: unknown;
        RelatedTopics?: unknown[];
    };
    const results: StyleSearchResult[] = [];

    if (typeof data.AbstractText === 'string' && data.AbstractText.trim()) {
        results.push({
            title: typeof data.Heading === 'string' ? data.Heading : 'DuckDuckGo abstract',
            content: data.AbstractText,
            url: typeof data.AbstractURL === 'string' ? data.AbstractURL : undefined,
        });
    }

    const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
    for (const item of related) {
        const topic = item as { Text?: unknown; FirstURL?: unknown; Topics?: unknown[] };
        if (typeof topic.Text === 'string') {
            results.push({
                title: topic.Text.split(' - ')[0] || 'DuckDuckGo related topic',
                content: topic.Text,
                url: typeof topic.FirstURL === 'string' ? topic.FirstURL : undefined,
            });
        }
        if (Array.isArray(topic.Topics)) {
            for (const nested of topic.Topics) {
                const nestedTopic = nested as { Text?: unknown; FirstURL?: unknown };
                if (typeof nestedTopic.Text === 'string') {
                    results.push({
                        title: nestedTopic.Text.split(' - ')[0] || 'DuckDuckGo related topic',
                        content: nestedTopic.Text,
                        url: typeof nestedTopic.FirstURL === 'string' ? nestedTopic.FirstURL : undefined,
                    });
                }
            }
        }
    }

    return results.slice(0, STYLE_SEARCH_MAX_RESULTS);
}

function extractDuckDuckGoLiteResults(html: string): StyleSearchResult[] {
    const results: StyleSearchResult[] = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
        const titleMatch = row.match(/<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!titleMatch) continue;

        const snippetMatch = row.match(/<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/i);
        const title = stripTags(titleMatch[2]);
        const content = snippetMatch ? stripTags(snippetMatch[1]) : title;
        const url = decodeHtmlEntities(titleMatch[1]);

        if (title || content) {
            results.push({ title, content, url });
        }

        if (results.length >= STYLE_SEARCH_MAX_RESULTS) break;
    }

    return results;
}

async function searchDuckDuckGo(query: string): Promise<StyleSearchResult[]> {
    const instantUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const instantResponse = await fetchWithTimeout(
        instantUrl,
        { headers: { 'Accept': 'application/json' } },
        STYLE_SEARCH_TIMEOUT_MS
    );

    if (instantResponse.ok) {
        const instantResults = extractDuckDuckGoAbstracts(await instantResponse.json());
        if (instantResults.length > 0) return instantResults;
    }

    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const liteResponse = await fetchWithTimeout(
        liteUrl,
        { headers: { 'Accept': 'text/html', 'User-Agent': 'LuminaAI/0.1 style-context' } },
        STYLE_SEARCH_TIMEOUT_MS
    );

    if (!liteResponse.ok) {
        throw new Error(`DuckDuckGo search failed: ${liteResponse.status}`);
    }

    return extractDuckDuckGoLiteResults(await liteResponse.text());
}

export async function searchStyleContext(intent: string): Promise<StyleContext | null> {
    if (!isEnabled()) return null;

    const cached = await getCachedStyleContext(intent);
    if (cached) return cached;

    const query = buildQuery(intent);
    const provider = getProvider();
    const rawResults = provider === 'tavily'
        ? await searchTavily(query)
        : await searchDuckDuckGo(query);
    const results = rawResults.filter((result) => !isLowQualityPresetSeo(result));
    const context = buildStyleContext(intent, query, results);
    if (context) {
        await setCachedStyleContext(intent, context);
    }
    return context;
}
