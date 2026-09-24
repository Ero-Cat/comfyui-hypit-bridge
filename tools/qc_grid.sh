#!/bin/bash
# qc_grid.sh — 超分前后对比 QC 网格：按节拍时刻抽帧，原片（lanczos 基线）与超分片左右并排，
# 再 tile 成一张网格 PNG 供人工目检（闪烁/锐度/风格漂移/画幅）。
#
# 用法:
#   bash tools/qc_grid.sh <source.mp4> <upscaled.mp4> [beats] [-o out.png] [--zoom 2]
#   beats: 逗号分隔秒数，默认取 6 个均匀节拍；--zoom 为局部放大倍数（对比细节用，默认 2）
# 示例:
#   bash tools/qc_grid.sh out/tonghuashun-16s-final.mp4 out/upscaled.mp4 2.5,6,9.5 -o out/qc-upscale.png
set -euo pipefail

if [[ $# -lt 2 ]]; then
  grep '^#' "$0" | head -7
  exit 1
fi
SRC=$1; UP=$2; shift 2
BEATS=""
OUT=""
ZOOM=2
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) OUT=$2; shift 2 ;;
    --zoom) ZOOM=$2; shift 2 ;;
    *) BEATS=$1; shift ;;
  esac
done
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
UPW=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$UP")
UPH=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$UP")
if [[ -z "$BEATS" ]]; then
  BEATS=$(python3 -c "d=$DUR; print(','.join(f'{d*i/7:.2f}' for i in range(1,7)))")
fi
[[ -n "$OUT" ]] || OUT="qc-grid-upscale.png"
TMP=$(mktemp -d)
IFS=',' read -ra BT <<< "$BEATS"

# 每个节拍：源帧 lanczos 放大到超分尺寸（公平基线）与超分帧并排，中央 1/ZOOM 区域再放大一格
i=0
for t in "${BT[@]}"; do
  ffmpeg -y -v error -ss "$t" -i "$SRC" -frames:v 1 -vf "scale=${UPW}:${UPH}:flags=lanczos" "$TMP/s$i.png"
  ffmpeg -y -v error -ss "$t" -i "$UP" -frames:v 1 "$TMP/u$i.png"
  # 中央裁 1/ZOOM 区域用邻近插值放大回整帧尺寸做"放大镜"细节条
  ffmpeg -y -v error -i "$TMP/s$i.png" -vf "crop=w=${UPW}/$ZOOM:h=${UPH}/$ZOOM:x=(iw-ow)/2:y=(ih-oh)/2,scale=${UPW}:${UPH}:flags=neighbor" "$TMP/sz$i.png"
  ffmpeg -y -v error -i "$TMP/u$i.png" -vf "crop=w=${UPW}/$ZOOM:h=${UPH}/$ZOOM:x=(iw-ow)/2:y=(ih-oh)/2,scale=${UPW}:${UPH}:flags=neighbor" "$TMP/uz$i.png"
  i=$((i+1))
done

# 每行 = [基线|超分]（上） + [基线放大镜|超分放大镜]（下），两行同宽，纵向 tile 全部节拍
for ((j=0; j<i; j++)); do
  ffmpeg -y -v error -i "$TMP/s$j.png" -i "$TMP/u$j.png" -i "$TMP/sz$j.png" -i "$TMP/uz$j.png" \
    -filter_complex "[0][1]hstack[top];[2][3]hstack[mid];[top][mid]vstack" "$TMP/row$j.png"
done
inputs=""; filter=""
for ((k=0; k<i; k++)); do inputs+=" -i $TMP/row$k.png"; filter+="[$k:v]"; done
ffmpeg -y -v error $inputs -filter_complex "${filter}vstack=inputs=$i" "$OUT"
echo "QC 网格: ${OUT}（左=原片lanczos基线 右=超分；下行=中央1/${ZOOM}放大）  节拍: ${BEATS}s"
rm -rf "$TMP"
