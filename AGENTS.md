# AGENTS.md — comfyui-hypit-bridge 工作指南

把一台 ComfyUI 部署接入 Hypit，作为 **MiniMax H3 视频生成服务**（6–90s 连续长镜头、时间窗改写、
动作跟随）。本文件给在本仓库工作的 agent 定行为契约：**最高优先级的是脚本确认关口（§2）——
任何生成任务在提交 ComfyUI 之前，必须先把完整方案呈给用户确认。**

## 1. 常用命令

```bash
# 包构建（改动 packages/ 源码后必须重跑）
cd packages/<pkg> && npm install && npm run build
npm install ./packages/provider-comfyui ./packages/model-h3-chain ./packages/model-h3-retake ./packages/model-h3-control

# 生成流水线
hypit check <file>.svml                    # 验证 SVML 语法与端口约束（提交前必跑）
hypit build <file>.svrun --follow          # 提交生成并跟踪执行日志
hypit get <build-id> --output gen.video --to output/result.mp4   # 导出成品
hypit doctor --endpoint comfyui.5090       # 检查 provider 激活状态

# ComfyUI 工作流同步（workflows/ 是本地权威源）
bash tools/sync_workflows.sh push|pull|status
```

当前 Runtime 端点为 `comfyui.5090`（配置在 `hypit.runtime.json`，已 gitignore）。
Turbo 全流程默认已定型：refTurbo 8 步 + SolAttn 动作优先档。链式引擎**按声线需求选**：
台词声线必须跟参考 → `chainRef2va:true`（ref2va 权重 + selfAnchorVoice 跨窗锁音色，
2026-09-23 tonghuashun 定）；声线无关、只要视觉身份 → `chainRef2va:false`（fl2va@8，
身份保持更好，但 fl2va 只经文本编码器捎带参考，声音锚不绑音色）。

## 2. 强制脚本确认关口（不可跳过）

**在向 ComfyUI 发送任何生成任务（`hypit build`）之前，必须先把「生成方案」呈给用户过目，
拿到明确确认后才能提交渲染。用户确认前不得提交。** 此契约与
[.zcode/skills/video-rewrite/SKILL.md](.zcode/skills/video-rewrite/SKILL.md) 的第 4 步过目点同源，
并推广到本项目一切生成任务。

**「每次提交都算一次生成」（2026-09-23 用户定规）**：修参重提、失败重试、Retake 重渲、
换引擎重跑等一切会占用 GPU 的 build，都必须**再次**拿到用户对该次提交的明确确认——
上一次的确认不沿用到下一次提交；参数有变时把变化点列出来让用户拍板。

呈给用户的确认卡片**固定包含以下四项**，缺一不可：

1. **推荐生成方案**——根据本项目能力选最合适的路径，说清用哪个模型元素/引擎、挂哪些参考
  （参考图×N / 声音锚 / 首帧 / 视频参考）、关键采样参数，以及**为什么**（对照 §3 的选择指南）。
2. **完整脚本文案**——逐窗全文。链式脚本一窗一段、`---` 分隔；每窗逐字复述人物外貌与场景设定；
  每窗结尾落在稳定拍上；词句不跨窗；写"变了什么"不写"没变什么"。
3. **推荐分辨率**——默认 `768P`（1280×736，本机唯一验证配方）；`2K` 未实测，默认封顶 768P，
  仅在用户明确要求时提议。画幅从参考素材自动推导（无参考默认 16:9）。确认卡必须**写明
  横屏/竖屏与具体分辨率数字**（如"横屏 1280×736"）——画幅歧义是最高频返工原因
  （2026-09-23 tonghuashun 曾按源视频假设 9:16，用户实际要 16:9 横屏）。
4. **推荐视频时长**——必须附推导过程：中文台词 0.22s/字（英文 0.6s/词）+ 每镜动作拍 3.5–4s，
  向上取整；链式无缝链时长必须落进 17k+5 帧格网（如 31s 可落、32s 会弹到 35.25s——用 31s）；
  无限窗引擎只接受 19/27/36/44/53/61/70/78/87s 档位。

确认方式：用户明确说"确认/通过/开始生成"（或对四项逐一点头）即放行；用户提出任何修改，
按修改重推受影响项（改文案要重算时长、改时长要重排窗口）后**重新呈卡**。禁止把"没有反对"
当作确认；禁止在未确认状态下把 `hypit build` 排队、预提交或以任何形式发送到 ComfyUI。

## 3. 能力矩阵与方案选择指南

