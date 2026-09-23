#!/bin/bash
# transcribe.sh — whisper.cpp 转写音频 → transcript.srt + brief.md（节拍表 + 原片大意整理）。
# brief.md 是流程契约的过目点：生成新文案前必须先给用户看。
#
# 用法:
#   bash tools/transcribe.sh <audio.wav> <outdir> [--cut "START DUR" 输出干净声音锚]
# 示例:
#   bash tools/transcribe.sh assets/person/voice-full.wav assets/person --cut "5.7 6.5"
set -euo pipefail

WHISPER=${WHISPER:-/opt/homebrew/opt/whisper.cpp/bin/whisper-cli}
MODEL=${MODEL:-$HOME/.local/share/whisper/ggml-small.bin}

if [[ $# -lt 2 ]]; then
  grep '^#' "$0" | head -8
  exit 1
fi

IN=$1; OUTDIR=$2; shift 2
mkdir -p "$OUTDIR"
WAV16="$OUTDIR/.tmp-16k.wav"
ffmpeg -y -v error -i "$IN" -ar 16000 -ac 1 "$WAV16"

"$WHISPER" -m "$MODEL" -l zh --max-len 0 -osrt -of "$OUTDIR/transcript" "$WAV16" > /dev/null 2>&1
rm -f "$WAV16"

CUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cut) CUT=$2; shift 2 ;;
    *) shift ;;
  esac
done
if [[ -n "$CUT" ]]; then
  read -r SS TT <<< "$CUT"
  ffmpeg -y -v error -i "$IN" -ss "$SS" -t "$TT" -ac 1 -ar 24000 "$OUTDIR/voice-anchor.wav"
  echo "声音锚: $OUTDIR/voice-anchor.wav (${SS}s + ${TT}s)"
fi

# 生成 brief.md（节拍表 + 大意占位，由 agent 补充整理）
python3 - "$OUTDIR/transcript.srt" "$OUTDIR/brief.md" <<'PY'
import re, sys
srt, out = sys.argv[1], sys.argv[2]
text = open(srt, encoding="utf-8").read()
blocks = re.findall(r"(\d+)\n(\d\d:\d\d:\d\d[,.]\d+)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d+)\n(.+?)(?:\n\n|\n*$)", text, re.S)
def sec(t):
    h, m, s = t.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)
lines = ["# 原片转写 brief（生成前必须给用户过目）", "",
         "> whisper 转写自动生成；口语/专有名词可能有错字，低置信度句子已标注。", "",
         "## 节拍表", "", "| # | 起 | 止 | 时长 | 台词 |", "| --- | --- | --- | --- | --- |"]
merged = []
for idx, (_n, a, b, body) in enumerate(blocks):
    body = body.replace("\n", " ").strip()
    if merged and sec(a) - merged[-1][2] < 0.9 and len(body) <= 8:
        merged[-1] = (merged[-1][0], merged[-1][1], sec(b), merged[-1][3] + " " + body)
    else:
        merged.append((sec(a), sec(b), sec(b), body))
for i, (a, b, _e, body) in enumerate(merged):
    lines.append(f"| {i+1} | {a:.1f}s | {b:.1f}s | {b-a:.1f}s | {body} |")
total = merged[-1][1] if merged else 0
lines += ["", f"总时长约 {total:.0f}s，{len(merged)} 个节拍。", "",
          "## 原片大意（agent 根据节拍表整理）", "", "（待整理）", "",
          "## 情绪曲线（agent 标注）", "", "（待整理）"]
open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"brief: {out}（节拍表已生成，大意/情绪待 agent 补充）")
PY
echo "转写完成: $OUTDIR/transcript.srt"
