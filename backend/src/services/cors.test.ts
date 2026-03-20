import assert from 'node:assert/strict';
import test from 'node:test';
import { isOriginAllowed } from './cors.js';

test('vercel.app origins are denied by default when not in explicit allowlist', () => {
    const allowed = isOriginAllowed('https://attacker.vercel.app', ['http://localhost:*'], false);
    assert.equal(allowed, false);
});

test('vercel.app origins can be optionally allowed by explicit flag', () => {
    const allowed = isOriginAllowed('https://preview.vercel.app', ['http://localhost:*'], true);
    assert.equal(allowed, true);
});

test('wildcard allowlist patterns continue to work for known origins', () => {
    const allowed = isOriginAllowed('http://localhost:3000', ['http://localhost:*'], false);
    assert.equal(allowed, true);
});