| 能力 | 模型元素 | 时长 | 适用 |
| --- | --- | --- | --- |
| 单镜头 T2V / 首尾帧 | `<h3:TextVideo>` `<h3:FrameVideo>` | 6–15s | 无身份要求的单镜头 |
| 视频参考（ref2va） | `<h3:ReferenceVideo video=...>` | 6–15s | **保人物+保声线**：整视频（含原声）作参考，音色还原最佳 |
| 长镜头链式 | `<h3c:TakeVideo>` | 16–90s | 有脚本的多窗叙事；无参考→无限窗引擎，有参考→无缝链引擎 |
| 局部改写 | `<h3r:Retake>` | 窗口 ≤15.2s | 成品小修，不动其余画面 |
| 动作跟随 | `<h3ctl:ControlVideo>` | 6–15s | 姿态/深度严格跟随（**未做 GPU 实测**） |

按场景推荐（本项目实测结论）：

- **有源视频、换台词/换场景、保人物保声线**（主力生产场景，参考 `productions/dahuangmao-32s`）：
  走 video-rewrite 流水线（净化 → 提取 → 转写 → **过目** → 生成 → 验证）。
  ≤15s 音色优先 `<h3:ReferenceVideo>` 挂净化视频参考（含原声自动跟随；52s 整条会在 encode 步吃
  13.5GB 内存，先裁）；**>15s 保声线必须链式 + `chainRef2va:true`**——ref2va 权重真正消费
  voice_ref 声音锚并 selfAnchorVoice 跨窗锁音色，fl2va 只经文本编码器捎带参考、声线不跟随
  （tonghuashun v1 实测教训）。fl2va@8 链式身份保持更好，仅用于无台词/声线无关场次。
- **多镜叙事长片（16–90s）**：`<h3c:TakeVideo>`。要人物一致性就带参考图（走无缝链）；纯场景演化
  不带参考（走无限窗，无镜头边界）。Profile 可 `chainEngine` 强制指定，默认 auto。
- **单镜头 ≤15s**：无参考 `<h3:TextVideo>`；有首尾帧用 `<h3:FrameVideo>`（帧引导模式下
  aspectRatio 禁用，继承引导图比例）。
- **成品微调**：`<h3r:Retake>`（`video` 保声音重渲画面 / `audio` 保画面只重做声音）。
  源视频全帧载入内存：30s 源 ≈8GB 可行，61s 源 16.6GB 会 OOM——长源先 `ffmpeg -t 30 -c copy` 裁剪。

## 4. 硬性约束与已知坑

- **单卡并发 1**：同一时刻只跑一个任务；提交前排空队列。
- **单窗 6–15s** 是 H3 原生上限；更长内容必须走链式。
- **`referenceVideo` 端口仅 `<h3:ReferenceVideo>` 支持**；`TextVideo`/`FrameVideo`/`TakeVideo`
  请求带视频参考会被明确拒绝。链式的身份参考走 `referenceImage`（≤9 张）+ `referenceAudio`（≤3 条）。
- **声音锚必须 ≤12s**：整段原声作锚会在渲染中段炸 HostBuffer.read_file_slice（已加预检）。
- **声音锚必须验收"干净"再上车**（2026-09-24 tonghuashun 声线不像的根因①）：切好后用
  `silencedetect=noise=-38dB:d=0.30` 检查——干净独白必须存在句间/首尾静音段；**全程连续有声
  =混着 BGM/海浪底噪**，音色克隆会被全程带偏（7.96s 海滩原声锚实测翻车）。再转写核对内容
  确认是目标说话人。用户提供的录音也要走同样验收。
- **链式脚本每窗必须带音色描述句**（根因②）：音频分支需要文本条件配合 voice_ref——每窗
  人物复述里写明「她的声音与参考音频音色完全一致：〈音色白描〉」（对照实测音色极佳的
  ref2va 单镜头提示词模式「exactly the same voice as in &lt;Audio 1&gt;」）。只挂 wav 不写文案，
  音色克隆会向默认嗓音漂移。
- **声线兜底升级路径**（若干净锚+音色文案后仍不像）：chainTurbo:false 走 20 步官方质量档
  （"音色极佳"实测配方）；仍不行换 3×`h3:ReferenceVideo` 挂视频参考（原声自动跟随，
  唯一经用户验收的音色路径），代价是失去链式跨窗连续性且画幅跟随参考视频需处理。
- **脏参考会被全程复刻**：参考帧/首帧里的水印、边框线等伪影会被模型学进全片。参考素材先过
  `watermark_detect` + `clean_watermark` 净化；水印位置必须实测（视觉模型会说错角落）。
- **"对镜头说话"内容模型会自生成字幕条**（抖音先验）：提示词只能部分抑制，标准兜底是成品后处理
  `clean_watermark.sh` 对字幕条 bbox delogo。
