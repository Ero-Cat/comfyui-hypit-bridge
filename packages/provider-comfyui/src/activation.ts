import {
  createRuntimeEndpointAdapterFacet, runtimeConfigBoolean, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createComfyuiProvider, providerModule } from "./provider.js";

function configNumber(value: unknown, subject: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${subject} must be a finite number`);
  return value;
}

const CONFIG_KEYS = [
  "baseUrl", "concurrency", "pollIntervalMs", "steps", "sampler", "scheduler", "crf",
  "filenamePrefix", "unetName", "loraName", "clipName", "videoVaeName", "audioVaeName", "useSolAttn",
  "chainEngine", "refUnetName", "refLoraName", "refTurbo", "refTurboSteps", "refSteps", "refSampler", "refScheduler", "refSolAttn", "refSolAttnTau", "refSolAttnStart", "refSolAttnEnd", "refSolAttnInt8Pv",
  "controlPatchName", "allowAuto2K", "chainRef2va", "chainTurbo", "selfAnchorVoice",
  "upscaleGanModel", "upscaleSeedvr2Name", "upscaleSeedvr2VaeName", "upscaleLane", "upscaleFit",
  "upscaleFramesPerBatch", "upscaleCrf", "upscalePrefix",
];

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "ComfyUI service");
      runtimeConfigExact(config, CONFIG_KEYS, "ComfyUI service");
      const baseUrl = runtimeConfigString(config.baseUrl, "ComfyUI baseUrl");
      if (!baseUrl || !context.pool) throw new Error("ComfyUI service requires baseUrl and pool");
      return { endpoint: createComfyuiProvider({
        instance: context.instance, pool: context.pool, baseUrl,
        concurrency: runtimeConfigPositiveInteger(config.concurrency, "ComfyUI concurrency") ?? 1,
        pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "ComfyUI pollIntervalMs") ?? 5_000,
        steps: runtimeConfigPositiveInteger(config.steps, "ComfyUI steps"),
        sampler: runtimeConfigString(config.sampler, "ComfyUI sampler"),
        scheduler: runtimeConfigString(config.scheduler, "ComfyUI scheduler"),
        filenamePrefix: runtimeConfigString(config.filenamePrefix, "ComfyUI filenamePrefix"),
        crf: runtimeConfigPositiveInteger(config.crf, "ComfyUI crf"),
        unetName: runtimeConfigString(config.unetName, "ComfyUI unetName"),
        loraName: runtimeConfigString(config.loraName, "ComfyUI loraName"),
        clipName: runtimeConfigString(config.clipName, "ComfyUI clipName"),
        videoVaeName: runtimeConfigString(config.videoVaeName, "ComfyUI videoVaeName"),
        audioVaeName: runtimeConfigString(config.audioVaeName, "ComfyUI audioVaeName"),
        useSolAttn: runtimeConfigBoolean(config.useSolAttn, "ComfyUI useSolAttn"),
        chainEngine: runtimeConfigString(config.chainEngine, "ComfyUI chainEngine"),
        refUnetName: runtimeConfigString(config.refUnetName, "ComfyUI refUnetName"),
        refLoraName: runtimeConfigString(config.refLoraName, "ComfyUI refLoraName"),
        refTurbo: runtimeConfigBoolean(config.refTurbo, "ComfyUI refTurbo"),
        refTurboSteps: runtimeConfigPositiveInteger(config.refTurboSteps, "ComfyUI refTurboSteps"),
        refSteps: runtimeConfigPositiveInteger(config.refSteps, "ComfyUI refSteps"),
        refSampler: runtimeConfigString(config.refSampler, "ComfyUI refSampler"),
        refScheduler: runtimeConfigString(config.refScheduler, "ComfyUI refScheduler"),
        refSolAttn: runtimeConfigBoolean(config.refSolAttn, "ComfyUI refSolAttn"),
        refSolAttnTau: configNumber(config.refSolAttnTau, "ComfyUI refSolAttnTau"),
        refSolAttnStart: configNumber(config.refSolAttnStart, "ComfyUI refSolAttnStart"),
        refSolAttnEnd: configNumber(config.refSolAttnEnd, "ComfyUI refSolAttnEnd"),
        refSolAttnInt8Pv: runtimeConfigBoolean(config.refSolAttnInt8Pv, "ComfyUI refSolAttnInt8Pv"),
        controlPatchName: runtimeConfigString(config.controlPatchName, "ComfyUI controlPatchName"),
        allowAuto2K: runtimeConfigBoolean(config.allowAuto2K, "ComfyUI allowAuto2K"),
        chainRef2va: runtimeConfigBoolean(config.chainRef2va, "ComfyUI chainRef2va"),
        chainTurbo: runtimeConfigBoolean(config.chainTurbo, "ComfyUI chainTurbo"),
        selfAnchorVoice: runtimeConfigBoolean(config.selfAnchorVoice, "ComfyUI selfAnchorVoice"),
        upscaleGanModel: runtimeConfigString(config.upscaleGanModel, "ComfyUI upscaleGanModel"),
        upscaleSeedvr2Name: runtimeConfigString(config.upscaleSeedvr2Name, "ComfyUI upscaleSeedvr2Name"),
        upscaleSeedvr2VaeName: runtimeConfigString(config.upscaleSeedvr2VaeName, "ComfyUI upscaleSeedvr2VaeName"),
        upscaleLane: runtimeConfigString(config.upscaleLane, "ComfyUI upscaleLane"),
        upscaleFit: runtimeConfigString(config.upscaleFit, "ComfyUI upscaleFit"),
        upscaleFramesPerBatch: runtimeConfigPositiveInteger(config.upscaleFramesPerBatch, "ComfyUI upscaleFramesPerBatch"),
        upscaleCrf: runtimeConfigPositiveInteger(config.upscaleCrf, "ComfyUI upscaleCrf"),
        upscalePrefix: runtimeConfigString(config.upscalePrefix, "ComfyUI upscalePrefix"),
      }) };
    },
  })],
};
