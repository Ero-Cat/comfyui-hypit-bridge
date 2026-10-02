---
name: promote-goods
description: 电商带货短视频生产流水线：输入商品详情页 URL → 采集商品图/视频/文案 → 合规净化 → 写带货脚本 → H3 生成竖屏口播视频 → 验证后期交付。当用户提供商品链接要求生成带货/挂车/种草视频，或要复跑 promote-goods 产品时使用。
---

# promote-goods：电商带货短视频流水线

把「一个商品详情页 URL」变成「一条可直接挂车的 9:16 竖屏口播带货短视频」。
默认配方（2026-09-27 用户定规）：**9:16 竖屏 736×1280（768P）、商品实拍感画面 +
全程 H3 生成口播（每窗必有台词，无纯音乐窗）、不出镜、真实台词后期烧字幕、
不超分（1080P 仅用户明确要求时作为可选项呈卡）、全链路无价格/时间/产地/功效/配料表/极限词**。

## 0. 流水线七步（不可跳步）

```
1 采集 → 2 净化与策展 → 3 类目判定+模板选择 → 4 合规净化① → 5 脚本生成+门控②+check
→ 6 ⏸确认卡（AGENTS §2 关口，停） → 7 生成 → 验证 → 后期成片 → 回写 notes
```

### 1 采集
```bash
.venv/bin/python3 tools/scrape_product.py <商品页URL> [--out-dir productions/promote-goods/goods/<id>]
```
产出 `product.json`（标题/文案块/价格〔仅备查〕/图/视频）+ `assets/raw/` + `screenshot.png`。
SPA 页面走网络嗅探+XHR JSON 挖掘；反爬/登录墙 → `--headful` 复核 → browser-use 技能 GUI 兜底。
已知坑：XHR 兜底选标题可能选错（如选成售后政策）——从 copy_blocks 人工判读真实标题。
**price_ref_only 字段严禁进入任何提示词/字幕**（佣金实时变动）。

### 2 净化与策展
- 视觉净化（策展规则）：带**价格标签/日期/产地标注/配料表特写/营销文字**的图或视频帧 →
  剔除或 PIL 裁切后用；多轮裁切后用视觉模型复核残留文字。
- **包装一致性**：参考素材仅取自同一详情页（同 SKU）；策展时视觉模型核对各参考间桶/瓶一致。
- 商品视频：`ffmpeg -an` 去音轨（防 ref2va 原声跟随抢口播）+ 裁掉价格贴片段。
- 参考命名 `assets/ref-1..N.png`；**ref-1 必须是 736×1280 竖屏锚图**（白底商品图 bbox
  居中合成暖渐变底，见 goods/3759672774646432103 策展记录）。
- 策展结论写 `curated.json`（selling_points_sanitized / banned_in_script / refs / dropped）。

### 3 类目判定 + 模板选择
按 `references/templates.md` 六类目（美妆个护/食品饮料/数码3C/家居日用/服饰箱包/母婴玩具）
选钩子模式与三拍结构；低客单默认 **16s/2 窗**，高客单/信任型 31s 档。

### 4 合规净化①（对采集文案）
```bash
python3 tools/check_compliance.py product.json里的文案字段 --mode copy \
  --extra-origin <该商品产地词> --extra-word <该商品专属禁词>
```
按输出把卖点改写成**体验/场景/人群语言**（写进 curated.json 的 selling_points_sanitized）。

### 5 脚本生成 + 门控② + check
- 写法遵循 `.zcode/skills/h3-av-contract`（写前必读）+ 口播规则：
  **`(S1) says in an off-screen voiceover: <d>[Chinese] …</d>`**（官方精确短语），
  `<d>` 后紧跟 `No one on screen is talking.`（字幕条先验抑制）。
- **受众声线画像（2026-09-27 用户定规）**：按商品目标人群的年龄区间+性别选旁白 persona
  （表见 `references/templates.md` §受众声线画像），音色描述句按 persona 逐窗复述；
  无锚时 selfAnchorVoice 跨窗自锚。
