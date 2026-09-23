import { artifactTypes } from "@hypit/hypit/artifact";
import { sealGenerationPortRequest, sealGenerationPortTable } from "@hypit/hypit/generation";
import type { GenerationPortTable, GenerationPortValue, GenerationRequest } from "@hypit/hypit/generation";
import { defineExactModelModule } from "@hypit/hypit/model-kit";
import { textTypes } from "@hypit/hypit/text";
import type { TypeRef } from "@hypit/hypit/author-kit";

export const h3ControlModuleRef = { name: "@local/h3-control", version: "1" } as const;

/**
 * The motion-following contract for MiniMax H3: one new video whose structure follows a control
 * video while appearance follows the prompt. The deployment extracts the control signal from a raw
 * video (pose skeleton via DWPose, depth via DepthAnything) or takes a pre-extracted signal video
 * as-is; generation runs on ref2va weights with the official Fun ControlNet Union patch at full
 * strength.
 */
export const h3ControlTypes = ["pose", "depth", "raw"] as const;
export type H3ControlType = (typeof h3ControlTypes)[number];

export const h3ControlPorts: GenerationPortTable = sealGenerationPortTable({
  model: "h3-control",
  result: "video",
  ports: [
    { name: "prompt", value: { kind: "text", maxChars: 7_000 }, minItems: 1, maxItems: 1 },
    // Optional: omitted, the Provider matches the control video's own length (capped to one window).
    { name: "duration", value: { kind: "number", integer: true, minimum: 6, maximum: 15 }, minItems: 0, maxItems: 1 },
    { name: "resolution", value: { kind: "enum", values: ["768P", "2K"] }, minItems: 0, maxItems: 1 },
    { name: "aspectRatio", value: { kind: "enum", values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] }, minItems: 0, maxItems: 1 },
    { name: "controlVideo", value: { kind: "media", accepts: ["video"] }, minItems: 1, maxItems: 1 },
    { name: "controlType", value: { kind: "enum", values: [...h3ControlTypes] }, minItems: 0, maxItems: 1 },
  ],
  requires: [],
});

export function sealH3ControlRequest(
  ports: Readonly<Record<string, readonly GenerationPortValue[]>>,
): GenerationRequest {
  return sealGenerationPortRequest(h3ControlPorts, ports);
}

const h3ControlBaseDefinition = defineExactModelModule({
  module: h3ControlModuleRef,
  endpoints: [{
    key: "control",
    requestTypeName: "H3ControlRequest",
    producerName: "request-h3-control",
    ports: h3ControlPorts,
  }],
});

export const h3ControlEndpoints = h3ControlBaseDefinition.endpoints;
export const h3ControlComponent = h3ControlBaseDefinition.component;
const endpoint = h3ControlEndpoints.control!;

const controlDeclaration = {
  name: "control-video",
  tag: "ControlVideo",
  mode: "structured" as const,
  outputs: [endpoint.draftType, ...(["controlVideo"] as const).map((port) => endpoint.mediaBindings[port]!.type)] as readonly TypeRef[],
  vocabulary: {
    summary: "Generates one video whose motion and structure follow a control video, with appearance from the prompt (MiniMax H3 Fun ControlNet Union).",
    attributes: [
      { name: "id", kind: "identifier" as const, required: true,
        summary: "Names this generation so its video Artifact can be referenced elsewhere in the Source." },
      { name: "prompt", kind: "reference" as const, required: true, accepts: [textTypes.text],
        summary: "Selects the Text describing what the followed motion looks like: subject, appearance, scene and camera." },
      { name: "control", kind: "reference" as const, required: true, accepts: [artifactTypes.blob],
        summary: "Selects the video Artifact whose motion is followed." },
      { name: "control-type", kind: "literal" as const, required: false, values: [...h3ControlTypes],
        summary: "Chooses how the control signal is read: pose (DWPose skeleton), depth (DepthAnything) or raw (a pre-extracted signal video, passed through unchanged). Default pose." },
      { name: "duration", kind: "literal" as const, required: false,
        summary: "Sets the length of the generated video in whole seconds; omitted, it matches the control video's own length within one window." },
      { name: "resolution", kind: "literal" as const, required: false, values: ["768P", "2K"],
        summary: "Chooses which of the model's two output tiers renders the video." },
      { name: "aspect-ratio", kind: "literal" as const, required: false, values: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        summary: "Sets the Frame shape of the generated video." },
    ],
    ports: [
      { name: "video", type: artifactTypes.blob, summary: "The generated motion-following video Artifact." },
    ],
    example: '<h3ctl:ControlVideo id="dance" prompt={dancePrompt} control={refClip.video} control-type="pose" duration="8" resolution="768P" aspect-ratio="16:9"/>',
    notes: [
      "`duration` is a whole number of seconds between 6 and 15 — one native H3 window.",
      "The control video's motion is followed at full strength; appearance, subject and scene come from the prompt.",
      "`pose` extracts a DWPose skeleton from the control video, `depth` a depth map; `raw` expects an already-extracted signal video (skeleton/depth/lineart) and passes it through unchanged.",
      "Generation runs on the ref2va checkpoint with the Fun ControlNet Union patch; identity references are not carried in this mode yet.",
      "The element takes no children and no text content.",
    ],
  },
};

export const h3ControlDeclaration = controlDeclaration;

export const h3ControlManifest = { ...h3ControlBaseDefinition.manifest };
export const h3ControlDefinition = { ...h3ControlBaseDefinition, manifest: h3ControlManifest };
