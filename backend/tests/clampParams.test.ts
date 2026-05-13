import { describe, it, expect } from 'vitest';
import { clampLightroomParams } from '../src/utils/clampParams.js';

describe('clampLightroomParams', () => {
    it('Exposure2012 超过 +5 会被钳到 5', () => {
        const r = clampLightroomParams({ Exposure2012: 10 });
        expect(r.Exposure2012).toBeLessThanOrEqual(5);
    });

    it('Exposure2012 低于 -5 会被钳到 -5', () => {
        const r = clampLightroomParams({ Exposure2012: -10 });
        expect(r.Exposure2012).toBeGreaterThanOrEqual(-5);
    });

    it('Highlights2012 范围 [-100, 100]', () => {
        const r = clampLightroomParams({ Highlights2012: -200 });
        expect(r.Highlights2012).toBe(-100);
    });

    it('Temperature 范围合理（2000-50000 K）', () => {
        const r1 = clampLightroomParams({ Temperature: 100 });
        const r2 = clampLightroomParams({ Temperature: 99999 });
        expect(r1.Temperature as number).toBeGreaterThanOrEqual(2000);
        expect(r2.Temperature as number).toBeLessThanOrEqual(50000);
    });

    it('未知参数被原样保留（不报错也不丢）', () => {
        const r = clampLightroomParams({ FooBar: 42 } as Record<string, number>);
        expect(r.FooBar).toBe(42);
    });

    it('空对象返回空对象', () => {
        expect(clampLightroomParams({})).toEqual({});
    });

    it('NaN 输入被剔除（避免污染下游 XMP）', () => {
        const r = clampLightroomParams({ Exposure2012: NaN });
        if ('Exposure2012' in r) {
            expect(Number.isFinite(r.Exposure2012 as number)).toBe(true);
        }
    });
});
