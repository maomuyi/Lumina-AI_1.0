import { z } from 'zod';
import {
    KNOWN_LIGHTROOM_SCALAR_KEYS,
    KNOWN_TONE_CURVE_KEYS,
    isKnownLightroomScalarKey,
    isKnownToneCurveKey,
} from './clampParams.js';

export const ALLOWED_STYLE_KEYS = [
    'auto',
    'japanese',
    'film',
    'cyberpunk',
    'grey',
    'cinematic',
] as const;

const intentSchema = z.string().trim().max(600);
const imageFingerprintSchema = z.string().trim().min(16).max(128);
const revisionSchema = z.coerce.number().int().positive();

const analyzeFieldSchema = z.object({
    userIntent: intentSchema.optional().default(''),
    style: z.enum(ALLOWED_STYLE_KEYS).optional().default('auto'),
    imageFingerprint: imageFingerprintSchema,
});

const refineFieldSchema = z.object({
    session_id: z.string().regex(/^sess_[A-Za-z0-9_-]{8,40}$/),
    revision: revisionSchema,
    image_fingerprint: imageFingerprintSchema,
    new_intent: intentSchema.min(1),
});

const xmpBodySchema = z.object({
    lightroom_params: z.unknown(),
    session_id: z.string().regex(/^sess_[A-Za-z0-9_-]{8,40}$/).optional(),
    revision: revisionSchema.optional(),
});

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function validateAnalyzeFields(raw: {
    userIntent?: string;
    style?: string;
    imageFingerprint?: string;
}): {
    userIntent: string;
    style: (typeof ALLOWED_STYLE_KEYS)[number];
    imageFingerprint: string;
} {
    return analyzeFieldSchema.parse(raw);
}

export function validateRefineBody(body: unknown): {
    session_id: string;
    revision: number;
    image_fingerprint: string;
    new_intent: string;
} {
    return refineFieldSchema.parse(body);
}

export function validateXmpBody(body: unknown): {
    lightroomParams: Record<string, number | number[]>;
    sessionId?: string;
    revision?: number;
} {
    const parsed = xmpBodySchema.parse(body);
    return {
        lightroomParams: validateLightroomParamPayload(parsed.lightroom_params),
        sessionId: parsed.session_id,
        revision: parsed.revision,
    };
}

export function validateLightroomParamPayload(
    params: unknown
): Record<string, number | number[]> {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('Missing required field: lightroom_params');
    }

    const result: Record<string, number | number[]> = {};
    for (const [key, value] of Object.entries(params)) {
        if (isKnownToneCurveKey(key)) {
            if (!Array.isArray(value) || value.length < 4 || value.length % 2 !== 0) {
                throw new Error(`Invalid tone curve value for key "${key}"`);
            }
            const nums = value.map((item) => Number(item));
            if (nums.some((num) => !Number.isFinite(num))) {
                throw new Error(`Invalid tone curve value for key "${key}"`);
            }
            result[key] = nums;
            continue;
        }

        if (!isKnownLightroomScalarKey(key)) {
            throw new Error(`Unknown Lightroom parameter key "${key}"`);
        }
        if (!isFiniteNumber(value)) {
            throw new Error(`Invalid parameter value for key "${key}"`);
        }
        result[key] = value;
    }

    return result;
}

export const KNOWN_LIGHTROOM_PARAM_KEY_COUNT =
    KNOWN_LIGHTROOM_SCALAR_KEYS.size + KNOWN_TONE_CURVE_KEYS.size;
