import { describe, expect, it } from 'vitest';
import { enhanceParamsForStyleIntent } from '../src/services/styleParamEnhancer.js';

describe('enhanceParamsForStyleIntent', () => {
    it('turns black and white intent into numeric previewable parameters', () => {
        const params = enhanceParamsForStyleIntent({ Exposure2012: 0.2, Vibrance: 10 }, '我想要黑白风格的');

        expect(params.Saturation).toBe(-100);
        expect(params.Vibrance).toBe(-100);
        expect(params.SaturationAdjustmentBlue).toBe(-100);
        expect(params.SplitToningShadowSaturation).toBe(0);
    });

    it('adds visible low-saturation clean style parameters', () => {
        const params = enhanceParamsForStyleIntent({ Saturation: 0 }, '调成最近小红书流行的清透低饱和胶片感');

        expect(params.Saturation as number).toBeLessThan(0);
        expect(params.SaturationAdjustmentGreen as number).toBeLessThan(0);
        expect(params.Highlights2012 as number).toBeLessThan(0);
        expect(params.GrainAmount as number).toBeGreaterThan(0);
    });

    it('adds visible cinematic split-toning parameters', () => {
        const params = enhanceParamsForStyleIntent({}, '整体更电影感');

        expect(params.SplitToningShadowSaturation as number).toBeGreaterThan(0);
        expect(params.SplitToningHighlightSaturation as number).toBeGreaterThan(0);
        expect(params.Contrast2012 as number).toBeGreaterThan(0);
    });
});
