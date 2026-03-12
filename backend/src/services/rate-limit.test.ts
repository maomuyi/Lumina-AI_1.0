import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createMemoryRateLimitStore,
    createRedisRateLimitStore,
    hitRateLimit,
} from './rate-limit.js';

test('rate limiter allows requests under the limit and blocks the next one', async () => {
    const store = createMemoryRateLimitStore();
    const first = await hitRateLimit(store, 'analyze', 'ip:127.0.0.1', 2, 60, 1_000);
    const second = await hitRateLimit(store, 'analyze', 'ip:127.0.0.1', 2, 60, 1_000);
    const third = await hitRateLimit(store, 'analyze', 'ip:127.0.0.1', 2, 60, 1_000);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
    assert.equal(third.remaining, 0);
    assert.ok(third.retryAfterSeconds >= 1);
});

test('rate limiter resets after the window expires', async () => {
    const store = createMemoryRateLimitStore();
    const now = 5_000;

    await hitRateLimit(store, 'xmp', 'ip:127.0.0.1', 1, 10, now);
    const blocked = await hitRateLimit(store, 'xmp', 'ip:127.0.0.1', 1, 10, now + 5_000);
    const allowedAgain = await hitRateLimit(store, 'xmp', 'ip:127.0.0.1', 1, 10, now + 10_001);

    assert.equal(blocked.allowed, false);
    assert.equal(allowedAgain.allowed, true);
});

test('redis rate limit store uses the shared redis client interface for fixed-window hits', async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const store = createRedisRateLimitStore({
        async incr(key) {
            calls.push({ method: 'incr', args: [key] });
            return 1;
        },
        async expire(key, seconds) {
            calls.push({ method: 'expire', args: [key, seconds] });
            return 1;
        },
    });

    const decision = await hitRateLimit(store, 'analyze', 'ip:127.0.0.1', 3, 60, 1_000);

    assert.equal(decision.allowed, true);
    assert.equal(decision.degraded, false);
    assert.deepEqual(calls, [
        { method: 'incr', args: ['analyze:ip:127.0.0.1'] },
        { method: 'expire', args: ['analyze:ip:127.0.0.1', 60] },
    ]);
});

test('rate limiter fails open and reports degraded mode when redis throws', async () => {
    const store = createRedisRateLimitStore({
        async incr() {
            throw new Error('redis unavailable');
        },
        async expire() {
            return 1;
        },
    });

    const decision = await hitRateLimit(store, 'refine', 'ip:127.0.0.1', 2, 120, 1_000);

    assert.equal(decision.allowed, true);
    assert.equal(decision.degraded, true);
    assert.equal(decision.remaining, 2);
    assert.equal(decision.retryAfterSeconds, 0);
});
