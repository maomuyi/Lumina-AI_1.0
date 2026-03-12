/**
 * index.ts — Lumina 后端服务入口
 *
 * 启动 Fastify 服务器，注册 CORS、multipart、路由和静态文件服务。
 *
 * 启动方式：
 *   开发模式：npm run dev      (tsx watch 热重载)
 *   生产模式：npm run build && npm start
 */

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { analyzeRoutes } from './routes/analyze.js';
import { refineRoutes } from './routes/refine.js';
import { xmpRoutes } from './routes/xmp.js';
import fs from 'node:fs';
import path from 'node:path';
import { cleanupExpiredXmpFiles, ensureXmpDir, XMP_DIR, XMP_FILE_TTL_SECONDS } from './services/xmpFiles.js';
import {
    cleanupExpiredVisionPreviewFiles,
    ensureVisionPreviewDir,
    VISION_PREVIEW_DIR,
    VISION_PREVIEW_TTL_SECONDS,
} from './services/visionPreviewFiles.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ANALYZE_MAX_FILE_SIZE_MB = parseInt(process.env.ANALYZE_MAX_FILE_SIZE_MB || '50', 10);
const ANALYZE_MAX_FILE_SIZE_BYTES = Math.max(1, ANALYZE_MAX_FILE_SIZE_MB) * 1024 * 1024;
const DEFAULT_CORS_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*'];

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCorsOrigins(): string[] {
    const raw = process.env.CORS_ORIGINS;
    if (!raw) return DEFAULT_CORS_ORIGINS;
    const parsed = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : DEFAULT_CORS_ORIGINS;
}

function compileOriginPattern(pattern: string): RegExp {
    const regex = `^${escapeRegExp(pattern).replace(/\\\*/g, '.*')}$`;
    return new RegExp(regex);
}

function buildCorsOriginMatcher() {
    const patterns = parseCorsOrigins();
    const matchers = patterns.map(compileOriginPattern);
    // 兼容 *.vercel.app（保留原规则）
    const vercelMatcher = /^https?:\/\/([a-zA-Z0-9-]+\.)*vercel\.app(?::\d+)?$/;

    return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
        if (!origin) {
            cb(null, true);
            return;
        }

        const matchedByPattern = matchers.some((matcher) => matcher.test(origin));
        if (matchedByPattern || vercelMatcher.test(origin)) {
            cb(null, true);
            return;
        }

        cb(new Error('CORS origin denied'), false);
    };
}

async function main() {
    const fastify = Fastify({
        logger: {
            level: 'info',
            transport: {
                target: 'pino-pretty',
                options: { colorize: true },
            },
        },
        // 提升 body 大小限制（允许高分辨率 JPG 预览上送）
        bodyLimit: ANALYZE_MAX_FILE_SIZE_BYTES + 5 * 1024 * 1024,
    });

    // ── CORS（允许前端 localhost:3000 跨域） ────────────────────────────
    await fastify.register(cors, {
        origin: buildCorsOriginMatcher(),
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: true,
    });

    fastify.addHook('onSend', async (_request, reply, payload) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'no-referrer');
        return payload;
    });

    // ── Multipart 支持（用于上传预览图） ────────────────────────────────
    await fastify.register(multipart, {
        limits: {
            fileSize: ANALYZE_MAX_FILE_SIZE_BYTES,
            files: 1,
        },
    });

    // ── 健康检查 ────────────────────────────────────────────────────────
    fastify.get('/health', async () => ({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.1.5',
    }));

    // ── 注册业务路由 ────────────────────────────────────────────────────
    await fastify.register(analyzeRoutes);
    await fastify.register(refineRoutes);
    await fastify.register(xmpRoutes);

    // ── XMP 文件静态下载服务 ─────────────────────────────────────────────
    // MVP 阶段用本地 tmp 目录，后续切 OSS
    ensureXmpDir();
    ensureVisionPreviewDir();

    fastify.get<{ Params: { filename: string } }>(
        '/downloads/:filename',
        async (request, reply) => {
            const { filename } = request.params;

            // 安全检查：防止路径遍历
            if (filename.includes('..') || filename.includes('/')) {
                return reply.status(400).send({ error: 'Invalid filename' });
            }

            const filePath = path.join(XMP_DIR, filename);
            if (!fs.existsSync(filePath)) {
                return reply.status(404).send({ error: 'File not found or expired' });
            }

            return reply
                .header('Content-Type', 'application/rdf+xml')
                .header('Content-Disposition', `attachment; filename="${filename}"`)
                .send(fs.createReadStream(filePath));
        }
    );

    fastify.get<{ Params: { filename: string } }>(
        '/uploads/vision/:filename',
        async (request, reply) => {
            const { filename } = request.params;
            if (!/^vision_[A-Za-z0-9_-]{10}\.jpg$/.test(filename)) {
                return reply.status(400).send({ error: 'Invalid filename' });
            }

            const filePath = path.join(VISION_PREVIEW_DIR, filename);
            if (!fs.existsSync(filePath)) {
                return reply.status(404).send({ error: 'File not found or expired' });
            }

            return reply
                .header('Content-Type', 'image/jpeg')
                .header('Cache-Control', 'private, max-age=60')
                .send(fs.createReadStream(filePath));
        }
    );

    // ── XMP 清理定时任务（默认 24h TTL）────────────────────────────────
    const cleanupEverySeconds = Math.max(300, Math.floor(XMP_FILE_TTL_SECONDS / 2));
    const runCleanup = () => {
        const { scanned, removed } = cleanupExpiredXmpFiles();
        if (removed > 0) {
            fastify.log.info(
                `[xmp-cleanup] removed ${removed} files (scanned=${scanned}, ttl=${XMP_FILE_TTL_SECONDS}s)`
            );
        }
    };

    runCleanup();
    setInterval(runCleanup, cleanupEverySeconds * 1000).unref();

    const cleanupVisionPreviewEverySeconds = Math.max(120, Math.floor(VISION_PREVIEW_TTL_SECONDS / 2));
    const runVisionPreviewCleanup = () => {
        const { scanned, removed } = cleanupExpiredVisionPreviewFiles();
        if (removed > 0) {
            fastify.log.info(
                `[vision-preview-cleanup] removed ${removed} files (scanned=${scanned}, ttl=${VISION_PREVIEW_TTL_SECONDS}s)`
            );
        }
    };

    runVisionPreviewCleanup();
    setInterval(runVisionPreviewCleanup, cleanupVisionPreviewEverySeconds * 1000).unref();

    // ── 启动服务器 ─────────────────────────────────────────────────────
    try {
        await fastify.listen({ port: PORT, host: HOST });
        console.log(`
╔══════════════════════════════════════════════════╗
║  🎨 Lumina Backend v0.1.5                        ║
║                                                  ║
║  API:    http://${HOST}:${PORT}                   ║
║  Health: http://${HOST}:${PORT}/health            ║
║                                                  ║
║  Routes:                                         ║
║    POST /api/analyze   (SSE, multipart)          ║
║    POST /api/refine    (SSE, multipart)          ║
║    POST /api/xmp       (JSON)                    ║
║    GET  /downloads/:id (XMP download)            ║
╚══════════════════════════════════════════════════╝
`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

main();
