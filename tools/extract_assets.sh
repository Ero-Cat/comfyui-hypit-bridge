#!/bin/bash
# extract_assets.sh — 从（已净化的）视频提取生成素材：多角度参考帧 + 完整音轨。
# 参考帧取正面/多角度时段效果最佳（ComfyUI-H3-Multishot 文档建议）。
#
# 用法:
#   bash tools/extract_assets.sh <in.mp4> <outdir> [时刻列表，空格分隔，默认自动分散 5 张]
# 示例:
#   bash tools/extract_assets.sh clean.mp4 assets/person 2 14 26 38 48
set -euo pipefail

if [[ $# -lt 2 ]]; then
  grep '^#' "$0" | head -8
  exit 1
fi

IN=$1; OUTDIR=$2; shift 2
mkdir -p "$OUTDIR"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
echo "视频时长: ${DUR}s"

if [[ $# -gt 0 ]]; then
  TIMES=("$@")
else
  # 自动分散 5 帧：跳过首尾 5%，均匀取
  TIMES=($(python3 -c "
d = float('${DUR}')
lo, hi = d * 0.05, d * 0.95
print(' '.join(str(round(lo + (hi - lo) * i / 4, 1)) for i in range(5)))"))
fi

i=1
for t in "${TIMES[@]}"; do
  ffmpeg -y -v error -ss "$t" -i "$IN" -frames:v 1 "$OUTDIR/ref-$(printf '%02d' $i).png"
  echo "  ref-$(printf '%02d' $i).png @ ${t}s"
  i=$((i + 1))
done

ffmpeg -y -v error -i "$IN" -vn -ac 1 -ar 24000 "$OUTDIR/voice-full.wav"
echo "音轨: $OUTDIR/voice-full.wav（${DUR}s；生成前请用 tools/transcribe.sh 选段做声音锚）"
