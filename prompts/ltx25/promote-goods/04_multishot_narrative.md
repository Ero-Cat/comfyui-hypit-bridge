# 04 多镜头一镜过叙事（multishot + 台词）

**意图**：一条 10 秒竖屏小故事——3–4 个镜头切换 + 一句旁白，带货节奏（痛点场景 → 产品出场
→ 使用 → 效果）。用 IC-LoRA 三段模板（[VISUAL]/[SPEECH]/[SOUNDS]），本检查点 IC-LoRA 已烘入，
模板精度最高。

## 英文 prompt 模板（{...} 按品填）

```
[VISUAL] Start on a close-up of {痛点场景, e.g. tangled cables spilling out of a bag on a messy
desk}, then cut to {产品出场, e.g. a neat cable organizer box being placed beside them}, then
cut to a medium shot of {使用动作, e.g. hands coiling each cable into the box}, then cut to a
final close-up of {效果, e.g. the tidy desk with the closed box, morning light}. One
consistent warm indoor scene throughout. [SPEECH] A warm friendly narrator says: "{中文台词,
过合规闸后逐字填入}". [SOUNDS] {产品声效, e.g. a soft fabric zip}, {动作声, e.g. the gentle
click of the lid closing}, a quiet room tone. Unscored.
```

## 参数卡

| 项 | 值 |
| --- | --- |
| 画幅 | 竖 768×1280 |
| 帧数 | 241（10s，4 镜头 × ~2.5s） |
| 工作流 | `LTX25_Multishot_Story.json`（改 prompt） |

## 写法要点

- **镜头数与时长匹配**：10s 容 3–4 镜（每镜 2.5–3s）；5s 只容 2 镜。镜头切换全部用
  `then cut to` 串联，写在 [VISUAL] 一段内。
- **[SPEECH] 台词 ≤ 14 中文字**（10s 内语速 0.33s/字 + 收口 1s 余量，与 H3 实测节奏一致）；
  台词先过 `tools/check_compliance.py` 再填入；说话人描述写在引号外（A warm friendly narrator）。
- 台词中音频动作用方括号：`"[laughs] 好家伙，终于不缠了。"`（[SPEECH] 内）。
- **[SOUNDS] 与镜头对位**：按镜头顺序列声效，模型会按画面节奏对位；至少一条环境底声。
- 一致性句收尾（One consistent warm indoor scene throughout）锁光线与场景，防跨镜头漂移。
- 变体：无台词版删掉整个 [SPEECH] 段（三段模板可省段，不可改名）；横幅 1280×768 同理。

## 与 H3 的取舍

10s 内、无身份保真要求、要"镜头语言感" → 用本模板；16s 以上、同一人物贯穿多窗、要口播声线
跟随 → H3 链式（promote-goods 主配方）。
