import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clampLightroomParams } from '../utils/clampParams.js';
import { generateXMP } from '../services/xmp.js';
import { writeXmpFile } from '../services/xmpFiles.js';

interface XmpBody {
    lightroom_params?: Record<string, number | number[]>;
}

function isValidLightroomParamValue(value: unknown): value is number | number[] {
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value)) return false;
    return value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

export async function xmpRoutes(fastify: FastifyInstance) {
    fastify.post('/api/xmp', async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as XmpBody | undefined;
        const params = body?.lightroom_params;

        if (!params || typeof params !== 'object') {
            return reply.status(400).send({
                error: 'Missing required field: lightroom_params',
            });
        }

        for (const [key, value] of Object.entries(params)) {
            if (!isValidLightroomParamValue(value)) {
                return reply.status(400).send({
                    error: `Invalid parameter value for key "${key}"`,
                });
            }
        }

        const clamped = clampLightroomParams(params);
        const xmpContent = generateXMP(clamped);
        const { downloadUrl } = writeXmpFile(xmpContent);

        return reply.send({ download_url: downloadUrl });
    });
}
