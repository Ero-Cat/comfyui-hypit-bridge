#!/bin/bash
# sync_workflows.sh — ComfyUI 工作流双向同步（本地主 + 拉回远端）
set -euo pipefail
SSH="ssh -i ${SSH_KEY:-$HOME/.ssh/id_rsa} -o ConnectTimeout=10 ${SSH_USER:-deploy}@${COMFYUI_HOST:?Set COMFYUI_HOST}"
SCP="scp -i ${SSH_KEY:-$HOME/.ssh/id_rsa} -o ConnectTimeout=10"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/workflows"
mkdir -p "$LOCAL_DIR"

case "${1:-status}" in
  push)
    echo "=== Push: local → 5090 ==="
    for f in "$LOCAL_DIR"/*.json; do
      [[ -f "$f" ]] || continue
      $SCP "$f" "${SSH_USER:-deploy}@${COMFYUI_HOST:?Set COMFYUI_HOST}:G:/AI/ComfyUI/user/default/workflows/$(basename "$f")"
      echo "  ✓ $(basename "$f")"
    done
    ;;
  pull)
    echo "=== Pull: 5090 → local ==="
    $SCP "${SSH_USER:-deploy}@${COMFYUI_HOST:?Set COMFYUI_HOST}:G:/AI/ComfyUI/user/default/workflows/*.json" "$LOCAL_DIR/" 2>/dev/null || true
    # scp glob may fail on Windows; fallback to individual files
    if ! ls "$LOCAL_DIR"/*.json >/dev/null 2>&1; then
      for name in $($SSH "dir /b G:\\AI\\ComfyUI\\user\\default\\workflows\\*.json 2>NUL"); do
        $SCP "${SSH_USER:-deploy}@${COMFYUI_HOST:?Set COMFYUI_HOST}:G:/AI/ComfyUI/user/default/workflows/$name" "$LOCAL_DIR/" && echo "  + $name"
      done
    fi
    ls -1 "$LOCAL_DIR"/*.json 2>/dev/null | xargs -I{} basename {} | head -20
    ;;
  status)
    echo "=== Local ($(ls "$LOCAL_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ') files) ==="
    ls -1 "$LOCAL_DIR"/*.json 2>/dev/null | xargs -I{} basename {} | sort
    echo ""
    echo "=== Remote ==="
    $SSH "dir /b G:\\AI\\ComfyUI\\user\\default\\workflows\\*.json 2>NUL" | sort
    ;;
esac
