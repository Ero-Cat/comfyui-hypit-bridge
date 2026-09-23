import { canonicalize, defineEndpointPackage, wakeAfter } from "@hypit/hypit/endpoint-kit";
import type { AsyncEndpoint, EndpointOutcome, EndpointPollContext, EndpointRequest, EndpointStartContext, EndpointSupport } from "@hypit/hypit/endpoint-kit";
import {
  compileWireRequest, generationTypes, mappingSupportsRequest, sealGeneratedVideoSet,
} from "@hypit/hypit/generation";
import type { GenerationRequest, GenerationWireMapping } from "@hypit/hypit/generation";

export const providerModule = { name: "provider-comfyui", version: "1" } as const;

/**
 * Two capabilities against one ComfyUI deployment running ComfyUI's native MiniMax H3 nodes plus
 * the ComfyUI-H3-Multishot pack:
 *
 * - `@hypit/minimax-h3@1#minimax-h3`: the stock single-take Model (one H3 generation, 6-15 s).
 * - `@local/h3-chain@1#h3-chain-take`: the project long-take Model (16-90 s), routed to one of
 *   two chain engines by request shape.
 */
export const capability = { module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" } as const;
export const chainCapability = { module: { name: "@local/h3-chain", version: "1" }, name: "h3-chain-take" } as const;
export const retakeCapability = { module: { name: "@local/h3-retake", version: "1" }, name: "h3-retake" } as const;
export const controlCapability = { module: { name: "@local/h3-control", version: "1" }, name: "h3-control" } as const;

// Every authored port has a declared field; referenceVideo has no node input anywhere in this
// deployment, so supports() refuses it explicitly instead of letting a mapping drop it silently.
export const mapping: GenerationWireMapping = {
  capability, result: "video", routes: [{ model: "minimax-h3" }],
  fields: {
    prompt: { as: "value", field: "prompt" },
    duration: { as: "value", field: "duration" },
    resolution: { as: "value", field: "resolution" },
    aspectRatio: { as: "value", field: "aspectRatio" },
    referenceImage: { as: "urlArray", field: "referenceImages" },
    referenceVideo: { as: "urlArray", field: "referenceVideos" },
    referenceAudio: { as: "urlArray", field: "referenceAudios" },
    firstFrame: { as: "url", field: "firstFrame" },
    lastFrame: { as: "url", field: "lastFrame" },
  },
};
export const chainMapping: GenerationWireMapping = {
  capability: chainCapability, result: "video", routes: [{ model: "h3-chain-take" }],
  fields: {
    prompt: { as: "value", field: "prompt" },
    duration: { as: "value", field: "duration" },
    resolution: { as: "value", field: "resolution" },
    aspectRatio: { as: "value", field: "aspectRatio" },
    referenceImage: { as: "urlArray", field: "referenceImages" },
    referenceAudio: { as: "urlArray", field: "referenceAudios" },
    firstFrame: { as: "url", field: "firstFrame" },
  },
};

export const retakeMapping: GenerationWireMapping = {
  capability: retakeCapability, result: "video", routes: [{ model: "h3-retake" }],
  fields: {
    source: { as: "url", field: "source" },
    prompt: { as: "value", field: "prompt" },
    startSeconds: { as: "value", field: "startSeconds" },
    endSeconds: { as: "value", field: "endSeconds" },
    mode: { as: "value", field: "mode" },
  },
};
export const controlMapping: GenerationWireMapping = {
  capability: controlCapability, result: "video", routes: [{ model: "h3-control" }],
  fields: {
    prompt: { as: "value", field: "prompt" },
    duration: { as: "value", field: "duration" },
    resolution: { as: "value", field: "resolution" },
    aspectRatio: { as: "value", field: "aspectRatio" },
    controlVideo: { as: "url", field: "controlVideo" },
    controlType: { as: "value", field: "controlType" },
  },
};

/**
 * Verified defaults (ComfyUI 0.36+, RTX 5090 32 GB reference):
 * FL2VA int8-convrot weights, the fl2v turbo 8-step LoRA, SolAttn patch defaults, euler/beta.
 * Every value is overridable through the Endpoint config in the Runtime Profile.
 */
export const comfyuiDefaults = {
  unetName: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  loraName: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
  clipName: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  videoVaeName: "minimax_h3_video_vae_int8_convrot.safetensors",
  audioVaeName: "minimax_h3_audio_vae_fp32.safetensors",
  steps: 8,
  sampler: "euler",
  scheduler: "beta",
  filenamePrefix: "H3Hypit",
  crf: 20,
  useSolAttn: true,
  concurrency: 1,
  pollIntervalMs: 5_000,
  chainEngine: "auto",
  // Reference-driven regeneration (MiniMaxH3ReferenceToVideo): official quality-first recipe —
  // ref2va weights, res_multistep/simple at 20 steps, no turbo LoRA. refTurbo swaps in the ref2v
  // 4-step turbo LoRA (5× faster, v0.1 quality — compare before trusting long renders).
  refUnetName: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  refLoraName: "minimax_h3_ref2v_turbo_4step_v1.0_comfyui_bf16.safetensors",
  refTurbo: false,
  refSteps: 20,
  refSampler: "res_multistep",
  refScheduler: "simple",
  // Motion following (MiniMaxH3FunControlNetApply): the official Fun ControlNet Union patch at
  // full strength on ref2va; the control signal comes from DWPose/DepthAnything extraction of a
  // raw video, or passes through untouched when the author supplies a pre-extracted signal.
  controlPatchName: "minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors",
  // Auto-derived parameters: reference framing drives aspect and (opt-in) the 2K tier; a video
  // reference's own soundtrack rides along when no explicit audio reference is supplied.
  allowAuto2K: false,
  // Reference-carrying chains run on the ref2va checkpoint (the reference-trained weights) with
  // its shipped turbo pairing, and pin the voice: shot 1's performed audio becomes the ongoing
  // <Audio 1> anchor for every later window, which holds the timbre across window joins.
  // chainTurbo=false swaps the turbo pairing for the official 20-step quality recipe.
  chainRef2va: true,
  chainTurbo: true,
  selfAnchorVoice: true,
} as const;

const FRAME_FPS = 24;
// H3's 17k+5 frame grid at 24 fps: 124 frames ≈ 5.2 s, 362 frames ≈ 15.1 s (trained range).
const MIN_GRID_FRAMES = 124;
const MAX_GRID_FRAMES = 362;
const MIN_DURATION_SECONDS = 6;
const MAX_DURATION_SECONDS = 15;
// Pixel budget per resolution tier; 768P reproduces the deployment's verified 1280×736 recipe.
const TIER_PIXELS: Readonly<Record<string, number>> = { "768P": 1280 * 736, "2K": 2048 * 1152 };
const DEFAULT_ASPECT_RATIO = "16:9";
// The single-take sampler reads `---` lines as shot separators; a single-take request must not carry them.
const SHOT_SEPARATOR = /^\s*-{3,}\s*$/m;

// The infinite-take engine's phase-clean geometry: window 243 frames (Wb=14 blocks), overlap 34
// (Ob=2), stride Sb=12 blocks — a multiple of 3, so no end-window A/V phase warning. N windows
// make a take of 204·N+39 frames exactly, from the node's own window math.
const INFINITE_WINDOW_FRAMES = 243;
const INFINITE_OVERLAP_FRAMES = 34;
const INFINITE_MIN_WINDOWS = 2;
const INFINITE_MAX_WINDOWS = 10;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected ComfyUI response object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const inner = value as Record<string, unknown>;
    for (const key of ["text", "value", "content"]) {
      if (typeof inner[key] === "string" && (inner[key] as string).length > 0) return inner[key] as string;
    }
  }
  throw new Error("Expected nonempty ComfyUI text value");
}
function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}
function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Expected ComfyUI numeric value");
}
function stringList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Expected ComfyUI reference list");
  return value.map((item) => text(item));
}
function redactUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/giu, "[redacted-url]");
}

function address(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const loopbackOrLan = host === "localhost" || host === "::1"
    || /^127\./u.test(host) || /^10\./u.test(host) || /^192\.168\./u.test(host)
    || /^169\.254\./u.test(host) || /^172\.(1[6-9]|2\d|3[01])\./u.test(host)
    || host.endsWith(".local") || host.endsWith(".lan");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackOrLan)) {
    throw new Error("ComfyUI URLs require HTTPS, or HTTP on loopback or a private LAN address");
  }
  return url.href.replace(/\/$/u, "");
}

/** H3 frame counts live on a 17k+5 grid; snap the requested seconds up to the next grid point. */
function gridFrames(durationSeconds: number): number {
  return gridSnapUpFrames(Math.round(durationSeconds * FRAME_FPS));
}
function gridSnapUpFrames(raw: number): number {
  const x = Math.max(5, Math.ceil(raw));
  const remainder = x % 17;
  const frames = x + (remainder <= 5 ? 5 - remainder : 22 - remainder);
  return Math.min(MAX_GRID_FRAMES, Math.max(MIN_GRID_FRAMES, frames));
}
/** Snap raw frames up to the 17k+5 grid without the single-take [124, 362] clamp. */
function gridSnapUpUnclamped(raw: number): number {
  const x = Math.max(5, Math.ceil(raw));
  const remainder = x % 17;
  return x + (remainder <= 5 ? 5 - remainder : 22 - remainder);
}

