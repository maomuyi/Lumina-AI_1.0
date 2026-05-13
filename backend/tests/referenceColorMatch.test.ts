import { describe, expect, it } from 'vitest';
import {
    blendReferenceMatchParams,
    bucketHue,
    buildReferenceMatchParamsFromStats,
    clampLightroomParam,
    rgbToHsl,
    srgbToLab,
    type ImageColorStats,
} from '../../frontend/lib/reference-color-match';

function makeStats(
    overrides: Partial<ImageColorStats> = {}
): ImageColorStats {
    return {
        pixelCount: 1000,
        lab: {
            mean: { l: 50, a: 0, b: 0 },
            std: { l: 10, a: 5, b: 5 },
            percentiles: {
                p05: 8,
                p20: 25,
                p50: 50,
                p80: 78,
                p95: 92,
            },
        },
        hsl: {
            meanSaturation: 0.45,
            meanLightness: 0.5,
            channels: {},
        },
        ...overrides,
    };
}

describe('reference-color-match pure helpers', () => {
    it('converts sRGB white/black to expected LAB lightness', () => {
        expect(srgbToLab(255, 255, 255).l).toBeCloseTo(100, 1);
        expect(srgbToLab(0, 0, 0).l).toBeCloseTo(0, 1);
        expect(srgbToLab(255, 0, 0).a).toBeGreaterThan(60);
    });

    it('converts RGB to HSL and buckets hue into 8 Lightroom channels', () => {
        const orange = rgbToHsl(255, 128, 0);
        expect(orange.h).toBeCloseTo(30, 0);
        expect(bucketHue(orange.h)).toBe('Orange');
        expect(bucketHue(180)).toBe('Aqua');
        expect(bucketHue(240)).toBe('Blue');
        expect(bucketHue(330)).toBe('Magenta');
    });

    it('skips HSL channels that are absent in the target image', () => {
        const target = makeStats({
            hsl: {
                meanSaturation: 0.4,
                meanLightness: 0.5,
                channels: {},
            },
        });
        const reference = makeStats({
            hsl: {
                meanSaturation: 0.4,
                meanLightness: 0.5,
                channels: {
                    Blue: {
                        count: 100,
                        ratio: 0.1,
                        meanHue: 220,
                        meanSaturation: 0.8,
                        meanLightness: 0.6,
                    },
                },
            },
        });

        const params = buildReferenceMatchParamsFromStats(target, reference);
        expect(params.HueAdjustmentBlue).toBeUndefined();
        expect(params.SaturationAdjustmentBlue).toBeUndefined();
        expect(params.LuminanceAdjustmentBlue).toBeUndefined();
    });

    it('applies 30% orange-channel decay to protect skin tones', () => {
        const target = makeStats({
            hsl: {
                meanSaturation: 0.4,
                meanLightness: 0.5,
                channels: {
                    Red: {
                        count: 100,
                        ratio: 0.1,
                        meanHue: 0,
                        meanSaturation: 0.4,
                        meanLightness: 0.5,
                    },
                    Orange: {
                        count: 100,
                        ratio: 0.1,
                        meanHue: 20,
                        meanSaturation: 0.4,
                        meanLightness: 0.5,
                    },
                },
            },
        });
        const reference = makeStats({
            hsl: {
                meanSaturation: 0.4,
                meanLightness: 0.5,
                channels: {
                    Red: {
                        count: 100,
                        ratio: 0.1,
                        meanHue: 30,
                        meanSaturation: 0.7,
                        meanLightness: 0.7,
                    },
                    Orange: {
                        count: 100,
                        ratio: 0.1,
                        meanHue: 50,
                        meanSaturation: 0.7,
                        meanLightness: 0.7,
                    },
                },
            },
        });

        const params = buildReferenceMatchParamsFromStats(target, reference);
        expect(params.HueAdjustmentRed).toBe(24);
        expect(params.HueAdjustmentOrange).toBe(7);
        expect(params.SaturationAdjustmentOrange).toBe(8);
        expect(params.LuminanceAdjustmentOrange).toBe(4);
    });

    it('clamps Lightroom parameter ranges', () => {
        expect(clampLightroomParam('Exposure2012', 99)).toBe(5);
        expect(clampLightroomParam('Exposure2012', -99)).toBe(-5);
        expect(clampLightroomParam('Temperature', 100)).toBe(2000);
        expect(clampLightroomParam('Tint', 999)).toBe(150);
    });

    it('keeps base params unchanged at 0% strength', () => {
        const base = { Exposure2012: 1, Contrast2012: 10 };
        const result = blendReferenceMatchParams(base, { Exposure2012: 3 }, 0);
        expect(result.params).toEqual(base);
        expect(result.changedKeys).toEqual([]);
    });

    it('at 70% strength only blends keys produced by the match engine', () => {
        const base = { Exposure2012: 1, Contrast2012: 10 };
        const result = blendReferenceMatchParams(base, { Exposure2012: 3 }, 70);
        expect(result.params.Exposure2012).toBe(2.4);
        expect(result.params.Contrast2012).toBe(10);
        expect(result.changedKeys).toEqual(['Exposure2012']);
    });

    it('at 100% strength uses match params but still clamps to Lightroom ranges', () => {
        const result = blendReferenceMatchParams(
            { Exposure2012: 0, Temperature: 5500 },
            { Exposure2012: 99, Temperature: 100 },
            100
        );
        expect(result.params.Exposure2012).toBe(5);
        expect(result.params.Temperature).toBe(2000);
        expect(result.changedKeys).toEqual(['Exposure2012', 'Temperature']);
    });
});
