import { getRedisClient, type SharedRedisClient } from './redis.js';

export interface RateLimitStore {
    hit: (
        key: string,
        windowSeconds: number,
        nowMs?: number
    ) => Promise<{ count: number; resetAt: number; degraded?: boolean }>;
}

interface WindowState {
    count: number;
    resetAt: number;
}

export interface RateLimitDecision {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
    resetAt: number;
    degraded: boolean;
}

export type RateLimitRedisClient = Pick<SharedRedisClient, 'incr' | 'expire'> &
    Partial<Pick<SharedRedisClient, 'ttl'>>;

export function createMemoryRateLimitStore(): RateLimitStore {
    const windows = new Map<string, WindowState>();

    return {
        async hit(key: string, windowSeconds: number, nowMs = Date.now()) {
            const existing = windows.get(key);
            const nextResetAt = nowMs + windowSeconds * 1000;

            if (!existing || nowMs >= existing.resetAt) {
                const fresh: WindowState = { count: 1, resetAt: nextResetAt };
                windows.set(key, fresh);
                return { ...fresh, degraded: false };
            }

            existing.count += 1;
            windows.set(key, existing);
            return { ...existing, degraded: false };
        },
    };
}

export function createRedisRateLimitStore(redisClient?: RateLimitRedisClient): RateLimitStore {
    return {
        async hit(key: string, windowSeconds: number, nowMs = Date.now()) {
            const client = redisClient ?? getRedisClient();

            try {
                const count = await client.incr(key);
                if (count === 1) {
                    await client.expire(key, windowSeconds);
                    return {
                        count,
                        resetAt: nowMs + windowSeconds * 1000,
                        degraded: false,
                    };
                }

                const ttlSeconds =
                    typeof client.ttl === 'function' ? await client.ttl(key) : -1;
                const retryAfterSeconds = ttlSeconds > 0 ? ttlSeconds : windowSeconds;

                return {
                    count,
                    resetAt: nowMs + retryAfterSeconds * 1000,
                    degraded: false,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[rate-limit] redis fixed-window failed open: ${message}`);
                return {
                    count: 0,
                    resetAt: nowMs,
                    degraded: true,
                };
            }
        },
    };
}

export async function hitRateLimit(
    store: RateLimitStore,
    bucket: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
    nowMs = Date.now()
): Promise<RateLimitDecision> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const safeWindow = Math.max(1, Math.floor(windowSeconds));
    const state = await store.hit(`${bucket}:${identifier}`, safeWindow, nowMs);

    if (state.degraded) {
        return {
            allowed: true,
            remaining: safeLimit,
            retryAfterSeconds: 0,
            resetAt: nowMs,
            degraded: true,
        };
    }

    const remaining = Math.max(0, safeLimit - state.count);
    const allowed = state.count <= safeLimit;

    return {
        allowed,
        remaining,
        retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - nowMs) / 1000)),
        resetAt: state.resetAt,
        degraded: false,
    };
}