/** Infinite-take window count for a requested duration: N windows = 204·N+39 frames. */
function infiniteTakeForDuration(durationSeconds: number): { windows: number; frames: number } {
  const windows = Math.round((durationSeconds * FRAME_FPS - 39) / 204);
  return { windows, frames: 204 * windows + 39 };
}
function infiniteTakeOptions(): readonly number[] {
  return Array.from({ length: INFINITE_MAX_WINDOWS - INFINITE_MIN_WINDOWS + 1 },
    (_, index) => Math.round((204 * (index + INFINITE_MIN_WINDOWS) + 39) / FRAME_FPS));
}

/** A chain script is `---`-separated window prompts, or JSON {"prompts": [...]}; returns the windows. */
function parseChainScript(script: string): string[] {
  const trimmed = script.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch (error) {
      throw new Error(`Chain script looks like JSON but does not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
    const container = Array.isArray(parsed) ? parsed
      : object(parsed).prompts ?? object(parsed).shots;
    if (!Array.isArray(container)) throw new Error('Chain script JSON must be a list or {"prompts": [...]}');
    return container.map((item, index) => {
      if (typeof item !== "string" || item.trim().length === 0) throw new Error(`Chain script window ${index + 1} is not nonempty text`);
      return item.trim();
    });
  }
  const blocks = script.split(/^\s*-{3,}\s*$/mu);
  return blocks.map((block, index) => {
    const value = block.trim();
    if (value.length === 0) throw new Error(`Chain script window ${index + 1} is empty (check the --- separators)`);
    return value;
  });
}

/** Generation dimensions at the tier's pixel budget, aspect snapped to multiples of 32. */
function dimensionsForRatio(ratio: number, resolution: string): { width: number; height: number } {
  const area = TIER_PIXELS[resolution] ?? TIER_PIXELS["768P"]!;
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const snap = (value: number): number => Math.max(320, Math.round(value / 32) * 32);
  return { width: snap(Math.sqrt(area * safe)), height: snap(Math.sqrt(area / safe)) };
}
function dimensionsFor(aspectRatio: string, resolution: string): { width: number; height: number } {
  const [aw, ah] = aspectRatio.split(":").map(Number);
  const valid = aw !== undefined && ah !== undefined && Number.isFinite(aw) && Number.isFinite(ah) && aw > 0 && ah > 0;
  return dimensionsForRatio(valid ? aw / ah! : 16 / 9, resolution);
}

/** Read pixel dimensions from PNG/GIF/JPEG/WebP headers so a frame-guided run inherits its image's aspect. */
function imageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const is = (offset: number, signature: number[]): boolean => signature.every((byte, index) => bytes[offset + index] === byte);
  if (bytes.length > 24 && is(0, [0x89, 0x50, 0x4e, 0x47])) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 10 && is(0, [0x47, 0x49, 0x46])) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length > 4 && is(0, [0xff, 0xd8])) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  if (bytes.length > 30 && is(8, [0x57, 0x45, 0x42, 0x50])) {
    const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    if (chunk === "VP8X") {
      const width = 1 + ((bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) & 0xffffff);
      const height = 1 + ((bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) & 0xffffff);
      return { width, height };
    }
    if (chunk === "VP8 ") {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const bits = (bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}

/** Read pixel dimensions and duration straight from an MP4's tkhd/mvhd boxes, so a video
 * reference can drive aspect, resolution tier and (for motion following) the take length. */
type VideoProbe = { width?: number; height?: number; seconds?: number };
function bytesIndexOf(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) { if (haystack[i + j] !== needle[j]) continue outer; }
    return i;
  }
  return -1;
}
function mp4Probe(bytes: Uint8Array): VideoProbe {
  const probe: VideoProbe = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tkhd = bytesIndexOf(bytes, [0x74, 0x6b, 0x68, 0x64]);
  if (tkhd >= 0) {
    const version = bytes[tkhd + 8] ?? 0;
    const fixedOffset = version === 0 ? 76 : 96;
    if (tkhd + 8 + fixedOffset + 8 <= bytes.length) {
      const width = view.getInt32(tkhd + 8 + fixedOffset) >>> 16;
      const height = view.getInt32(tkhd + 8 + fixedOffset + 4) >>> 16;
      if (width > 0 && width <= 8192 && height > 0 && height <= 8192) { probe.width = width; probe.height = height; }
    }
  }
  const mvhd = bytesIndexOf(bytes, [0x6d, 0x76, 0x68, 0x64]);
  if (mvhd >= 0) {
    const version = bytes[mvhd + 8] ?? 0;
    if (version === 0 && mvhd + 8 + 20 <= bytes.length) {
      const timescale = view.getUint32(mvhd + 8 + 12);
      const duration = view.getUint32(mvhd + 8 + 16);
      if (timescale > 0 && duration > 0 && duration / timescale <= 3_600) probe.seconds = duration / timescale;
    } else if (version === 1 && mvhd + 8 + 32 <= bytes.length) {
      const timescale = view.getUint32(mvhd + 8 + 20);
      const duration = view.getUint32(mvhd + 8 + 24) * 2 ** 32 + view.getUint32(mvhd + 8 + 28);
      if (timescale > 0 && duration > 0 && duration / timescale <= 3_600) probe.seconds = duration / timescale;
    }
  }
  return probe;
}

/** Resolution tier from a reference's own pixel area; 2K derivation is opt-in (unverified tier
 * on this deployment), an explicit `resolution` port always wins. */
function autoResolutionTier(width: number, height: number, allowAuto2K: boolean): string {
  return allowAuto2K && width * height >= 1_600_000 ? "2K" : "768P";
}

/** One "word" per CJK character plus one per Latin token; speech paces at roughly 0.22 s per
 * CJK character (4–5 chars/s) and 0.6 s per Latin word, and description text also drives
 * picture, so the window estimate clamps to the trained range. */
function scriptWordCount(block: string): { cjk: number; latin: number } {
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/gu;
  const cjk = (block.match(cjkPattern) ?? []).length;
  const latin = (block.replace(cjkPattern, " ").match(/[A-Za-z0-9']+/gu) ?? []).length;
  return { cjk, latin };
}
function estimateWindowSeconds(block: string): number {
  // PROMPTING.md's measured pacing: a ~10 s window carries ~15 spoken words, a ~15 s window
  // ~27 — roughly 0.6 s per Latin word; Chinese speech runs 4–5 characters per second.
  const { cjk, latin } = scriptWordCount(block);
  return Math.min(15.1, Math.max(8, cjk * 0.22 + latin * 0.6));
}

/** WAV duration from the RIFF header, to keep voice anchors at "one clean solo line" length:
 * a whole video's soundtrack as a reference rides every sampling step of every window and
 * overflows the reference path (seen as HostBuffer.read_file_slice failures mid-render). */
function wavDurationSeconds(bytes: Uint8Array): number | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 44 || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) return undefined;
  if (bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45) return undefined;
  const byteRate = view.getUint32(28);
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunk = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    if (chunk === "data") { dataBytes = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (byteRate <= 0 || dataBytes <= 0) return undefined;
  return dataBytes / byteRate;
}

const MAX_VOICE_ANCHOR_SECONDS = 12;

function extensionFor(mediaType: string): string {
  const map: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
    "audio/ogg": "ogg", "audio/flac": "flac", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  };
  return map[(mediaType.split(";")[0] ?? "").trim().toLowerCase()] ?? "bin";
}
function mediaTypeForFile(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "webm") return "video/webm";
  if (extension === "gif") return "image/gif";
  return "video/mp4";
}

type ComfyNode = { class_type: string; inputs: Record<string, unknown> };
type ComfyGraph = Record<string, ComfyNode>;

type GenerationSettings = {
  unetName: string; loraName: string; clipName: string; videoVaeName: string; audioVaeName: string;
  steps: number; sampler: string; scheduler: string; useSolAttn: boolean; filenamePrefix: string; crf: number;
  refUnetName: string; refLoraName: string; refTurbo: boolean; refSteps: number; refSampler: string; refScheduler: string;
  controlPatchName: string;
  allowAuto2K: boolean;
  chainRef2va: boolean;
  chainTurbo: boolean;
  selfAnchorVoice: boolean;
};

/** The standard fl2va model chain used by single-take, chain and retake graphs. */

function modelChainNodes(settings: GenerationSettings,
  overrides: { unetName?: string; loraName?: string; useSolAttn?: boolean } = {}): { graph: ComfyGraph; model: [string, number]; clip: [string, number]; videoVae: [string, number]; audioVae: [string, number] } {
  const unetName = overrides.unetName ?? settings.unetName;
  const loraName = overrides.loraName !== undefined ? overrides.loraName : settings.loraName;
  const useSolAttn = overrides.useSolAttn ?? settings.useSolAttn;
  const graph: ComfyGraph = {
    checkpoint: { class_type: "UNETLoader", inputs: { unet_name: unetName, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: settings.clipName, type: "minimax", device: "default" } },
    video_vae: { class_type: "VAELoader", inputs: { vae_name: settings.videoVaeName } },
    audio_vae: { class_type: "VAELoader", inputs: { vae_name: settings.audioVaeName } },
  };
  let modelSource: [string, number] = ["checkpoint", 0];
  if (loraName.length > 0) {
    graph.turbo_lora = { class_type: "LoraLoaderModelOnly", inputs: { model: modelSource, lora_name: loraName, strength_model: 1 } };
    modelSource = ["turbo_lora", 0];
  }
  if (useSolAttn) {
    graph.sol_attn = {
      class_type: "SolAttnPatch", inputs: {
        model: modelSource, tau: 1.3, start_percent: 0.2, end_percent: 0.9, min_tokens: 4096,
        int8_qk: true, sink_conditioning: "exact_kv_and_rows", morton: false, morton_curve: "2d_frame",
        int8_pv: true, verbose: false, use_tma: false, dense_blocks: "",
      },
    };
    modelSource = ["sol_attn", 0];
  }
  return { graph, model: modelSource, clip: ["clip", 0], videoVae: ["video_vae", 0], audioVae: ["audio_vae", 0] };
}

function outputNode(images: [string, number], audio: [string, number], settings: GenerationSettings): ComfyNode {
  return {
    class_type: "VHS_VideoCombine",
    inputs: {
      images, audio, frame_rate: FRAME_FPS, loop_count: 0, filename_prefix: settings.filenamePrefix,
      format: "video/h264-mp4", pix_fmt: "yuv420p", crf: settings.crf, save_metadata: true,
      trim_to_audio: false, pingpong: false, save_output: true,
    },
  };
}

/** LoadImage → ImageScale(lanczos/center) so an uploaded frame matches the generation's latent size. */
function scaledImageNode(graph: ComfyGraph, id: string, image: string, width: number, height: number): [string, number] {
  graph[`${id}_load`] = { class_type: "LoadImage", inputs: { image } };
  graph[`${id}_scale`] = {
    class_type: "ImageScale", inputs: { image: [`${id}_load`, 0], upscale_method: "lanczos", width, height, crop: "center" },
  };
  return [`${id}_scale`, 0];
}

/**
 * The seamless-chain sampler (ComfyUI-H3-Multishot core): last-frame handoff between windows,
 * reference images carried into every window, voice anchors, save-every-shot insurance. A
 * single-window call (shotCount 1) is the single-take route of the stock capability.
 */
function buildMultishotGraph(args: {
  prompt: string; width: number; height: number; frames: number; seed: number; steps: number;
  firstFrame?: string; referenceImages: readonly string[]; referenceAudios: readonly string[];
}, settings: GenerationSettings, options: { shotCount?: number; saveEveryShot?: boolean; selfAnchorVoice?: boolean;
  model?: { unetName: string; loraName: string } } = {}): ComfyGraph {
  const chain = modelChainNodes(settings, options.model !== undefined
    ? { unetName: options.model.unetName, loraName: options.model.loraName } : {});
  const graph = chain.graph;
  const samplerInputs: Record<string, unknown> = {
    model: chain.model, clip: chain.clip, video_vae: chain.videoVae, audio_vae: chain.audioVae,
    script: args.prompt, shot_count: options.shotCount ?? 1, width: args.width, height: args.height,
    frames_per_shot: args.frames, seed: args.seed, steps: args.steps, seed_per_shot: true,
    sampler_name: settings.sampler, scheduler: settings.scheduler,
    save_every_shot: options.saveEveryShot === true,
    self_anchor_voice: options.selfAnchorVoice === true,
  };
  if (args.firstFrame !== undefined) {
    samplerInputs.start_image = scaledImageNode(graph, "start_image", args.firstFrame, args.width, args.height);
  }
  if (args.referenceImages.length === 1) {
    graph.reference_image = { class_type: "LoadImage", inputs: { image: args.referenceImages[0]! } };
    samplerInputs.reference_images = ["reference_image", 0];
  } else if (args.referenceImages.length > 1) {
    let batch: [string, number] | undefined;
    args.referenceImages.forEach((image, index) => {
      graph[`reference_image_${index + 1}`] = { class_type: "LoadImage", inputs: { image } };
      if (index === 0) return;
      const inputs: Record<string, unknown> = index === 1
        ? { image1: ["reference_image_1", 0], image2: ["reference_image_2", 0] }
        : { image1: batch, image2: [`reference_image_${index + 1}`, 0] };
      graph[`reference_batch_${index}`] = { class_type: "ImageBatch", inputs };
      batch = [`reference_batch_${index}`, 0];
    });
    samplerInputs.reference_images = batch;
  }
  const voiceInputs = ["voice_ref", "voice_ref_2", "voice_ref_3"];
  args.referenceAudios.forEach((audio, index) => {
    graph[`voice_audio_${index + 1}`] = { class_type: "LoadAudio", inputs: { audio } };
    samplerInputs[voiceInputs[index]!] = [`voice_audio_${index + 1}`, 0];
  });
  graph.sampler = { class_type: "H3MultishotSampler", inputs: samplerInputs };
  graph.output = outputNode(["sampler", 0], ["sampler", 1], settings);
  return graph;
}

/**
 * The infinite-take sampler: one denoise trajectory over the whole take, Temporal MultiDiffusion
 * with overlapping attention windows blended by raised-cosine ramps — no shot boundaries at all.
 * euler-family only (H3's audio velocity is chain-rule-scaled); VRAM is one window regardless of length.
 */
function buildInfiniteGraph(args: {
  script: string; width: number; height: number; totalFrames: number; seed: number;
}, settings: GenerationSettings): ComfyGraph {
  const chain = modelChainNodes(settings);
  const graph = chain.graph;
  graph.sampler = { class_type: "H3InfiniteTakeSampler", inputs: {
    model: chain.model, clip: chain.clip, video_vae: chain.videoVae, audio_vae: chain.audioVae,
    script: args.script, width: args.width, height: args.height,
    total_frames: args.totalFrames, window_frames: INFINITE_WINDOW_FRAMES, overlap_frames: INFINITE_OVERLAP_FRAMES,
    seed: args.seed, steps: settings.steps, sampler_name: "euler", scheduler: settings.scheduler,
    derive_length_from_script: false, activation_reserve_gb: 8,
  } };
  graph.output = outputNode(["sampler", 0], ["sampler", 1], settings);
  return graph;
}

/** Frame-guided route (last frame present, first optional): the native MiniMax H3 first/last-frame path. */
function buildFrameGraph(args: {
  prompt: string; width: number; height: number; frames: number; seed: number;
  firstFrame?: string; lastFrame: string;
}, settings: GenerationSettings): ComfyGraph {
  const chain = modelChainNodes(settings);
  const graph = chain.graph;
  const encodeInputs: Record<string, unknown> = {
    clip: chain.clip, vae: chain.videoVae, prompt: args.prompt,
    width: args.width, height: args.height, length: args.frames,
  };
  if (args.firstFrame !== undefined) {
    encodeInputs.first_frame = scaledImageNode(graph, "first_frame", args.firstFrame, args.width, args.height);
  }
  encodeInputs.last_frame = scaledImageNode(graph, "last_frame", args.lastFrame, args.width, args.height);
  graph.encode = { class_type: "MiniMaxH3ImageToVideo", inputs: encodeInputs };
  graph.noise = { class_type: "RandomNoise", inputs: { noise_seed: args.seed } };
  graph.guider = { class_type: "BasicGuider", inputs: { model: chain.model, conditioning: ["encode", 0] } };
  graph.sampler_select = { class_type: "KSamplerSelect", inputs: { sampler_name: settings.sampler } };
  graph.sigmas = { class_type: "BasicScheduler", inputs: { model: chain.model, scheduler: settings.scheduler, steps: settings.steps, denoise: 1 } };
  graph.sample = {
    class_type: "SamplerCustomAdvanced",
    inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler_select", 0], sigmas: ["sigmas", 0], latent_image: ["encode", 1] },
  };
  graph.decode = { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: chain.videoVae } };
  graph.decode_audio = { class_type: "VAEDecodeAudio", inputs: { samples: ["sample", 0], vae: chain.audioVae } };
  graph.output = outputNode(["decode", 0], ["decode_audio", 0], settings);
  return graph;
}

/**
 * Reference-driven regeneration: the native R2V path on ref2va weights. Image, video and audio
 * references ride the multimodal text encoder as <Picture N>/<Audio N>; motion follows the prompt,
 * not the reference video. Follows the official R2V recipe (res_multistep/simple, no attention
 * patches); COMFY_AUTOGROW inputs are addressed by their full slot names (`ref_images.ref_image_0`).
 */
function buildReferenceGraph(args: {
  prompt: string; width: number; height: number; frames: number; seed: number;
  referenceImages: readonly string[]; referenceVideos: readonly string[]; referenceAudios: readonly string[];
  carryVideoAudio: boolean;
}, settings: GenerationSettings): ComfyGraph {
  const model = modelChainNodes(settings, {
    unetName: settings.refUnetName,
    loraName: settings.refTurbo ? settings.refLoraName : "",
    useSolAttn: false,
  });
  const graph = model.graph;
  const encodeInputs: Record<string, unknown> = {
    clip: model.clip, vae: model.videoVae, audio_vae: model.audioVae,
    prompt: args.prompt, width: args.width, height: args.height, length: args.frames,
    ref_image_size: "match",
  };
  args.referenceImages.forEach((image, index) => {
    graph[`ref_image_${index}`] = { class_type: "LoadImage", inputs: { image } };
    encodeInputs[`ref_images.ref_image_${index}`] = [`ref_image_${index}`, 0];
  });
  args.referenceVideos.forEach((video, index) => {
    graph[`ref_video_${index}`] = {
      class_type: "VHS_LoadVideo",
      inputs: { video, force_rate: FRAME_FPS, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "None" },
    };
    encodeInputs[`ref_videos.ref_video_${index}`] = [`ref_video_${index}`, 0];
    // Audio auto-follow: with no explicit audio reference, each video reference's own soundtrack
    // rides along as its audio anchor (VHS_LoadVideo slot 2 is AUDIO).
    if (args.carryVideoAudio && args.referenceAudios.length === 0) {
      encodeInputs[`ref_video_audios.ref_video_audio_${index}`] = [`ref_video_${index}`, 2];
    }
  });
  args.referenceAudios.forEach((audio, index) => {
    graph[`ref_audio_${index}`] = { class_type: "LoadAudio", inputs: { audio } };
    encodeInputs[`ref_audios.ref_audio_${index}`] = [`ref_audio_${index}`, 0];
  });
  graph.encode = { class_type: "MiniMaxH3ReferenceToVideo", inputs: encodeInputs };
  graph.noise = { class_type: "RandomNoise", inputs: { noise_seed: args.seed } };
  graph.guider = { class_type: "BasicGuider", inputs: { model: model.model, conditioning: ["encode", 0] } };
  graph.sampler_select = { class_type: "KSamplerSelect", inputs: { sampler_name: settings.refSampler } };
  graph.sigmas = {
    class_type: "BasicScheduler",
    inputs: { model: model.model, scheduler: settings.refScheduler, steps: settings.refTurbo ? 4 : settings.refSteps, denoise: 1 },
  };
  graph.sample = {
    class_type: "SamplerCustomAdvanced",
    inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler_select", 0], sigmas: ["sigmas", 0], latent_image: ["encode", 1] },
  };
  graph.decode = { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: model.videoVae } };
  graph.decode_audio = { class_type: "VAEDecodeAudio", inputs: { samples: ["sample", 0], vae: model.audioVae } };
  graph.output = outputNode(["decode", 0], ["decode_audio", 0], settings);
  return graph;
}

/** One-window rewrite of a finished clip: H3Retake re-renders [start, end] under a new prompt
 * with the material either side frozen; mode selects whether audio, video, or both are redone. */
function buildRetakeGraph(args: {
  video: string; prompt: string; startSeconds: number; endSeconds: number; mode: string; seed: number;
}, settings: GenerationSettings): ComfyGraph {
  const chain = modelChainNodes(settings);
  const graph = chain.graph;
  const retakeModes: Readonly<Record<string, string>> = {
    "video+audio": "video + audio (redo the moment)",
    video: "video only (keep the performance)",
    audio: "audio only (keep the picture)",
  };
  graph.source = {
    class_type: "VHS_LoadVideo",
    inputs: { video: args.video, force_rate: FRAME_FPS, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "None" },
  };
  graph.sampler_select = { class_type: "KSamplerSelect", inputs: { sampler_name: settings.sampler } };
  graph.sigmas = { class_type: "BasicScheduler", inputs: { model: chain.model, scheduler: settings.scheduler, steps: settings.steps, denoise: 1 } };
  graph.retake = { class_type: "H3Retake", inputs: {
    model: chain.model, clip: chain.clip, video_vae: chain.videoVae, audio_vae: chain.audioVae,
    images: ["source", 0], audio: ["source", 2],
    prompt: args.prompt, start_seconds: args.startSeconds, end_seconds: args.endSeconds,
    mode: retakeModes[args.mode] ?? retakeModes["video+audio"]!,
    seed: args.seed, sampler: ["sampler_select", 0], sigmas: ["sigmas", 0],
  } };
  graph.output = outputNode(["retake", 0], ["retake", 1], settings);
  return graph;
}

function serviceSupportFor(refUnetAvailable: boolean): (request: EndpointRequest) => EndpointSupport {
  return (request: EndpointRequest): EndpointSupport => {
    const ports = (request.constraints as unknown as GenerationRequest).ports;
    const duration = ports.duration?.[0];
    if (typeof duration === "number" && (duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS)) {
      return {
        status: "unsupported",
        reason: `This ComfyUI deployment renders ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} second videos on H3's 17k+5 frame grid, not ${duration} seconds`,
      };
    }
    const resolution = ports.resolution?.[0];
    if (resolution !== undefined && resolution !== "768P" && resolution !== "2K") {
      return { status: "unsupported", reason: `This ComfyUI deployment renders 768P or 2K, not ${String(resolution)}` };
    }
    if ((ports.referenceVideo ?? []).length > 0 && !refUnetAvailable) {
      return {
        status: "unsupported",
        reason: "Video references need the ref2va checkpoint on the ComfyUI host; it is not installed (config refUnetName is empty)",
      };
    }
    return mappingSupportsRequest(mapping, request.constraints)
      ? { status: "supported" }
      : { status: "unsupported", reason: "This ComfyUI deployment does not accept one of the requested inputs" };
  };
}

