import { artifactTypes } from "@hypit/hypit/artifact";
import { generationPort, sealGenerationMediaBinding, sealGenerationRequestDraft } from "@hypit/hypit/generation";
import type { GenerationMediaPort, GenerationMediaRole, GenerationPortValue } from "@hypit/hypit/generation";
import { createExactModelPrimaryGenerationFragment, exactModelMediaInputNames, exactModelTextInputName } from "@hypit/hypit/model-kit";
import type { ExactModelMediaInput } from "@hypit/hypit/model-kit";
import type { CanonicalValue, StructuredElement, StructuredSurfaceHandler, SurfaceResolvedReference, TypeRef } from "@hypit/hypit/author-kit";
import { textTypes, verifyText } from "@hypit/hypit/text";
import { h3RetakeEndpoints, h3RetakeModes } from "./index.js";

type Media = { readonly port: "source"; readonly role: GenerationMediaRole; readonly source: SurfaceResolvedReference };
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
function numberAttribute(element: StructuredElement, name: string): number { const value = Number(text(element, name)); assert(Number.isFinite(value), `${element.name}.${name} must be a number`); return value; }
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

export const decodeH3RetakeSurface: StructuredSurfaceHandler = ({ element, resolveReference }) => {
  exact(element, ["id", "source", "prompt", "start", "end", "mode"], ["id", "source", "prompt", "start", "end"]);
  assert(!element.children.some((item) => item.kind === "element" || item.value.trim()), `${element.name} must be empty`);
  const prompt = ref(element, "prompt", textTypes.text, resolveReference);
  if (prompt.record !== undefined) { assert(prompt.record.value.kind === "inline", `${element.name}.prompt must reference Text`); verifyText(prompt.record.value.value); }
  const source = mediaRef(element, "source", "video", resolveReference);
  const ports: Record<string, readonly GenerationPortValue[]> = {
    startSeconds: [numberAttribute(element, "start")],
    endSeconds: [numberAttribute(element, "end")],
  };
  const mode = optionalText(element, "mode");
  if (mode !== undefined) {
    assert((h3RetakeModes as readonly string[]).includes(mode), `${element.name}.mode must be one of ${h3RetakeModes.join(", ")}`);
    ports.mode = [mode];
  }

  const id = text(element, "id"); const endpoint = h3RetakeEndpoints.retake!;
  const draft = sealGenerationRequestDraft(endpoint.ports, ports);
  const records: Array<{ id: string; type: TypeRef; value: { kind: "inline"; value: CanonicalValue }; range: StructuredElement["range"] }> = [{ id: `${id}.draft`, type: endpoint.draftType, value: { kind: "inline", value: draft as unknown as CanonicalValue }, range: element.range }];
  const inputs: Record<string, SurfaceResolvedReference["ref"] | { kind: "record"; id: string }> = { draft: { kind: "record", id: `${id}.draft` }, [exactModelTextInputName("prompt")]: prompt.ref };
  const media: Media[] = [{ port: "source", role: "video", source }];
  const mediaInputs = media.map((item, index): ExactModelMediaInput => {
    const name = `media-${String(index + 1).padStart(4, "0")}`; const binding = endpoint.mediaBindings[item.port]!; const port = generationPort(endpoint.ports, item.port);
    assert(port.value.kind === "media", `${item.port} is not media`); const bindingId = `${id}.${name}.binding`;
    records.push({ id: bindingId, type: binding.type, value: { kind: "inline", value: sealGenerationMediaBinding(port as GenerationMediaPort, { role: item.role }) as unknown as CanonicalValue }, range: element.range });
    const names = exactModelMediaInputNames(name); inputs[names.binding] = { kind: "record", id: bindingId }; inputs[names.artifact] = item.source.ref;
    return { name, port: item.port };
  });
  const fragment = createExactModelPrimaryGenerationFragment(endpoint, mediaInputs, [{ name: "prompt", port: "prompt" }]);
  return { records, fragments: [fragment], components: [{ id, fragment: fragment.id, inputs, outputs: { video: `${id}.video` }, range: element.range }] };
};
