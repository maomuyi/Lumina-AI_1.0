// Generates a valid Adobe XMP sidecar preset from Lightroom parameters
export function generateXMP(params: Record<string, number>): string {
  const xmpTemplate = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:Version="16.0"
    crs:ProcessVersion="11.0"
    crs:WhiteBalance="Custom"
    crs:Temperature="${params.Temperature ?? 5500}"
    crs:Tint="${params.Tint ?? 0}"
    crs:Exposure2012="${params.Exposure ?? 0}"
    crs:Contrast2012="${params.Contrast ?? 0}"
    crs:Highlights2012="${params.Highlights ?? 0}"
    crs:Shadows2012="${params.Shadows ?? 0}"
    crs:Whites2012="${params.Whites ?? 0}"
    crs:Blacks2012="${params.Blacks ?? 0}"
    crs:Texture="${params.Texture ?? 0}"
    crs:Clarity2012="${params.Clarity ?? 0}"
    crs:Dehaze="${params.Dehaze ?? 0}"
    crs:Vibrance="${params.Vibrance ?? 0}"
    crs:Saturation="${params.Saturation ?? 0}"
    crs:ParametricHighlights="${params.ParametricHighlights ?? 0}"
    crs:ParametricLights="${params.ParametricLights ?? 0}"
    crs:ParametricDarks="${params.ParametricDarks ?? 0}"
    crs:ParametricShadows="${params.ParametricShadows ?? 0}"
    crs:Sharpness="${params.Sharpness ?? 40}"
    crs:SharpenRadius="${params.SharpenRadius ?? 1.0}"
    crs:SharpenDetail="${params.SharpenDetail ?? 25}"
    crs:SharpenEdgeMasking="${params.SharpenEdgeMasking ?? 0}"
    crs:LuminanceSmoothing="${params.LuminanceSmoothing ?? 0}"
    crs:ColorNoiseReduction="${params.ColorNoiseReduction ?? 25}"
    crs:HueAdjustmentRed="${params.HueAdjustmentRed ?? 0}"
    crs:HueAdjustmentOrange="${params.HueAdjustmentOrange ?? 0}"
    crs:HueAdjustmentYellow="${params.HueAdjustmentYellow ?? 0}"
    crs:HueAdjustmentGreen="${params.HueAdjustmentGreen ?? 0}"
    crs:HueAdjustmentAqua="${params.HueAdjustmentAqua ?? 0}"
    crs:HueAdjustmentBlue="${params.HueAdjustmentBlue ?? 0}"
    crs:HueAdjustmentPurple="${params.HueAdjustmentPurple ?? 0}"
    crs:HueAdjustmentMagenta="${params.HueAdjustmentMagenta ?? 0}"
    crs:SaturationAdjustmentRed="${params.SaturationAdjustmentRed ?? 0}"
    crs:SaturationAdjustmentOrange="${params.SaturationAdjustmentOrange ?? 0}"
    crs:SaturationAdjustmentYellow="${params.SaturationAdjustmentYellow ?? 0}"
    crs:SaturationAdjustmentGreen="${params.SaturationAdjustmentGreen ?? 0}"
    crs:SaturationAdjustmentAqua="${params.SaturationAdjustmentAqua ?? 0}"
    crs:SaturationAdjustmentBlue="${params.SaturationAdjustmentBlue ?? 0}"
    crs:SaturationAdjustmentPurple="${params.SaturationAdjustmentPurple ?? 0}"
    crs:SaturationAdjustmentMagenta="${params.SaturationAdjustmentMagenta ?? 0}"
    crs:LuminanceAdjustmentRed="${params.LuminanceAdjustmentRed ?? 0}"
    crs:LuminanceAdjustmentOrange="${params.LuminanceAdjustmentOrange ?? 0}"
    crs:LuminanceAdjustmentYellow="${params.LuminanceAdjustmentYellow ?? 0}"
    crs:LuminanceAdjustmentGreen="${params.LuminanceAdjustmentGreen ?? 0}"
    crs:LuminanceAdjustmentAqua="${params.LuminanceAdjustmentAqua ?? 0}"
    crs:LuminanceAdjustmentBlue="${params.LuminanceAdjustmentBlue ?? 0}"
    crs:LuminanceAdjustmentPurple="${params.LuminanceAdjustmentPurple ?? 0}"
    crs:LuminanceAdjustmentMagenta="${params.LuminanceAdjustmentMagenta ?? 0}"
    crs:PostCropVignetteAmount="${params.PostCropVignetteAmount ?? 0}"
    crs:PostCropVignetteMidpoint="${params.PostCropVignetteMidpoint ?? 50}"
    crs:PostCropVignetteFeather="${params.PostCropVignetteFeather ?? 50}"
    crs:PostCropVignetteRoundness="${params.PostCropVignetteRoundness ?? 0}"
    crs:GrainAmount="${params.GrainAmount ?? 0}"
    crs:GrainSize="${params.GrainSize ?? 25}"
    crs:GrainFrequency="${params.GrainFrequency ?? 50}"
    crs:SplitToningHighlightHue="${params.SplitToningHighlightHue ?? 0}"
    crs:SplitToningHighlightSaturation="${params.SplitToningHighlightSaturation ?? 0}"
    crs:SplitToningBalance="${params.SplitToningBalance ?? 0}"
    crs:SplitToningShadowHue="${params.SplitToningShadowHue ?? 0}"
    crs:SplitToningShadowSaturation="${params.SplitToningShadowSaturation ?? 0}"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

  return xmpTemplate
}

export function downloadXMP(content: string, fileName: string) {
  const blob = new Blob([content], { type: "application/rdf+xml" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName.replace(/\.[^.]+$/, "") + ".xmp"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
