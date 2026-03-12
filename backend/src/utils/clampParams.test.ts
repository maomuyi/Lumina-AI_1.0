import assert from 'node:assert/strict';
import test from 'node:test';
import { clampLightroomParams } from './clampParams.js';

test('clampLightroomParams clamps known scalar params and drops unknown keys', () => {
    const clamped = clampLightroomParams({
        Exposure2012: 99,
        Saturation: -120,
        UnknownInjectedParam: 123,
    });

    assert.equal(clamped.Exposure2012, 5);
    assert.equal(clamped.Saturation, -100);
    assert.equal('UnknownInjectedParam' in clamped, false);
});

test('clampLightroomParams only keeps known tone curve keys', () => {
    const clamped = clampLightroomParams({
        ToneCurvePV2012: [-10, 0, 128.4, 260],
        ToneCurveInjected: [1, 2, 3, 4],
    });

    assert.deepEqual(clamped.ToneCurvePV2012, [0, 0, 128, 255]);
    assert.equal('ToneCurveInjected' in clamped, false);
});
