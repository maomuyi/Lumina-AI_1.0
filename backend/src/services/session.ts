/**
 * session.ts — Redis Session 管理
 *
 * 首次 analyze 时创建 session，缓存图片 URL 和物理数据。
 * 后续 refine 请求只传 session_id + new_intent，后端从 Redis 取缓存数据。
 * TTL 30 分钟，自动过期。
 */

import Redis from 'ioredis';
import { nanoid } from 'nanoid';
import type { RawDataForPrompt } from './prompt.js';

const SESSION_TTL = parseInt(process.env.SESSION_TTL || '1800', 10); // 30min

let redis: Redis | null = null;
let redisFallbackLogged = false;
let redisDisabled = false;

const memorySessions = new Map<string, { data: SessionData; expiresAt: number }>();

function getRedis(): Redis {
    if (redisDisabled) {
        throw new Error('Redis is disabled after falling back to in-memory sessions');
    }
    if (!redis) {
        const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        redis = new Redis(url, {
            maxRetriesPerRequest: 1,
            lazyConnect: true,
            enableOfflineQueue: false,
            connectTimeout: 500,
            retryStrategy: () => null,
        });
        redis.on('error', (err) => {
            if (!redisFallbackLogged) {
                console.error('[Redis Error]', err.message);
            }
        });
    }
    return redis;
}

export interface SessionData {
    /** 预览图 Base64（首轮传入，后续复用，不重传） */
    previewImageBase64: string;
    /** WASM 解析的物理数据 */
    rawData: RawDataForPrompt;
    /** 上一轮 LLM 输出的调色参数 */
    lastLrParams: Record<string, number | number[]>;
    /** 物理数据的一句话摘要（给 Text-only LLM 用） */
    rawDataSummary: string;
    /** 当前轮次 */
    round: number;
    /** 创建时间 */
    createdAt: string;
}

const KEY_PREFIX = 'lumina:session:';

function logRedisFallback(err: unknown): void {
    if (redisFallbackLogged) return;
    redisFallbackLogged = true;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Redis Fallback] Session data will use in-memory storage: ${message}`);
}

function disableRedis(err: unknown): void {
    logRedisFallback(err);
    redisDisabled = true;
    if (redis) {
        redis.disconnect();
        redis = null;
    }
}

function cleanupMemorySessions(now = Date.now()): void {
    for (const [key, value] of memorySessions.entries()) {
        if (value.expiresAt <= now) {
            memorySessions.delete(key);
        }
    }
}

function setMemorySession(sessionId: string, data: SessionData): void {
    cleanupMemorySessions();
    memorySessions.set(sessionId, {
        data,
        expiresAt: Date.now() + SESSION_TTL * 1000,
    });
}

function getMemorySession(sessionId: string): SessionData | null {
    cleanupMemorySessions();
    return memorySessions.get(sessionId)?.data ?? null;
}

async function persistSession(sessionId: string, session: SessionData): Promise<void> {
    setMemorySession(sessionId, session);

    if (redisDisabled) return;

    try {
        await getRedis().set(
            KEY_PREFIX + sessionId,
            JSON.stringify(session),
            'EX',
            SESSION_TTL
        );
    } catch (err) {
        disableRedis(err);
    }
}

/**
 * 创建新 Session
 */
export async function createSession(data: Omit<SessionData, 'round' | 'createdAt'>): Promise<string> {
    const sessionId = `sess_${nanoid(12)}`;
    const session: SessionData = {
        ...data,
        round: 1,
        createdAt: new Date().toISOString(),
    };
    await persistSession(sessionId, session);
    return sessionId;
}

/**
 * 获取 Session
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
    const memorySession = getMemorySession(sessionId);
    if (memorySession) return memorySession;

    if (redisDisabled) return null;

    try {
        const raw = await getRedis().get(KEY_PREFIX + sessionId);
        if (raw) {
            const session = JSON.parse(raw) as SessionData;
            setMemorySession(sessionId, session);
            return session;
        }
    } catch (err) {
        disableRedis(err);
    }

    return null;
}

/**
 * 更新 Session（微调后保存新参数）
 */
export async function updateSession(
    sessionId: string,
    updates: Partial<Pick<SessionData, 'lastLrParams' | 'round'>>
): Promise<void> {
    const existing = await getSession(sessionId);
    if (!existing) return;

    const updated = { ...existing, ...updates };
    await persistSession(sessionId, updated);
}

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
