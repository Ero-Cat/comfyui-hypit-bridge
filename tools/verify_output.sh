#!/bin/bash
# verify_output.sh — 成品视频全项验证：规格/时长/水印时序方差检测/静音节拍/转写核对。
#
# 用法:
#   bash tools/verify_output.sh <output.mp4> [--expect-script <新台词文本>]
# 示例:
#   bash tools/verify_output.sh out.mp4 --expect-script new-script.txt
set -euo pipefail

WHISPER=${WHISPER:-/opt/homebrew/opt/whisper.cpp/bin/whisper-cli}
MODEL=${MODEL:-$HOME/.local/share/whisper/ggml-small.bin}

if [[ $# -lt 1 ]]; then
  grep '^#' "$0" | head -7
  exit 1
fi

OUT=$1; shift
EXPECT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect-script) EXPECT=$2; shift 2 ;;
    *) shift ;;
  esac
done
TMP=$(mktemp -d)

echo "=== 规格 ==="
ffprobe -v error -show_entries format=duration -show_entries stream=codec_type,codec_name,width,height \
  -of default=noprint_wrappers=1 "$OUT"

echo "=== 水印检测（输出自身的静态叠加扫描） ==="
python3 "$PWD/tools/watermark_detect.py" "$OUT" | tee "$TMP/wm.json"
REGIONS=$(python3 -c "import json;print(len(json.load(open('$TMP/wm.json'))['regions']))")
if [[ "$REGIONS" == "0" ]]; then echo "✅ 无静态水印/字幕残留"; else echo "⚠️ 检出 ${REGIONS} 个静态区域（人工确认是否误报：静止背景也会命中）"; fi

echo "=== 静音节拍 ==="
SIL=$(ffmpeg -i "$OUT" -af silencedetect=noise=-32dB:d=0.6 -f null - 2>&1 | grep -c silence_start || true)
echo "停顿数: ${SIL}"

if [[ -n "$EXPECT" ]]; then
  echo "=== 转写核对（逐行命中预期台词） ==="
  ffmpeg -y -v error -i "$OUT" -vn -ar 16000 -ac 1 "$TMP/a16.wav"
  "$WHISPER" -m "$MODEL" -l zh --max-len 0 -osrt -of "$TMP/tr" "$TMP/a16.wav" > /dev/null 2>&1
  python3 - "$TMP/tr.srt" "$EXPECT" <<'PY'
import re, sys
srt = open(sys.argv[1], encoding='utf-8').read()
got = re.sub(r'\s+', '', ' '.join(re.findall(r'\d\d:\d\d:\d\d[,.]\d+\s*-->\s*\d\d:\d\d:\d\d[,.]\d+\n(.+?)(?:\n\n|\n*$)', srt, re.S)))
expect_lines = [l.strip() for l in open(sys.argv[2], encoding='utf-8') if l.strip() and not l.startswith('#')]
hit = miss = 0
for line in expect_lines:
    key = re.sub(r'[，。？！~、,.?! ]', '', line)
    if key and key in got:
        hit += 1
    else:
        miss += 1
        print(f"  ✗ 未命中: {line}")
print(f"命中 {hit}/{hit + miss} 行")
PY
fi
rm -rf "$TMP"
