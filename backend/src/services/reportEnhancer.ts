import type { RawDataForPrompt } from './prompt.js';
import type { LLMResponse } from '../utils/parseAI.js';

const REPORT_TAGS = {
    diagnosis: ['【🖼 画面诊断】', '【🖼️ 画面诊断】'],
    physics: ['【🔬 底层剖析】'],
    strategy: ['【💡 美化建议】'],
};

const ACTION_PRIORITY = [
    'Exposure2012',
    'Highlights2012',
    'Shadows2012',
    'Whites2012',
    'Blacks2012',
    'Temperature',
    'Tint',
    'Vibrance',
    'Saturation',
    'Texture',
    'Clarity2012',
    'Dehaze',
    'LuminanceSmoothing',
    'ColorNoiseReduction',
    'GrainAmount',
];

function stripTag(text: string, tags: string[]): string {
    let result = text.trim();
    for (const tag of tags) {
        result = result.replace(tag, '').trim();
    }
    return result;
}

function formatPercent(value: number): string {
    return `${(Math.max(0, value) * 100).toFixed(1)}%`;
}

function plusSigned(value: number): string {
    const rounded = Math.abs(value) >= 10 ? Math.round(value) : Number(value.toFixed(2));
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

function summarizeHistogram(hist: number[]): string {
    if (!Array.isArray(hist) || hist.length === 0) {
        return '直方图缺失，按保守策略执行。';
    }
    const peakIndex = hist.reduce(
        (bestIdx, value, idx) => (value > hist[bestIdx] ? idx : bestIdx),
        0
    );
    const normalized = peakIndex / Math.max(1, hist.length - 1);
    if (normalized < 0.25) return '主峰偏暗部，欠曝区域占比高。';
    if (normalized > 0.75) return '主峰偏高光，亮部占比高且需保护层次。';
    return '主峰位于中间调，曝光基线较稳定。';
}

function summaryForParam(param: string, value: number, raw: RawDataForPrompt): string {
    const sp = raw.sensor_physics;
    const clip = formatPercent(sp.highlight_clipping_rate);
    const shadow = formatPercent(1 - sp.shadow_survival_rate);
    const iso = raw.exif.iso ?? 'unknown';
    const banding = sp.banding_risk;

    switch (param) {
    case 'Exposure2012':
        return `按暗部存活率 ${formatPercent(sp.shadow_survival_rate)} 回补基准曝光，避免中间调塌陷。`;
    case 'Highlights2012':
        return `高光溢出 ${clip}，通过压高光回收亮部纹理并避免灰雾感。`;
    case 'Shadows2012':
        return `暗部受损 ${shadow}，定向抬升阴影但保留黑位支撑。`;
    case 'Whites2012':
        return `白场用于重建高光冲击力，匹配当前 ${clip} 的容错空间。`;
    case 'Blacks2012':
        return `黑位用于锚定对比基线，防止抬曝光后画面发漂。`;
    case 'Temperature':
        return `结合 RGGB 通道比与场景语义校正白平衡，当前值 ${plusSigned(value)} 更贴合光源。`;
    case 'Tint':
        return '微调色偏轴，控制肤色与中性灰的偏绿/偏洋红风险。';
    case 'Vibrance':
        return `优先使用自然饱和度，减少肤色或高饱和区域过冲。`;
    case 'Saturation':
        return '全局饱和度仅做小幅修正，避免高饱和彩块失真。';
    case 'Texture':
        return '纹理针对中频细节，优先提升质感而不过度强调噪点。';
    case 'Clarity2012':
        return '清晰度用于局部反差塑形，防止边缘光晕和皮肤粗糙化。';
    case 'Dehaze':
        return `去朦胧受 ISO ${iso} 与信噪比约束，避免噪点被放大。`;
    case 'LuminanceSmoothing':
        return `依据 ISO ${iso} 与暗部质量开启亮度降噪，平衡细节与干净度。`;
    case 'ColorNoiseReduction':
        return '色噪抑制用于稳定暗部色斑，避免阴影区彩噪外翻。';
    case 'GrainAmount':
        return `断层风险 ${banding} 时引入颗粒打散色阶，降低平滑渐变的条带感。`;
    default:
        return '该参数用于微调全局层次与色彩平衡。';
    }
}

function toAction(param: string, value: number, raw: RawDataForPrompt): string {
    return `【${param}】${plusSigned(value)}：${summaryForParam(param, value, raw)}`;
}

function extractActionParam(action: string): string | null {
    const match = action.match(/【(.+?)】/);
    return match?.[1] ?? null;
}

function buildDerivedActions(
    params: Record<string, number | number[]>,
    raw: RawDataForPrompt
): string[] {
    const numericEntries = Object.entries(params)
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => [key, value as number] as const)
        .filter(([, value]) => Math.abs(value) > 0.01);

    const sorted = numericEntries.sort((a, b) => {
        const idxA = ACTION_PRIORITY.indexOf(a[0]);
        const idxB = ACTION_PRIORITY.indexOf(b[0]);
        const priorityA = idxA === -1 ? 999 : idxA;
        const priorityB = idxB === -1 ? 999 : idxB;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return Math.abs(b[1]) - Math.abs(a[1]);
    });

    return sorted.slice(0, 8).map(([param, value]) => toAction(param, value, raw));
}