- **身份参考用脸部特写裁片**（多角度）；全场景帧当参考会被当风格/场景信号稀释。
- **链式路径 `aspect-ratio` 属性不生效，画幅跟参考#1 图**：方形脸部裁片全家桶必出方片
  （tonghuashun v1 出了 960×960）；需要横/竖幅时参考#1 必须是目标画幅的锚图
  （如 1280×720 画布贴脸）。视频参考会把画幅拖向源视频画幅。
- **台词节奏实测 ~0.33s/字（含停顿），比理论 0.22s/字慢 ~50%**：定裁点前先算语音收口，
  32s 成片台词总字数按 ≤95 字预算、收口留 ≥1s 余量，否则裁点会切断末句
  （tonghuashun v1 台词说到 33.4s 的教训）。
- **ref 路径画幅推导的探针 bug（2026-09-24 实锤）**：provider 的 mp4Probe 命中**第一个**
  tkhd（可能是音频轨的），本仓实文件上读出 (720,0)→height=0 被拒→视频探针不生效→画幅
  推导**回落到第一张图片参考**。历史上 ref 路径没带图参考时回落默认 16:9"碰巧正确"，
  带竖幅图参考就会出竖片（tonghuashun 16s 首烧 832×1152）。**规避法：ref 路径参考图#1
  永远放目标画幅锚图（如 1280×720 的 ref-169.png）**；根治需改 mp4Probe 遍历全部 tkhd
  取双维>0 的那个（待办，需 npm build + reinstall）
- **SVML 里的尖括号占位符必须写 XML 实体**：`&lt;Subject 1&gt;`、`&lt;Audio 1&gt;`。
- **单镜头请求的 prompt 含 `---` 分行会被拒绝**（那是链式分镜分隔符）。
- **局域网地址只接受 http 内网/回环**；公网必须 https。
- **运维**：RAM 预检拦截（权重驻留）→ 对 ComfyUI `POST /free` 释放后重提，无需重启；
  首提被僵尸 worker 劫持卡死 → 取消后 `hypit runtime up` 干净重启。

## 5. 生成与验证闭环

1. `hypit check` 通过 → §2 确认卡片 → 用户放行
2. `hypit build --follow` 跟踪（队列位置会显示在进度里；单卡排队数小时是正常的）
3. 导出后**必须跑** `bash tools/verify_output.sh <out.mp4> --expect-script <新台词文本>`：
   规格/时长/无水印残留/静音节拍/转写逐行核对，结果报告给用户
4. 关键节拍抽帧出 QC 网格（ffmpeg tile）供人工目检；身份一致性/表演质量需人眼验收，
   不要宣称"验证通过"超出工具能证明的范围
5. Retake 改写不满意时可整窗重来；Retake 内存上限见 §3

## 6. 目录与产物约定

- `packages/` 源码改动后必须 `npm run build` 并重新 `npm install ./packages/...`；`dist/` 不入库。
- 生产项目放 `productions/<name>/`：`notes.md`（brief + treatment + 执行记录 + 标准规则沉淀）、
  `assets/`（净化素材、参考帧、声音锚，gitignore）、`take.svml`/`build.svrun`、`out/`。
  **执行记录与踩坑结论必须回写 notes.md**——它们是后续生产的参数依据。
- `assets/`、`output/`、`*.mp4`、`hypit.runtime.json`、`docs/ATX5090-ssh.md`、`docs/PATCHES.md`
  均不入库（含私有 IP/凭据/人脸声纹素材，**严禁**提交或外发）。
- `workflows/` 是 ComfyUI 工作流定义的本地权威源，改动后用 `sync_workflows.sh push` 部署。

## 7. 相关技能与文档

| 资源 | 何时用 |
| --- | --- |
| `.zcode/skills/video-rewrite/SKILL.md` | 源视频换台词/保人物/保声线/去水印的完整契约（本仓库内） |
| 用户级技能 `h3-prompt-writing` | 写 H3 提示词结构（T2VA/I2VA/FL2VA/L2VA/Ref2VA、声音景观等） |
| 用户级技能 `hypit` | SVML/SVS/SVRun 语法与 Runtime/凭据问题 |
| [packages/model-h3-chain/README.md](packages/model-h3-chain/README.md) | 链式合约、双引擎路由、脚本写法实测规则（PROMPTING.md） |
| [packages/provider-comfyui/README.md](packages/provider-comfyui/README.md) | 端口映射、请求路由、Profile 可覆盖参数、验证记录全表 |
| [packages/model-h3-retake/README.md](packages/model-h3-retake/README.md) | Retake 语义与内存上限 |
| [docs/SETUP.md](docs/SETUP.md) | 权重清单（~60GB）、custom nodes、环境变量 |
