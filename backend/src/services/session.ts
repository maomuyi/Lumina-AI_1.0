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

function getRedis(): Redis {
    if (!redis) {
        const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        redis = new Redis(url, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });
        redis.on('error', (err) => {
            console.error('[Redis Error]', err.message);
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

/**
 * 创建新 Session
 */
export async function createSession(data: Omit<SessionData, 'round' | 'createdAt'>): Promise<string> {
    const r = getRedis();
    const sessionId = `sess_${nanoid(12)}`;
    const session: SessionData = {
        ...data,
        round: 1,
        createdAt: new Date().toISOString(),
    };
    await r.set(
        KEY_PREFIX + sessionId,
        JSON.stringify(session),
        'EX',
        SESSION_TTL
    );
    return sessionId;
}

/**
 * 获取 Session
 */
export async function getSession(sessionId: string): Promise<SessionData | null> {
    const r = getRedis();
    const raw = await r.get(KEY_PREFIX + sessionId);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
}

/**
 * 更新 Session（微调后保存新参数）
 */
export async function updateSession(
    sessionId: string,
    updates: Partial<Pick<SessionData, 'lastLrParams' | 'round'>>
): Promise<void> {
    const r = getRedis();
    const existing = await getSession(sessionId);
    if (!existing) return;

    const updated = { ...existing, ...updates };
    await r.set(
        KEY_PREFIX + sessionId,
        JSON.stringify(updated),
        'EX',
        SESSION_TTL // 每次更新时续期
    );
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