type ChainEngine = "infinite" | "multishot";

function effectiveChainEngine(ports: Readonly<Record<string, unknown>>, configured: string): ChainEngine {
  if (configured === "infinite" || configured === "multishot") return configured;
  const hasReferences = ((ports.referenceImage as unknown[] | undefined) ?? []).length > 0
    || ((ports.referenceAudio as unknown[] | undefined) ?? []).length > 0
    || ((ports.firstFrame as unknown[] | undefined) ?? []).length > 0;
  return hasReferences ? "multishot" : "infinite";
}

function chainSupportFor(configuredEngine: string): (request: EndpointRequest) => EndpointSupport {
  return (request: EndpointRequest): EndpointSupport => {
    const ports = (request.constraints as unknown as GenerationRequest).ports;
    const duration = ports.duration?.[0];
    if (typeof duration === "number" && (duration < 16 || duration > 90)) {
      return { status: "unsupported", reason: `A chained take runs 16–90 seconds, not ${duration} seconds` };
    }
    const resolution = ports.resolution?.[0];
    if (resolution !== undefined && resolution !== "768P" && resolution !== "2K") {
      return { status: "unsupported", reason: `This ComfyUI deployment renders 768P or 2K, not ${String(resolution)}` };
    }
    const engine = effectiveChainEngine(ports as Readonly<Record<string, unknown>>, configuredEngine);
    if (engine === "infinite") {
      const hasReferences = ((ports.referenceImage ?? []).length + (ports.referenceAudio ?? []).length + (ports.firstFrame ?? []).length) > 0;
      if (hasReferences) {
        return { status: "unsupported", reason: 'The infinite-take engine carries no references; use chainEngine "auto" or "multishot" for reference-guided takes' };
      }
      if (typeof duration === "number") {
        const take = infiniteTakeForDuration(duration);
        if (take.windows < INFINITE_MIN_WINDOWS || take.windows > INFINITE_MAX_WINDOWS
          || Math.abs(take.frames / FRAME_FPS - duration) > 1.5) {
          return {
            status: "unsupported",
            reason: `The infinite-take engine renders takes of ${infiniteTakeOptions().join(", ")} seconds (one --- script window each); not ${duration} seconds`,
          };
        }
      }
    }
    return mappingSupportsRequest(chainMapping, request.constraints)
      ? { status: "supported" }
      : { status: "unsupported", reason: "This ComfyUI deployment does not accept one of the requested chain inputs" };
  };
}

