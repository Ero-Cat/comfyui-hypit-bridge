---
name: video-rewrite
description: 给一个真人/角色视频换台词、保人物、保声线、去水印的组件化流水线。当用户提供源视频要求改写对话内容、替换主体、去除水印或保持声音特征时使用；包含转写→过目→生成→验证的完整契约。
---

# video-rewrite：视频改写流水线

把"给视频 → 改台词/保人物/保声线/去水印"走成固定契约。所有工具在项目 `tools/` 目录，
独立可调用；生成走本项目的 `@local/h3-chain`（`<h3c:TakeVideo>`）能力。

## 硬性流程契约（不可跳过）

1. **净化**：`watermark_detect` 检测 → **agent 判断真水印区域**（检测器会把静止背景误报为水印，
   四角命中时人工核对亮度/形状特征）→ `clean_watermark` delogo 修补 → 有边框线伪影时追加裁剪
2. **提取**：`extract_assets` 从净化版抽 5 张多角度参考帧 + 完整音轨 + 首帧
3. **转写**：`transcribe` → transcript.srt + brief.md（节拍表自动生成，**大意/情绪曲线由 agent 补全**）
4. **⏸ 过目点（必须停下）**：把 brief.md 的原片大意 + 节拍表 + **新脚本草案**（含目标时长、窗口划分）
   展示给用户，等确认或修改要求。**用户确认前不得提交渲染。**
5. **生成**：确认后组装 `<h3c:TakeVideo>`（净化参考帧 ×5 + 声音锚 ≤12s + 可选首帧；
   duration 显式或按脚本词密度自动；比例/分辨率自动推导），`hypit build` 提交
6. **验证**：`verify_output` 全项（时长/无静态水印残留/静音节拍/转写逐行核对），报告给用户

## 脚本速查

```bash
python3 tools/watermark_detect.py <video> > wm.json        # 检测（需 agent 判断真伪）
bash tools/clean_watermark.sh <in> <out> --json wm.json     # delogo 修补
bash tools/extract_assets.sh <clean.mp4> <outdir> [时刻...] # 参考帧 + 音轨
bash tools/transcribe.sh <wav> <outdir> --cut "START DUR"   # 转写 + brief + 声音锚
bash tools/verify_output.sh <out.mp4> --expect-script <txt> # 全项验证
```

## 关键经验（踩过的坑）

- **水印位置必须实测**：视觉模型会说错角落（本例说右上、实际右下 x524-716/y1090-1238）；
  静态背景（墙面/边框线）会被检测器误报，须按亮度反差和字形特征人工判别
- **脏参考会被全程复刻**：参考帧/首帧里的任何静态伪影（水印、边框线）都会被模型学进全片
- **模型会给"对镜头说话"内容自生成字幕条**（抖音先验，底部中央）：提示词删掉"短视频"类措辞只能部分抑制；
  标准兜底 = 成品后处理 `clean_watermark.sh` 对字幕条 bbox delogo（位置静态固定，效果好）
- **身份参考用脸部特写裁片**（多角度，包作者标准做法），全场景帧当参考会被当风格/场景信号稀释
- **ref2va+4步turbo 的链式身份保持弱于 fl2va+8步**（实测两次失败）；Identity 优先时用 fl2va@8 + start_image
- **声音锚 ≤12 秒**：整段原声作锚会在渲染中段炸 HostBuffer.read_file_slice；选最干净的一句
- **身份一致性**：净化参考 + ref2va + 首帧锚；`chainTurbo=false`（Profile 配置）可换 20 步质量档
- **台词节拍**：新脚本镜像原片节拍结构（转写节拍表），每窗结尾落稳定拍、逐窗复述人物设定、
  词不跨窗；中文 ~0.22s/字，英文 ~0.6s/词
- 生成参数：比例/分辨率从参考自动推导（默认封顶 768P，`allowAuto2K` 解锁）；时长显式给或自动

## 独立去水印（不重新生成、保留原片像素时）

见 `tools/remove_watermark_comfyui.md`（LaMa inpainting 独立工作流，或 H3 ControlNet mask 重绘）。
