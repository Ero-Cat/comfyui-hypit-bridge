#!/usr/bin/env python3
"""promote-goods 合规净化双闸（promote-goods 流水线专用）。

两处使用（.zcode/skills/promote-goods/SKILL.md 步骤 3 与 步骤 5）:
  ① 净化建议（对采集文案）: --mode copy  → 只输出建议清单，exit 0
  ② 生成门控（对最终脚本）: --mode script → 命中 FAIL 项 exit 1，不过闸不得呈确认卡

用法:
  python3 tools/check_compliance.py <文本文件> [--mode copy|script] [--stdin]
      [--extra-origin 绍兴,太湖] [--extra-word 私域词] [--json]

规则来源（2026-09-27 用户《选品与剪辑规范》+ 补充约束）:
  - 极限词六类：最 / 一 / 顶级 / 首家·国 / 绝对极限 / 权威（附：巨量千川广告审核规范）
  - 产品具体功效描述 → 需润色成体验/场景语言（FAIL 提示改写，不是禁提商品）
  - 配料表详细描述 → 不提（FAIL）
  - 价格（数字+元/券/特价等）→ 去除（FAIL；价格随佣金实时变动）
  - 时间信息（促销时限/日期/保质期）→ 去除（FAIL）
  - 产地信息（产地/产自/原产 + 每商品 --extra-origin 名录）→ 去除（FAIL）
  - 名人元素 / 暗示食用使用后效果 → 不涉及（FAIL）
  - 边缘词（便宜/实惠/包邮/新品…）→ WARN 人工复核
"""
from __future__ import annotations

import argparse
import json
import re
import sys

# ---------- 规则表 ----------

RULES_FAIL: list[tuple[str, str, list[str]]] = [
    ("极限词·最", "广告法绝对化用语", [
        "最好", "最强", "最大", "最小", "最高", "最低", "最便宜", "最优惠", "最先进", "最优秀",
        "最高级", "最新", "最爱", "最适合", "最值得", "最火", "最爆", "最热", "最全", "史上最",
    ]),
    ("极限词·一", "排序/唯一性宣称", [
        "第一", "第一名", "第一名品", "销量第一", "全网第一", "第一名", "唯一", "独一无二",
        "仅此一次", "最后一天", "首个", "首选", "首席", "一线品牌", "一经上市", "国际一流",
        "NO.1", "TOP1", "Top1", "no.1",
    ]),
    ("极限词·顶级", "夸大分级", [
        "顶级", "顶尖", "极品", "极致", "极致体验", "王牌", "冠军", "销量冠军", "销量王",
        "王者", "至尊", "奢侈品级", "史上", "前无古人", "全网最", "宇宙第一",
    ]),
    ("极限词·首家·国", "国家/行业背书", [
        "首家", "国家认证", "国家级", "世界级", "全国领先", "行业领先", "领先品牌", "国际品质",
        "驰名商标", "老字号", "特供", "专供", "国宴", "国务院", "领导人", "人民大会堂",
    ]),
    ("极限词·绝对极限", "绝对化承诺", [
        "绝对", "百分百", "100%", "百分之百", "永久", "永久有效", "万能", "完美", "彻底",
        "根治", "药到病除", "包治", "包好", "立竿见影", "无效退款", "稳赚", "秒杀一切",
    ]),
    ("极限词·权威", "权威/专家背书", [
        "权威", "权威认证", "专家推荐", "专家认证", "院士", "诺贝尔", "科研成果", "专利技术",
        "独家专利", "国家专利",
    ]),
    ("功效宣称", "需润色为体验/场景语言（不做功效断言）", [
        "美白", "祛斑", "祛痘", "抗皱", "去皱", "抗衰老", "延缓衰老", "瘦身", "减肥", "燃脂",
        "降血脂", "降血糖", "降血压", "降三高", "护肝", "养胃", "养颜", "补肾", "壮阳", "生发",
        "防癌", "抗癌", "消炎", "杀菌", "杀菌率", "消毒", "解毒", "排毒", "提高免疫力",
        "增强免疫", "补钙", "补铁", "补锌", "助眠", "安神", "治疗", "疗效", "治愈", "药用",
        "医用", "药效", "药用价值", "去腥", "增香", "解腻", "去屑", "防脱", "控油", "美白牙齿",
    ]),
    ("配料表", "不提配料/成分明细", [
        "配料表", "配料：", "配料:", "成分表", "营养成分", "营养表", "含量表", "食品添加剂",
        "添加剂：", "无添加蔗糖", "零添加",
    ]),
    ("价格", "价格随佣金实时变动，一律不出现", [
        "¥", "￥", "元一", "块钱", "块一", "价格是", "卖价", "特价", "券后", "优惠券", "领券",
        "限时价", "到手价", "折后", "打几折", "半价", "免费送", "0元", "零元购", "白菜价",
        "亏本", "倒贴", "清仓价", "跳楼价",
    ]),
    ("时间信息", "促销时限/日期类信息会失效", [
        "限时", "仅限今日", "最后一天", "最后几小时", "倒计时", "秒杀开始", "今晚八点", "双11",
        "双十一", "618", "年货节", "双12", "新品上市期", "活动截止", "保质期", "生产日期",
        "有效期至", "截止日期", "今日下单", "现在下单", "赶紧抢", "手慢无", "售完即止",
    ]),
    ("产地", "产地信息去除（含商品具体产地名录，用 --extra-origin 补充）", [
        "产地", "产自", "原产地", "原产自", "源自", "发源地在", "直发",
    ]),
    ("名人", "不涉及名人/肖像/代言暗示", [
        "明星同款", "明星代言", "名人推荐", "网红推荐", "大V推荐", "某明星", "鹿晗", "王一博",
    ]),
    ("暗示效果", "不暗示食用/使用后效果", [
        "一喝就", "一抹就", "一贴就", "一喷就", "一穿就", "一用就", "吃完就", "喝了就",
        "用了就", "涂上就", "马上见效", "立刻见效", "当天见效", "三天见效", "七天见效",
        "越喝越", "越用越", "越吃越",
    ]),
]

