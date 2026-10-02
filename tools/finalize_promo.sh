#!/usr/bin/env bash
# promote-goods 成片后期：烧中文字幕（抖音风大字，9:16 底部安全区）+ 可选 BGM 低量混音 + 响度归一。
#
# 本机 ffmpeg 8.1 为精简构建（无 ass/subtitles/drawtext 滤镜）——字幕用
# PIL 逐句渲染透明 PNG + ffmpeg overlay(enable=between) 烧制，效果等价。
# 字幕文本来自我们自己的脚本（expected-script.txt），彻底规避模型生成乱码字幕；
# 768P(736×1280) 与 1080P(1080×1920) 输入自适应字号。
#
# 用法:
#   bash tools/finalize_promo.sh <in.mp4> <script.txt> [out.mp4] [--bgm <bgm.mp3>] [--bgm-gain 0.16]
#
# script.txt：一行一句台词（# 开头为注释行，跳过）；每句时长按字数权重在视频时长内分配。
set -euo pipefail

IN="${1:?用法: finalize_promo.sh <in.mp4> <script.txt> [out.mp4] [--bgm file] [--bgm-gain 0.16]}"
SCRIPT_TXT="${2:?缺 script.txt}"
shift 2
OUT=""
BGM=""; BGM_GAIN="0.8"   # pre-duck 增益；人声闪避由 sidechaincompress 处理
if [[ $# -gt 0 && ! "$1" =~ ^-- ]]; then OUT="$1"; shift; fi
[[ -z "$OUT" ]] && OUT="${IN%.mp4}-final.mp4"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bgm) BGM="$2"; shift 2 ;;
    --bgm-gain) BGM_GAIN="$2"; shift 2 ;;
    *) echo "未知参数 $1"; exit 2 ;;
  esac
done

command -v ffmpeg >/dev/null || { echo "需要 ffmpeg"; exit 2; }
PY=${PYTHON:-python3}

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$IN")
W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$IN")
echo "[finalize] 输入 ${W}x${H} ${DUR}s"

WORK="$(mktemp -d /tmp/promo_final.XXXXXX)"

# Python 一段完成：每句按字数权重分配时间 → PIL 渲染透明字幕 PNG（白字黑边轻阴影）
# → 写出 ffmpeg 输入清单与 overlay 滤镜链
"$PY" - "$SCRIPT_TXT" "$DUR" "$W" "$H" "$WORK" <<'PYEOF'
import sys
from PIL import Image, ImageDraw, ImageFont

script_txt, dur, W, H, work = (sys.argv[1], float(sys.argv[2]),
                               int(sys.argv[3]), int(sys.argv[4]), sys.argv[5])
lines = [l.strip() for l in open(script_txt, encoding="utf-8")
         if l.strip() and not l.strip().startswith("#")]
if not lines:
    raise SystemExit("script.txt 无台词行")

if H >= 1900:   fs, bottom, stroke = 76, 210, 6
elif H >= 1200: fs, bottom, stroke = 52, 150, 4
else:           fs, bottom, stroke = 44, 120, 3

font_path = "/System/Library/Fonts/PingFang.ttc"
def load(sz):
    try:
        return ImageFont.truetype(font_path, sz, index=0)
    except Exception:
        return ImageFont.truetype("/System/Library/Fonts/STHeiti Light.ttc", sz)

weights = [max(len(l), 4) for l in lines]
total = sum(weights)
seg, t = [], 0.0
for w in weights:
    s, e = t, min(t + dur * w / total, dur - 0.05)
    t += dur * w / total
    seg.append((s, e))

inputs = []
n = len(lines)
for i, line in enumerate(lines):
    font = load(fs)
    tmp = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    bbox = tmp.textbbox((0, 0), line, font=font, stroke_width=stroke)
    tw = bbox[2] - bbox[0]
    if tw > W - 80:  # 超宽句自动缩字号
        font = load(max(int(fs * (W - 80) / tw), 24))
        bbox = tmp.textbbox((0, 0), line, font=font, stroke_width=stroke)
        tw = bbox[2] - bbox[0]
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = (W - tw) // 2 - bbox[0]
    y = H - bottom - fs - 6
    d.text((x + 2, y + 3), line, font=font, fill=(0, 0, 0, 110),
           stroke_width=stroke, stroke_fill=(0, 0, 0, 110))
    d.text((x, y), line, font=font, fill=(255, 255, 255, 255),
           stroke_width=stroke, stroke_fill=(0, 0, 0, 255))
    img.save(f"{work}/sub-{i:02d}.png")
    inputs.append(f"-i {work}/sub-{i:02d}.png")

chains = [f"[{1 + i}:v]format=rgba[s{i}]" for i in range(n)]
prev = "0:v"
for i in range(n):
    chains.append(f"[{prev}][s{i}]overlay=0:0:"
                  f"enable='between(t,{seg[i][0]:.2f},{seg[i][1]:.2f})'"
                  f"[{'vout' if i == n - 1 else f'o{i}'}]")
    prev = f"o{i}"
chains.append("[vout]format=yuv420p[v]")

open(f"{work}/inputs.txt", "w").write(" ".join(inputs))
open(f"{work}/video_chain.txt", "w").write(";\n".join(chains))
print(f"字幕 {n} 句: " + " ".join(f"{s:.1f}-{e:.1f}s" for s, e in seg))
PYEOF

VCHAIN=$(cat "$WORK/video_chain.txt")
INPUTS=$(cat "$WORK/inputs.txt")

if [[ -n "$BGM" ]]; then
  echo "[finalize] 烧字幕 → BGM 人声闪避混音（pre-duck gain=${BGM_GAIN}）+ 响度归一"
  echo "[finalize] ⚠ 曲库为 CC-BY：发布文案需署名 Music: <曲名> - Kevin MacLeod (incompetech.com), CC BY 4.0"
  TMPV="$WORK/subbed.mp4"
  # shellcheck disable=SC2086
  ffmpeg -y -v error -i "$IN" $INPUTS -filter_complex "$VCHAIN" \
    -map "[v]" -map 0:a -c:v libx264 -crf 18 -preset medium -c:a copy "$TMPV"
  # 人声作 sidechain 压 BGM：说话时乐自动让位，停顿处乐回填
  ffmpeg -y -v error -i "$TMPV" -stream_loop -1 -i "$BGM" \
    -filter_complex "[0:a]asplit=2[voice][sc];[1:a]volume=${BGM_GAIN},afade=t=in:st=0:d=0.8[bgm];[bgm][sc]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=450[duck];[voice][duck]amix=inputs=2:duration=first:dropout_transition=3,loudnorm=I=-14:TP=-1.5[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -t "$DUR" -movflags +faststart "$OUT"
else
  # shellcheck disable=SC2086
  ffmpeg -y -v error -i "$IN" $INPUTS -filter_complex "$VCHAIN" \
    -map "[v]" -map "0:a" -c:v libx264 -crf 18 -preset medium \
    -af "loudnorm=I=-14:TP=-1.5" -c:a aac -b:a 160k -movflags +faststart "$OUT"
fi
rm -rf "$WORK"
echo "[finalize] 完成 → $OUT"
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT"
