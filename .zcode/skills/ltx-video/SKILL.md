---
name: ltx-video
description: LTX-2.5 单镜头音视频联合生成的硬契约。在本仓库用 LTX-2.5 写提示词、选参数、跑 <ltx:GenVideo> 或 LTX25_* 工作流之前必读：分辨率 64 像素格网、帧数 8k+1 格网、两段式配方（蒸馏 8 步半分辨率 → latent x2 → 精修 3 步）、[VISUAL]/[SPEECH]/[SOUNDS] 模板、unscored 反模式、与 H3 的能力边界。用于电商产品 B-roll、单镜头音画、多镜头叙事。
---

# ltx-video：LTX-2.5 单镜头音视频契约

LTX-2.5 = 22B 音视频**联合** DiT：画面与同步声音一次生成（环境声/产品声效/旁白对白都能出），
单次生成 4–10 秒。本部署走 **ChrisColeTech uncensored v1.1** 权重组（Eros10 + DMD 蒸馏 +
官方 IC-LoRA + Img2Vid 适配器全部烘入），uncensored Gemma-4 12B 编码器（int8），
节点链 = ComfyUI-GGUF-Loader 包的 `LTXV25*` 节点 + ComfyUI 0.36 原生 LTXV 节点。

## 1. 硬约束（违反即废片/报错）

- **宽高必须 %64==0**：一采在半分辨率跑（半幅再 %32）；画幅只有两档——横 `1280×768`、竖 `768×1280`。720 之类不整除的尺寸会被向下取整破坏 ×2 回程。
- **帧数必须 8k+1**（视频 VAE 时间 8:1 压缩 + 因果首帧）：`97(4s) / 121(5s) / 145(6s) / 169(7s) / 193(8s) / 217(9s) / 241(10s)` @ 24fps。`<ltx:GenVideo duration>` 会向上取整落格网。
- **时长 4–10s 一镜**：更长叙事要么写多镜头提示词（LTX 原生 multishot，见 §3），要么切多段，要么换 H3 链式（16–90s）。
- **采样计划是节点预设不是步数**：`distilled (8 steps)` 一采 + `refine (3 steps)` 精修，sigma 曲线固定（蒸馏版在别的曲线上看起来像坏模型）；CFG 双流恒 1.0 → **负提示词无效，留空**。
- **i2v 首帧**：提示词写"接下来发生什么"，不要复述画面内容；官方措辞 `Starting from the provided image as the first frame, ...`。首帧会被节点自行中心裁切到目标格网，**不要**预先缩放。画幅未声明时跟首帧方向。
- **§2 确认关口同样适用**：LTX 与 H3 共用单卡，任何 LTX 生成（含重试/改参）呈卡拿确认再提交。

## 2. 权重与切换（Profile 键）

| 档位 | ltxUnetName | 说明 |
| --- | --- | --- |
| 官方 distilled（**当前默认**） | `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` | Lightricks 官方套件（ModelScope 镜像安装，免 token）；2026-10-01 三发冒烟全过 |
| uncensored v1.1 | `ltx25_uncensored_v1.1-fp8_scaled.safetensors` | 扩散侧去审查 + DMD 蒸馏 + IC-LoRA 烘入（ChrisColeTech HF 仓库，仅 HF 有镜像）；DiT 尾段守夜人接力中 |

编码器档：官方 `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` /
uncensored `gemma4_12b_ltx25_uncensored-int8.safetensors`（投影层同构，可互换）。
**切档 = 改 runtime config 四个键**（`ltxUnetName`/`ltxClipName`/`ltxVideoVaeName`/`ltxAudioVaeName`，
两档 VAE 文件字节相同只是名字不同）+ `hypit runtime down && up`，无需改代码。
下载路由结论见 docs/PATCHES.md 2026-10-01 节（**ModelScope=官方档首选源，100MB/s**；HF 跨境晚高峰拥塞）。

## 3. 提示词写法（音画同文）

**结构（单镜头）**：一整段流畅英文——镜头/景别 → 主体+外观 → 动作 → 环境/光线 → 运镜 → **声音描述**（环境声、产品声效、旁白语气；说话内容用引号原句）。

**结构（多镜头/带台词，IC-LoRA 模板——检查点已烘入 IC-LoRA，用模板精度最高）**：

```
[VISUAL] Start on <镜头1>, then cut to <镜头2>, then cut to <镜头3>. <光线/风格统一句>
[SPEECH] A warm friendly narrator says: "中文或英文台词逐字"。 [<音频提示> 如 [laughs][sighs]]
[SOUNDS] <非语言声逐项>，<环境声>。 Unscored.
```