- **反 AI 味三原则（2026-09-27 用户定规，写脚本硬约束）**：
  1. **声音自然**：音色描述句写「像真实博主/邻居在分享」的自然口语（natural
     conversational delivery, normal volume, small natural pauses）；**禁播音腔**
     （professional announcer / broadcast tone 等词不写）。
  2. **物体因果入场**：任何进入画面的物体必须写明来因（手放入 / 本来就在台面上），
     禁 "suddenly appears" 类无因描述；每窗逐字复述**场景物品清单**，已存在物品
     不得凭空增删。
  3. **物理真实交互**：液体受重力倾倒、蒸汽上升、物体放置有支撑面、手部动作有真实
     接触与反作用（握持/拧盖）；不写超现实、魔法感、镜头内瞬移。
- 每窗：integrated_multimodal_description（英文正文+逐窗复述商品与场景）+
  overall_soundscape（厨房声/动作声写满，`No other voices`）+ non_diegetic_music: N/A
  （BGM 后期混，不在生成侧做）。
- **高频话术密度（2026-09-27 用户定规：带货=高频高节奏，禁"半天一句"）**：
  台词总量 **31s 片 80–95 字、16s 片 45–55 字**（语音占片长 ≥80%，安全线上限 2.7字/s
  不破）；句长 5–11 字短句；**每 2.5–3.5s 一个信息点**（钩子/卖点/数字/反问）；每窗
  台词分 2–3 段短句而非一长句；句式库见 templates.md（数字冲击/反问/排比/命令式 CTA）。
  稀疏台词对带货是双重伤害：留不住人 + 模型自编语音填空白（babble 风险随稀疏上升）。
- 窗尾台词收在停顿（接缝落静默）；CTA 只说「点下方小黄车」，**不报价不提时间**。
- **BGM 默认开启（2026-09-27 用户定规）**：成片必带 BGM，曲库
  `productions/promote-goods/assets/bgm/`（CC-BY，**发布文案必须署名**，清单见该目录
  README）；`finalize_promo.sh --bgm <曲> --bgm-gain 0.8` 人声闪避混音（说话时乐让位）。
- 门控：`check_compliance.py take.svml --mode script --extra-origin … --extra-word …`
  FAIL 清零才准呈卡 → `hypit check` 通过。

### 6 ⏸确认卡（每次提交单独放行）
固定四项 + build 清单（AGENTS §2）：
1. **推荐生成方案**：引擎/参考/关键参数与理由。**产线档：turbo LoRA(8步)+SolAttn+
   heretic NVFP4 TE，加速器（EasyCache/Spectrum）全关**（2026-09-28 终测双双降智否决：
   事件因果/场景回归崩坏）；31s 片按 **≤58min 上界**报价（干净内存档未单测，产线首条
   实测后修正）；Spectrum 仅可用于草稿预览版（15m57s，须另行呈卡）；**提交前先
   `POST /free`**（RAM 预检 <12.7GB 会拒）；挂品牌声音锚才切 `chainRef2va:true`。
2. **完整脚本文案**：逐窗全文 + 旁白台词。
3. **推荐分辨率**：竖屏 9:16 · 736×1280（768P 档）。
4. **推荐时长**：16s（2 窗零浪费定点；0.33s/字×38 字≈12.5s 语音 + 收口余量推导）。
外加：本次 build 清单（默认仅 1 个生成 build + 预估 GPU 耗时；
**「1080P 超分 +6–8 分钟」单列可选项，用户明确勾选才加**）。

### 7 生成 → 验证 → 后期
```bash
# runtime 配置改动后必须重启 worker（仓库根执行）
hypit runtime down && hypit runtime up
hypit build <goods>/build.svrun --follow
hypit get <build-id> --output pg-huadiao-16s.video --to <goods>/out/take.mp4
# 验证（仓库根）
bash tools/verify_output.sh <out>.mp4 --expect-script <goods>/expected-script.txt \
  --expect-res 736x1280 --expect-fps 24
python3 tools/audio_seam_check.py <out>.mp4 --seam 8.0 --budget <字数×0.33>
# 后期：烧字幕（真实台词文本，杜绝模型乱码字幕）+ 可选 BGM
bash tools/finalize_promo.sh <out>.mp4 <goods>/expected-script.txt [out-final.mp4] [--bgm <bgm>]
```
QC 目检重点（1fps 连拍 + 网格）：**商品/包装一致性**（本产品最大风险）、无价格/日期/
产地/配料表残留、无自生成字幕条、节拍顺序；**反 AI 味三查（2026-09-27 定规）**：
①物品有无凭空出现/消失（对照各窗场景清单；**事件段〔开盖/倾倒/平移往返〕加抽 fps=2
帧带核因果——静帧看不出「盖上还倒酒」类违例**）②物理交互是否真实（重力/支撑/接触）
③旁白有无 AI 腔/播音腔（人耳）。渲染与素材结论回写
`productions/promote-goods/notes.md` 与该 goods 的执行记录。

