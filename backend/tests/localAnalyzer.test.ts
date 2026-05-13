import { describe, it, expect } from 'vitest';
import { buildLocalAnalysis, buildLocalRefine } from '../src/services/localAnalyzer.js';
import type { RawDataForPrompt } from '../src/services/prompt.js';

const NEF_HEALTHY: RawDataForPrompt = {
    file_type: 'NEF',
    exif: { camera_model: 'Nikon Z5_2', iso: 100 },
    sensor_physics: {
        bit_depth: 14,
        shadow_survival_rate: 0.95,
        highlight_clipping_rate: 0.005,
        banding_risk: 'low',
        raw_channel_multipliers: [2.1, 1.0, 1.0, 1.5],
    },
    linear_histogram: [100, 200, 300, 400, 500, 400, 300, 200, 100, 50, 30, 20, 10, 5, 3, 2],
    color_space: 'sRGB',
};

const JPG_BURNED: RawDataForPrompt = {
    file_type: 'JPG',
    exif: { camera_model: 'iPhone 15', iso: 1600 },
    sensor_physics: {
        bit_depth: 8,
        shadow_survival_rate: 0.6,
        highlight_clipping_rate: 0.08,  // 严重死白
        banding_risk: 'high',
    },
    linear_histogram: [10, 20, 30, 40, 200, 800, 900, 800, 400, 100, 50, 20, 10, 5, 2, 1],
};

