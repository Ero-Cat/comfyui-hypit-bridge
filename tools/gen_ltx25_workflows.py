#!/usr/bin/env python3
"""Generate LTX-2.5 baseline workflows (ComfyUI UI format) for ComfyUI 0.36 + ComfyUI-GGUF-Loader.

The node chain mirrors provider-comfyui's buildLtxGraph — the official two-stage LTX-2.5 recipe:
  LTXV25ModelsLoader -> LTXV25ImgToVideo(t2v/i2v, stage-1 latent at HALF resolution)
  -> LTXV25KSampler("distilled (8 steps)") -> LTXV25LatentUpscale(x2, i2v re-hold @1.0)
  -> LTXV25KSampler("refine (3 steps)") -> LTXV25AVDecode -> SaveVideo

Widget order is derived live from /object_info (link-only types are skipped, seed's
control_after_generate is serialized as a trailing "fixed"), so widgets_values stays correct
without hand-maintaining it. Run against a ComfyUI that has the ComfyUI-GGUF-Loader pack:

  python3 tools/gen_ltx25_workflows.py            # writes workflows/LTX25_*.json
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

BASE = os.environ.get("COMFYUI_BASE", "http://192.168.66.222:8000")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "workflows")

# 2026-10-01 install: the OFFICIAL Lightricks int8-convrot lane (via the ModelScope mirror,
# ungated + peak-hour-proof). The uncensored lane's DiT rides in later from HF; swap these names
# (and matching hypit.runtime.json ltx* keys) to flip lanes.
FILES = {
    "unet": "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    "clip": "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors",
    "video_vae": "ltx-2.5-video-vae-bf16.safetensors",
    "audio_vae": "ltx-2.5-audio-vae-bf16.safetensors",
    "upscaler": "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
}
FPS = 24

LINK_TYPES = {"MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT", "IMAGE", "VIDEO", "LATENT_UPSCALE_MODEL"}

# Output slots per node type, in slot order: (name, link type).
OUTPUT_SLOTS = {
    "LTXV25ModelsLoader": [("model", "MODEL"), ("clip", "CLIP"), ("vae", "VAE"), ("audio_vae", "VAE")],
    "LTXV25ImgToVideo": [("model", "MODEL"), ("positive", "CONDITIONING"), ("negative", "CONDITIONING"),
                         ("latent", "LATENT"), ("frame_rate", "FLOAT")],
    "LTXV25KSampler": [("LATENT", "LATENT")],
    "LTXV25LatentUpscale": [("LATENT", "LATENT")],
    "LTXV25AVDecode": [("VIDEO", "VIDEO")],
    "SaveVideo": [("VIDEO", "VIDEO")],
    "LatentUpscaleModelLoader": [("LATENT_UPSCALE_MODEL", "LATENT_UPSCALE_MODEL")],
    "LoadImage": [("IMAGE", "IMAGE")],
}


def object_info(name: str) -> dict:
    with urllib.request.urlopen(f"{BASE}/object_info/{name}", timeout=20) as response:
        return json.load(response)[name]


def widget_keys(name: str) -> list[tuple[str, bool, object]]:
    """(input key, has control_after_generate, schema default) for every widget input."""
    spec = object_info(name)
    keys: list[tuple[str, bool, object]] = []
    for section in ("required", "optional"):
        for key, meta in spec["input"].get(section, {}).items():
            kind = meta[0] if meta else None
            if isinstance(kind, str) and kind in LINK_TYPES:
                continue
            options = meta[1] if isinstance(meta, list) and len(meta) > 1 and isinstance(meta[1], dict) else {}
            control = bool(options.get("control_after_generate"))
            default = options.get("default")
            if default is None and isinstance(kind, list):
                default = kind[0]
            if default is None:
                default = 0 if kind == "INT" else 0.0 if kind == "FLOAT" else ""
            keys.append((key, control, default))
    return keys


def api_graph(prompt: str, width: int, height: int, length: int, *, first_frame: str | None = None,
              seed: int = 20261001, prefix: str = "LTX25") -> dict:
    """The same graph provider-comfyui's buildLtxGraph submits (API format)."""
    graph: dict = {
        "models": {"class_type": "LTXV25ModelsLoader", "inputs": {
            "unet_name": FILES["unet"], "clip_name": FILES["clip"],
            "video_vae_name": FILES["video_vae"], "audio_vae_name": FILES["audio_vae"]}},
        "upscaler": {"class_type": "LatentUpscaleModelLoader", "inputs": {"model_name": FILES["upscaler"]}},
    }
    prep: dict = {
        "model": ["models", 0], "clip": ["models", 1], "mode": "i2v" if first_frame else "t2v",
        "vae": ["models", 2], "audio_vae": ["models", 3],
        "prompt": prompt, "negative_prompt": "",
        "width": width, "height": height, "length": length,
        "frame_rate": FPS, "batch_size": 1,
    }
    if first_frame:
        graph["first_frame"] = {"class_type": "LoadImage", "inputs": {"image": first_frame}}
        prep["images"] = ["first_frame", 0]
    graph["prep"] = {"class_type": "LTXV25ImgToVideo", "inputs": prep}
    graph["sample_distilled"] = {"class_type": "LTXV25KSampler", "inputs": {
        "model": ["prep", 0], "positive": ["prep", 1], "negative": ["prep", 2], "latent_image": ["prep", 3],
        "seed": seed, "schedule": "distilled (8 steps)", "sampler_name": "euler_ancestral",
        "video_cfg": 1, "audio_cfg": 1}}
    upscale: dict = {"latent": ["sample_distilled", 0], "upscale_model": ["upscaler", 0], "vae": ["models", 2]}
    if first_frame:
        upscale["images"] = ["first_frame", 0]
    graph["upscale"] = {"class_type": "LTXV25LatentUpscale", "inputs": upscale}
    graph["sample_refine"] = {"class_type": "LTXV25KSampler", "inputs": {
        "model": ["prep", 0], "positive": ["prep", 1], "negative": ["prep", 2], "latent_image": ["upscale", 0],
        "seed": seed, "schedule": "refine (3 steps)", "sampler_name": "euler_ancestral",
        "video_cfg": 1, "audio_cfg": 1}}
    graph["decode"] = {"class_type": "LTXV25AVDecode", "inputs": {
        "latent": ["sample_refine", 0], "vae": ["models", 2], "audio_vae": ["models", 3], "fps": FPS}}
    graph["output"] = {"class_type": "SaveVideo", "inputs": {
        "video": ["decode", 0], "filename_prefix": prefix, "format": "auto", "codec": "auto"}}
    return graph


