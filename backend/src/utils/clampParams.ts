/**
 * clampParams.ts — Lightroom 参数范围校验与钳制
 *
 * 防止 LLM 生成越界参数导致 XMP 异常或 Lightroom 崩溃。
 */

const PARAM_BOUNDS: Record<string, [number, number]> = {
    // 基础面板
    Temperature: [2000, 50000],
    Tint: [-150, 150],
    Exposure2012: [-5, 5],
    Contrast2012: [-100, 100],
    Highlights2012: [-100, 100],
    Shadows2012: [-100, 100],
    Whites2012: [-100, 100],
    Blacks2012: [-100, 100],

    // 质感
    Texture: [-100, 100],
    Clarity2012: [-100, 100],
    Dehaze: [-100, 100],
    Vibrance: [-100, 100],
    Saturation: [-100, 100],

    // 参数曲线
    ParametricShadows: [-100, 100],
    ParametricDarks: [-100, 100],
    ParametricLights: [-100, 100],
    ParametricHighlights: [-100, 100],

    // 锐化 & 降噪
    Sharpness: [0, 150],
    SharpenRadius: [0.5, 3.0],
    SharpenDetail: [0, 100],
    SharpenEdgeMasking: [0, 100],
    LuminanceSmoothing: [0, 100],
    ColorNoiseReduction: [0, 100],

    // HSL (全部 -100 ~ +100)
    HueAdjustmentRed: [-100, 100],
    HueAdjustmentOrange: [-100, 100],
    HueAdjustmentYellow: [-100, 100],
    HueAdjustmentGreen: [-100, 100],
    HueAdjustmentAqua: [-100, 100],
    HueAdjustmentBlue: [-100, 100],
    HueAdjustmentPurple: [-100, 100],
    HueAdjustmentMagenta: [-100, 100],
    SaturationAdjustmentRed: [-100, 100],
    SaturationAdjustmentOrange: [-100, 100],
    SaturationAdjustmentYellow: [-100, 100],
    SaturationAdjustmentGreen: [-100, 100],
    SaturationAdjustmentAqua: [-100, 100],
    SaturationAdjustmentBlue: [-100, 100],
    SaturationAdjustmentPurple: [-100, 100],
    SaturationAdjustmentMagenta: [-100, 100],
    LuminanceAdjustmentRed: [-100, 100],
    LuminanceAdjustmentOrange: [-100, 100],
    LuminanceAdjustmentYellow: [-100, 100],
    LuminanceAdjustmentGreen: [-100, 100],
    LuminanceAdjustmentAqua: [-100, 100],
    LuminanceAdjustmentBlue: [-100, 100],
    LuminanceAdjustmentPurple: [-100, 100],
    LuminanceAdjustmentMagenta: [-100, 100],

    // 色调分离
    SplitToningShadowHue: [0, 359],
    SplitToningShadowSaturation: [0, 100],
    SplitToningHighlightHue: [0, 359],
    SplitToningHighlightSaturation: [0, 100],
    SplitToningBalance: [-100, 100],

    // 暗角
    PostCropVignetteAmount: [-100, 100],
    PostCropVignetteMidpoint: [0, 100],
    PostCropVignetteFeather: [0, 100],
    PostCropVignetteRoundness: [-100, 100],

    // 颗粒
    GrainAmount: [0, 100],
    GrainSize: [0, 100],
    GrainFrequency: [0, 100],
};

/**
 * 所有已知参数的默认值（未被 AI 修改时填入 XMP 模板的值）
 */
export const PARAM_DEFAULTS: Record<string, number> = {
    Temperature: 5500,
    Tint: 0,
    Exposure2012: 0,
    Contrast2012: 0,
    Highlights2012: 0,
    Shadows2012: 0,
    Whites2012: 0,
    Blacks2012: 0,
    Texture: 0,
    Clarity2012: 0,
    Dehaze: 0,
    Vibrance: 0,
    Saturation: 0,
    ParametricShadows: 0,
    ParametricDarks: 0,
    ParametricLights: 0,
    ParametricHighlights: 0,
    Sharpness: 40,
    SharpenRadius: 1.0,
    SharpenDetail: 25,
    SharpenEdgeMasking: 0,
    LuminanceSmoothing: 0,
    ColorNoiseReduction: 25,
    HueAdjustmentRed: 0,
    HueAdjustmentOrange: 0,
    HueAdjustmentYellow: 0,
    HueAdjustmentGreen: 0,
    HueAdjustmentAqua: 0,
    HueAdjustmentBlue: 0,
    HueAdjustmentPurple: 0,
    HueAdjustmentMagenta: 0,
    SaturationAdjustmentRed: 0,
    SaturationAdjustmentOrange: 0,
    SaturationAdjustmentYellow: 0,
    SaturationAdjustmentGreen: 0,
    SaturationAdjustmentAqua: 0,
    SaturationAdjustmentBlue: 0,
    SaturationAdjustmentPurple: 0,
    SaturationAdjustmentMagenta: 0,
    LuminanceAdjustmentRed: 0,
    LuminanceAdjustmentOrange: 0,
    LuminanceAdjustmentYellow: 0,
    LuminanceAdjustmentGreen: 0,
    LuminanceAdjustmentAqua: 0,
    LuminanceAdjustmentBlue: 0,
    LuminanceAdjustmentPurple: 0,
    LuminanceAdjustmentMagenta: 0,
    SplitToningShadowHue: 0,
    SplitToningShadowSaturation: 0,
    SplitToningHighlightHue: 0,
    SplitToningHighlightSaturation: 0,
    SplitToningBalance: 0,
    PostCropVignetteAmount: 0,
    PostCropVignetteMidpoint: 50,
    PostCropVignetteFeather: 50,
    PostCropVignetteRoundness: 0,
    GrainAmount: 0,
    GrainSize: 25,
    GrainFrequency: 50,
};

/**
 * 钳制 AI 输出的参数到合法范围。
 * 同时将不合法类型（string/null）转为默认值。
 */
export function clampLightroomParams(
    aiParams: Record<string, number | number[]>
): Record<string, number | number[]> {
    const result: Record<string, number | number[]> = {};

    for (const [key, value] of Object.entries(aiParams)) {
        // ToneCurve 为特殊数组类型，不做 clamp
        if (key.startsWith('ToneCurve') && Array.isArray(value)) {
            // 校验数组元素都是 0~255 的整数
            result[key] = (value as number[]).map((v) =>
                Math.max(0, Math.min(255, Math.round(Number(v) || 0)))
            );
            continue;
        }

        const numVal = Number(value);
        if (isNaN(numVal)) continue; // 跳过非数字

        const bounds = PARAM_BOUNDS[key];
        if (bounds) {
            result[key] = Math.max(bounds[0], Math.min(bounds[1], numVal));
        } else {
            // 未知参数仍然保留（可能是新版 LR 参数）
            result[key] = numVal;
        }
    }

    return result;
}
