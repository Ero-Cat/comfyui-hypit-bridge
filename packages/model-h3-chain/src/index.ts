import { artifactTypes } from "@hypit/hypit/artifact";
import { sealGenerationPortRequest, sealGenerationPortTable } from "@hypit/hypit/generation";
import type { GenerationPortTable, GenerationPortValue, GenerationRequest } from "@hypit/hypit/generation";
import { defineExactModelModule } from "@hypit/hypit/model-kit";
import { textTypes } from "@hypit/hypit/text";
import type { TypeRef } from "@hypit/hypit/author-kit";

export const h3ChainModuleRef = { name: "@local/h3-chain", version: "1" } as const;

/**
 * The long-take contract for MiniMax H3 on ComfyUI: one continuous video of 16-90 seconds from a
 * per-window script, beyond the 15-second ceiling of one native H3 generation. What H3 accepts
 * per window is a property of the trained model; how windows are joined belongs to the Provider
 * (overlap-blended infinite take, or the seamless chain with per-window references).
 */
export const h3ChainPorts: GenerationPortTable = sealGenerationPortTable({
  model: "h3-chain-take",
  result: "video",
  ports: [
    // One prompt per window; a whole chain script runs long, so the ceiling is generous.
    { name: "prompt", value: { kind: "text", maxChars: 60_000 }, minItems: 1, maxItems: 1 },
    // Optional: omitted, the Provider derives the take length from the script (words per window)
    // and the references' own framing.
    { name: "duration", value: { kind: "number", integer: true, minimum: 16, maximum: 90 }, minItems: 0, maxItems: 1 },
    { name: "resolution", value: { kind: "enum", values: ["768P", "2K"] }, minItems: 0, maxItems: 1 },
    {
      name: "aspectRatio",
      value: { kind: "enum", values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
      minItems: 0,
      maxItems: 1,
    },
    { name: "referenceImage", value: { kind: "media", accepts: ["image"] }, minItems: 0, maxItems: 9 },
    { name: "referenceAudio", value: { kind: "media", accepts: ["audio"] }, minItems: 0, maxItems: 3 },
    { name: "firstFrame", value: { kind: "media", accepts: ["image"] }, minItems: 0, maxItems: 1 },
  ],
  requires: [],
});

export function sealH3ChainRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealGenerationPortRequest(h3ChainPorts, ports);
}

const h3ChainBaseDefinition = defineExactModelModule({
  module: h3ChainModuleRef,
  endpoints: [{
    key: "take",
    requestTypeName: "H3ChainTakeRequest",
    producerName: "request-h3-chain-take",
    ports: h3ChainPorts,
  }],
});

export const h3ChainEndpoints = h3ChainBaseDefinition.endpoints;
export const h3ChainComponent = h3ChainBaseDefinition.component;
const endpoint = h3ChainEndpoints.take!;

const h3ChainDurationNote = "`duration` is a whole number of seconds between 16 and 90 — one native H3 window renders at most ~15, so a take is several joined windows.";

const takeVideoDeclaration = {
  name: "take-video",
  tag: "TakeVideo",
  mode: "structured" as const,
  outputs: [
    endpoint.draftType,
    ...(["referenceImage", "referenceAudio", "firstFrame"] as const)
      .map((port) => endpoint.mediaBindings[port]!.type),
  ] as readonly TypeRef[],
  vocabulary: {
    summary: "Generates one long continuous video Artifact (16-90 s) from a per-window script with the MiniMax H3 chain engines.",
    attributes: [
      { name: "id", kind: "identifier" as const, required: true,
        summary: "Names this generation so its video Artifact can be referenced elsewhere in the Source." },
      { name: "prompt", kind: "reference" as const, required: true, accepts: [textTypes.text],
        summary: "Selects the chain script Text: one prompt per window, separated by a --- line (JSON {\"prompts\": [...]} also accepted)." },
      { name: "duration", kind: "literal" as const, required: false,
        summary: "Sets the target length of the whole take in whole seconds; omitted, it is derived from the script's window count and word density." },
      { name: "resolution", kind: "literal" as const, required: false, values: ["768P", "2K"],
        summary: "Chooses which of the model's two output tiers renders the take." },
      { name: "aspect-ratio", kind: "literal" as const, required: false, values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        summary: "Sets the Frame shape of the take." },
      { name: "first-frame", kind: "reference" as const, required: false, accepts: [artifactTypes.blob],
        summary: "Selects the image Artifact the take opens on; it also anchors identity through the seamless-chain engine." },
    ],
    children: [
      { tag: "Reference", cardinality: "many" as const,
        summary: "Attaches one subject Artifact the whole take carries, chosen by an `image` or `audio` reference.",
        attributes: [
          { name: "image", kind: "reference" as const, required: false, accepts: [artifactTypes.blob],
            summary: "Selects the image Artifact whose subject every window of the take carries." },
          { name: "audio", kind: "reference" as const, required: false, accepts: [artifactTypes.blob],
            summary: "Selects the audio Artifact the take carries as a voice anchor." },
        ] },
    ],
    ports: [
      { name: "video", type: artifactTypes.blob, summary: "The generated long-take video Artifact." },
    ],
    example: [
      '<h3c:TakeVideo id="opening" prompt={script} duration="44" resolution="768P" aspect-ratio="16:9">',
      "  <h3c:Reference image={hero.image}/>",
      "</h3c:TakeVideo>",
    ].join("\n"),
    notes: [
      h3ChainDurationNote,
      "`768P` and `2K` are the model's own tiers: H3-Base renders at 768p and H3-Regenerate-2K re-renders from the original context.",
      "The script carries one prompt per window; write each window to end on a settled beat so no word or motion straddles a window boundary.",
      "Without references the take renders on the overlap-blended infinite-take engine; `Reference` children or `first-frame` select the seamless-chain engine, which carries them into every window.",
      "`Reference` carries exactly one of `image` or `audio`, and is empty; at most 9 image and 3 audio references.",
      "The element carries no text content.",
    ],
  },
};

export const h3ChainTakeVideoDeclaration = takeVideoDeclaration;

export const h3ChainManifest = {
  ...h3ChainBaseDefinition.manifest,
};
export const h3ChainDefinition = {
  ...h3ChainBaseDefinition, manifest: h3ChainManifest,
};
