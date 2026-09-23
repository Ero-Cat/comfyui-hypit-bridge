import { artifactTypes } from "@hypit/hypit/artifact";
import { generationPort, sealGenerationMediaBinding, sealGenerationRequestDraft } from "@hypit/hypit/generation";
import type { GenerationMediaPort, GenerationMediaRole, GenerationPortValue } from "@hypit/hypit/generation";
import { createExactModelPrimaryGenerationFragment, exactModelMediaInputNames, exactModelTextInputName } from "@hypit/hypit/model-kit";
import type { ExactModelMediaInput } from "@hypit/hypit/model-kit";
import type { CanonicalValue, StructuredElement, StructuredSurfaceHandler, SurfaceResolvedReference, TypeRef } from "@hypit/hypit/author-kit";
import { textTypes, verifyText } from "@hypit/hypit/text";
import { h3ChainEndpoints } from "./index.js";

type Media = { readonly port: "referenceImage" | "referenceAudio" | "firstFrame"; readonly role: GenerationMediaRole; readonly source: SurfaceResolvedReference };
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function sameType(a: TypeRef, b: TypeRef): boolean { return a.name === b.name && a.module.name === b.module.name && a.module.version === b.module.version; }
function exact(element: StructuredElement, allowed: readonly string[], required: readonly string[]): void {
  const unknown = Object.keys(element.attributes).filter((name) => !allowed.includes(name)); assert(unknown.length === 0, `${element.name} does not accept ${unknown[0]}`);
  const missing = required.filter((name) => element.attributes[name] === undefined); assert(missing.length === 0, `${element.name} requires ${missing.join(", ")}`);
}
function text(element: StructuredElement, name: string): string {
  const value = element.attributes[name]; assert(typeof value === "string" && value.trim().length > 0, `${element.name}.${name} must be text`); return value.trim();
}
function optionalText(element: StructuredElement, name: string): string | undefined { return element.attributes[name] === undefined ? undefined : text(element, name); }
function integer(element: StructuredElement, name: string): number { const value = Number(text(element, name)); assert(Number.isSafeInteger(value), `${element.name}.${name} must be an integer`); return value; }
function ref(element: StructuredElement, name: string, type: TypeRef, resolve: (path: string) => SurfaceResolvedReference | undefined): SurfaceResolvedReference {
  const value: unknown = element.attributes[name];
  assert(value !== null && typeof value === "object" && !Array.isArray(value) && (value as { kind?: unknown }).kind === "reference", `${element.name}.${name} must be a reference`);
  const path = (value as { path?: unknown }).path;
  assert(typeof path === "string", `${element.name}.${name} must be a reference`);
  const result = resolve(path); assert(result !== undefined && sameType(result.type, type), `${element.name}.${name} has the wrong type`); return result;
}
function mediaRef(element: StructuredElement, name: string, role: GenerationMediaRole, resolve: (path: string) => SurfaceResolvedReference | undefined): SurfaceResolvedReference {
  const result = ref(element, name, artifactTypes.blob, resolve);
  if (result.record !== undefined) assert(result.record.value.kind === "blob" && result.record.value.mediaType.startsWith(`${role}/`), `${element.name}.${name} must be ${role} media`);
  return result;
}
function empty(element: StructuredElement): void { assert(!element.children.some((item) => item.kind === "element" || item.value.trim()), `${element.name} must be empty`); }

function output(element: StructuredElement, prompt: SurfaceResolvedReference, ports: Readonly<Record<string, readonly GenerationPortValue[]>>, media: readonly Media[]) {
  const id = text(element, "id"); const endpoint = h3ChainEndpoints.take!;
  const draft = sealGenerationRequestDraft(endpoint.ports, ports);
  const records: Array<{ id: string; type: TypeRef; value: { kind: "inline"; value: CanonicalValue }; range: StructuredElement["range"] }> = [{ id: `${id}.draft`, type: endpoint.draftType, value: { kind: "inline", value: draft as unknown as CanonicalValue }, range: element.range }];
  const inputs: Record<string, SurfaceResolvedReference["ref"] | { kind: "record"; id: string }> = { draft: { kind: "record", id: `${id}.draft` }, [exactModelTextInputName("prompt")]: prompt.ref };
  const mediaInputs = media.map((item, index): ExactModelMediaInput => {
    const name = `media-${String(index + 1).padStart(4, "0")}`; const binding = endpoint.mediaBindings[item.port]!; const port = generationPort(endpoint.ports, item.port);
    assert(port.value.kind === "media", `${item.port} is not media`); const bindingId = `${id}.${name}.binding`;
    records.push({ id: bindingId, type: binding.type, value: { kind: "inline", value: sealGenerationMediaBinding(port as GenerationMediaPort, { role: item.role }) as unknown as CanonicalValue }, range: element.range });
    const names = exactModelMediaInputNames(name); inputs[names.binding] = { kind: "record", id: bindingId }; inputs[names.artifact] = item.source.ref;
    return { name, port: item.port };
  });
  const fragment = createExactModelPrimaryGenerationFragment(endpoint, mediaInputs, [{ name: "prompt", port: "prompt" }]);
  return { records, fragments: [fragment], components: [{ id, fragment: fragment.id, inputs, outputs: { video: `${id}.video` }, range: element.range }] };
}
function common(element: StructuredElement, resolveReference: (path: string) => SurfaceResolvedReference | undefined) {
  const prompt = ref(element, "prompt", textTypes.text, resolveReference);
  if (prompt.record !== undefined) { assert(prompt.record.value.kind === "inline", `${element.name}.prompt must reference Text`); verifyText(prompt.record.value.value); }
  const ports: Record<string, readonly GenerationPortValue[]> = {};
  const resolution = optionalText(element, "resolution"); if (resolution !== undefined) ports.resolution = [resolution];
  const aspect = optionalText(element, "aspect-ratio"); if (aspect !== undefined) ports.aspectRatio = [aspect];
  return { prompt, ports };
}

export const decodeH3ChainTakeVideoSurface: StructuredSurfaceHandler = ({ element, resolveReference }) => {
  exact(element, ["id", "prompt", "duration", "resolution", "aspect-ratio", "first-frame"], ["id", "prompt"]);
  const { prompt, ports } = common(element, resolveReference);
  if (element.attributes.duration !== undefined) ports.duration = [integer(element, "duration")];
  const media: Media[] = [];
  if (element.attributes["first-frame"] !== undefined) {
    media.push({ port: "firstFrame", role: "image", source: mediaRef(element, "first-frame", "image", resolveReference) });
  }
  const mapping = { image: ["referenceImage", "image"], audio: ["referenceAudio", "audio"] } as const;
  for (const child of element.children) {
    if (child.kind === "text") { assert(child.value.trim().length === 0, `${element.name} accepts only Reference children`); continue; }
    assert(child.name.endsWith("Reference"), `${element.name} accepts only Reference children`);
    const used = Object.keys(mapping).filter((name) => child.attributes[name] !== undefined) as (keyof typeof mapping)[];
    assert(used.length === 1, `${child.name} requires exactly one of image or audio`); exact(child, [used[0]!], [used[0]!]); empty(child);
    const role = used[0]!; const [port] = mapping[role];
    media.push({ port, role, source: mediaRef(child, role, role, resolveReference) });
  }
  for (const port of ["referenceImage", "referenceAudio"] as const) {
    assert(media.filter((item) => item.port === port).length <= generationPort(h3ChainEndpoints.take!.ports, port).maxItems, `${element.name} has too many ${port} references`);
  }
  return output(element, prompt, ports, media);
};
