// Lightroom parameter definitions matching actual Lightroom Develop Module
export interface LightroomParam {
  key: string
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
  unit?: string
}

export interface LightroomGroup {
  key: string
  label: string
  params: LightroomParam[]
}

export const LIGHTROOM_GROUPS: LightroomGroup[] = [
  {
    key: "basic",
    label: "基本",
    params: [
      { key: "Temperature", label: "色温", min: 2000, max: 50000, step: 50, defaultValue: 5500, unit: "K" },
      { key: "Tint", label: "色调", min: -150, max: 150, step: 1, defaultValue: 0 },
      { key: "Exposure2012", label: "曝光", min: -5, max: 5, step: 0.01, defaultValue: 0 },
      { key: "Contrast2012", label: "对比度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Highlights2012", label: "高光", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Shadows2012", label: "阴影", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Whites2012", label: "白色", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Blacks2012", label: "黑色", min: -100, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  {
    key: "tone_curve",
    label: "色调曲线",
    params: [
      { key: "ParametricHighlights", label: "高光", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "ParametricLights", label: "亮色调", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "ParametricDarks", label: "暗色调", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "ParametricShadows", label: "阴影", min: -100, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  {
    key: "presence",
    label: "偏好",
    params: [
      { key: "Texture", label: "纹理", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Clarity2012", label: "清晰度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Dehaze", label: "去朦胧", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Vibrance", label: "自然饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "Saturation", label: "饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  {
    key: "hsl",
    label: "HSL / 颜色",
    params: [
      { key: "HueAdjustmentRed", label: "红色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentOrange", label: "橙色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentYellow", label: "黄色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentGreen", label: "绿色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentAqua", label: "浅绿色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentBlue", label: "蓝色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentPurple", label: "紫色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "HueAdjustmentMagenta", label: "洋红色色相", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentRed", label: "红色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentOrange", label: "橙色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentYellow", label: "黄色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentGreen", label: "绿色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentAqua", label: "浅绿色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentBlue", label: "蓝色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentPurple", label: "紫色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SaturationAdjustmentMagenta", label: "洋红色饱和度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentRed", label: "红色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentOrange", label: "橙色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentYellow", label: "黄色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentGreen", label: "绿色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentAqua", label: "浅绿色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentBlue", label: "蓝色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentPurple", label: "紫色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceAdjustmentMagenta", label: "洋红色明度", min: -100, max: 100, step: 1, defaultValue: 0 },
    ],
  },
  {
    key: "detail",
    label: "细节",
    params: [
      { key: "Sharpness", label: "锐化量", min: 0, max: 150, step: 1, defaultValue: 40 },
      { key: "SharpenRadius", label: "锐化半径", min: 0.5, max: 3, step: 0.1, defaultValue: 1.0 },
      { key: "SharpenDetail", label: "锐化细节", min: 0, max: 100, step: 1, defaultValue: 25 },
      { key: "SharpenEdgeMasking", label: "蒙版", min: 0, max: 100, step: 1, defaultValue: 0 },
      { key: "LuminanceSmoothing", label: "明度降噪", min: 0, max: 100, step: 1, defaultValue: 0 },
      { key: "ColorNoiseReduction", label: "颜色降噪", min: 0, max: 100, step: 1, defaultValue: 25 },
    ],
  },
  {
    key: "effects",
    label: "效果",
    params: [
      { key: "PostCropVignetteAmount", label: "暗角量", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "PostCropVignetteMidpoint", label: "暗角中点", min: 0, max: 100, step: 1, defaultValue: 50 },
      { key: "PostCropVignetteFeather", label: "暗角羽化", min: 0, max: 100, step: 1, defaultValue: 50 },
      { key: "PostCropVignetteRoundness", label: "暗角圆度", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "GrainAmount", label: "颗粒量", min: 0, max: 100, step: 1, defaultValue: 0 },
      { key: "GrainSize", label: "颗粒大小", min: 0, max: 100, step: 1, defaultValue: 25 },
      { key: "GrainFrequency", label: "颗粒粗糙度", min: 0, max: 100, step: 1, defaultValue: 50 },
    ],
  },
  {
    key: "split_toning",
    label: "色调分离",
    params: [
      { key: "SplitToningHighlightHue", label: "高光色相", min: 0, max: 359, step: 1, defaultValue: 0 },
      { key: "SplitToningHighlightSaturation", label: "高光饱和度", min: 0, max: 100, step: 1, defaultValue: 0 },
      { key: "SplitToningBalance", label: "平衡", min: -100, max: 100, step: 1, defaultValue: 0 },
      { key: "SplitToningShadowHue", label: "阴影色相", min: 0, max: 359, step: 1, defaultValue: 0 },
      { key: "SplitToningShadowSaturation", label: "阴影饱和度", min: 0, max: 100, step: 1, defaultValue: 0 },
    ],
  },
]

// Get default values for all params
export function getDefaultParams(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const group of LIGHTROOM_GROUPS) {
    for (const param of group.params) {
      result[param.key] = param.defaultValue
    }
  }
  return result
}
