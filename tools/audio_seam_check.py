#!/usr/bin/env python3
# audio_seam_check.py — H3 成片音频体检：接缝三指标 + 全片发声密度审计。
#
# 背景（babble 事故 2026-09-26）：链式音频按窗生成再拼接，接缝质量与"模型自行编语音填空"
# （台词未用 <d> 官方格式标记时）都必须客观测量，不能只靠人耳。
#
# 用法:
#   python3 tools/audio_seam_check.py <video.mp4> [--seam 8.0 ...] [--budget 4.5]
#     --seam   秒；链式窗口接缝位置（窗数-1 个，等窗时长= duration/窗数）。可重复传多个。
#     --budget 脚本台词的预期语音秒数（字数×节奏），用于"模型加词"审计；省略则只报实测值。
# 输出 JSON + 人读摘要。纯标准库（ffmpeg 抽 24k 单声道 wav 后 wave/struct 分析）。
#
# 判定标准（与 h3-av-contract skill 同源）：
#   click   : 接缝 ±200 采样点 max|diff| ≤ 全片 99.99 分位 ×1.5 → 无爆音
#   level   : 接缝两侧 0.5s RMS 差 <1.5dB（或接缝落在静默=两侧任一 <全片峰值3% → 最佳）
#   voice   : 两侧 3.5s 窗口基频中位数差 <5% → 同一把嗓子
#   density : 实测有声秒数 vs 预算（--budget 时；超出 +3s 视为模型加词，需人耳复核）

import argparse
import json
import math
import struct
import subprocess
import sys
import tempfile
import wave


def extract_wav(video: str) -> str:
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", video, "-ac", "1", "-ar", "24000", tmp.name],
        check=True,
    )
    return tmp.name


def load(path: str):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    return struct.unpack("<%dh" % (len(raw) // 2), raw), sr


def rms(samples, a: int, b: int) -> float:
    seg = samples[a:b]
    return math.sqrt(sum(x * x for x in seg) / max(1, len(seg)))


def median_f0(samples, sr: int, a: int, b: int) -> float:
    """40ms 帧自相关基频中位数；只统计能量足的浊音帧（sr=24000）。"""
    frames = []
    step = int(0.01 * sr)
    fl = int(0.04 * sr)
    seg_rms = rms(samples, a, b)
    gate = seg_rms * seg_rms * fl * 1.5
    lo, hi = int(sr / 400), int(sr / 70)
    for i in range(a, b - fl, step):
        fr = samples[i:i + fl]
        if sum(x * x for x in fr) < gate:
            continue
        best, lag_best = 0.0, 0
        for lag in range(lo, hi):
            c = sum(fr[j] * fr[j + lag] for j in range(0, fl - lag, 2))
            if c > best:
                best, lag_best = c, lag
        if lag_best:
            frames.append(sr / lag_best)
    if not frames:
        return 0.0
    frames.sort()
    return frames[len(frames) // 2]


def seam_report(s, sr: int, seam: float, global_p9999: int, peak_rms: float) -> dict:
    si = int(seam * sr)
    lo, hi = max(0, si - 200), min(len(s) - 1, si + 200)
    jump = max(abs(s[i + 1] - s[i]) for i in range(lo, hi)) if hi > lo else 0
    click = jump <= global_p9999 * 1.5
    pre, post = rms(s, si - int(0.5 * sr), si), rms(s, si, si + int(0.5 * sr))
    level_db = 20 * math.log10(max(post, 1e-9) / max(pre, 1e-9))
    # 瞬时静默：接缝 ±25ms 落在停顿里（拼接最不可闻的位置）；0.5s 窗含语音头尾时，
    # level step 大也只说明"接缝在静默间隙中"，不是硬拼。
    inst = rms(s, si - int(0.025 * sr), si + int(0.025 * sr))
    instant_silence = inst < peak_rms * 0.03
    f0_pre = median_f0(s, sr, max(0, si - int(3.5 * sr)), max(0, si - int(0.5 * sr)))
    f0_post = median_f0(s, sr, min(len(s), si + int(0.5 * sr)), min(len(s), si + int(3.5 * sr)))
    pitch_pct = abs(f0_post - f0_pre) / f0_pre * 100 if f0_pre and f0_post else None
    same_voice = pitch_pct is not None and pitch_pct < 5
    return {
        "seam_s": seam,
        "max_diff_at_seam": jump,
        "global_p9999_diff": global_p9999,
        "click": click,
        "rms_pre_0p5s": round(pre, 1),
        "rms_post_0p5s": round(post, 1),
        "level_step_db": round(level_db, 2),
        "instant_rms": round(inst, 1),
        "seam_in_silence": instant_silence,
        "f0_pre_hz": round(f0_pre, 1),
        "f0_post_hz": round(f0_post, 1),
        "pitch_diff_pct": round(pitch_pct, 2) if pitch_pct is not None else None,
        "same_voice": same_voice,
        "verdict": "PASS" if click and (instant_silence or abs(level_db) < 1.5) and same_voice else "CHECK",
    }


def density_report(s, sr: int, budget: float | None) -> dict:
    win = int(0.25 * sr)
    bins = [rms(s, i, i + win) for i in range(0, len(s) - win, win)]
    peak = max(bins)
    voiced = sum(1 for r in bins if r > peak * 0.18) * 0.25
    quiet = sum(1 for r in bins if peak * 0.03 < r <= peak * 0.18) * 0.25
    out = {
        "voiced_seconds": round(voiced, 2),
        "quiet_seconds": round(quiet, 2),
        "total_seconds": round(len(s) / sr, 2),
    }
    if budget is not None:
        out["budget_seconds"] = budget
        out["model_added_speech"] = voiced > budget + 3.0
        out["note"] = "实测有声远超脚本预算 → 模型自行加词（babble 风险同源），需人耳复核" if out["model_added_speech"] else "实测与预算相符"
    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--seam", type=float, action="append", default=[])
    p.add_argument("--budget", type=float, default=None)
    args = p.parse_args()

    wav = extract_wav(args.video)
    s, sr = load(wav)
    diffs = sorted(abs(s[i + 1] - s[i]) for i in range(0, len(s) - 1, 7))
    p9999 = diffs[int(len(diffs) * 0.9999)]
    win = int(0.25 * sr)
    peak = max(rms(s, i, i + win) for i in range(0, len(s) - win, win))

    report = {
        "video": args.video,
        "duration_s": round(len(s) / sr, 3),
        "seams": [seam_report(s, sr, x, p9999, peak) for x in args.seam],
        "density": density_report(s, sr, args.budget),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    bad = [x for x in report["seams"] if x["verdict"] != "PASS"]
    for x in report["seams"]:
        print(
            f"seam @{x['seam_s']}s: click={'OK' if x['click'] else 'FAIL'} "
            f"level={x['level_step_db']:+.2f}dB{' (in silence)' if x['seam_in_silence'] else ''} "
            f"f0={x['f0_pre_hz']}→{x['f0_post_hz']}Hz ({x['pitch_diff_pct']}%) "
            f"→ {x['verdict']}"
        )
    print(
        f"voiced {report['density']['voiced_seconds']}s / {report['density']['total_seconds']}s"
        + (f" vs budget {args.budget}s → {'MODEL ADDED SPEECH' if report['density'].get('model_added_speech') else 'within budget'}" if args.budget is not None else "")
    )
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