- **台词写进 [SPEECH]**，音频提示用方括号；三段顺序固定，段落可按需省略（无台词就整段去掉）。
- **禁否定句**：模型无视 "no music"；要无配乐写 **`Unscored`**。要"安静"就正面写具体环境声。
- **声音不写会被发明**：不描述音轨 ≠ 静音，模型会自己编。带货片必须显式写产品声/环境声/旁白。
- 多镜头切换在 [VISUAL] 里用 "start on / then cut to" 串联，保持同一光线与场景句收尾。

带货台词（[SPEECH] 引号内容）过 `tools/check_compliance.py` 合规闸：禁价格/时间限制/产地/
功效宣称/配料表/极限词——英文提示词里携带的中文台词同样算广告文案。

## 4. 与 H3 的能力边界（选型）

| 需求 | 用哪个 |
| --- | --- |
| 单镜头 4–10s、要音画同期（产品 B-roll、氛围空镜、声效演示） | **LTX `<ltx:GenVideo>`** |
| 16–90s 长镜/多窗叙事、保人物保声线、台词口播 | H3 链式（h3-av-contract 契约） |
| 换台词/保人物/保声线的改写 | H3 ref2va / video-rewrite |
| 竖屏带货口播主视频 | H3（promote-goods 默认配方）；LTX 出**产品 B-roll 素材层** |
| 成品 1080P 超分 | h3-upscale（GAN/SeedVR2） |

LTX 无参考图/声音锚/首尾帧（只有首帧 i2v），无跨窗声线锁——需要身份与音色跟随的场景走 H3。

## 5. 用法

- **Hypit**：`<ltx:GenVideo id={...} prompt={text} duration="5" resolution="768P" aspect-ratio="9:16"/>`（`hypit check` → §2 卡 → `hypit build --follow`）。
- **ComfyUI Web UI**：模板库选 `LTX25_T2V_Baseline / LTX25_I2V_Baseline / LTX25_Vertical_Product / LTX25_Multishot_Story`（本地权威源 `workflows/LTX25_*.json`，改后 `sync_workflows.sh push`）。
- **提示词预制**：`prompts/ltx25/promote-goods/`（产品转台/开箱上手/使用场景/多镜头叙事四类，含参数卡）。
- 重新生成工作流 JSON：`python3 tools/gen_ltx25_workflows.py`（widget 序列从远端 /object_info 实时推导，勿手改 JSON）。

## 6. 验证

- `bash tools/verify_output.sh <out.mp4> --expect-res 1280x768 --expect-fps 24`（规格/静音节拍/转写核对；单窗口无接缝，audio_seam_check 不适用）。
- 听感目检音轨：台词是否逐字、声效是否对位、"unscored" 是否真的无配乐（LTX 音画都是生成的，两边都要验）。
- `tools/qc_grid.sh` 关键节拍抽帧目检；速度/显存结论回写 notes（首次实测基线见 `productions/ltx25-baseline/notes.md`）。

## 7. 已知坑（2026-10-01 安装期沉淀）

- **跨境晚高峰拥塞**（约 15 时起）：HF/GitHub 同步劣化到 KB/s 级且 30 分钟冷却无效；大文件走
  ModelScope（官方档）或留深夜窗口（uncensored 档守夜人模式）。
- **hf-mirror 现对 /resolve 308 重定向回 huggingface.co**：5090 机器可直穿 HF→US CDN（好窗口
  单流 1.2–2.4MB/s）；aria2 十六连接配方见 `tools/aria2-ltx25-*.ps1`（注意控制文件
  `--auto-save-interval=10`，默认 60s 会让短命重试轮丢账本从零重下）。
- **官方档无需 HF token**：ModelScope `Lightricks/LTX-2.5` 镜像免门槛，aria2 实测 100MB/s。
- **Windows SSH 启动 ComfyUI 用 `tools/run-comfyui-fg.ps1` 前台跑**：`start-comfyui-h3hypit.ps1` 的 Start-Process 在 SSH 会话结束后子进程即死（PATCHES.md 记载的坑，0 字节日志复现）。
- **PS 5.1 Invoke-RestMethod 解析 /object_info 超大 JSON 会退化为标量**：验证节点/文件用 `/object_info/<Node>` 单点查询或 curl+python，勿全量 irm。
- LTXV25ModelsLoader 校验套件完整性：拒收 LTX-2.3 检查点与音/视频 VAE 互换（装错会明确报错）。