export function enrichDiagnosticReport(
    report: LLMResponse['diagnostic_report'],
    rawData: RawDataForPrompt,
    params: Record<string, number | number[]>
): LLMResponse['diagnostic_report'] {
    const sp = rawData.sensor_physics;
    const clipping = formatPercent(sp.highlight_clipping_rate);
    const shadowKeep = formatPercent(sp.shadow_survival_rate);
    const shadowLoss = formatPercent(1 - sp.shadow_survival_rate);
    const histogramSummary = summarizeHistogram(rawData.linear_histogram);
    const dynamicBand =
        sp.highlight_clipping_rate < 0.03 && sp.shadow_survival_rate > 0.9
            ? '动态范围健康，可进行中高强度塑形。'
            : '动态范围受限，需优先保护可恢复层次。';
    const wbSummary = Array.isArray(sp.raw_channel_multipliers) && sp.raw_channel_multipliers.length >= 3
        ? `通道倍率 R/G/B≈${sp.raw_channel_multipliers[0].toFixed(2)}/1.00/${sp.raw_channel_multipliers[2].toFixed(2)}。`
        : '缺少通道倍率，白平衡按语义保守估计。';

    const modelDiagnosis = stripTag(report.module_1_diagnosis, REPORT_TAGS.diagnosis);
    const modelPhysics = stripTag(report.module_2_physics, REPORT_TAGS.physics);
    const modelStrategy = stripTag(report.module_3_strategy, REPORT_TAGS.strategy);

    const derivedActions = buildDerivedActions(params, rawData);
    const mergedActions: string[] = [];
    const seen = new Set<string>();

    for (const source of [...report.module_4_core_actions, ...derivedActions]) {
        const action = source.trim();
        if (!action) continue;
        const key = extractActionParam(action) ?? action;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedActions.push(action);
        if (mergedActions.length >= 10) break;
    }

    if (mergedActions.length === 0) {
        mergedActions.push('【Exposure2012】+0.00：当前参数未发生偏移，建议结合意图重新生成方案。');
    }

    const diagnosisExpert = [
        `底片判定：${rawData.file_type} ${sp.bit_depth}-bit，ISO ${rawData.exif.iso ?? 'unknown'}。`,
        `高光溢出 ${clipping}，暗部受损 ${shadowLoss}（存活 ${shadowKeep}）。`,
        histogramSummary,
        dynamicBand,
    ].join(' ');

    const physicsExpert = [
        `核心指标：bit_depth=${sp.bit_depth}，highlight_clipping_rate=${clipping}，shadow_survival_rate=${shadowKeep}，banding_risk=${sp.banding_risk}。`,
        wbSummary,
        rawData.color_space ? `色彩空间标记：${rawData.color_space}。` : '色彩空间标记：unknown。',
    ].join(' ');

    const strategyExpert = [
        '执行顺序：先曝光与白平衡基线，再做高光/阴影重映射，最后执行颜色分级与噪声防御。',
        rawData.file_type === 'JPG'
            ? 'JPG 为 8-bit 压缩轨，建议限制极端拉扯并优先用柔性参数。'
            : 'RAW 双轨输入可同时利用视觉语义与物理数据，参数可更精确地贴合底片上限。',
    ].join(' ');

    return {
        module_1_diagnosis: `【🖼 画面诊断】${modelDiagnosis} 专家结论：${diagnosisExpert}`,
        module_2_physics: `【🔬 底层剖析】${modelPhysics} ${physicsExpert}`,
        module_3_strategy: `【💡 美化建议】${modelStrategy} ${strategyExpert}`,
        module_4_core_actions: mergedActions,
    };
}
