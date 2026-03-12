import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';
import { validateXmpBody } from '../utils/requestValidation.js';
import { createRedisRateLimitStore, hitRateLimit } from '../services/rate-limit.js';

const xmpRateLimitStore = createRedisRateLimitStore();
const XMP_RATE_LIMIT_MAX = parseInt(process.env.XMP_RATE_LIMIT_MAX || '60', 10);
const XMP_RATE_LIMIT_WINDOW_SECONDS = parseInt(
    process.env.XMP_RATE_LIMIT_WINDOW_SECONDS || '300',
    10
);

export async function xmpRoutes(fastify: FastifyInstance) {
    fastify.post('/api/xmp', async (request: FastifyRequest, reply: FastifyReply) => {
        const rateLimit = await hitRateLimit(
            xmpRateLimitStore,
            'xmp',
            request.ip,
            XMP_RATE_LIMIT_MAX,
            XMP_RATE_LIMIT_WINDOW_SECONDS
        );
        if (!rateLimit.allowed) {
            return reply
                .status(429)
                .header('Retry-After', String(rateLimit.retryAfterSeconds))
                .send({
                    error: `XMP generation rate limit exceeded. Retry in ${rateLimit.retryAfterSeconds}s.`,
                });
        }

        try {
            const { lightroomParams } = validateXmpBody(request.body);
            const clamped = clampLightroomParams(lightroomParams);
            const xmpContent = generateXMP(clamped);
            const { downloadUrl } = writeXmpFile(xmpContent);

            return reply.send({ download_url: downloadUrl });
        } catch (err) {
            return reply.status(400).send({
                error: err instanceof Error ? err.message : 'Invalid XMP payload',
            });
        }
    });
}