def to_ui_workflow(api: dict, title: str) -> dict:
    """Convert the API graph into a ComfyUI UI-format workflow (nodes/links arrays)."""
    schemas = {name: widget_keys(name) for name in sorted({node["class_type"] for node in api.values()})}
    order = [key for key in api.keys()]  # insertion order is already topological
    ids = {key: index + 1 for index, key in enumerate(order)}
    links: list[list] = []
    link_id = 0
    nodes = []
    for column, key in enumerate(order):
        node = api[key]
        name = node["class_type"]
        inputs = []
        widgets: list = []
        # The UI node's input list = link inputs in schema order; widgets in schema order after.
        spec = object_info(name)
        input_slots = []
        for section in ("required", "optional"):
            for slot_key, meta in spec["input"].get(section, {}).items():
                kind = meta[0] if meta else None
                if isinstance(kind, str) and kind in LINK_TYPES:
                    input_slots.append((slot_key, kind))
        for slot_index, (slot_key, kind) in enumerate(input_slots):
            value = node["inputs"].get(slot_key)
            link = None
            if isinstance(value, list):
                link_id += 1
                origin, origin_slot = value
                links.append([link_id, ids[origin], origin_slot, ids[key], slot_index, kind])
                link = link_id
            inputs.append({"name": slot_key, "type": kind, "link": link})
        for widget_key, control, default in schemas[name]:
            value = node["inputs"].get(widget_key, default)
            widgets.append(value)
            if control:
                widgets.append("fixed")
        if name == "LoadImage":
            widgets = widgets + ["image"]
        outputs = []
        slots = OUTPUT_SLOTS.get(name, [])
        for slot_index, (slot, kind) in enumerate(slots):
            outgoing = [link[0] for link in links if link[1] == ids[key] and link[2] == slot_index]
            outputs.append({"name": slot.lower(), "type": kind, "links": outgoing})
        nodes.append({
            "id": ids[key], "type": name,
            "pos": [column * 360 + 40, 60 + (120 if key == "first_frame" else 0)],
            "size": [0, 0], "flags": {}, "order": column, "mode": 0,
            "inputs": inputs, "outputs": outputs,
            "properties": {"Node name for S&R": name},
            "widgets_values": widgets,
        })
    return {
        "last_node_id": len(order), "last_link_id": link_id,
        "nodes": nodes, "links": links, "groups": [], "config": {}, "extra": {},
        "version": 0.4, "title": title,
    }


