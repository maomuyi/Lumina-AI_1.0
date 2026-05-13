import { describe, expect, it } from 'vitest';
import { enhanceParamsForStyleIntent } from '../src/services/styleParamEnhancer.js';
import { resolveStyleIntentProfile } from '../src/services/styleProfiles.js';
import type { RawDataForPrompt } from '../src/services/prompt.js';

const SAFE_RAW: RawDataForPrompt = {
    file_type: 'NEF',
    exif: { iso: 100 },
    sensor_physics: {
        bit_depth: 14,
        shadow_survival_rate: 0.96,
        highlight_clipping_rate: 0.01,
        banding_risk: 'low',
        raw_channel_multipliers: [2.1, 1, 1.4],
    },
    linear_histogram: [10, 20, 30, 60, 80, 120, 80, 60, 30, 15],
    color_space: 'sRGB',
};

const RISKY_JPG: RawDataForPrompt = {
    file_type: 'JPG',
    exif: { iso: 3200 },
    sensor_physics: {
        bit_depth: 8,
        shadow_survival_rate: 0.72,
        highlight_clipping_rate: 0.08,
        banding_risk: 'high',
    },
    linear_histogram: [5, 12, 28, 90, 180, 240, 160, 80, 40, 18],
};

function num(params: Record<string, number | number[]>, key: string): number {
    const value = params[key];
    return typeof value === 'number' ? value : 0;
}

describe('style intent profiles', () => {
    it('detects common Chinese and English style intents', () => {
        expect(resolveStyleIntentProfile('小红书低饱和清透')?.id).toContain('xiaohongshu_clean');
        expect(resolveStyleIntentProfile('Portra 400 胶片')?.id).toContain('portra_film');
        expect(resolveStyleIntentProfile('电影感青橙')?.id).toContain('cinematic_teal_orange');
        expect(resolveStyleIntentProfile('CCD 港风复古')?.id).toContain('ccd_vintage');
        expect(resolveStyleIntentProfile('黑白高级灰')?.id).toContain('black_white');
    });

    it('makes style refine visibly different across at least three key dimensions', () => {
        const params = enhanceParamsForStyleIntent(
            { Exposure2012: 0.1, Saturation: 0, GrainAmount: 0 },
            '调成 Portra 胶片感',
            '',
            SAFE_RAW
        );

        expect(num(params, 'Highlights2012')).toBeLessThanOrEqual(-16);
        expect(num(params, 'Blacks2012')).toBeGreaterThanOrEqual(14);
        expect(num(params, 'GrainAmount')).toBeGreaterThanOrEqual(22);
        expect(num(params, 'SplitToningHighlightSaturation')).toBeGreaterThanOrEqual(8);
    });

    it('uses Lightroom defaults for sparse params instead of collapsing color temperature', () => {
        const params = enhanceParamsForStyleIntent(
            { Exposure2012: 0.1 },
            '电影感青橙',
            '',
            SAFE_RAW
        );

        expect(num(params, 'Temperature')).toBeGreaterThan(5000);
        expect(num(params, 'Temperature')).toBeLessThan(5500);
        expect(num(params, 'SplitToningShadowHue')).toBe(215);
    });

    it('keeps hue-style fields as stable targets on repeated style refines', () => {
        const first = enhanceParamsForStyleIntent(
            { SplitToningShadowHue: 0, SplitToningHighlightHue: 0 },
            'Portra 胶片',
            '',
            SAFE_RAW
        );
        const second = enhanceParamsForStyleIntent(first, 'Portra 胶片', '', SAFE_RAW);

        expect(num(first, 'SplitToningShadowHue')).toBe(215);
        expect(num(second, 'SplitToningShadowHue')).toBe(215);
        expect(num(second, 'SplitToningHighlightHue')).toBe(45);
    });

    it('does not double-apply profile deltas when the model already made a visible move', () => {
        const previous = {
            Highlights2012: -47,
            Blacks2012: -27.3,
            GrainAmount: 12,
            SaturationAdjustmentGreen: 0,
            SplitToningShadowSaturation: 18,
            SplitToningHighlightSaturation: 12,
        };
        const modelOutput = {
            Highlights2012: -71,
            Blacks2012: -9.3,
            GrainAmount: 28,
            SaturationAdjustmentGreen: -18,
            SplitToningShadowSaturation: 10,
            SplitToningHighlightSaturation: 12,
        };
        const params = enhanceParamsForStyleIntent(
            modelOutput,
            '调成 Portra 胶片感，变化要明显',
            '',
            SAFE_RAW,
            previous
        );

        expect(num(params, 'Highlights2012')).toBe(-71);
        expect(num(params, 'Blacks2012')).toBe(-9.3);
        expect(num(params, 'SaturationAdjustmentGreen')).toBe(-18);
        expect(num(params, 'GrainAmount')).toBe(40);
        expect(num(params, 'SplitToningShadowSaturation')).toBe(10);
    });

    it('keeps safety limits for risky JPG while still applying visible style', () => {
        const params = enhanceParamsForStyleIntent(
            { Shadows2012: 20, Dehaze: 0, Saturation: 0 },
            '电影感青橙更明显',
            '',
            RISKY_JPG
        );

        expect(num(params, 'Shadows2012')).toBeLessThanOrEqual(45);
        expect(num(params, 'Dehaze')).toBeLessThanOrEqual(0);
        expect(num(params, 'Highlights2012')).toBeGreaterThanOrEqual(-58);
        expect(num(params, 'SplitToningShadowSaturation')).toBeGreaterThanOrEqual(14);
    });
});