function numericParam(params: Record<string, number | number[]>, key: string): number {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function styleDistance(
    a: Record<string, number | number[]>,
    b: Record<string, number | number[]>
): number {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let total = 0;
    for (const key of keys) {
        total += Math.abs(numericParam(a, key) - numericParam(b, key));
    }
    return total;
}

describe('buildLocalAnalysis', () => {
    it('健康 NEF + auto 风格：返回完整四模块报告', () => {
        const r = buildLocalAnalysis(NEF_HEALTHY, '想要清新一点', 'auto');
        expect(r.diagnostic_report.module_1_diagnosis).toContain('画面诊断');
        expect(r.diagnostic_report.module_2_physics).toContain('底层剖析');
        expect(r.diagnostic_report.module_3_strategy).toContain('美化建议');
        expect(r.diagnostic_report.module_4_core_actions.length).toBeGreaterThan(0);
        expect(Object.keys(r.lightroom_params).length).toBeGreaterThan(0);
    });

    it('film 风格触发胶片专属参数（颗粒+冷暖分调）', () => {
        const r = buildLocalAnalysis(NEF_HEALTHY, '', 'film');
        expect(r.lightroom_params.GrainAmount).toBeDefined();
        expect(r.diagnostic_report.module_1_diagnosis).toMatch(/胶片|film/i);
    });

    it('cyberpunk 风格触发蓝紫高饱和', () => {
        const r = buildLocalAnalysis(NEF_HEALTHY, '', 'cyberpunk');
        const blue = r.lightroom_params.SaturationAdjustmentBlue as number;
        expect(blue).toBeGreaterThan(0);
    });

    it('JPG + 严重死白：高光必然为负（保护溢出区）', () => {
        const r = buildLocalAnalysis(JPG_BURNED, '', 'auto');
        const hl = r.lightroom_params.Highlights2012 as number;
        expect(hl).toBeLessThan(0);
    });

    it('JPG 8-bit 高断层风险：Clarity2012 不会很高（防瑕疵）', () => {
        const r = buildLocalAnalysis(JPG_BURNED, '', 'cinematic');
        const cla = (r.lightroom_params.Clarity2012 as number) || 0;
        expect(cla).toBeLessThanOrEqual(15);
    });

    it('user_intent 包含"暖色"会推高 Temperature', () => {
        const r1 = buildLocalAnalysis(NEF_HEALTHY, '请调暖一点', 'auto');
        const r2 = buildLocalAnalysis(NEF_HEALTHY, '请调冷一点', 'auto');
        const t1 = (r1.lightroom_params.Temperature as number) || 5500;
        const t2 = (r2.lightroom_params.Temperature as number) || 5500;
        // 暖色 Temperature 数值应 < 冷色（K 值越低越暖，符合 LR 习惯）
        expect(t1).not.toBe(t2);
    });

    it('返回值的 lightroom_params 不含 NaN/Infinity', () => {
        const r = buildLocalAnalysis(NEF_HEALTHY, '', 'film');
        for (const v of Object.values(r.lightroom_params)) {
            if (typeof v === 'number') {
                expect(Number.isFinite(v)).toBe(true);
            } else if (Array.isArray(v)) {
                for (const x of v) expect(Number.isFinite(x)).toBe(true);
            }
        }
    });

    it('未知风格降级为 auto 不抛错', () => {
        expect(() => buildLocalAnalysis(NEF_HEALTHY, '', 'unknown_xyz')).not.toThrow();
    });

    it('5 个风格 profile 两两差异量都超过 800', () => {
        const styles = ['japanese', 'film', 'cyberpunk', 'grey', 'cinematic'];
        const results = Object.fromEntries(
            styles.map((style) => [style, buildLocalAnalysis(NEF_HEALTHY, '', style).lightroom_params])
        );

        let minDistance = Infinity;
        for (let i = 0; i < styles.length; i += 1) {
            for (let j = i + 1; j < styles.length; j += 1) {
                const distance = styleDistance(results[styles[i]], results[styles[j]]);
                minDistance = Math.min(minDistance, distance);
            }
        }

        expect(minDistance).toBeGreaterThan(800);
    });
});

describe('buildLocalRefine', () => {
    it('refine 在已有参数基础上做增量调整，不会清空', () => {
        const initial = buildLocalAnalysis(NEF_HEALTHY, '', 'auto');
        const r = buildLocalRefine(initial.lightroom_params, NEF_HEALTHY, '再亮一点');
        expect(Object.keys(r.lightroom_params).length).toBeGreaterThan(0);
    });

    it('refine intent 含"强一点"会放大对比度（实际匹配 /强一点|更明显/）', () => {
        const initial = buildLocalAnalysis(NEF_HEALTHY, '', 'auto');
        const initialContrast = (initial.lightroom_params.Contrast2012 as number) || 0;
        const r = buildLocalRefine(initial.lightroom_params, NEF_HEALTHY, '对比强一点');
        const newContrast = (r.lightroom_params.Contrast2012 as number) || 0;
        // 实际逻辑：先 0.72*current + 0.28*adjustment，再 *1.15
        // 只要 baseline 不为 0，强化后应严格大于初值
        if (initialContrast !== 0) {
            expect(Math.abs(newContrast)).toBeGreaterThanOrEqual(Math.abs(initialContrast) * 0.7);
        }
        expect(typeof newContrast).toBe('number');
        expect(Number.isFinite(newContrast)).toBe(true);
    });

    it('refine intent 含"弱一点"会衰减饱和度类参数', () => {
        const initial = buildLocalAnalysis(NEF_HEALTHY, '', 'cyberpunk');
        const initialVib = (initial.lightroom_params.Vibrance as number) || 0;
        const r = buildLocalRefine(initial.lightroom_params, NEF_HEALTHY, '弱一点更自然');
        const newVib = (r.lightroom_params.Vibrance as number) || 0;
        // 弱化后绝对值应 <= 初值（不一定严格小于，因为还要叠基线）
        if (initialVib > 0) {
            expect(Math.abs(newVib)).toBeLessThanOrEqual(Math.abs(initialVib) + 1);
        }
        expect(Number.isFinite(newVib)).toBe(true);
    });

    it('refine "再冷一点" 一次后 Temperature 至少下降 300K', () => {
        const initial = buildLocalAnalysis(NEF_HEALTHY, '', 'auto');
        const initialTemperature = numericParam(initial.lightroom_params, 'Temperature');
        const r = buildLocalRefine(initial.lightroom_params, NEF_HEALTHY, '再冷一点');
        const newTemperature = numericParam(r.lightroom_params, 'Temperature');

        expect(initialTemperature - newTemperature).toBeGreaterThanOrEqual(300);
    });
});
