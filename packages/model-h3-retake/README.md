# @local/h3-retake

项目自有 Model 包：**改写已有 H3 视频的一个时间窗**——窗口内按新提示词重渲，窗口两侧画面冻结，
时长不变。由 `provider-comfyui` 的 `h3-retake` capability 实现（包内 `H3Retake` 节点）。

```xml
<import as="h3r" from="@local/h3-retake@1"/>

<h3r:Retake id="fix" source={take.video} prompt={fixPrompt} start="12" end="20"/>
```

## 请求语义

| 端口 | 约束 | 说明 |
| --- | --- | --- |
| `source` | 1 个视频 | 被改写的视频（建议 H3 自产：24fps 原生音轨，接缝最干净） |
| `prompt` | 文本 ≤7000 | 窗口内发生什么；模型只看到这段文本 + 两侧冻结画面 |
| `startSeconds` / `endSeconds` | 0–600s，窗口 ≤15.2s | 窗口起止（吸附到 H3 潜格网 ~0.14s/格） |
| `mode` | `video+audio` / `video` / `audio` | `video+audio` 重来这一刻；**`video` 保声音重渲画面；`audio` 保画面只重做声音** |

## 硬件上限注意（31 GB 内存机器实测）

- **源视频全帧会载入内存**（帧数 × 宽 × 高 × 3 × float32）：30s@1280×736 ≈ 8 GB 可行（空闲内存只剩 ~2 GB 时也过）；
  **61s 源 = 16.6 GB，31 GB 机器直接 OOM（实测）**。长源先裁剪再 retake（`ffmpeg -t 30 -c copy`）。
- 渲染时长 = 源 VAE 重编码 + 窗口重渲 + 重组装：30s 源改 8s 窗 ≈ 24 分钟（5090 实测）。

## 验证记录（2026-09-22，RTX 5090）

| 用例 | 结果 |
| --- | --- |
| 61s 源改 8s 窗 | ❌ 源全帧 16.6 GB，DefaultCPUAllocator OOM（预期内，见上） |
| 30s 源改 12–20s（加橘猫上桌，video+audio） | ✅ 时长不变 30.08s；窗口外帧差 2–3（冻结），窗口内帧差 72–76（重渲）；橘猫出现在桌上 |
