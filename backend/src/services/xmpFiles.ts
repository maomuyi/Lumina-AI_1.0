import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

export const XMP_DIR = path.join(process.cwd(), 'tmp', 'xmp');
export const XMP_FILE_TTL_SECONDS = parseInt(
    process.env.XMP_FILE_TTL_SECONDS || '86400',
    10
);

export function ensureXmpDir(): void {
    fs.mkdirSync(XMP_DIR, { recursive: true });
}

export function writeXmpFile(content: string): {
    filename: string;
    filePath: string;
    downloadUrl: string;
} {
    ensureXmpDir();
    const filename = `Lumina_${nanoid(8)}.xmp`;
    const filePath = path.join(XMP_DIR, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return {
        filename,
        filePath,
        downloadUrl: `/downloads/${filename}`,
    };
}

export function cleanupExpiredXmpFiles(nowMs = Date.now()): {
    scanned: number;
    removed: number;
} {
    ensureXmpDir();
    const ttlMs = XMP_FILE_TTL_SECONDS * 1000;
    const files = fs.readdirSync(XMP_DIR);
    let removed = 0;

    for (const file of files) {
        if (!file.endsWith('.xmp')) continue;

        const filePath = path.join(XMP_DIR, file);
        try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) continue;
            if (nowMs - stat.mtimeMs > ttlMs) {
                fs.unlinkSync(filePath);
                removed += 1;
            }
        } catch {
            // Ignore a single file failure to avoid breaking cleanup loop.
        }
    }

    return { scanned: files.length, removed };
}
