#!/usr/bin/env python3
"""watermark_detect.py — 定位视频中的静态水印/字幕叠加块。

原理：静态叠加（水印/logo/字幕）在画面变化时保持不变 → 对多帧采样计算每像素的
时间标准差，低方差且与局部背景有亮度反差的连通块即候选水印。

零第三方依赖（ffmpeg + python stdlib）。输出 bbox JSON 到 stdout，供 clean_watermark.sh 使用。

用法:
  python3 tools/watermark_detect.py <video> [--corners all|br|tr|bl|tl] [--frames 9] [--interval 6]
示例:
  python3 tools/watermark_detect.py source.mp4 > watermark.json
"""
import argparse
import json
import statistics
import subprocess
import sys


def probe_size(video: str) -> tuple[int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", video],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split(",")[:2]
    return int(w), int(h)


def sample_frames(video: str, interval: int, count: int) -> list[bytes]:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", video,
         "-vf", f"fps=1/{interval},format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=True).stdout
    w, h = probe_size(video)
    frame_len = w * h
    return [raw[i * frame_len:(i + 1) * frame_len]
            for i in range(len(raw) // frame_len)][:max(4, min(count, 8))]


def detect(video: str, corners: str, interval: int, count: int) -> dict:
    w, h = probe_size(video)
    frames = sample_frames(video, interval, count)
    frame_len = w * h
    frames = [f for f in frames if len(f) >= frame_len][:8]
    if len(frames) < 4:
        raise SystemExit("需要至少 4 帧采样，请降低 --interval 或检查视频")

    quadrants = {
        "tr": (w * 2 // 3, w, 0, h // 5),
        "tl": (0, w // 3, 0, h // 5),
        "br": (w * 2 // 3, w, h * 4 // 5, h),
        "bl": (0, w // 3, h * 4 // 5, h),
    }
    result = {"video": video, "width": w, "height": h, "regions": []}
    for name, (x0, x1, y0, y1) in quadrants.items():
        if corners != "all" and corners != name:
            continue
        hits: list[tuple[int, int]] = []
        for y in range(y0, y1, 4):
            for x in range(x0, x1, 4):
                vals = [f[y * w + x] for f in frames]
                if statistics.pstdev(vals) < 6:  # static over changing video
                    hits.append((x, y))
        if len(hits) >= 12:  # 面积阈值：过滤背景本来就静止的零星点
            xs = [p[0] for p in hits]
            ys = [p[1] for p in hits]
            result["regions"].append({
                "corner": name,
                "x": max(0, min(xs) - 6), "y": max(0, min(ys) - 6),
                "w": (max(xs) - min(xs)) + 12, "h": (max(ys) - min(ys)) + 12,
                "static_pixels": len(hits),
            })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video")
    parser.add_argument("--corners", default="all", choices=["all", "br", "tr", "bl", "tl"])
    parser.add_argument("--frames", type=int, default=9, help="采样帧数（上限 8）")
    parser.add_argument("--interval", type=int, default=6, help="采样间隔秒")
    args = parser.parse_args()
    result = detect(args.video, args.corners, args.interval, args.frames)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
