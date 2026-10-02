#!/usr/bin/env python3
"""promote-goods 商品详情页通用采集器。

用法（仓库根执行，用 venv 解释器）:
  .venv/bin/python3 tools/scrape_product.py <商品页URL> [--out-dir DIR] [--id ID]
      [--max-images 20] [--max-video-mb 200] [--headful] [--timeout 45]

输出（写入 --out-dir，默认 productions/promote-goods/goods/<id>/）:
  product.json   结构化结果：标题/品牌/文案块/图片/视频/整页截图/警告
  assets/raw/    下载的原图与商品视频
  screenshot.png 整页截图（供人工策展）

提取策略（SPA 电商页兜底优先级从高到低）:
  1. 网络嗅探：记录页面加载期间所有 image/* 与 video/*（及 .mp4/.webm URL）响应——
     对 JS 渲染页（如 jinritemai）最可靠；同时挖 XHR JSON 里的商品字段。
  2. JSON-LD (schema.org Product)。
  3. OG/meta 标签。
  4. DOM 启发式：主内容区大图、video 标签源。

注意：price 字段仅存档备查（佣金实时变动），下游提示词/字幕严禁引用。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")

MEDIA_KEYS = re.compile(r"(title|name|desc|content|detail|spec|brand|category|shop|label)", re.I)
MEDIA_URL_IN_JSON = re.compile(r"https?://[^\s\"'\\]+\.(?:jpg|jpeg|png|webp|mp4|webm)", re.I)


def log(msg: str) -> None:
    print(f"[scrape] {msg}", flush=True)


def guess_id(url: str) -> str:
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    for k in ("id", "productId", "product_id", "itemId", "item_id"):
        if k in q and q[k][0]:
            return q[k][0][:24]
    host = urllib.parse.urlparse(url).netloc.replace(".", "-")
    return f"{host}-{hashlib.md5(url.encode()).hexdigest()[:8]}"


def harvest_json(node, found: dict, depth: int = 0) -> None:
    """递归挖 JSON 响应里的商品字段与媒体 URL。"""
    if depth > 8:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str):
                if re.search(r"(video|video_url|videoUrl)$", k, re.I) and "http" in v:
                    found.setdefault("videos", set()).add(v)
                elif re.search(r"image|img|pic|cover|thumb", k, re.I) and v.startswith("http"):
                    found.setdefault("images", set()).add(v)
                elif MEDIA_KEYS.search(k):
                    s = v.strip()
                    if 4 <= len(s) <= 4000 and not s.startswith("http"):
                        found.setdefault("copy", set()).add(s)
            harvest_json(v, found, depth + 1)
    elif isinstance(node, list):
        for v in node:
            harvest_json(v, found, depth + 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--out-dir")
    ap.add_argument("--id")
    ap.add_argument("--max-images", type=int, default=20)
    ap.add_argument("--max-video-mb", type=int, default=200)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--timeout", type=int, default=45)
    args = ap.parse_args()

    gid = args.id or guess_id(args.url)
    out_dir = Path(args.out_dir) if args.out_dir else Path("productions/promote-goods/goods") / gid
    raw_dir = out_dir / "assets" / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    product: dict = {
        "id": gid,
        "url": args.url,
        "scraped_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "title": None,
        "brand": None,
        "description": None,
        "copy_blocks": [],
        "price_ref_only": None,  # 仅存档；严禁进入提示词/字幕（佣金实时变动）
        "images": [],
        "videos": [],
        "screenshot": str(out_dir / "screenshot.png"),
        "warnings": [],
    }
    sniff_images: dict[str, str] = {}   # url -> content_type
    sniff_videos: dict[str, str] = {}
    json_found: dict[str, set] = {}

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("需要 playwright：.venv/bin/pip install playwright && .venv/bin/playwright install chromium", file=sys.stderr)
        return 2

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headful)
        ctx = browser.new_context(user_agent=UA, viewport={"width": 1280, "height": 900},
                                  locale="zh-CN", timezone_id="Asia/Shanghai")
        page = ctx.new_page()

        def on_response(resp):
            try:
                ct = resp.headers.get("content-type", "")
                url = resp.url.split("#")[0]
                if re.search(r"\.(mp4|webm)(\?|$)", url, re.I) or ct.startswith("video/"):
                    if "blob:" not in url:
                        sniff_videos.setdefault(url, ct)
                elif ct.startswith("image/") or re.search(r"\.(jpe?g|png|webp)(\?|$)", url, re.I):
                    sniff_images.setdefault(url, ct)
                elif "json" in ct:
                    try:
                        harvest_json(resp.json(), json_found)
                    except Exception:
                        pass
            except Exception:
                pass

        page.on("response", on_response)
        log(f"打开 {args.url}")
        page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            product["warnings"].append("networkidle 超时（SPA 常见，继续）")

        # 滚动触发懒加载
        for i in range(6):
            page.evaluate(f"window.scrollTo(0, document.body.scrollHeight * {(i + 1) / 6})")
            page.wait_for_timeout(700)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(800)

        html = page.content()

        # ---- JSON-LD ----
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(tag.string or "")
            except Exception:
                continue
            items = data if isinstance(data, list) else [data]
            for it in items:
                if not isinstance(it, dict):
                    continue
                t = (it.get("@type") or "")
                if "Product" in t or "product" in str(t):
                    product["title"] = product["title"] or it.get("name")
                    product["description"] = product["description"] or it.get("description")
                    brand = it.get("brand")
                    if isinstance(brand, dict):
                        product["brand"] = product["brand"] or brand.get("name")
                    for img in (it.get("image") or []):
                        if isinstance(img, str):
                            sniff_images.setdefault(img, "jsonld")
                    offers = it.get("offers")
                    if isinstance(offers, dict) and offers.get("price"):
                        product["price_ref_only"] = offers.get("price")

        # ---- OG / meta ----
        def meta(prop):
            el = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
            return el.get("content") if el and el.get("content") else None

        product["title"] = product["title"] or meta("og:title") or (soup.h1.get_text(strip=True) if soup.h1 else None)
        product["description"] = product["description"] or meta("og:description") or meta("description")
        if meta("og:image"):
            sniff_images.setdefault(meta("og:image"), "og")
        if meta("og:video"):
            sniff_videos.setdefault(meta("og:video"), "og")

        # ---- DOM 启发式：主内容大图 ----
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src") or img.get("data-original") or ""
            if not src or src.startswith("data:"):
                continue
            alt = (img.get("alt") or "").strip()
            parent_cls = " ".join(img.parent.get("class", [])) if img.parent else ""
            # 主图/轮播/详情里的图优先；图标类 class 排除
            if re.search(r"icon|logo|avatar|sprite|emoji", src + parent_cls, re.I):
                continue
            sniff_images.setdefault(urllib.parse.urljoin(args.url, src), "dom" + (f"|{alt[:20]}" if alt else ""))

        # ---- DOM video 标签 ----
        for v in soup.find_all("video"):
            for s in ([v.get("src")] if v.get("src") else []) + [x.get("src") for x in v.find_all("source")]:
                if s and s.startswith("http"):
                    sniff_videos.setdefault(s, "dom-video")

        # ---- XHR JSON 挖掘结果并入 ----
        for u in json_found.get("images", set()):
            sniff_images.setdefault(u, "xhr-json")
        for u in json_found.get("videos", set()):
            sniff_videos.setdefault(u, "xhr-json")
        for s in json_found.get("copy", set()):
            if len(s) >= 6:
                product["copy_blocks"].append(s)
        # title 兜底：XHR 里最长的短字符串（<=120字）
        if not product["title"]:
            cands = sorted(product["copy_blocks"], key=len, reverse=True)
            for c in cands:
                if 6 <= len(c) <= 120 and not re.search(r"[\d.]+元|¥|价格", c):
                    product["title"] = c
                    break

        # 过滤：图标尺寸常见 100px 以下；排除明显 UI 图（checkbox/占位）
        def img_rank(item):
            url, src = item
            score = 0
            if src == "jsonld":
                score += 5
            elif src == "og":
                score += 4
            elif src == "xhr-json":
                score += 3
            elif src.startswith("dom|"):
                score += 2
            if re.search(r"(main|gallery|carousel|swiper|detail|sku|pic)", url, re.I):
                score += 2
            return -score

        img_items = sorted(sniff_images.items(), key=img_rank)
        # 去重（同图不同参数）+ 去疑似装饰图
        seen_h = set()
        chosen = []
        for url, src in img_items:
            h = hashlib.md5(re.sub(r"[?#].*$", "", url).encode()).hexdigest()
            if h in seen_h:
                continue
            seen_h.add(h)
            chosen.append((url, src))
            if len(chosen) >= args.max_images:
                break

        # ---- 下载 ----
        log(f"待下载图片 {len(chosen)} / 嗅探 {len(sniff_images)}")
        for i, (url, src) in enumerate(chosen, 1):
            try:
                resp = ctx.request.get(url, headers={"Referer": args.url}, timeout=30000)
                body = resp.body()
                if len(body) < 8000:  # <8KB 大概率是图标/占位
                    continue
                ctype = resp.headers.get("content-type", "").split(";")[0]
                ext = mimetypes.guess_extension(ctype) or ".jpg"
                if ext == ".jpe":
                    ext = ".jpg"
                fname = f"img-{i:02d}{ext}"
                (raw_dir / fname).write_bytes(body)
                product["images"].append({"url": url, "file": str(raw_dir / fname),
                                          "bytes": len(body), "source": src})
            except Exception as e:
                product["warnings"].append(f"图片下载失败 {url[:80]}: {e}")

        log(f"待下载视频 {len(sniff_videos)} 个")
        for i, (url, src) in enumerate(sorted(sniff_videos.items()), 1):
            if ".m3u8" in url:
                product["warnings"].append(f"HLS 流跳过（需人工处理）: {url[:100]}")
                continue
            try:
                resp = ctx.request.get(url, headers={"Referer": args.url}, timeout=60000)
                body = resp.body()
                if len(body) > args.max_video_mb * 1024 * 1024:
                    product["warnings"].append(f"视频超限跳过 ({len(body)//1048576}MB): {url[:80]}")
                    continue
                ctype = resp.headers.get("content-type", "").split(";")[0]
                ext = mimetypes.guess_extension(ctype) or ".mp4"
                fname = f"video-{i:02d}{ext}"
                (raw_dir / fname).write_bytes(body)
                product["videos"].append({"url": url, "file": str(raw_dir / fname),
                                          "bytes": len(body), "source": src})
            except Exception as e:
                product["warnings"].append(f"视频下载失败 {url[:80]}: {e}")

        # ---- 整页截图 ----
        try:
            page.screenshot(path=str(out_dir / "screenshot.png"), full_page=True)
        except Exception as e:
            product["warnings"].append(f"截图失败: {e}")

        browser.close()

    # copy_blocks 去重截断
    seen = set()
    uniq = []
    for s in product["copy_blocks"]:
        k = s[:60]
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    product["copy_blocks"] = uniq[:80]

    (out_dir / "product.json").write_text(json.dumps(product, ensure_ascii=False, indent=2), encoding="utf-8")

    ok = bool(product["images"] or product["videos"])
    log(f"完成 → {out_dir/'product.json'}")
    log(f"  标题: {product['title']}")
    log(f"  图片 {len(product['images'])} | 视频 {len(product['videos'])} | 文案块 {len(product['copy_blocks'])}")
    for w in product["warnings"][:10]:
        log(f"  ⚠ {w}")
    if not ok:
        log("⚠ 未采到任何媒体——页面可能需登录/强反爬，用 --headful 复核或走 browser-use 兜底")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
