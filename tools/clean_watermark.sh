#!/bin/bash
# clean_watermark.sh — 用 ffmpeg delogo 修补水印区域（区域插值，保留完整画面与比例）。
# 快速路径：适合"重新生成"场景的素材净化。保留原片像素的高质量独立工作流见
# tools/remove_watermark_comfyui.md。
#
# 用法:
#   bash tools/clean_watermark.sh <in.mp4> <out.mp4> <x> <y> <w> <h> [更多 delogo 区域...]
#   bash tools/clean_watermark.sh <in.mp4> <out.mp4> --json watermark.json   # 配合 watermark_detect.py
# 示例:
#   python3 tools/watermark_detect.py src.mp4 > wm.json
#   bash tools/clean_watermark.sh src.mp4 clean.mp4 --json wm.json
set -euo pipefail

if [[ $# -lt 3 ]]; then
  grep '^#' "$0" | head -12
  exit 1
fi

IN=$1; OUT=$2; shift 2
FILTERS=()

if [[ "$1" == "--json" ]]; then
  JSON=$2
  # 从 detect 输出提取所有区域，逐个拼 delogo 滤镜
  while IFS=' ' read -r x y w h; do
    FILTERS+=("delogo=x=${x}:y=${y}:w=${w}:h=${h}")
  done < <(python3 - "$JSON" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for r in data.get("regions", []):
    print(r["x"], r["y"], r["w"], r["h"])
PY
)
  shift 2
else
  while [[ $# -ge 4 ]]; do
    FILTERS+=("delogo=x=${1}:y=${2}:w=${3}:h=${4}")
    shift 4
  done
fi

if [[ ${#FILTERS[@]} -eq 0 ]]; then
  echo "没有可处理的区域（检测输出为空或参数缺失）" >&2
  exit 1
fi

JOIN=$(IFS=','; echo "${FILTERS[*]}")
echo "delogo 滤镜: ${JOIN}"
ffmpeg -y -v error -i "$IN" -vf "$JOIN" -c:v libx264 -crf 18 -preset medium -c:a copy "$OUT"
echo "净化完成: ${OUT}"