### 8 最终交付必附「发布文案建议」（2026-09-27 用户定规，不可缺项）

每次交付成片时，同卡给出可直接粘贴的发布文案，四要素齐备：

1. **首句钩子**（体验/场景句，不吃"绝对化"红线，如「我家厨房的料酒从不买小瓶装」）
2. **正文短句**：成片台词的情绪化压缩版 + 价值点（不重复字幕全文）
3. **评论引导**（算法评论率因子落点）：一个具体问题（「你家烧鱼放什么？」），不是"欢迎评论"
4. **话题标签** 3–5 个：类目词 + 场景词 + 泛流量词（按 `references/templates.md` 类目标签库）

**发布文案与视频同口径过闸**：`check_compliance.py --mode script --extra-origin …
--extra-word …` FAIL=0 才准交付（平台审核对文案与视频同标准；价格/时间/产地/功效/
配料表/极限词在文案里同样会触发风险门控→0 分）。

## 1. 硬规则速查（违反=返工）

| 规则 | 来源 |
| --- | --- |
| 无价格（数字/券/特价/元）、无促销时间词、无产地（含商品专属产地名录） | 2026-09-27 用户 |
| 功效宣称→体验/场景语言；配料表不提不念；名人/暗示食用效果不涉及 | 同上 |
| 极限词六类全表剔除（check_compliance.py 内置） | 用户《选品与剪辑规范》 |
| 每窗必有口播（无纯音乐窗）；主食材/演示段台词覆盖 | 同上（原混剪规则，H3 生成天然满足） |
| 不同素材商品包装一致；辅素材产品与主商品一致（同 SKU 来源） | 同上 |
| 9:16 竖屏 ref-1 锚图；台词 `<d>`+off-screen voiceover；每窗声景三字段 | h3-av-contract |
| 1080P 超分不默认（+6–8 分钟 GPU），确认卡问询制 | 2026-09-27 用户 |
| **高频话术密度**：31s 片 80–95 字、16s 片 45–55 字、每 2.5–3.5s 一个信息点 | 2026-09-27 用户 |
| **BGM 默认开启**：曲库 CC-BY 需署名，人声闪避混音 | 同上 |
| 引擎：**turbo LoRA（8 步）全场景强制启用**，禁止 20 步质量档进产线（效率太差） | 2026-09-27 用户 |
| **社区加速器（EasyCache/Spectrum）交付禁用**——终测双双降智否决；Spectrum 仅草稿预览档 | 2026-09-28 终测 |
| **反 AI 味三原则**：声音自然禁播音腔；物体因果入场不凭空出现；物理真实交互 | 同上 |
| **受众声线画像**：按商品目标人群年龄/性别选旁白 persona（templates 表） | 同上 |
| 每次 build 单独确认；check_compliance FAIL=0 才呈卡 | AGENTS §2 |
| **最终交付必附发布文案建议（四要素）且同口径过合规闸** | 2026-09-27 用户定规 |

## 2. 相关文档
- `references/strategy.md` — 流量算法→生成配方映射 + 合规规则全文 + 生成时间预算
- `references/templates.md` — 六类目模板（钩子/三拍/台词写法/CTA 句式）
- `references/algorithm-research.md` — 两版流量算法研究存档（启发式，非官方）
- `AGENTS.md` §2/§4/§5 — 行为总契约；`.zcode/skills/h3-av-contract` — 音频/镜头硬契约
- `.zcode/skills/ltx-video` — **LTX-2.5 产品 B-roll 素材通道**（2026-10-01 起）：口播主视频仍走 H3
  本配方，产品转台/开箱/氛围/多镜头小故事等**素材层**可用 `<ltx:GenVideo>`（4–10s 音画联合，
  竖幅 768×1280），预制模板在 `prompts/ltx25/promote-goods/`；LTX 无声线锚不出口播人物，
  其 [SPEECH] 台词同过本 skill 合规闸。
