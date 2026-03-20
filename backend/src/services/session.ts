import { nanoid } from 'nanoid';
import type { RawDataForPrompt } from './prompt.js';
import { getRedisClient, type SharedRedisClient } from './redis.js';

const SESSION_TTL = parseInt(process.env.SESSION_TTL || '1800', 10); // 30min

export interface SessionData {
    rawData: RawDataForPrompt;
    rawDataSummary: string;
    imageFingerprint: string;
    style: string;
    lastLrParams: Record<string, number | number[]>;
    lastReport: Record<string, unknown> | null;
    revision: number;
    intentHistory?: string[];
    createdAt: string;
    updatedAt: string;
}

export interface CreateSessionInput {
    rawData: RawDataForPrompt;
    rawDataSummary: string;
    imageFingerprint: string;
    style?: string;
    lastLrParams: Record<string, number | number[]>;
    lastReport?: Record<string, unknown> | null;
    intent?: string;
    intentHistory?: string[];
}

export interface UpdateSessionInput {
    rawDataSummary?: string;
    style?: string;
    lastLrParams?: Record<string, number | number[]>;
    lastReport?: Record<string, unknown> | null;
    intent?: string;
    intentHistory?: string[];
}

export interface SessionMatchInput {
    revision: number;
    imageFingerprint: string;
}

export type SessionMatchResult = 'ok' | 'revision_conflict' | 'fingerprint_mismatch';

export type SessionRedisClient = Pick<SharedRedisClient, 'get' | 'set'> &
    Partial<Pick<SharedRedisClient, 'eval'>>;

const KEY_PREFIX = 'lumina:session:';
const CAS_SET_BY_REVISION_SCRIPT = `
local key = KEYS[1]
local expectedRevision = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local nextPayload = ARGV[3]
local raw = redis.call('GET', key)
if not raw then
  return nil
end
local current = cjson.decode(raw)
if tonumber(current.revision) ~= expectedRevision then
  return nil
end
redis.call('SET', key, nextPayload, 'EX', ttl)
return nextPayload
`;

function normalizeIntentHistory(input?: string[]): string[] | undefined {
    if (!input) return undefined;

    const normalized = input
        .map((intent) => intent.trim())
        .filter(Boolean);

    return normalized.length > 0 ? normalized : undefined;
}

function buildSessionData(input: CreateSessionInput, nowIso: string): SessionData {
    const intentHistory = normalizeIntentHistory(
        input.intentHistory ?? (input.intent ? [input.intent] : undefined)
    );

    return {
        rawData: input.rawData,
        rawDataSummary: input.rawDataSummary,
        imageFingerprint: input.imageFingerprint,
        style: input.style ?? 'auto',
        lastLrParams: input.lastLrParams,
        lastReport: input.lastReport ?? null,
        revision: 1,
        intentHistory,
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}

function buildUpdatedSession(existing: SessionData, updates: UpdateSessionInput, nowIso: string): SessionData {
    const nextIntentHistory = normalizeIntentHistory(
        updates.intentHistory ??
            (updates.intent
                ? [...(existing.intentHistory ?? []), updates.intent]
                : existing.intentHistory)
    );

    return {
        ...existing,
        rawDataSummary: updates.rawDataSummary ?? existing.rawDataSummary,
        style: updates.style ?? existing.style,
        lastLrParams: updates.lastLrParams ?? existing.lastLrParams,
        lastReport: updates.lastReport ?? existing.lastReport,
        intentHistory: nextIntentHistory,
        revision: existing.revision + 1,
        updatedAt: nowIso,
    };
}

function sessionKey(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
}

export function compareSessionRevisionAndFingerprint(
    session: Pick<SessionData, 'revision' | 'imageFingerprint'>,
    incoming: SessionMatchInput
): SessionMatchResult {
    if (session.imageFingerprint !== incoming.imageFingerprint) {
        return 'fingerprint_mismatch';
    }

    if (session.revision !== incoming.revision) {
        return 'revision_conflict';
    }

    return 'ok';
}

export function createSessionService(redisClient?: SessionRedisClient) {
    const resolveRedisClient = (): SessionRedisClient => redisClient ?? getRedisClient();

    const createSession = async (data: CreateSessionInput): Promise<string> => {
        const sessionId = `sess_${nanoid(12)}`;
        const nowIso = new Date().toISOString();
        const session = buildSessionData(data, nowIso);
        await resolveRedisClient().set(
            sessionKey(sessionId),
            JSON.stringify(session),
            'EX',
            SESSION_TTL
        );
        return sessionId;
    };

    const getSession = async (sessionId: string): Promise<SessionData | null> => {
        const raw = await resolveRedisClient().get(sessionKey(sessionId));
        if (!raw) return null;
        return JSON.parse(raw) as SessionData;
    };

    const updateSession = async (
        sessionId: string,
        updates: UpdateSessionInput
    ): Promise<SessionData | null> => {
        const client = resolveRedisClient();
        const key = sessionKey(sessionId);
        const existingRaw = await client.get(key);
        if (!existingRaw) return null;
        const existing = JSON.parse(existingRaw) as SessionData;
        if (!existing) return null;

        const updated = buildUpdatedSession(existing, updates, new Date().toISOString());

        if (typeof client.eval === 'function') {
            const result = await client.eval(
                CAS_SET_BY_REVISION_SCRIPT,
                1,
                key,
                existing.revision,
                SESSION_TTL,
                JSON.stringify(updated)
            );
            if (!result) {
                return null;
            }
            return updated;
        }

        await client.set(key, JSON.stringify(updated), 'EX', SESSION_TTL);
        return updated;
    };

    return {
        createSession,
        getSession,
        updateSession,
    };
}

const defaultSessionService = createSessionService();

/**
 * 创建新 Session
 */
export const createSession = defaultSessionService.createSession;

/**
 * 获取 Session
 */
export const getSession = defaultSessionService.getSession;

/**
 * 更新 Session（微调后保存新参数）
 */
export const updateSession = defaultSessionService.updateSession;

/**
 * 生成物理数据的简明摘要（给 Text-only 微调 LLM 使用）
 */
export function summarizeRawData(rawData: RawDataForPrompt): string {
    const sp = rawData.sensor_physics;
    const iso = rawData.exif.iso || 'unknown';
    return [
        `文件类型: ${rawData.file_type}`,
        `位深: ${sp.bit_depth}-bit`,
        `ISO: ${iso}`,
        `暗部存活率: ${(sp.shadow_survival_rate * 100).toFixed(1)}%`,
        `高光溢出率: ${(sp.highlight_clipping_rate * 100).toFixed(1)}%`,
        `断层风险: ${sp.banding_risk}`,
        rawData.color_space ? `色彩空间: ${rawData.color_space}` : '',
    ]
        .filter(Boolean)
        .join(', ');
}
