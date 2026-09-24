import { artifactTypes } from "@hypit/hypit/artifact";
import { sealGenerationPortRequest, sealGenerationPortTable } from "@hypit/hypit/generation";
import type { GenerationPortTable, GenerationPortValue, GenerationRequest } from "@hypit/hypit/generation";
import { defineExactModelModule } from "@hypit/hypit/model-kit";
import type { TypeRef } from "@hypit/hypit/author-kit";

export const h3UpscaleModuleRef = { name: "@local/h3-upscale", version: "1" } as const;

/**
 * The HD remaster contract for a finished video: re-render the take at a higher resolution while
 * preserving its look. Two lanes — "gan" runs a per-frame upscale model (fast, no redraw, the
 * style survives untouched) and "seedvr2" runs a one-step diffusion restoration (richer detail and
 * temporal coherence, ~1 s/frame on the deployment's GPU). The soundtrack rides the source
 * untouched on both lanes.
 */
export const h3UpscaleTargets = ["1080p"] as const;
export type H3UpscaleTarget = (typeof h3UpscaleTargets)[number];

export const h3UpscaleLanes = ["gan", "seedvr2"] as const;
export type H3UpscaleLane = (typeof h3UpscaleLanes)[number];

export const h3UpscaleModels = [
  "4x-ultrasharp", "4x-ultrasharp-v2-lite", "realesrgan-x4plus", "realesrgan-x2plus", "animevideov3",
] as const;
export type H3UpscaleModel = (typeof h3UpscaleModels)[number];

export const h3UpscaleFits = ["crop", "pad", "keep"] as const;
export type H3UpscaleFit = (typeof h3UpscaleFits)[number];

export const h3UpscalePorts: GenerationPortTable = sealGenerationPortTable({
  model: "h3-upscale",
  result: "video",
  ports: [
    { name: "source", value: { kind: "media", accepts: ["video"] }, minItems: 1, maxItems: 1 },
    { name: "target", value: { kind: "enum", values: [...h3UpscaleTargets] }, minItems: 0, maxItems: 1 },
    { name: "lane", value: { kind: "enum", values: [...h3UpscaleLanes] }, minItems: 0, maxItems: 1 },
    { name: "model", value: { kind: "enum", values: [...h3UpscaleModels] }, minItems: 0, maxItems: 1 },
    { name: "fit", value: { kind: "enum", values: [...h3UpscaleFits] }, minItems: 0, maxItems: 1 },
  ],
  requires: [],
});

export function sealH3UpscaleRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealGenerationPortRequest(h3UpscalePorts, ports);
}

const h3UpscaleBaseDefinition = defineExactModelModule({
  module: h3UpscaleModuleRef,
  endpoints: [{
    key: "upscale",
    requestTypeName: "H3UpscaleRequest",
    producerName: "request-h3-upscale",
    ports: h3UpscalePorts,
  }],
});

export const h3UpscaleEndpoints = h3UpscaleBaseDefinition.endpoints;
export const h3UpscaleComponent = h3UpscaleBaseDefinition.component;
const endpoint = h3UpscaleEndpoints.upscale!;

const upscaleDeclaration = {
  name: "upscale",
  tag: "UpscaleVideo",
  mode: "structured" as const,
  outputs: [endpoint.draftType, ...(["source"] as const).map((port) => endpoint.mediaBindings[port]!.type)] as readonly TypeRef[],
  vocabulary: {
    summary: "Re-renders a finished video at 1080P with its look intact (per-frame GAN supersampling or SeedVR2 one-step restoration).",
    attributes: [
      { name: "id", kind: "identifier" as const, required: true,
        summary: "Names this remaster so its video Artifact can be referenced elsewhere in the Source." },
      { name: "source", kind: "reference" as const, required: true, accepts: [artifactTypes.blob],
        summary: "Selects the video Artifact being remastered." },
      { name: "target", kind: "literal" as const, required: false, values: [...h3UpscaleTargets],
        summary: "Sets the output resolution; 1080p (1920×1080, landscape, or 1080×1920 portrait) for now." },
      { name: "lane", kind: "literal" as const, required: false, values: [...h3UpscaleLanes],
        summary: "Chooses the engine: gan (per-frame upscale model, minutes per take, no redraw) or seedvr2 (one-step diffusion restoration, ~1 s/frame, best detail)." },
      { name: "model", kind: "literal" as const, required: false, values: [...h3UpscaleModels],
        summary: "Picks the GAN-lane upscale model (ignored on seedvr2); default 4x-ultrasharp, animevideov3 for flat anime styles." },
      { name: "fit", kind: "literal" as const, required: false, values: [...h3UpscaleFits],
        summary: "Handles the source-aspect vs target-aspect gap: crop (cover + center crop, default), pad (black bars), keep (aspect-exact off-standard frame)." },
    ],
    ports: [
      { name: "video", type: artifactTypes.blob, summary: "The upscaled video Artifact." },
    ],
    example: '<h3up:UpscaleVideo id="hd" source={take.video} lane="gan"/>',
    notes: [
      "The soundtrack is carried from the source untouched; timing and frame rate stay as rendered.",
      "`lane` defaults to gan; switch to seedvr2 for hero deliveries (budget ~1 s per frame of GPU time).",
      "The seedvr2 lane stays under ~45 s of source per call (host-RAM bound); longer takes use the gan lane or split.",
      "`fit`=\"crop\" trims ≤3% of the long-edge overflow a 1.74:1 H3 frame carries against 16:9; \"keep\" outputs 1920×1104 instead of cropping.",
      "The element takes no children and no text content.",
    ],
  },
};

export const h3UpscaleDeclaration = upscaleDeclaration;
export const h3UpscaleManifest = { ...h3UpscaleBaseDefinition.manifest };
export const h3UpscaleDefinition = { ...h3UpscaleBaseDefinition, manifest: h3UpscaleManifest };
