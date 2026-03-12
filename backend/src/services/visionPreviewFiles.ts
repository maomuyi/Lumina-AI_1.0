import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

export const VISION_PREVIEW_DIR = path.join(process.cwd(), 'tmp', 'vision-previews');
export const VISION_PREVIEW_TTL_SECONDS = parseInt(
    process.env.VISION_PREVIEW_TTL_SECONDS || '900',
    10
);

export function ensureVisionPreviewDir(): void {
    fs.mkdirSync(VISION_PREVIEW_DIR, { recursive: true });
}

export function writeVisionPreviewFile(buffer: Buffer, publicBaseUrl: string): {
    filename: string;
    filePath: string;
    publicUrl: string;
    cleanup: () => void;
} {
    ensureVisionPreviewDir();
    const filename = `vision_${nanoid(10)}.jpg`;
    const filePath = path.join(VISION_PREVIEW_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    return {
        filename,
        filePath,
        publicUrl: new URL(`/uploads/vision/${filename}`, `${publicBaseUrl}/`).toString(),
        cleanup() {
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes('ENOENT')) {
                    console.warn(`[vision-preview] cleanup failed: ${message}`);
                }
            }
        },
    };
}

export function cleanupExpiredVisionPreviewFiles(nowMs = Date.now()): {
    scanned: number;
    removed: number;
} {
    ensureVisionPreviewDir();
    const ttlMs = VISION_PREVIEW_TTL_SECONDS * 1000;
    const files = fs.readdirSync(VISION_PREVIEW_DIR);
    let removed = 0;

    for (const file of files) {
        if (!file.endsWith('.jpg')) continue;
        const filePath = path.join(VISION_PREVIEW_DIR, file);
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) continue;
            if (nowMs - stat.mtimeMs > ttlMs) {
                fs.unlinkSync(filePath);
                removed += 1;
            }
        } catch {
            // Ignore single-file cleanup failures and continue scanning.
        }
    }

    return {
        scanned: files.length,
        removed,
    };
}