RULES_WARN: list[tuple[str, str, list[str]]] = [
    ("边缘词·价格倾向", "人工复核是否保留", [
        "便宜", "实惠", "划算", "省钱", "超值", "性价比", "白菜", "包邮", "免费试用", "赠品",
    ]),
    ("边缘词·时效倾向", "人工复核是否保留", [
        "新品", "刚上市", "今年", "今天", "现货", "库存",
    ]),
]

PRICE_NUM = re.compile(r"\d+(?:\.\d+)?\s*[元块毛分]")
DATE_NUM = re.compile(r"\d{4}\s*年|\d{1,2}\s*月\s*\d{1,2}\s*[日号]")


def scan(text: str, extra_origin: list[str], extra_word: list[str]) -> dict:
    hits = []

    def add(level, cat, note, word, pos):
        line = text.count("\n", 0, pos) + 1
        ctx = text[max(0, pos - 14):pos + 18].replace("\n", "␤")
        hits.append({"level": level, "cat": cat, "note": note, "word": word,
                     "line": line, "context": ctx})

    for cat, note, words in RULES_FAIL:
        for w in words:
            for m in re.finditer(re.escape(w), text):
                add("FAIL", cat, note, w, m.start())
    for cat, note, words in RULES_WARN:
        for w in words:
            for m in re.finditer(re.escape(w), text):
                add("WARN", cat, note, w, m.start())
    for w in extra_origin:
        for m in re.finditer(re.escape(w), text):
            add("FAIL", "产地", f"商品产地名录：{w}", w, m.start())
    for w in extra_word:
        for m in re.finditer(re.escape(w), text):
            add("FAIL", "自定义禁词", f"--extra-word：{w}", w, m.start())
    for m in PRICE_NUM.finditer(text):
        add("FAIL", "价格", "数字+货币单位", m.group().strip(), m.start())
    for m in DATE_NUM.finditer(text):
        add("FAIL", "时间信息", "日期数字", m.group().strip(), m.start())

    # 去重（同词同位置可能被多条规则命中）
    seen = set()
    uniq = []
    for h in hits:
        k = (h["word"], h["line"], h["context"])
        if k not in seen:
            seen.add(k)
            uniq.append(h)
    order = {"FAIL": 0, "WARN": 1}
    uniq.sort(key=lambda h: (order[h["level"]], h["line"]))
    return {"hits": uniq,
            "fail_count": sum(1 for h in uniq if h["level"] == "FAIL"),
            "warn_count": sum(1 for h in uniq if h["level"] == "WARN")}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?", help="文本文件路径（或 --stdin）")
    ap.add_argument("--stdin", action="store_true")
    ap.add_argument("--mode", choices=["copy", "script"], default="script",
                    help="copy=净化建议(仅报告)；script=生成门控(FAIL 退出码1)")
    ap.add_argument("--extra-origin", default="", help="逗号分隔的该商品产地禁词（如 绍兴,太湖）")
    ap.add_argument("--extra-word", default="", help="逗号分隔的自定义禁词")
    ap.add_argument("--json", action="store_true", help="输出 JSON")
    args = ap.parse_args()

    if args.stdin:
        text = sys.stdin.read()
    else:
        if not args.file:
            ap.error("需要文本文件或 --stdin")
        text = open(args.file, encoding="utf-8").read()

    res = scan(
        text,
        [w.strip() for w in args.extra_origin.split(",") if w.strip()],
        [w.strip() for w in args.extra_word.split(",") if w.strip()],
    )

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        for h in res["hits"]:
            print(f"[{h['level']}] 行{h['line']} {h['cat']} 「{h['word']}』 {h['note']}")
            print(f"       …{h['context']}…")
        print(f"—— 共 FAIL {res['fail_count']} 项 / WARN {res['warn_count']} 项（mode={args.mode}）")

    if args.mode == "script" and res["fail_count"] > 0:
        print("⛔ 门控未通过：命中 FAIL 项，改写后再闸。")
        return 1
    if args.mode == "script":
        print("✅ 合规门控通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
