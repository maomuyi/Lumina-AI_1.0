import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import Fastify from 'fastify';
import { xmpRoutes } from './xmp.js';
import { createSessionService, summarizeRawData } from '../services/session.js';
import { setSharedRedisClientForTests, type SharedRedisClient } from '../services/redis.js';

function buildRawData() {
    return {
        file_type: 'NEF',
        exif: {
            camera_model: 'Nikon Zf',
            iso: 400,
            shutter: '1/125',
            aperture: 2.8,
            focal_length: 50,
        },
        sensor_physics: {
            bit_depth: 14,
            shadow_survival_rate: 0.94,
            highlight_clipping_rate: 0.02,
            banding_risk: 'low' as const,
        },
        linear_histogram: [0.12, 0.33, 0.55],
        color_space: 'Adobe RGB',
    };
}

const TEST_FINGERPRINT = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createFakeRedisClient(): SharedRedisClient {
    const stringStore = new Map<string, string>();
    const counters = new Map<string, number>();
    const ttls = new Map<string, number>();

    return {
        status: 'ready',
        async get(key) {
            return stringStore.get(key) ?? null;
        },
        async set(key, value, mode, durationSeconds) {
            if (mode === 'EX') {
                ttls.set(key, durationSeconds);
            }
            stringStore.set(key, value);
            return 'OK';
        },
        async incr(key) {
            const next = (counters.get(key) ?? 0) + 1;
            counters.set(key, next);
            return next;
        },
        async expire(key, durationSeconds) {
            ttls.set(key, durationSeconds);
            return 1;
        },
        async ttl(key) {
            return ttls.get(key) ?? -1;
        },
    };
}

afterEach(() => {
    setSharedRedisClientForTests(null);
});

test('xmp route works without session image context and does not mutate session state', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);

    const sessions = createSessionService(redisClient);
    const rawData = buildRawData();
    const sessionId = await sessions.createSession({
        rawData,
        rawDataSummary: summarizeRawData(rawData),
        imageFingerprint: TEST_FINGERPRINT,
        style: 'auto',
        lastLrParams: { Exposure2012: 0.25 },
        lastReport: { module_1_diagnosis: 'balanced' },
    });
    const before = await sessions.getSession(sessionId);

    const app = Fastify();
    await app.register(xmpRoutes);

    const response = await app.inject({
        method: 'POST',
        url: '/api/xmp',
        payload: {
            lightroom_params: {
                Exposure2012: 0.35,
                Contrast2012: 12,
            },
        },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /download_url/);

    const after = await sessions.getSession(sessionId);
    assert.deepEqual(after, before);

    await app.close();
});

test('xmp route accepts optional session_id and revision without mutating session', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);

    const sessions = createSessionService(redisClient);
    const rawData = buildRawData();
    const sessionId = await sessions.createSession({
        rawData,
        rawDataSummary: summarizeRawData(rawData),
        imageFingerprint: TEST_FINGERPRINT,
        style: 'auto',
        lastLrParams: { Exposure2012: 0.25 },
        lastReport: { module_1_diagnosis: 'balanced' },
    });
    const before = await sessions.getSession(sessionId);

    const app = Fastify();
    await app.register(xmpRoutes);

    const response = await app.inject({
        method: 'POST',
        url: '/api/xmp',
        payload: {
            session_id: sessionId,
            revision: 1,
            lightroom_params: {
                Exposure2012: 0.2,
                Contrast2012: 8,
            },
        },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /download_url/);

    const after = await sessions.getSession(sessionId);
    assert.deepEqual(after, before);

    await app.close();
});
