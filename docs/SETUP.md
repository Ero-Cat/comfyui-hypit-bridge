# Setup Guide

## Prerequisites

- **ComfyUI** v0.36+ running on a GPU machine (RTX 3090/4090/5090 with ≥24 GB VRAM)
- **Hypit CLI** (`npm install -g @hypit/hypit`)
- **Node.js** v20+
- **ffmpeg** (for media processing tools)

## Step 1: Clone and install packages

```bash
git clone https://github.com/<your-username>/comfyui-hypit-bridge.git
cd comfyui-hypit-bridge

# Build all provider/model packages
for pkg in packages/*/; do
  (cd "$pkg" && npm install && npm run build)
done

# Install into project root
npm install ./packages/provider-comfyui ./packages/model-h3-chain ./packages/model-h3-retake ./packages/model-h3-control
```

## Step 2: Configure your ComfyUI endpoint

```bash
# Copy the template
cp hypit.runtime.example.json hypit.runtime.json

# Edit with your ComfyUI host address
# Replace <comfyui-host> with your machine's IP or hostname
```

Your `hypit.runtime.json` should look like:

```json
{
  "baseUrl": "http://192.168.1.100:8000"
}
```

> `hypit.runtime.json` is gitignored — your private config stays local.

## Step 3: Download MiniMax H3 model weights

Required weights on your ComfyUI machine:

| Weight | Location | Size |
| --- | --- | --- |
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `models/diffusion_models/` | ~20 GB |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `models/diffusion_models/` | ~20 GB |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `models/text_encoders/` | ~15 GB |
| `minimax_h3_video_vae_int8_convrot.safetensors` | `models/vae/` | ~2.7 GB |
| `minimax_h3_audio_vae_fp32.safetensors` | `models/vae/` | ~0.6 GB |
| `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | `models/loras/` | ~1.9 GB |

Download from [Comfy-Org/MiniMax-H3 on HuggingFace](https://huggingface.co/Comfy-Org/MiniMax-H3).

## Step 4: Install ComfyUI custom nodes

On your ComfyUI machine:

```bash
cd ComfyUI/custom_nodes

# Required
git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite

# For long-take chains (16-90s)
git clone https://github.com/jlucasmcrell/ComfyUI-H3-Multishot

# For watermark removal (optional)
git clone https://github.com/Acly/comfyui-inpaint-nodes
git clone https://github.com/daniabib/ComfyUI_ProPainter_Nodes
```

## Step 5: Verify connection

```bash
# Check ComfyUI is reachable
curl http://<comfyui-host>:8000/system_stats

# Verify provider activates
hypit doctor --endpoint comfyui.local
```

## Step 6: Run your first generation

```bash
hypit check tests/h3-test.svml
hypit build tests/h3-test.svrun --follow
```

## Optional tools

```bash
# Whisper transcription (for dialogue extraction)
brew install whisper-cpp
mkdir -p ~/.local/share/whisper
curl -L -o ~/.local/share/whisper/ggml-small.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
```

## Environment variables

| Variable | Purpose | Example |
| --- | --- | --- |
| `COMFYUI_HOST` | ComfyUI machine address (for sync scripts) | `192.168.1.100` |
| `SSH_KEY` | SSH private key path (for remote management) | `~/.ssh/id_rsa` |

Set them in your shell profile:

```bash
export COMFYUI_HOST="192.168.1.100"
export SSH_KEY="$HOME/.ssh/id_rsa"
```
