<div align="center">

# comfyui-hypit-bridge

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)](docs/SETUP.md)
[![ComfyUI](https://img.shields.io/badge/ComfyUI-v0.36%2B-4EA55B)](docs/SETUP.md)
[![Model](https://img.shields.io/badge/MiniMax-H3-FF6F00)](https://huggingface.co/Comfy-Org/MiniMax-H3)
[![GPU](https://img.shields.io/badge/validated_on-RTX_5090_32GB-C22E5C)](docs/SETUP.md)

把一台 ComfyUI 部署接入 [Hypit](docs/SETUP.md)，作为 **MiniMax H3 视频生成服务**：
一条命令提交 6–90 秒连续长镜头、时间窗改写与动作跟随生成。

[快速开始](#-快速开始) · [能力总览](#-能力总览) · [使用示例](#-使用示例) · [常用命令](#-常用命令) · [更多文档](#-更多文档)

</div>

## 📖 目录

- [快速开始](#-快速开始)
- [能力总览](#-能力总览)
- [使用示例](#-使用示例)
- [常用命令](#-常用命令)
- [工具脚本](#-工具脚本)
- [硬件与限制](#-硬件与限制)
- [项目结构](#-项目结构)
- [更多文档](#-更多文档)

## ⚡️ 快速开始

**前置条件**：Node.js v20+、Hypit CLI（`npm install -g @hypit/hypit`）、ffmpeg；一台 ComfyUI v0.36+ 的
GPU 机器（≥24 GB 显存，本项目在 RTX 5090 32GB / 32GB RAM 上验证）。模型权重（~60 GB）与
custom nodes 安装见 [docs/SETUP.md](docs/SETUP.md)。

```bash
# 1. 克隆并构建全部 provider / model 包
git clone https://github.com/Ero-Cat/comfyui-hypit-bridge.git
cd comfyui-hypit-bridge
for pkg in packages/*/; do (cd "$pkg" && npm install && npm run build); done
npm install ./packages/provider-comfyui ./packages/model-h3-chain ./packages/model-h3-retake ./packages/model-h3-control

# 2. 配置 ComfyUI 端点（私有配置，已 gitignore）
cp hypit.runtime.example.json hypit.runtime.json
#    编辑 baseUrl → http://<comfyui-host>:8000

# 3. 验证连接
curl http://<comfyui-host>:8000/system_stats   # ComfyUI 可达
hypit doctor --endpoint comfyui.local          # provider 激活

# 4. 跑通第一次生成
hypit check tests/xxx.svml                     # 验证 Source 语法
hypit build tests/xxx.svrun --follow           # 提交并跟踪执行
hypit get <build-id> --output gen.video --to output/result.mp4
```

这就是上手所需的全部！🎉 完整安装指南（权重清单、custom nodes、环境变量）见
[docs/SETUP.md](docs/SETUP.md)。

## 🎬 能力总览

| 能力 | 模型元素 | 用途 | 单次时长 |
| --- | --- | --- | --- |
| 单镜头 | `<h3:TextVideo>` `<h3:FrameVideo>` | T2V / 首尾帧生成 | 6–15s |
| 视频参考 | `<h3:ReferenceVideo video={...}/>` | 视频直接作为参考（人物+声音完整上下文，走 ref2va） | 6–15s |
| 长镜头 | `<h3c:TakeVideo>` | 链式多窗（InfiniteTake / Multishot 双引擎） | 16–90s |
| 局部改写 | `<h3r:Retake>` | 改写时间窗（保声音 / 保画面 / both） | ≤15s/窗 |
| 动作跟随 | `<h3ctl:ControlVideo>` | ControlNet 姿态/深度跟随 | 6–15s |

## 🧩 使用示例

### 单镜头（官方 `@hypit/minimax-h3` 合约）

```xml
<import as="h3" from="@hypit/minimax-h3@1"/>

<!-- 文生视频 -->
<h3:TextVideo id="shot" prompt={desc} duration="8" resolution="768P"/>

<!-- 视频参考：人物 + 声音完整上下文重生成 -->
<h3:ReferenceVideo id="redo" video={clip.video} prompt={desc}/>
```

支持首尾帧引导、参考图 ≤9 张、声音锚 ≤3 条；`refTurbo: true` 可切 4 步 turbo（约 5× 提速）。

### 长镜头（`@local/h3-chain`，16–90s）

```xml
<import as="h3c" from="@local/h3-chain@1"/>

<h3c:TakeVideo id="opening" prompt={script} duration="44" resolution="768P" aspect-ratio="16:9">
  <h3c:Reference image={hero.image}/>
</h3c:TakeVideo>
```

链式脚本**一窗一段**、`---` 单独成行分隔；双引擎自动路由：无参考 → 无限窗引擎（无镜头边界，
可选 19/27/36/44/53/61/70/78/87s 档），有参考 → 无缝链引擎（末帧接力 + 参考逐窗携带）。脚本写法
要点见 [packages/model-h3-chain/README.md](packages/model-h3-chain/README.md)。

### 局部改写（`@local/h3-retake`）

```xml
<import as="h3r" from="@local/h3-retake@1"/>

<h3r:Retake id="fix" source={take.video} prompt={fixPrompt} start="12" end="20"/>
```

窗口两侧画面冻结、**时长不变**；`mode` 可选 `video+audio`（重来这一刻）/ `video`（保声音重渲画面）/
`audio`（保画面只重做声音）。硬件上限见 [packages/model-h3-retake/README.md](packages/model-h3-retake/README.md)。

### 动作跟随（`@local/h3-control`）

```xml
<import as="h3ctl" from="@local/h3-control@1"/>

<h3ctl:ControlVideo id="dance" prompt={dancePrompt} control={refClip.video} control-type="pose"
                    duration="8" resolution="768P" aspect-ratio="16:9"/>
```

动作全强度跟随控制视频，外观/主体/场景来自提示词；`control-type` 支持 `pose`（DWPose 骨架）、
`depth`（DepthAnything）、`raw`（预提取信号直通）。

## ⌨️ 常用命令

| 命令 | 用途 |
| --- | --- |
| `hypit check tests/xxx.svml` | 验证 `.svml` 语法与端口约束 |
| `hypit build tests/xxx.svrun --follow` | 提交生成并跟踪执行日志 |
| `hypit get <build-id> --output gen.video --to output/result.mp4` | 导出成品 |
| `hypit doctor --endpoint comfyui.local` | 检查 provider 激活状态 |
| `bash tools/sync_workflows.sh push` | 部署工作流：本地 → GPU 机 |
| `bash tools/sync_workflows.sh pull` | 拉回 GPU 机上手动保存的工作流 |
| `bash tools/sync_workflows.sh status` | 对比两端工作流差异 |

`workflows/` 是 ComfyUI 工作流定义的**本地权威源**，与 GPU 机双向同步。

## 🛠 工具脚本

| 脚本 | 用途 |
| --- | --- |
| `tools/watermark_detect.py` | 检测静态水印（时间方差法） |
| `tools/clean_watermark.sh` | ffmpeg delogo 快速去水印 |
| `tools/extract_assets.sh` | 从视频提取参考帧 + 音轨 |
| `tools/transcribe.sh` | whisper.cpp 转写 + 节拍表 + 声音锚 |
| `tools/verify_output.sh` | 成品全项验证（时长/水印/节拍/台词） |
| `tools/sync_workflows.sh` | ComfyUI 工作流双向同步 |
| `tools/remove_watermark_comfyui.md` | 独立去水印工作流文档（LaMa/ProPainter） |

## ⚠️ 硬件与限制

- **单卡并发 1**：provider 以 `concurrency: 1` 串行提交（RTX 5090 32GB 单卡部署）。
- **单次 6–15s**：H3 原生窗口上限；更长内容走长镜头链式能力（16–90s）。
- **Retake 内存上限**：源视频全帧载入内存，61s 源 ≈ 16.6 GB，32GB 内存机器实测 OOM——长源先
  `ffmpeg -t 30 -c copy` 裁剪再改写。
- **网络**：局域网 ComfyUI 地址走 http；公网地址必须 https。
- **分辨率档**：`768P` ≈ 1280×736（本机验证配方）；`2K` ≈ 2048×1152（未在本机验证）。

## 📁 项目结构

```
├── packages/              # Hypit Model + Provider 包（源码）
│   ├── provider-comfyui/  #   ComfyUI 提供者（4 个能力）
│   ├── model-h3-chain/    #   长镜头模型（16-90s）
│   ├── model-h3-retake/   #   时间窗改写模型
│   └── model-h3-control/  #   动作跟随模型（ControlNet）
├── tools/                 # 可复用流水线脚本（独立可调用）
├── workflows/             # ComfyUI 工作流定义（本地权威源，双向同步）
├── assets/                # 素材（按项目分子目录，gitignore）
├── output/                # 生成产物（gitignore）
├── tests/                 # .svml / .svrun 测试源
├── docs/                  # 文档
├── .zcode/skills/         # ZCode 技能（video-rewrite 等）
├── .hypit/                # Hypit 运行时（自动生成，gitignore）
└── hypit.runtime.json     # Runtime Profile（gitignore，模板见 hypit.runtime.example.json）
```

## 📚 更多文档

| 文档 | 说明 |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | 完整安装指南：权重清单（~60 GB）、custom nodes、环境变量 |
| [packages/provider-comfyui/README.md](packages/provider-comfyui/README.md) | 端口映射、请求路由、Profile 可覆盖参数 |
| [packages/model-h3-chain/README.md](packages/model-h3-chain/README.md) | 长镜头合约、双引擎路由、脚本写法要点 |
| [packages/model-h3-retake/README.md](packages/model-h3-retake/README.md) | 时间窗改写语义与硬件上限 |
| [.zcode/skills/video-rewrite/SKILL.md](.zcode/skills/video-rewrite/SKILL.md) | 视频换台词 / 换主体的组件化流水线 |

> `docs/ATX5090-ssh.md` 与 `docs/PATCHES.md` 含内网部署信息，已 gitignore，仅存在于本地。