/**
 * Motion following: the official Fun ControlNet Union recipe on ref2va. The control video's
 * signal (DWPose skeleton / DepthAnything map from a raw video, or a pre-extracted signal passed
 * through as `raw`) drives structure at full strength while the prompt owns appearance; the
 * conditioning and latent come from a reference-free R2V encode.
 */
function buildControlGraph(args: {
  prompt: string; width: number; height: number; frames: number; seed: number;
  controlVideo: string; controlType: string;
}, settings: GenerationSettings): ComfyGraph {
  const model = modelChainNodes(settings, {
    unetName: settings.refUnetName,
    loraName: settings.refTurbo ? settings.refLoraName : "",
    useSolAttn: false,
  });
  const graph = model.graph;
  graph.control_patch = { class_type: "ModelPatchLoader", inputs: { name: settings.controlPatchName } };
  graph.control_source = {
    class_type: "VHS_LoadVideo",
    inputs: { video: args.controlVideo, force_rate: FRAME_FPS, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "None" },
  };
  let controlRef: [string, number] = ["control_source", 0];
  if (args.controlType === "pose") {
    graph.control_pose = { class_type: "DWPreprocessor", inputs: { image: controlRef } };
    controlRef = ["control_pose", 0];
  } else if (args.controlType === "depth") {
    graph.control_depth = { class_type: "DepthAnythingPreprocessor", inputs: { image: controlRef } };
    controlRef = ["control_depth", 0];
  }
  graph.control_apply = { class_type: "MiniMaxH3FunControlNetApply", inputs: {
    model: model.model, model_patch: ["control_patch", 0], vae: model.videoVae,
    control_video: controlRef, strength: 1, start_percent: 0, end_percent: 1,
  } };
  graph.encode = { class_type: "MiniMaxH3ReferenceToVideo", inputs: {
    clip: model.clip, vae: model.videoVae, audio_vae: model.audioVae,
    prompt: args.prompt, width: args.width, height: args.height, length: args.frames, ref_image_size: "match",
  } };
  graph.noise = { class_type: "RandomNoise", inputs: { noise_seed: args.seed } };
  graph.guider = { class_type: "BasicGuider", inputs: { model: ["control_apply", 0], conditioning: ["encode", 0] } };
  graph.sampler_select = { class_type: "KSamplerSelect", inputs: { sampler_name: settings.refSampler } };
  graph.sigmas = {
    class_type: "BasicScheduler",
    inputs: { model: ["control_apply", 0], scheduler: settings.refScheduler, steps: settings.refTurbo ? 4 : settings.refSteps, denoise: 1 },
  };
  graph.sample = {
    class_type: "SamplerCustomAdvanced",
    inputs: { noise: ["noise", 0], guider: ["guider", 0], sampler: ["sampler_select", 0], sigmas: ["sigmas", 0], latent_image: ["encode", 1] },
  };
  graph.decode = { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: model.videoVae } };
  graph.decode_audio = { class_type: "VAEDecodeAudio", inputs: { samples: ["sample", 0], vae: model.audioVae } };
  graph.output = outputNode(["decode", 0], ["decode_audio", 0], settings);
  return graph;
}

