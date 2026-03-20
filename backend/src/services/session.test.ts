import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareSessionRevisionAndFingerprint,
    createSessionService,
    type SessionData,
} from './session.js';
import type { RawDataForPrompt } from './prompt.js';

function buildRawData(): RawDataForPrompt {
    return {
        file_type: 'NEF',
        exif: {
            iso: 400,
            shutter: '1/125',
            aperture: 2.8,
            focal_length: 50,
        },
        sensor_physics: {
            bit_depth: 14,
            shadow_survival_rate: 0.94,
            highlight_clipping_rate: 0.02,
            banding_risk: 'low',
        },
        linear_histogram: [0.12, 0.33, 0.55],
        color_space: 'Adobe RGB',
    };
}

function createFakeRedis() {
    const store = new Map<string, string>();

    return {
        client: {
            async get(key: string) {
                return store.get(key) ?? null;
            },
            async set(key: string, value: string) {
                store.set(key, value);
                return 'OK';
            },
        },
        store,
    };
}

test('session payload stores fingerprint and excludes persisted image payload fields', async () => {
    const fakeRedis = createFakeRedis();
    const sessions = createSessionService(fakeRedis.client);

    const sessionId = await sessions.createSession({
        rawData: buildRawData(),
        rawDataSummary: 'ISO 400, highlight clipping 2%',
        imageFingerprint: 'fingerprint-1',
        style: 'film',
        lastLrParams: { Exposure2012: 0.25 },
        lastReport: { module_1_diagnosis: 'balanced' },
        previewImageBase64: 'should-not-persist',
        publicImageUrl: 'https://lumina.example.com/uploads/vision/demo.jpg',
    } as never);

    const storedPayload = Array.from(fakeRedis.store.values())[0] ?? '';
    const session = await sessions.getSession(sessionId);

    assert.match(storedPayload, /"imageFingerprint":"fingerprint-1"/);
    assert.doesNotMatch(storedPayload, /previewImageBase64/);
    assert.doesNotMatch(storedPayload, /publicImageUrl/);
    assert.ok(session);
    assert.equal(session?.revision, 1);
});

test('session updates increment the revision and keep the fingerprint stable', async () => {
    const fakeRedis = createFakeRedis();
    const sessions = createSessionService(fakeRedis.client);
    const sessionId = await sessions.createSession({
        rawData: buildRawData(),
        rawDataSummary: 'ISO 400, highlight clipping 2%',
        imageFingerprint: 'fingerprint-1',
        style: 'auto',
        lastLrParams: { Exposure2012: 0.25 },
        lastReport: { module_1_diagnosis: 'balanced' },
    });

    await sessions.updateSession(sessionId, {
        lastLrParams: { Exposure2012: 0.35, Contrast2012: 10 },
        lastReport: { module_1_diagnosis: 'updated' },
        intent: 'lift the shadows slightly',
    });

    const session = await sessions.getSession(sessionId);

    assert.ok(session);
    assert.equal(session?.revision, 2);
    assert.equal(session?.imageFingerprint, 'fingerprint-1');
    assert.deepEqual(session?.intentHistory, ['lift the shadows slightly']);
});

test('session helper distinguishes revision conflicts from fingerprint mismatches', () => {
    const session = {
        rawData: buildRawData(),
        rawDataSummary: 'summary',
        imageFingerprint: 'fingerprint-1',
        style: 'auto',
        lastLrParams: { Exposure2012: 0.25 },
        lastReport: { module_1_diagnosis: 'balanced' },
        revision: 3,
        intentHistory: [],
        createdAt: '2026-03-12T00:00:00.000Z',
        updatedAt: '2026-03-12T00:00:00.000Z',
    } satisfies SessionData;

    assert.equal(
        compareSessionRevisionAndFingerprint(session, {
            revision: 3,
            imageFingerprint: 'fingerprint-1',
        }),
        'ok'
    );
    assert.equal(
        compareSessionRevisionAndFingerprint(session, {
            revision: 2,
            imageFingerprint: 'fingerprint-1',
        }),
        'revision_conflict'
    );
    assert.equal(
        compareSessionRevisionAndFingerprint(session, {
            revision: 3,
            imageFingerprint: 'fingerprint-2',
        }),
        'fingerprint_mismatch'
    );
});

test('session update fails when redis CAS detects stale revision', async () => {
    const store = new Map<string, string>();
    const client = {
        async get(key: string) {
            return store.get(key) ?? null;
        },
        async set(key: string, value: string) {
            store.set(key, value);
            return 'OK';
        },
        async eval() {
            return null;
        },
    };

    const sessions = createSessionService(client as never);
    const sessionId = await sessions.createSession({
        rawData: buildRawData(),
        rawDataSummary: 'summary',
        imageFingerprint: 'fingerprint-1',
        style: 'auto',
        lastLrParams: { Exposure2012: 0.25 },
        lastReport: { module_1_diagnosis: 'balanced' },
    });

    const result = await sessions.updateSession(sessionId, {
        lastLrParams: { Exposure2012: 0.3 },
        intent: 'new intent',
    });

    assert.equal(result, null);
});
