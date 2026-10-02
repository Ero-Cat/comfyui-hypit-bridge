import { artifactTypes } from "@hypit/hypit/artifact";
import { sealGenerationPortRequest, sealGenerationPortTable } from "@hypit/hypit/generation";
import type { GenerationPortTable, GenerationPortValue, GenerationRequest } from "@hypit/hypit/generation";
import { defineExactModelModule } from "@hypit/hypit/model-kit";
import { textTypes } from "@hypit/hypit/text";
import type { TypeRef } from "@hypit/hypit/author-kit";

export const ltxVideoModuleRef = { name: "@local/ltx-video", version: "1" } as const;

/**
 * The single-shot contract for LTX-2.5 on ComfyUI: one joint audio-video generation of 4-10
 * seconds from a text prompt, optionally first-frame guided. LTX-2.5 renders picture and
 * synchronized sound in one pass (stage 1 distilled at half resolution, spatial x2 latent
 * upscale, refine pass), so the prompt describes the sound as deliberately as the picture.
 */
export const ltxVideoPorts: GenerationPortTable = sealGenerationPortTable({
  model: "ltx-video",
  result: "video",
  ports: [
    { name: "prompt", value: { kind: "text", maxChars: 60_000 }, minItems: 1, maxItems: 1 },
    // One native LTX-2.5 generation; the 8k+1 frame grid snaps 4→97, 5→121 … 10→241 frames @ 24 fps.
    { name: "duration", value: { kind: "number", integer: true, minimum: 4, maximum: 10 }, minItems: 0, maxItems: 1 },
    { name: "resolution", value: { kind: "enum", values: ["768P"] }, minItems: 0, maxItems: 1 },
    { name: "aspectRatio", value: { kind: "enum", values: ["16:9", "9:16"] }, minItems: 0, maxItems: 1 },
    { name: "firstFrame", value: { kind: "media", accepts: ["image"] }, minItems: 0, maxItems: 1 },
  ],
  requires: [],
});

export function sealLtxVideoRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealGenerationPortRequest(ltxVideoPorts, ports);
}

const ltxVideoBaseDefinition = defineExactModelModule({
  module: ltxVideoModuleRef,
  endpoints: [{
    key: "take",
    requestTypeName: "LtxVideoTakeRequest",
    producerName: "request-ltx-video-take",
    ports: ltxVideoPorts,
  }],
});

export const ltxVideoEndpoints = ltxVideoBaseDefinition.endpoints;
export const ltxVideoComponent = ltxVideoBaseDefinition.component;
const endpoint = ltxVideoEndpoints.take!;

const ltxDurationNote = "`duration` is a whole number of seconds between 4 and 10 — LTX-2.5 samples one 8k+1 frame grid point at 24 fps (97, 121, … 241 frames), and the request snaps up to the next one.";

const genVideoDeclaration = {
  name: "gen-video",
  tag: "GenVideo",
  mode: "structured" as const,
  outputs: [
    endpoint.draftType,
    ...(["firstFrame"] as const).map((port) => endpoint.mediaBindings[port]!.type),
  ] as readonly TypeRef[],
  vocabulary: {
    summary: "Generates one joint audio-video Artifact (4-10 s) from a prompt with LTX-2.5 — synchronized sound is generated in the same pass, so describe it too.",
    attributes: [
      { name: "id", kind: "identifier" as const, required: true,
        summary: "Names this generation so its video Artifact can be referenced elsewhere in the Source." },
      { name: "prompt", kind: "reference" as const, required: true, accepts: [textTypes.text],
        summary: "Selects the prompt Text: a flowing description of shot, subject, action, camera — and the sound (ambience, effects, spoken lines), which LTX-2.5 generates in sync." },
      { name: "duration", kind: "literal" as const, required: false,
        summary: "Sets the clip length in whole seconds (4-10); omitted, 5 seconds." },
      { name: "resolution", kind: "literal" as const, required: false, values: ["768P"],
        summary: "Chooses the output tier; 768P renders a 1280-wide (or 1280-tall) frame." },
      { name: "aspect-ratio", kind: "literal" as const, required: false, values: ["16:9", "9:16"],
        summary: "Sets the frame shape; 16:9 lands at 1280×768, 9:16 at 768×1280 (LTX dimensions sit on the 64-pixel grid its half-res stage-1 pass needs)." },
      { name: "first-frame", kind: "reference" as const, required: false, accepts: [artifactTypes.blob],
        summary: "Selects the image Artifact the clip opens on; the generation holds it through both passes and inherits its orientation." },
    ],
    children: [],
    ports: [
      { name: "video", type: artifactTypes.blob, summary: "The generated video Artifact with its synced audio track." },
    ],
    example: [
      '<ltx:GenVideo id="product" prompt={copy} duration="5" resolution="768P" aspect-ratio="9:16"/>',
    ].join("\n"),
    notes: [
      ltxDurationNote,
      "Write the sound into the prompt (ambience, product noise, spoken lines with their delivery) — an undescribed soundtrack is invented, not muted.",
      "With `first-frame` the prompt describes what happens next, not what the image already shows; the aspect follows the image when unspoken.",
      "The element carries no text content and accepts no children.",
    ],
  },
};

export const ltxGenVideoDeclaration = genVideoDeclaration;

export const ltxVideoManifest = {
  ...ltxVideoBaseDefinition.manifest,
};
export const ltxVideoDefinition = {
  ...ltxVideoBaseDefinition, manifest: ltxVideoManifest,
};