function retakeSupport(request: EndpointRequest): EndpointSupport {
  const ports = (request.constraints as unknown as GenerationRequest).ports;
  const start = ports.startSeconds?.[0];
  const end = ports.endSeconds?.[0];
  if (typeof start === "number" && typeof end === "number") {
    if (end <= start) {
      return { status: "unsupported", reason: `A retake window must end after it starts, not ${start}–${end} seconds` };
    }
    if (end - start > 15.2) {
      return { status: "unsupported", reason: `A retake window stays within one native window (~15 s), not ${(end - start).toFixed(1)} seconds — split longer rewrites into several retakes` };
    }
    if (start < 0 || end > 600) {
      return { status: "unsupported", reason: `A retake window lives inside a 0–600 second source, not ${start}–${end} seconds` };
    }
  }
  const mode = ports.mode?.[0];
  if (mode !== undefined && mode !== "video+audio" && mode !== "video" && mode !== "audio") {
    return { status: "unsupported", reason: `A retake mode is video+audio, video or audio, not ${String(mode)}` };
  }
  return mappingSupportsRequest(retakeMapping, request.constraints)
    ? { status: "supported" }
    : { status: "unsupported", reason: "This ComfyUI deployment does not accept one of the requested retake inputs" };
}

function controlSupportFor(available: boolean): (request: EndpointRequest) => EndpointSupport {
  return (request: EndpointRequest): EndpointSupport => {
    if (!available) {
      return { status: "unsupported", reason: "Motion following needs the ref2va checkpoint and the Fun ControlNet Union patch on the ComfyUI host (refUnetName or controlPatchName is empty)" };
    }
    const ports = (request.constraints as unknown as GenerationRequest).ports;
    const duration = ports.duration?.[0];
    if (typeof duration === "number" && (duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS)) {
      return { status: "unsupported", reason: `Motion following renders one native window (${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} s), not ${duration} seconds` };
    }
    const resolution = ports.resolution?.[0];
    if (resolution !== undefined && resolution !== "768P" && resolution !== "2K") {
      return { status: "unsupported", reason: `This ComfyUI deployment renders 768P or 2K, not ${String(resolution)}` };
    }
    const controlType = ports.controlType?.[0];
    if (controlType !== undefined && controlType !== "pose" && controlType !== "depth" && controlType !== "raw") {
      return { status: "unsupported", reason: `A control type is pose, depth or raw, not ${String(controlType)}` };
    }
    return mappingSupportsRequest(controlMapping, request.constraints)
      ? { status: "supported" }
      : { status: "unsupported", reason: "This ComfyUI deployment does not accept one of the requested control inputs" };
  };
}

type OutputFile = { filename: string; subfolder: string; type: string; format?: string };

function findVideoOutput(outputs: Record<string, unknown>): OutputFile | undefined {
  for (const key of ["gifs", "videos", "images"]) {
    for (const nodeOutput of Object.values(outputs)) {
      const files = object(nodeOutput)[key];
      if (!Array.isArray(files) || files.length === 0) continue;
      const file = object(files[0]);
      if (typeof file.filename !== "string") continue;
      return {
        filename: file.filename,
        subfolder: typeof file.subfolder === "string" ? file.subfolder : "",
        type: typeof file.type === "string" ? file.type : "output",
        ...(typeof file.format === "string" ? { format: file.format } : {}),
      };
    }
  }
  return undefined;
}

function executionFailure(status: Record<string, unknown>): { code: string; message: string } {
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const message of messages) {
    if (!Array.isArray(message)) continue;
    const [kind, detail] = message as [unknown, unknown];
    if (kind === "execution_interrupted") {
      return { code: "COMFYUI_INTERRUPTED", message: "ComfyUI execution was interrupted" };
    }
    if (kind === "execution_error") {
      const error = object(detail);
      const nodeType = typeof error.node_type === "string" ? error.node_type : "unknown node";
      const nodeId = typeof error.node_id === "string" ? error.node_id : "?";
      const exception = typeof error.exception_message === "string" ? error.exception_message : "unknown error";
      const exceptionType = typeof error.exception_type === "string" ? ` (${error.exception_type})` : "";
      return { code: "COMFYUI_EXECUTION_ERROR", message: `ComfyUI failed at ${nodeType}#${nodeId}: ${redactUrls(exception)}${exceptionType}` };
    }
  }
  return { code: "COMFYUI_EXECUTION_ERROR", message: "ComfyUI reported an execution error" };
}

