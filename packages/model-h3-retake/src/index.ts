import { artifactTypes } from "@hypit/hypit/artifact";
import { sealGenerationPortRequest, sealGenerationPortTable } from "@hypit/hypit/generation";
import type { GenerationPortTable, GenerationPortValue, GenerationRequest } from "@hypit/hypit/generation";
import { defineExactModelModule } from "@hypit/hypit/model-kit";
import { textTypes } from "@hypit/hypit/text";
import type { TypeRef } from "@hypit/hypit/author-kit";

export const h3RetakeModuleRef = { name: "@local/h3-retake", version: "1" } as const;

/**
 * The rewrite contract for an existing MiniMax H3 video: re-render one time window of a finished
 * clip under a new prompt, with the material on either side of the window frozen. The model sees
 * only the window text plus the frozen context; everything outside the window is delivered
 * untouched, and the audio stream can be kept, redone, or redone alone.
 */
export const h3RetakeModes = ["video+audio", "video", "audio"] as const;
export type H3RetakeMode = (typeof h3RetakeModes)[number];

export const h3RetakePorts: GenerationPortTable = sealGenerationPortTable({
  model: "h3-retake",
  result: "video",
  ports: [
    { name: "source", value: { kind: "media", accepts: ["video"] }, minItems: 1, maxItems: 1 },
    { name: "prompt", value: { kind: "text", maxChars: 7_000 }, minItems: 1, maxItems: 1 },
    { name: "startSeconds", value: { kind: "number", minimum: 0, maximum: 600 }, minItems: 1, maxItems: 1 },
    { name: "endSeconds", value: { kind: "number", minimum: 0, maximum: 600 }, minItems: 1, maxItems: 1 },
    { name: "mode", value: { kind: "enum", values: [...h3RetakeModes] }, minItems: 0, maxItems: 1 },
  ],
  requires: [],
});

export function sealH3RetakeRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealGenerationPortRequest(h3RetakePorts, ports);
}

const h3RetakeBaseDefinition = defineExactModelModule({
  module: h3RetakeModuleRef,
  endpoints: [{
    key: "retake",
    requestTypeName: "H3RetakeRequest",
    producerName: "request-h3-retake",
    ports: h3RetakePorts,
  }],
});

export const h3RetakeEndpoints = h3RetakeBaseDefinition.endpoints;
export const h3RetakeComponent = h3RetakeBaseDefinition.component;
const endpoint = h3RetakeEndpoints.retake!;

const retakeDeclaration = {
  name: "retake",
  tag: "Retake",
  mode: "structured" as const,
  outputs: [endpoint.draftType, ...(["source"] as const).map((port) => endpoint.mediaBindings[port]!.type)] as readonly TypeRef[],
  vocabulary: {
    summary: "Re-renders one time window of an existing video under a new prompt with the material either side frozen (MiniMax H3 retake).",
    attributes: [
      { name: "id", kind: "identifier" as const, required: true,
        summary: "Names this rewrite so its video Artifact can be referenced elsewhere in the Source." },
      { name: "source", kind: "reference" as const, required: true, accepts: [artifactTypes.blob],
        summary: "Selects the video Artifact whose window is re-rendered." },
      { name: "prompt", kind: "reference" as const, required: true, accepts: [textTypes.text],
        summary: "Selects the Text describing what happens in the window; the model sees only this text plus the frozen material either side." },
      { name: "start", kind: "literal" as const, required: true,
        summary: "Sets where the retake window begins, in seconds (snapped to H3's latent grid)." },
      { name: "end", kind: "literal" as const, required: true,
        summary: "Sets where the retake window ends, in seconds; keep the window within ~15 s." },
      { name: "mode", kind: "literal" as const, required: false, values: [...h3RetakeModes],
        summary: "Chooses what is redone: video+audio (redo the moment), video (keep the audio performance), or audio (keep the picture, redo the sound)." },
    ],
    ports: [
      { name: "video", type: artifactTypes.blob, summary: "The rewritten video Artifact." },
    ],
    example: '<h3r:Retake id="fix" source={take.video} prompt={fixPrompt} start="30" end="38"/>',
    notes: [
      "Everything outside the window is delivered untouched; the model re-renders only the window.",
      "`mode` defaults to video+audio; `audio` keeps the picture and re-renders the sound alone, `video` keeps the audio performance and re-renders the picture.",
      "`end` minus `start` stays within one native window (~15 s); split longer rewrites into several retakes.",
      "The source should be an H3-rendered video (24 fps, native audio) for the cleanest joins.",
      "The element takes no children and no text content.",
    ],
  },
};

export const h3RetakeDeclaration = retakeDeclaration;

export const h3RetakeManifest = { ...h3RetakeBaseDefinition.manifest };
export const h3RetakeDefinition = { ...h3RetakeBaseDefinition, manifest: h3RetakeManifest };
