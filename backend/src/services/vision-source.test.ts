import assert from 'node:assert/strict';
import test from 'node:test';
import {
    prepareVisionImageSource,
    resolveVisionImageSource,
    validatePublicBaseUrl,
} from './vision-source.js';

test('codeproxy defaults to public_url transport', () => {
    const resolved = resolveVisionImageSource({
        configuredMode: 'auto',
        baseUrl: 'https://codeproxy.dev/v1',
        previewBase64: 'abcd',
        publicImageUrl: 'https://demo.lumina.app/uploads/vision/foo.jpg',
    });

    assert.deepEqual(resolved, {
        mode: 'public_url',
        imageUrl: 'https://demo.lumina.app/uploads/vision/foo.jpg',
    });
});

test('generic providers may continue to use data_url transport', () => {
    const resolved = resolveVisionImageSource({
        configuredMode: 'auto',
        baseUrl: 'https://api.openai.com/v1',
        previewBase64: 'abcd',
        publicImageUrl: 'https://demo.lumina.app/uploads/vision/foo.jpg',
    });

    assert.equal(resolved.mode, 'data_url');
    assert.match(resolved.imageUrl, /^data:image\/jpeg;base64,abcd$/);
});

test('validatePublicBaseUrl rejects localhost and private hosts for public_url mode', () => {
    assert.equal(validatePublicBaseUrl(undefined), null);
    assert.equal(validatePublicBaseUrl('http://localhost:3001'), null);
    assert.equal(validatePublicBaseUrl('http://127.0.0.1:3001'), null);
    assert.equal(validatePublicBaseUrl('https://lumina.example.com'), 'https://lumina.example.com');
});

test('request-scoped public preview creation returns a cleanup handle', async () => {
    const cleanupCalls: string[] = [];
    const prepared = prepareVisionImageSource({
        configuredMode: 'auto',
        baseUrl: 'https://codeproxy.dev/v1',
        previewBuffer: Buffer.from('preview-binary'),
        publicBaseUrl: 'https://lumina.example.com',
        createPreviewResource(buffer, publicBaseUrl) {
            assert.equal(buffer.toString('utf8'), 'preview-binary');
            assert.equal(publicBaseUrl, 'https://lumina.example.com');
            return {
                publicUrl: 'https://lumina.example.com/uploads/vision/test.jpg',
                cleanup() {
                    cleanupCalls.push('cleaned');
                },
            };
        },
    });

    assert.deepEqual(
        { mode: prepared.mode, imageUrl: prepared.imageUrl },
        {
            mode: 'public_url',
            imageUrl: 'https://lumina.example.com/uploads/vision/test.jpg',
        }
    );

    await prepared.cleanup();
    assert.deepEqual(cleanupCalls, ['cleaned']);
});

test('public url mode still rejects invalid PUBLIC_API_BASE_URL values', () => {
    assert.throws(
        () =>
            prepareVisionImageSource({
                configuredMode: 'public_url',
                baseUrl: 'https://codeproxy.dev/v1',
                previewBuffer: Buffer.from('preview-binary'),
                publicBaseUrl: 'http://localhost:3001',
            }),
        /publicly reachable image URL/
    );
});