export function createComfyuiProvider(options: {
  instance: string; pool: string; baseUrl: string;
  concurrency?: number | undefined; pollIntervalMs?: number | undefined; fetch?: typeof globalThis.fetch;
  steps?: number | undefined; sampler?: string | undefined; scheduler?: string | undefined;
  filenamePrefix?: string | undefined; crf?: number | undefined;
  unetName?: string | undefined; loraName?: string | undefined; clipName?: string | undefined;
  videoVaeName?: string | undefined; audioVaeName?: string | undefined;
  useSolAttn?: boolean | undefined;
  chainEngine?: string | undefined;
  refUnetName?: string | undefined; refLoraName?: string | undefined; refTurbo?: boolean | undefined;
  refSteps?: number | undefined; refSampler?: string | undefined; refScheduler?: string | undefined;
  controlPatchName?: string | undefined;
  allowAuto2K?: boolean | undefined;
  chainRef2va?: boolean | undefined;
  chainTurbo?: boolean | undefined;
  selfAnchorVoice?: boolean | undefined;
}) {
  const base = address(options.baseUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const interval = options.pollIntervalMs ?? comfyuiDefaults.pollIntervalMs;
  const clientId = globalThis.crypto.randomUUID();
  const configuredChainEngine = options.chainEngine ?? comfyuiDefaults.chainEngine;
  if (configuredChainEngine !== "auto" && configuredChainEngine !== "infinite" && configuredChainEngine !== "multishot") {
    throw new Error(`chainEngine must be "auto", "infinite" or "multishot", not ${configuredChainEngine}`);
  }
  const settings: GenerationSettings = {
    unetName: options.unetName ?? comfyuiDefaults.unetName,
    loraName: options.loraName ?? comfyuiDefaults.loraName,
    clipName: options.clipName ?? comfyuiDefaults.clipName,
    videoVaeName: options.videoVaeName ?? comfyuiDefaults.videoVaeName,
    audioVaeName: options.audioVaeName ?? comfyuiDefaults.audioVaeName,
    steps: options.steps ?? comfyuiDefaults.steps,
    sampler: options.sampler ?? comfyuiDefaults.sampler,
    scheduler: options.scheduler ?? comfyuiDefaults.scheduler,
    useSolAttn: options.useSolAttn ?? comfyuiDefaults.useSolAttn,
    filenamePrefix: options.filenamePrefix ?? comfyuiDefaults.filenamePrefix,
    crf: options.crf ?? comfyuiDefaults.crf,
    refUnetName: options.refUnetName !== undefined ? options.refUnetName : comfyuiDefaults.refUnetName,
    refLoraName: options.refLoraName ?? comfyuiDefaults.refLoraName,
    refTurbo: options.refTurbo ?? comfyuiDefaults.refTurbo,
    refSteps: options.refSteps ?? comfyuiDefaults.refSteps,
    refSampler: options.refSampler ?? comfyuiDefaults.refSampler,
    refScheduler: options.refScheduler ?? comfyuiDefaults.refScheduler,
    controlPatchName: options.controlPatchName !== undefined ? options.controlPatchName : comfyuiDefaults.controlPatchName,
    allowAuto2K: options.allowAuto2K ?? comfyuiDefaults.allowAuto2K,
    chainRef2va: options.chainRef2va ?? comfyuiDefaults.chainRef2va,
    chainTurbo: options.chainTurbo ?? comfyuiDefaults.chainTurbo,
    selfAnchorVoice: options.selfAnchorVoice ?? comfyuiDefaults.selfAnchorVoice,
  };
  const serviceSupport = serviceSupportFor(settings.refUnetName.length > 0);
  const controlSupport = controlSupportFor(settings.refUnetName.length > 0 && settings.controlPatchName.length > 0);

  async function requestJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetcher(`${base}${path}`, init);
    if (!response.ok) {
      let detail = "";
      try { detail = JSON.stringify(object(await response.json())).slice(0, 400); } catch { /* keep HTTP evidence only */ }
      throw Object.assign(
        new Error(`ComfyUI ${init.method ?? "GET"} ${path} returned HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}`),
        response.status === 404 ? { code: "COMFYUI_NOT_FOUND" } : {},
      );
    }
    return object(await response.json());
  }

  async function uploadMedia(bytes: Uint8Array, mediaType: string): Promise<string> {
    // Everything rides the image upload endpoint: this ComfyUI build answers 405 on
    // /upload/audio, while /upload/image stores any file type unchanged in input/.
    const kind = mediaType.startsWith("image/") || mediaType.startsWith("video/") || mediaType.startsWith("audio/")
      ? "image" : undefined;
    if (kind === undefined) throw new Error(`ComfyUI reference transport accepts image, video and audio media, not ${mediaType}`);
    const form = new FormData();
    const extension = extensionFor(mediaType);
    const uploadName = `hypit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    form.append(kind, new Blob([bytes as unknown as BlobPart], { type: mediaType }), uploadName);
    form.append("overwrite", "true");
    form.append("type", "input");
    const response = await fetcher(`${base}/upload/${kind}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`ComfyUI POST /upload/${kind} returned HTTP ${response.status}`);
    const body = object(await response.json());
    const name = text(body.name);
    const subfolder = typeof body.subfolder === "string" ? body.subfolder : "";
    return subfolder === "" ? name : `${subfolder}/${name}`;
  }

  async function systemRamFree(): Promise<number> {
    const stats = await requestJson("/system_stats", { signal: AbortSignal.timeout(15_000) });
    const ramFree = object(stats.system ?? {}).ram_free;
    if (typeof ramFree !== "number") throw new Error("ComfyUI /system_stats did not report ram_free");
    return ramFree;
  }

  async function releaseComfyuiMemory(): Promise<void> {
    await fetcher(`${base}/free`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(60_000),
    });
  }

  /**
   * Guard the end-of-take host-RAM assembly BEFORE any GPU time is spent: a take that dies at the
   * join loses its whole render. Asks ComfyUI to release cached models once when short, then
   * refuses with the numbers rather than gambling minutes of rendering on the allocation.
   */
  async function ensureChainRamBudget(bytes: number, context: EndpointStartContext, label: string): Promise<void> {
    const gigabyte = 1024 ** 3;
    let free = await systemRamFree();
    if (free < bytes) {
      await context.reportProgress?.({
        phase: `Freeing ComfyUI cached memory (${(free / gigabyte).toFixed(1)} GB free, this take needs ~${(bytes / gigabyte).toFixed(1)} GB)`,
      });
      await releaseComfyuiMemory();
      free = await systemRamFree();
    }
    if (free < bytes) {
      throw new Error(`Not enough free system RAM on the ComfyUI host for this ${label}: ${(free / gigabyte).toFixed(1)} GB free, ~${(bytes / gigabyte).toFixed(1)} GB needed. Free memory on that machine or shorten/split the take`);
    }
  }

  /** Host-RAM budget of one take. The patched infinite engine assembles through a disk-backed
   * memmap (only the decode chunk and page cache count); the seamless-chain engine holds fp16
   * parts plus an fp16 master (≈ one float32 timeline) while VHS encodes a uint8 copy beside it. */
  function chainRamBudget(engine: ChainEngine, frames: number, width: number, height: number): number {
    const floatTimeline = frames * width * height * 3 * 4;
    const share = engine === "infinite" ? 0.25 : 1.3;
    return Math.round(floatTimeline * share) + 2 * 1024 ** 3;
  }

  /** Resolve the wire request: upload reference media to ComfyUI, capturing image dimensions and
   * video probes so unspoken parameters can derive from the author's own material. */
  async function compileWithUploads(context: EndpointStartContext, requestMapping: GenerationWireMapping, authored: GenerationRequest)
    : Promise<{ wire: Record<string, unknown>; uploadedDimensions: Map<string, { width: number; height: number }>; uploadedVideoProbes: Map<string, VideoProbe> }> {
    const uploadedDimensions = new Map<string, { width: number; height: number }>();
    const uploadedVideoProbes = new Map<string, VideoProbe>();
    const uploadedAudioSeconds = new Map<string, number>();
    const compiled = object(await compileWireRequest(requestMapping, authored, async (artifact) => {
      const bytes = await context.resources.get(artifact.resource);
      if (bytes === undefined) throw new Error("Reference media is unavailable");
      const name = await uploadMedia(new Uint8Array(bytes), artifact.mediaType);
      if (artifact.mediaType.startsWith("image/")) {
        const dimensions = imageDimensions(new Uint8Array(bytes));
        if (dimensions !== undefined) uploadedDimensions.set(name, dimensions);
      } else if (artifact.mediaType.startsWith("video/")) {
        const probe = mp4Probe(new Uint8Array(bytes));
        if (probe.width !== undefined || probe.seconds !== undefined) uploadedVideoProbes.set(name, probe);
      } else if (artifact.mediaType.startsWith("audio/")) {
        // A voice anchor is one clean solo line; a full soundtrack as a reference overflows the
        // conditioning path mid-render, so over-long WAV anchors are refused up front.
        const seconds = wavDurationSeconds(new Uint8Array(bytes));
        if (seconds !== undefined && seconds > MAX_VOICE_ANCHOR_SECONDS) {
          throw new Error(`A voice-reference audio must stay within ${MAX_VOICE_ANCHOR_SECONDS} seconds (one clean solo line), not ${seconds.toFixed(1)} seconds — trim it to the speaker's cleanest passage`);
        }
        if (seconds !== undefined) uploadedAudioSeconds.set(name, seconds);
      }
      return name;
    }));
    return { wire: object(compiled.input), uploadedDimensions, uploadedVideoProbes };
  }

  async function submitGraph(graph: ComfyGraph, context: EndpointStartContext, label: string): Promise<EndpointOutcome> {
    await context.reportProgress?.({ phase: `Submitting ComfyUI ${label} prompt` });
    const submitted = await requestJson("/prompt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
      // Submission only enqueues on the ComfyUI server; the render itself is polled separately.
      signal: AbortSignal.timeout(60_000),
    });
    const promptId = text(submitted.prompt_id);
    const nodeErrors = submitted.node_errors;
    if (typeof nodeErrors === "object" && nodeErrors !== null && Object.keys(nodeErrors).length > 0) {
      throw new Error(`ComfyUI rejected the graph: ${JSON.stringify(nodeErrors).slice(0, 400)}`);
    }
    const handle = { promptId };
    await context.checkpoint?.({ handle, receipt: { id: promptId } });
    return { ...wakeAfter(handle, interval), receipt: { id: promptId } };
  }

  const singleTakeStart = async (context: EndpointStartContext): Promise<EndpointOutcome> => {
    const supported = serviceSupport(context.need);
    if (supported.status === "unsupported") throw new Error(supported.reason);
    const authored = context.need.constraints as unknown as GenerationRequest;
    await context.reportProgress?.({ phase: "Preparing ComfyUI reference media" });
    const { wire, uploadedDimensions, uploadedVideoProbes } = await compileWithUploads(context, mapping, authored);
    const prompt = text(wire.prompt);
    const duration = numberValue(wire.duration);
    const resolution = optionalText(wire.resolution) ?? "768P";
    const aspectRatio = optionalText(wire.aspectRatio) ?? DEFAULT_ASPECT_RATIO;
    const referenceImages = stringList(wire.referenceImages);
    const referenceAudios = stringList(wire.referenceAudios);
    const referenceVideos = stringList(wire.referenceVideos);
    const firstFrame = optionalText(wire.firstFrame);
    const lastFrame = optionalText(wire.lastFrame);
    const seed = Math.floor(Math.random() * 2 ** 31);
    // A video reference selects the R2V engine on ref2va weights: subjects ride the multimodal
    // text encoder (<Picture N>/<Audio N>) and motion follows the prompt.
    if (referenceVideos.length > 0) {
      if (settings.refUnetName.length === 0) {
        throw new Error("Video references need the ref2va checkpoint on the ComfyUI host (config refUnetName is empty)");
      }
      // The checkpoint must be visible to ComfyUI now; a half-finished download fails here with a
      // clear reason instead of a bare missing-checkpoint validation error after the uploads.
      // ComfyUI's /object_info wraps each input as [values, options] — the filenames live in [0].
      const unetResponse = object(await requestJson("/object_info/UNETLoader", { signal: AbortSignal.timeout(15_000) }));
      const unetEntry = object(object(object(unetResponse.UNETLoader).input).required).unet_name;
      const unetList = Array.isArray(unetEntry) && Array.isArray(unetEntry[0]) ? unetEntry[0] : unetEntry;
      if (!Array.isArray(unetList) || !unetList.includes(settings.refUnetName)) {
        throw new Error(`The ref2va checkpoint ${settings.refUnetName} is not visible to ComfyUI yet (still downloading or not installed); video references cannot run`);
      }
      await context.reportProgress?.({ phase: "Reference-driven regeneration on ref2va weights" });
      // Unspoken framing derives from the author's own material: the first video reference's
      // aspect and pixel area, else the first image reference, else the usual defaults. The
      // video references' own soundtracks ride along when no explicit audio reference exists.
      const videoProbe = uploadedVideoProbes.get(referenceVideos[0]!);
      const deriveFrom = videoProbe?.width !== undefined && videoProbe.height !== undefined
        ? { width: videoProbe.width, height: videoProbe.height }
        : uploadedDimensions.get(referenceImages[0] ?? "");
      const effectiveResolution = resolution !== "768P" ? resolution
        : deriveFrom !== undefined ? autoResolutionTier(deriveFrom.width, deriveFrom.height, settings.allowAuto2K) : "768P";
      const dimensions = aspectRatio !== DEFAULT_ASPECT_RATIO
        ? dimensionsFor(aspectRatio, effectiveResolution)
        : deriveFrom !== undefined
          ? dimensionsForRatio(deriveFrom.width / deriveFrom.height, effectiveResolution)
          : dimensionsFor(DEFAULT_ASPECT_RATIO, effectiveResolution);
      const graph = buildReferenceGraph({
        prompt, width: dimensions.width, height: dimensions.height, frames: gridFrames(duration), seed,
        referenceImages, referenceVideos, referenceAudios,
        carryVideoAudio: true,
      }, settings);
      return submitGraph(graph, context, "reference-video");
    }
    const frameGuided = lastFrame !== undefined;
    if (!frameGuided && SHOT_SEPARATOR.test(prompt)) {
      throw new Error("A single-take request cannot contain a --- line: the seamless-chain sampler would split it into several shots");
    }
    // A frame-guided run (or a first-frame multishot run, where the Model forbids aspect-ratio)
    // inherits its aspect from the guiding image at the resolution tier's pixel budget.
    const guidingImage = frameGuided
      ? uploadedDimensions.get(firstFrame ?? lastFrame!)
      : firstFrame !== undefined ? uploadedDimensions.get(firstFrame) : undefined;
    const dimensions = guidingImage !== undefined
      ? dimensionsForRatio(guidingImage.width / guidingImage.height, resolution)
      : dimensionsFor(aspectRatio, resolution);
    const graph = frameGuided
      ? buildFrameGraph({
        prompt, width: dimensions.width, height: dimensions.height, frames: gridFrames(duration), seed,
        ...(firstFrame !== undefined ? { firstFrame } : {}), lastFrame: lastFrame!,
      }, settings)
      : buildMultishotGraph({
        prompt, width: dimensions.width, height: dimensions.height, frames: gridFrames(duration), seed, steps: settings.steps,
        ...(firstFrame !== undefined ? { firstFrame } : {}), referenceImages, referenceAudios,
      }, settings);
    return submitGraph(graph, context, frameGuided ? "frame-guided" : "single-take");
  };

  const chainTakeStart = async (context: EndpointStartContext): Promise<EndpointOutcome> => {
    const chainSupport = chainSupportFor(configuredChainEngine);
    const supported = chainSupport(context.need);
    if (supported.status === "unsupported") throw new Error(supported.reason);
    const authored = context.need.constraints as unknown as GenerationRequest;
    await context.reportProgress?.({ phase: "Preparing ComfyUI chain reference media" });
    const { wire, uploadedDimensions } = await compileWithUploads(context, chainMapping, authored);
    const script = text(wire.prompt);
    const requestedDuration = wire.duration === undefined ? undefined : numberValue(wire.duration);
    const referenceImages = stringList(wire.referenceImages);
    const referenceAudios = stringList(wire.referenceAudios);
    const firstFrame = optionalText(wire.firstFrame);
    const blocks = parseChainScript(script);
    const ports = (context.need.constraints as unknown as GenerationRequest).ports;
    const engine = effectiveChainEngine(ports as unknown as Readonly<Record<string, unknown>>, configuredChainEngine);
    const seed = Math.floor(Math.random() * 2 ** 31);
    // Unspoken resolution derives from the identity references' own pixel area.
    const referenceDims = uploadedDimensions.get(referenceImages[0] ?? "")
      ?? (firstFrame !== undefined ? uploadedDimensions.get(firstFrame) : undefined);
    const resolution = optionalText(wire.resolution) !== undefined ? optionalText(wire.resolution)!
      : referenceDims !== undefined ? autoResolutionTier(referenceDims.width, referenceDims.height, settings.allowAuto2K) : "768P";
    const aspectRatio = optionalText(wire.aspectRatio) ?? DEFAULT_ASPECT_RATIO;
    if (engine === "infinite") {
      // Window count follows the script's blocks; an unspoken duration is derived from word
      // density, landing on the phase-clean length ladder.
      let take = requestedDuration !== undefined ? infiniteTakeForDuration(requestedDuration) : undefined;
      if (take === undefined) {
        const windows = blocks.length > 1 ? blocks.length
          : Math.max(INFINITE_MIN_WINDOWS, Math.ceil((blocks.reduce((sum, block) => sum + estimateWindowSeconds(block), 0) * FRAME_FPS - 39) / 204));
        take = { windows, frames: 204 * windows + 39 };
        await context.reportProgress?.({ phase: `Derived take length: ${Math.round(take.frames / FRAME_FPS)}s from the script's word density` });
      }
      if (take.windows < INFINITE_MIN_WINDOWS || take.windows > INFINITE_MAX_WINDOWS
        || Math.abs(take.frames / FRAME_FPS - (requestedDuration ?? take.frames / FRAME_FPS)) > 1.5) {
        throw new Error(`The infinite-take engine renders takes of ${infiniteTakeOptions().join(", ")} seconds, not ${requestedDuration}`);
      }
      if (blocks.length > 1 && blocks.length !== take.windows) {
        const spans = Array.from({ length: take.windows }, (_, index) => {
          const start = (17 * 12 * index) / FRAME_FPS;
          const end = (17 * (12 * index + 14) + 5) / FRAME_FPS;
          return `window ${index + 1}: ${start.toFixed(1)}s-${end.toFixed(1)}s`;
        });
        throw new Error(`The script has ${blocks.length} window prompts but a ${(take.frames / FRAME_FPS).toFixed(1)}s infinite take needs ${take.windows} windows:\n${spans.join("\n")}`);
      }
      await context.reportProgress?.({ phase: `Infinite take: ${take.windows} blended windows, ${Math.round(take.frames / FRAME_FPS)}s on the GPU` });
      const dimensions = dimensionsFor(aspectRatio, resolution);
      await ensureChainRamBudget(chainRamBudget("infinite", take.frames, dimensions.width, dimensions.height), context, "infinite take");
      const graph = buildInfiniteGraph({
        script: JSON.stringify({ prompts: blocks }), width: dimensions.width, height: dimensions.height,
        totalFrames: take.frames, seed,
      }, settings);
      return submitGraph(graph, context, "infinite-take");
    }
    // Seamless-chain engine: the script's --- blocks are the windows; an unspoken duration is
    // derived per window from word density (uniform windows, the sampler takes one length).
    const estimatedPerWindow = blocks.reduce((sum, block) => sum + estimateWindowSeconds(block), 0) / blocks.length;
    const framesPerShot = requestedDuration !== undefined
      ? gridSnapUpUnclamped(Math.round(requestedDuration * FRAME_FPS / blocks.length))
      : gridSnapUpUnclamped(Math.round(estimatedPerWindow * FRAME_FPS));
    if (framesPerShot > MAX_GRID_FRAMES) {
      throw new Error(`A ${requestedDuration ?? "derived"}s take over ${blocks.length} script block(s) needs ${framesPerShot} frames per window, above H3's 362-frame ceiling — add more --- blocks`);
    }
    const guidingImage = firstFrame !== undefined ? uploadedDimensions.get(firstFrame)
      : referenceImages.length > 0 ? uploadedDimensions.get(referenceImages[0] ?? "") : undefined;
    const dimensions = guidingImage !== undefined
      ? dimensionsForRatio(guidingImage.width / guidingImage.height, resolution)
      : dimensionsFor(aspectRatio, resolution);
    await context.reportProgress?.({ phase: `Seamless chain: ${blocks.length} windows × ${(framesPerShot / FRAME_FPS).toFixed(1)}s on the GPU` });
    const totalFrames = framesPerShot * blocks.length;
    await ensureChainRamBudget(chainRamBudget("multishot", totalFrames, dimensions.width, dimensions.height), context, "seamless chain");
    // Reference-carrying chains run on the reference-trained ref2va checkpoint with its shipped
    // turbo pairing when installed — fl2va carries references only through the text encoder.
    const referenceCarried = referenceImages.length > 0 || referenceAudios.length > 0;
    const unetResponse = object(await requestJson("/object_info/UNETLoader", { signal: AbortSignal.timeout(15_000) }));
    const unetEntry = object(object(object(unetResponse.UNETLoader).input).required).unet_name;
    const unetList = Array.isArray(unetEntry) && Array.isArray(unetEntry[0]) ? unetEntry[0] : unetEntry;
    const chainOnRef2va = settings.chainRef2va && referenceCarried
      && settings.refUnetName.length > 0 && Array.isArray(unetList) && unetList.includes(settings.refUnetName);
    const graph = buildMultishotGraph({
      prompt: script, width: dimensions.width, height: dimensions.height, frames: framesPerShot, seed,
      steps: chainOnRef2va && !settings.chainTurbo ? settings.refSteps : (chainOnRef2va ? 4 : settings.steps),
      ...(firstFrame !== undefined ? { firstFrame } : {}), referenceImages, referenceAudios,
    }, settings, {
      shotCount: 0, saveEveryShot: blocks.length >= 2, selfAnchorVoice: settings.selfAnchorVoice,
      ...(chainOnRef2va ? { model: { unetName: settings.refUnetName, loraName: settings.chainTurbo ? settings.refLoraName : "" } } : {}),
    });
    if (chainOnRef2va) {
      await context.reportProgress?.({ phase: "Reference chain on ref2va weights with voice self-anchoring" });
    }
    return submitGraph(graph, context, "seamless-chain");
  };

  const sharedLifecycle = {
    async poll(context: EndpointPollContext): Promise<EndpointOutcome> {
      const promptId = text(object(context.handle).promptId);
      const historyBody = await requestJson(`/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(30_000) });
      const entry: unknown = historyBody[promptId];
      if (entry === undefined || entry === null) {
        // Not in history yet: report whether ComfyUI is rendering it or where it sits in the queue.
        let phase = "queued on the ComfyUI server";
        try {
          const queue = await requestJson("/queue", { signal: AbortSignal.timeout(15_000) });
          const running = Array.isArray(queue.queue_running) ? queue.queue_running : [];
          const pending = Array.isArray(queue.queue_pending) ? queue.queue_pending : [];
          const isRunning = running.some((item) => Array.isArray(item) && item[1] === promptId);
          const position = pending.findIndex((item) => Array.isArray(item) && item[1] === promptId);
          phase = isRunning ? "rendering on the GPU" : position >= 0 ? `queued (position ${position + 1})` : phase;
        } catch { /* queue detail is cosmetic; the history answer above is the source of truth */ }
        return wakeAfter({ promptId }, interval, Date.now(), { phase });
      }
      const record = object(entry);
      const status = object(record.status ?? {});
      const statusText = typeof status.status_str === "string" ? status.status_str : "";
      if (statusText === "error") {
        return { status: "failed", receipt: { id: promptId }, failure: executionFailure(status) };
      }
      if (status.completed !== true) {
        return wakeAfter({ promptId }, interval, Date.now(), { phase: "rendering on the GPU" });
      }
      const file = findVideoOutput(object(record.outputs ?? {}));
      if (file === undefined) {
        // A completed prompt without saved media is a contract violation, not a pending job.
        throw new Error(`ComfyUI prompt ${promptId} completed without a saved video output`);
      }
      const handle = { promptId, filename: file.filename, subfolder: file.subfolder, type: file.type, format: file.format ?? "" };
      return { status: "ready", handle, receipt: { id: promptId } };
    },

    async collect(context: EndpointPollContext): Promise<EndpointOutcome> {
      const handle = object(context.handle);
      const filename = text(handle.filename);
      const subfolder = typeof handle.subfolder === "string" ? handle.subfolder : "";
      const type = typeof handle.type === "string" && handle.type.length > 0 ? handle.type : "output";
      const query = new URLSearchParams({ filename, subfolder, type });
      await context.reportProgress?.({ phase: "Receiving generated video" });
      const response = await fetcher(`${base}/view?${query.toString()}`, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok) throw new Error(`ComfyUI video download returned HTTP ${response.status}`);
      const mediaType = mediaTypeForFile(filename);
      const artifact = await context.resources.put(new Uint8Array(await response.arrayBuffer()), mediaType);
      return { status: "completed", result: { value: { kind: "inline", value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) } } };
    },

    async cancel(context: EndpointPollContext) {
      // Best effort: drop the prompt from the queue, then interrupt whatever is executing.
      const promptId = text(object(context.handle).promptId);
      try {
        await fetcher(`${base}/queue`, {
          method: "DELETE", headers: { "content-type": "application/json" },
          body: JSON.stringify({ delete: [promptId] }), signal: AbortSignal.timeout(15_000),
        });
        await fetcher(`${base}/interrupt`, { method: "POST", signal: AbortSignal.timeout(15_000) });
      } catch { /* cancellation stays best effort; poll reports the real state */ }
      return { status: "accepted" as const };
    },
  };

  const singleTakeEndpoint: AsyncEndpoint = { start: singleTakeStart, ...sharedLifecycle };
  const chainTakeEndpoint: AsyncEndpoint = { start: chainTakeStart, ...sharedLifecycle };

  const retakeStart = async (context: EndpointStartContext): Promise<EndpointOutcome> => {
    const supported = retakeSupport(context.need);
    if (supported.status === "unsupported") throw new Error(supported.reason);
    const authored = context.need.constraints as unknown as GenerationRequest;
    await context.reportProgress?.({ phase: "Uploading the source video to ComfyUI" });
    const { wire } = await compileWithUploads(context, retakeMapping, authored);
    const video = text(wire.source);
    const prompt = text(wire.prompt);
    const startSeconds = numberValue(wire.startSeconds);
    const endSeconds = numberValue(wire.endSeconds);
    const mode = optionalText(wire.mode) ?? "video+audio";
    if (endSeconds <= startSeconds || endSeconds - startSeconds > 15.2 || startSeconds < 0) {
      throw new Error(`Invalid retake window ${startSeconds}–${endSeconds} seconds`);
    }
    await context.reportProgress?.({ phase: `Retaking ${startSeconds}–${endSeconds}s (${mode}) with the sides frozen` });
    const graph = buildRetakeGraph({
      video, prompt, startSeconds, endSeconds, mode,
      seed: Math.floor(Math.random() * 2 ** 31),
    }, settings);
    return submitGraph(graph, context, "retake");
  };
  const retakeEndpoint: AsyncEndpoint = { start: retakeStart, ...sharedLifecycle };

  const controlStart = async (context: EndpointStartContext): Promise<EndpointOutcome> => {
    const supported = controlSupport(context.need);
    if (supported.status === "unsupported") throw new Error(supported.reason);
    const authored = context.need.constraints as unknown as GenerationRequest;
    await context.reportProgress?.({ phase: "Uploading the control video to ComfyUI" });
    const { wire, uploadedVideoProbes } = await compileWithUploads(context, controlMapping, authored);
    const prompt = text(wire.prompt);
    const controlVideo = text(wire.controlVideo);
    const controlType = optionalText(wire.controlType) ?? "pose";
    const probe = uploadedVideoProbes.get(controlVideo);
    // Unspoken parameters follow the control video itself: its length (within one window), its
    // aspect ratio and its pixel-area tier; explicit ports always win.
    const duration = wire.duration !== undefined ? numberValue(wire.duration)
      : probe?.seconds !== undefined ? Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(probe.seconds)))
      : 10;
    const resolution = optionalText(wire.resolution) !== undefined ? optionalText(wire.resolution)!
      : probe?.width !== undefined && probe.height !== undefined ? autoResolutionTier(probe.width, probe.height, settings.allowAuto2K) : "768P";
    const aspectRatio = optionalText(wire.aspectRatio) ?? DEFAULT_ASPECT_RATIO;
    // Both weights must be visible to ComfyUI now; a half-finished download fails here clearly.
    const unetResponse = object(await requestJson("/object_info/UNETLoader", { signal: AbortSignal.timeout(15_000) }));
    const unetEntry = object(object(object(unetResponse.UNETLoader).input).required).unet_name;
    const unetList = Array.isArray(unetEntry) && Array.isArray(unetEntry[0]) ? unetEntry[0] : unetEntry;
    if (!Array.isArray(unetList) || !unetList.includes(settings.refUnetName)) {
      throw new Error(`The ref2va checkpoint ${settings.refUnetName} is not visible to ComfyUI yet; motion following cannot run`);
    }
    const patchResponse = object(await requestJson("/object_info/ModelPatchLoader", { signal: AbortSignal.timeout(15_000) }));
    const patchList = object(object(object(patchResponse.ModelPatchLoader).input).required).name;
    if (!Array.isArray(patchList) || !patchList.includes(settings.controlPatchName)) {
      throw new Error(`The control patch ${settings.controlPatchName} is not visible to ComfyUI yet (still downloading or not installed); motion following cannot run`);
    }
    const dimensions = aspectRatio !== DEFAULT_ASPECT_RATIO
      ? dimensionsFor(aspectRatio, resolution)
      : probe?.width !== undefined && probe.height !== undefined
        ? dimensionsForRatio(probe.width / probe.height, resolution)
        : dimensionsFor(DEFAULT_ASPECT_RATIO, resolution);
    await context.reportProgress?.({ phase: `Motion following (${controlType}, ${duration}s) on the GPU` });
    const graph = buildControlGraph({
      prompt, width: dimensions.width, height: dimensions.height, frames: gridFrames(duration),
      seed: Math.floor(Math.random() * 2 ** 31),
      controlVideo, controlType,
    }, settings);
    return submitGraph(graph, context, "control-video");
  };
  const controlEndpoint: AsyncEndpoint = { start: controlStart, ...sharedLifecycle };

  return defineEndpointPackage({
    module: providerModule, facet: "video", instance: options.instance, pool: options.pool,
    defaultConcurrency: options.concurrency ?? comfyuiDefaults.concurrency,
    actionLimits: { submit: { concurrency: 1 }, poll: { concurrency: 4 }, collect: { concurrency: 2 } },
    pricing: { kind: "local" },
    capabilities: [
      { capability, returns: generationTypes.videoSet, lifecycle: "asynchronous", supports: serviceSupport, endpoint: singleTakeEndpoint },
      { capability: chainCapability, returns: generationTypes.videoSet, lifecycle: "asynchronous",
        supports: chainSupportFor(configuredChainEngine), endpoint: chainTakeEndpoint },
      { capability: retakeCapability, returns: generationTypes.videoSet, lifecycle: "asynchronous", supports: retakeSupport, endpoint: retakeEndpoint },
      { capability: controlCapability, returns: generationTypes.videoSet, lifecycle: "asynchronous", supports: controlSupport, endpoint: controlEndpoint },
    ],
  });
}