PROMPTS = {
    "t2v": (
        "A slow push-in on a matte-black ceramic coffee mug sitting on a walnut table beside a "
        "tall window, thin steam curling off the surface, soft morning light raking across the "
        "wood grain. The camera dollies in and settles on the mug. The quiet kitchen is audible: "
        "a low refrigerator hum, the faint tick of a wall clock, a soft bird chorus outside the "
        "window. Unscored."
    ),
    "i2v": (
        "Starting from the provided image as the first frame, the product slowly rotates as if on "
        "an invisible turntable while the camera holds steady; light sweeps across the surface "
        "revealing texture and finish. A soft mechanical whir accompanies the rotation, over a "
        "quiet studio room tone. Unscored."
    ),
    "vertical": (
        "Vertical product film: a glass serum bottle with a gold cap stands on a reflective "
        "podium in a bright studio, a gentle slow orbit around it as soft daylight drifts, tiny "
        "water droplets catching the light on the glass. The camera moves in one continuous "
        "orbit, then settles on a close-up of the cap. Faint airy room tone and a single soft "
        "chime as the shot settles. Unscored."
    ),
    "multishot": (
        "[VISUAL] Start on a wide establishing shot of a sunlit kitchen counter with a blender, "
        "then cut to a close-up of fresh strawberries and bananas dropping into the jar, then cut "
        "to a medium shot of the blender whirring into a smooth pink smoothie, then cut to a "
        "final close-up of the smoothie being poured into a glass. One continuous kitchen "
        "morning, consistent warm light. [SPEECH] A warm friendly narrator says: \"Morning fuel, "
        "thirty seconds flat.\" [SOUNDS] Crisp fruit drops, the blender's rising whir, the liquid "
        "pour, a bright kitchen ambience with birds outside. Unscored."
    ),
}

WORKFLOWS = [
    ("LTX25_T2V_Baseline.json", "LTX-2.5 T2V Baseline (official int8, 1280x768, 5s)",
     dict(prompt=PROMPTS["t2v"], width=1280, height=768, length=121, prefix="LTX25/t2v")),
    ("LTX25_I2V_Baseline.json", "LTX-2.5 I2V Baseline (first-frame hold, 1280x768, 5s)",
     dict(prompt=PROMPTS["i2v"], width=1280, height=768, length=121, first_frame="ltx25_first_frame.png",
          prefix="LTX25/i2v")),
    ("LTX25_Vertical_Product.json", "LTX-2.5 Vertical Product 9:16 (768x1280, 5s)",
     dict(prompt=PROMPTS["vertical"], width=768, height=1280, length=121, prefix="LTX25/vertical")),
    ("LTX25_Multishot_Story.json", "LTX-2.5 Multishot Story (VISUAL/SPEECH/SOUNDS, 1280x768, 10s)",
     dict(prompt=PROMPTS["multishot"], width=1280, height=768, length=241, prefix="LTX25/multishot")),
]


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    for filename, title, kwargs in WORKFLOWS:
        api = api_graph(**kwargs)
        ui = to_ui_workflow(api, title)
        path = os.path.join(OUT_DIR, filename)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(ui, handle, ensure_ascii=False, indent=1)
        print(f"wrote {path}: {len(ui['nodes'])} nodes, {len(ui['links'])} links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
