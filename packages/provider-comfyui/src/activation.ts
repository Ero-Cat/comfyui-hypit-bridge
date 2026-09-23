import {
  createRuntimeEndpointAdapterFacet, runtimeConfigBoolean, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createComfyuiProvider, providerModule } from "./provider.js";

const CONFIG_KEYS = [
  "baseUrl", "concurrency", "pollIntervalMs", "steps", "sampler", "scheduler", "crf",
  "filenamePrefix", "unetName", "loraName", "clipName", "videoVaeName", "audioVaeName", "useSolAttn",
  "chainEngine", "refUnetName", "refLoraName", "refTurbo", "refSteps", "refSampler", "refScheduler",
  "controlPatchName", "allowAuto2K", "chainRef2va", "chainTurbo", "selfAnchorVoice",
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
        refSteps: runtimeConfigPositiveInteger(config.refSteps, "ComfyUI refSteps"),
        refSampler: runtimeConfigString(config.refSampler, "ComfyUI refSampler"),
        refScheduler: runtimeConfigString(config.refScheduler, "ComfyUI refScheduler"),
        controlPatchName: runtimeConfigString(config.controlPatchName, "ComfyUI controlPatchName"),
        allowAuto2K: runtimeConfigBoolean(config.allowAuto2K, "ComfyUI allowAuto2K"),
        chainRef2va: runtimeConfigBoolean(config.chainRef2va, "ComfyUI chainRef2va"),
        chainTurbo: runtimeConfigBoolean(config.chainTurbo, "ComfyUI chainTurbo"),
        selfAnchorVoice: runtimeConfigBoolean(config.selfAnchorVoice, "ComfyUI selfAnchorVoice"),
      }) };
    },
  })],
};
