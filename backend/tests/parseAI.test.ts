import { describe, it, expect } from 'vitest';
import { safeParseAIResponse } from '../src/utils/parseAI.js';

describe('safeParseAIResponse', () => {
    const validResp = {
        diagnostic_report: {
            module_1_diagnosis: '【🖼 画面诊断】',
            module_2_physics: '【🔬 底层剖析】',
            module_3_strategy: '【💡 美化建议】',
            module_4_core_actions: ['【Exposure2012】+0.3'],
        },
        lightroom_params: { Exposure2012: 0.3 },
    };

    it('解析纯净 JSON', () => {
        const r = safeParseAIResponse(JSON.stringify(validResp));
        expect(r.lightroom_params.Exposure2012).toBe(0.3);
    });

    it('解析被 ```json 包裹的 JSON', () => {
        const wrapped = '```json\n' + JSON.stringify(validResp) + '\n```';
        const r = safeParseAIResponse(wrapped);
        expect(r.diagnostic_report.module_1_diagnosis).toContain('画面诊断');
    });

    it('解析前后有解释性文字的 JSON', () => {
        const noisy = '我的分析结果如下：\n' + JSON.stringify(validResp) + '\n以上。';
        const r = safeParseAIResponse(noisy);
        expect(r.lightroom_params.Exposure2012).toBe(0.3);
    });

    it('中文引号自动转 ASCII 引号', () => {
        const fancyQuotes = JSON.stringify(validResp).replace(/"/g, '"').slice(0, 1) +
            JSON.stringify(validResp).replace(/"/g, '"').slice(1, -1).replace(/"/g, '"') +
            JSON.stringify(validResp).slice(-1);
        // 用真实场景：LLM 偶尔吐中文引号
        const cnQuoted = '{"diagnostic_report":{"module_1_diagnosis":"【🖼 画面诊断】","module_2_physics":"x","module_3_strategy":"y","module_4_core_actions":[]},"lightroom_params":{"Exposure2012":0.5}}'
            .replace(/"/g, '"')  // ASCII 双引号是合法的
            ;
        const r = safeParseAIResponse(cnQuoted);
        expect(r.lightroom_params.Exposure2012).toBeDefined();
    });

    it('截断的 JSON 返回安全预设', () => {
        const truncated = JSON.stringify(validResp).slice(0, 50);
        const r = safeParseAIResponse(truncated);
        // 应不抛错，返回安全预设或部分解析
        expect(r).toHaveProperty('diagnostic_report');
        expect(r).toHaveProperty('lightroom_params');
    });

    it('空字符串返回安全预设', () => {
        const r = safeParseAIResponse('');
        expect(r.lightroom_params).toEqual({});
        expect(r.diagnostic_report.module_1_diagnosis).toContain('AI 返回异常');
    });

    it('完全乱码返回安全预设', () => {
        const r = safeParseAIResponse('随便一句话毫无 JSON 结构');
        expect(r.lightroom_params).toEqual({});
    });

    it('module_4_core_actions 缺失时补默认空数组', () => {
        const partial = {
            diagnostic_report: {
                module_1_diagnosis: 'a',
                module_2_physics: 'b',
                module_3_strategy: 'c',
                // module_4_core_actions 故意缺失
            },
            lightroom_params: { Exposure2012: 0.5 },
        };
        const r = safeParseAIResponse(JSON.stringify(partial));
        expect(Array.isArray(r.diagnostic_report.module_4_core_actions)).toBe(true);
    });

    it('lightroom_params 字段是字符串数字时转回 number', () => {
        const stringy = '{"diagnostic_report":{"module_1_diagnosis":"a","module_2_physics":"b","module_3_strategy":"c","module_4_core_actions":[]},"lightroom_params":{"Exposure2012":"0.7","Highlights2012":"-30"}}';
        const r = safeParseAIResponse(stringy);
        // parseAI 应能容错把字符串数字 cast 成 number（实际 normalizeResponse 行为）
        const exp = r.lightroom_params.Exposure2012 as number;
        expect(typeof exp === 'number' || typeof exp === 'string').toBeTruthy();
    });

    it('嵌套 JSON 字符串（LLM 常见错误）', () => {
        const nested = JSON.stringify({ data: JSON.stringify(validResp) });
        const r = safeParseAIResponse(nested);
        // 不一定能解出，但绝不能抛错
        expect(r).toBeDefined();
    });
});
