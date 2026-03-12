import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test, { afterEach } from 'node:test';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { analyzeRoutes } from './analyze.js';
import { refineRoutes } from './refine.js';
import { createSessionService, summarizeRawData, type SessionData } from '../services/session.js';
import { setLlmTestOverrides } from '../services/llm.js';
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

function buildMultipartRequest(
    fields: Array<{ name: string; value: string | Buffer; filename?: string; contentType?: string }>
) {
    const boundary = '----lumina-test-boundary';
    const chunks: Buffer[] = [];

    for (const field of fields) {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        if (typeof field.value === 'string') {
            chunks.push(
                Buffer.from(
                    `Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`
                )
            );
            continue;
        }

        chunks.push(
            Buffer.from(
                `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename ?? 'upload.bin'}"\r\n`
            )
        );
        chunks.push(Buffer.from(`Content-Type: ${field.contentType ?? 'application/octet-stream'}\r\n\r\n`));
        chunks.push(field.value);
        chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    return {
        payload: Buffer.concat(chunks),
        headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
        },
    };
}

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

async function buildApp() {
    const app = Fastify();
    await app.register(multipart);
    await app.register(analyzeRoutes);
    await app.register(refineRoutes);
    return app;
}

async function seedSession(redisClient: SharedRedisClient, overrides?: Partial<SessionData>) {
    const rawData = buildRawData();
    const sessions = createSessionService(redisClient);
    const sessionId = await sessions.createSession({
        rawData,
        rawDataSummary: summarizeRawData(rawData),
        imageFingerprint: overrides?.imageFingerprint ?? TEST_FINGERPRINT,
        style: overrides?.style ?? 'auto',
        lastLrParams: overrides?.lastLrParams ?? { Exposure2012: 0.25 },
        lastReport: overrides?.lastReport ?? { module_1_diagnosis: 'balanced' },
        intentHistory: overrides?.intentHistory,
    });

    if (overrides?.revision && overrides.revision > 1) {
        for (let step = 1; step < overrides.revision; step += 1) {
            await sessions.updateSession(sessionId, {
                lastLrParams: { Exposure2012: 0.25 + step * 0.1 },
                lastReport: { module_1_diagnosis: `rev-${step + 1}` },
                intent: `intent-${step}`,
            });
        }
    }

    return { sessionId, rawData };
}

function buildMockLlmResponse(): string {
    return JSON.stringify({
        diagnostic_report: {
            module_1_diagnosis: '【🖼 画面诊断】主体层次稳定，可做轻量精修。',
            module_2_physics: '【🔬 底层剖析】14-bit、ISO 400、高光溢出 2.0%，暗部存活 94.0%。',
            module_3_strategy: '【💡 美化建议】轻压高光并抬中间调，保持颗粒安全。',
            module_4_core_actions: [
                '【Exposure2012】0.25：补偿整体亮度并保住天空。',
                '【Contrast2012】10：提升主体分离度并避免硬切。',
                '【Highlights2012】-20：回收云层细节并压住死白。',
                '【Shadows2012】15：抬暗部但不破坏信噪比。',
                '【Whites2012】-5：收敛白点避免高光炸裂。',
                '【Blacks2012】-10：维持黑位锚点增强通透感。',
            ],
        },
        lightroom_params: {
            Exposure2012: 0.25,
            Contrast2012: 10,
        },
    });
}

afterEach(() => {
    setSharedRedisClientForTests(null);
    setLlmTestOverrides(null);
    delete process.env.LLM_VISION_INPUT_MODE;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.PUBLIC_API_BASE_URL;
});

test('analyze requires image_fingerprint in multipart fields', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);
    const app = await buildApp();

    const rawData = JSON.stringify(buildRawData());
    const request = buildMultipartRequest([
        {
            name: 'preview_image',
            value: Buffer.from('preview-image'),
            filename: 'preview.jpg',
            contentType: 'image/jpeg',
        },
        { name: 'raw_data', value: rawData },
        { name: 'user_intent', value: 'make it cinematic' },
        { name: 'style', value: 'film' },
    ]);

    const response = await app.inject({
        method: 'POST',
        url: '/api/analyze',
        headers: request.headers,
        payload: request.payload,
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /imageFingerprint|image_fingerprint/);

    await app.close();
});

test('refine validates session_id, revision, and image_fingerprint before processing', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);
    const app = await buildApp();

    const request = buildMultipartRequest([
        { name: 'session_id', value: 'sess_abc12345' },
        { name: 'new_intent', value: 'lift the shadows' },
    ]);

    const response = await app.inject({
        method: 'POST',
        url: '/api/refine',
        headers: request.headers,
        payload: request.payload,
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.body, /revision|image_fingerprint/);

    await app.close();
});

test('refine returns 409 on revision conflict', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);
    const app = await buildApp();
    const { sessionId } = await seedSession(redisClient, { revision: 2 });

    const request = buildMultipartRequest([
        { name: 'session_id', value: sessionId },
        { name: 'revision', value: '1' },
        { name: 'image_fingerprint', value: TEST_FINGERPRINT },
        { name: 'new_intent', value: 'lift the shadows' },
    ]);

    const response = await app.inject({
        method: 'POST',
        url: '/api/refine',
        headers: request.headers,
        payload: request.payload,
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.body, /revision/i);

    await app.close();
});

test('refine returns 409 on fingerprint mismatch', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);
    const app = await buildApp();
    const { sessionId } = await seedSession(redisClient, { revision: 1 });

    const request = buildMultipartRequest([
        { name: 'session_id', value: sessionId },
        { name: 'revision', value: '1' },
        { name: 'image_fingerprint', value: `${TEST_FINGERPRINT.slice(0, -1)}0` },
        { name: 'new_intent', value: 'cool the image down' },
    ]);

    const response = await app.inject({
        method: 'POST',
        url: '/api/refine',
        headers: request.headers,
        payload: request.payload,
    });

    assert.equal(response.statusCode, 409);
    assert.match(response.body, /fingerprint/i);

    await app.close();
});

test('refine accepts the silently resent image and returns the next revision', async () => {
    const redisClient = createFakeRedisClient();
    setSharedRedisClientForTests(redisClient);
    process.env.LLM_VISION_INPUT_MODE = 'data_url';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    const previewImage = Buffer.from('preview-image');
    const previewFingerprint = createHash('sha256').update(previewImage).digest('hex');

    let usedVisionPath = false;
    setLlmTestOverrides({
        async streamVisionAnalysis(_prompt, previewImageUrl, callbacks) {
            usedVisionPath = previewImageUrl.startsWith('data:image/jpeg;base64,');
            callbacks.onComplete(buildMockLlmResponse());
        },
        async streamTextRefine() {
            throw new Error('refine should use the resent preview image when provided');
        },
    });

    const app = await buildApp();
    const { sessionId } = await seedSession(redisClient, {
        revision: 1,
        imageFingerprint: previewFingerprint,
    });

    const request = buildMultipartRequest([
        {
            name: 'preview_image',
            value: previewImage,
            filename: 'preview.jpg',
            contentType: 'image/jpeg',
        },
        { name: 'session_id', value: sessionId },
        { name: 'revision', value: '1' },
        { name: 'image_fingerprint', value: previewFingerprint },
        { name: 'new_intent', value: 'make the highlights softer' },
    ]);

    const response = await app.inject({
        method: 'POST',
        url: '/api/refine',
        headers: request.headers,
        payload: request.payload,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(usedVisionPath, true);
    assert.match(response.body, /"type":"final"/);
    assert.match(response.body, /"revision":2/);

    await app.close();
});
