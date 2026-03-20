const DEFAULT_CORS_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*'];
const VERCEL_APP_ORIGIN_RE = /^https?:\/\/([a-zA-Z0-9-]+\.)*vercel\.app(?::\d+)?$/;

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileOriginPattern(pattern: string): RegExp {
    const regex = `^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`;
    return new RegExp(regex);
}

export function parseCorsOrigins(raw = process.env.CORS_ORIGINS): string[] {
    if (!raw) return DEFAULT_CORS_ORIGINS;
    const parsed = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : DEFAULT_CORS_ORIGINS;
}

export function parseAllowVercelAppOrigins(raw = process.env.ALLOW_VERCEL_APP_ORIGINS): boolean {
    if (!raw) return false;
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isOriginAllowed(
    origin: string | undefined,
    patterns: string[],
    allowVercelAppOrigins: boolean
): boolean {
    if (!origin) return true;

    const matchers = patterns.map(compileOriginPattern);
    if (matchers.some((matcher) => matcher.test(origin))) {
        return true;
    }

    return allowVercelAppOrigins && VERCEL_APP_ORIGIN_RE.test(origin);
}

export function createCorsOriginMatcher(
    patterns = parseCorsOrigins(),
    allowVercelAppOrigins = parseAllowVercelAppOrigins()
) {
    return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
        if (isOriginAllowed(origin, patterns, allowVercelAppOrigins)) {
            cb(null, true);
            return;
        }
        cb(new Error('CORS origin denied'), false);
    };
}
