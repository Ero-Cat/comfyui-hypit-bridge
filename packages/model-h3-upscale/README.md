# @local/h3-upscale

成品视频 1080P 高清化（超分后处理），以 hypit 体系接入：

```xml
<import from="@local/h3-upscale@1" as="h3up"/>
<h3up:UpscaleVideo id="hd" source={take.video} lane="gan" model="4x-ultrasharp" fit="crop"/>
```

## 端口

| 端口 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | video | ✓ | 待超分的成片（音轨原样保留） |
| `target` | enum `1080p` | – | 输出档（横屏 1920×1080 / 竖屏 1080×1920 自动） |
| `lane` | enum `gan` `seedvr2` | – | 引擎档，默认 gan（配置键 `upscaleLane`） |
| `model` | enum | – | gan 档模型：`4x-ultrasharp`(默认) `4x-ultrasharp-v2-lite` `realesrgan-x4plus` `realesrgan-x2plus` `animevideov3` |
| `fit` | enum `crop` `pad` `keep` | – | 画幅处理：crop=cover 居中裁（默认）、pad=黑边、keep=比例精确（横屏 1920×1104） |

## 两条 lane（RTX 5090 32GB 实测，2026-09-24）

- **gan 快速档**：逐帧超分模型（4x 超采样）+ Lanczos 落幅，VHS meta-batch 分批（配置
  `upscaleFramesPerBatch`，48 帧批 1.06s/帧），风格零改动，时长不限。
- **seedvr2 质量档**：ComfyUI 原生一步扩散复原（seedvr2_3b_int8 + 专用 VAE，TemporalChunk
  auto 分块），1.19s/帧，发丝/织物细节重建更自然、时序一致；**源 ≤45s**（主机 RAM 约束）。

## 模型选型（按内容，呈卡时说明理由）

真人/写实/3D 渲染 → `4x-ultrasharp`（备选 `realesrgan-x4plus`）；2D 平涂动画 →
`animevideov3`。权重清单与下载见 [docs/SETUP.md](../../docs/SETUP.md) Step 3b。

## 权重可见性预检

provider 在提交前经 `/object_info` 校验所选权重对 ComfyUI 可见（半截下载会得到明确报错，
不占 GPU）。provider 侧实现与验证记录见
[packages/provider-comfyui/README.md](../provider-comfyui/README.md)。
