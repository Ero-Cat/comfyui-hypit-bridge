# provider-comfyui

把一台 ComfyUI 部署（your GPU machine）作为 Hypit 的 MiniMax H3 生成服务。实现三个能力：

| Capability | Model | 用途 |
| --- | --- | --- |
| `@hypit/minimax-h3@1#minimax-h3` | `<h3:TextVideo>` / `<h3:FrameVideo>` / `<h3:ReferenceVideo>` | 单镜头 6–15s；**视频参考走 ref2va + ReferenceToVideo** |
| `@local/h3-chain@1#h3-chain-take` | `<h3c:TakeVideo>`（项目包 model-h3-chain） | 长镜头 16–90s，双引擎自动路由 |
| `@local/h3-retake@1#h3-retake` | `<h3r:Retake>`（项目包 model-h3-retake） | 改写已有视频的一个时间窗（含只改音频/只改画面模式） |
| `@local/h3-control@1#h3-control` | `<h3ctl:ControlVideo>`（项目包 model-h3-control） | **动作严格跟随**：控制视频(姿态/深度/预提取) + 提示词换皮 |

Profile 里绑定到 endpoint `comfyui.5090`（见 hypit.runtime.json）。

## 动作跟随能力（`@local/h3-control@1#h3-control`）

控制视频 → `VHS_LoadVideo(24fps)` → 按 `control-type` 提取信号（`pose`→`DWPreprocessor` 骨架、
`depth`→`DepthAnythingPreprocessor`、`raw`→预提取信号直通）→ `MiniMaxH3FunControlNetApply`
（官方 Fun ControlNet Union patch，强度 1）挂在 ref2va 模型上，条件/latent 来自无参考的 R2V 编码，
采样沿用参考档（res_multistep/simple，20 步；`refTurbo:true` 时 4 步 turbo）。提交前校验 ref2va 与
patch 权重对 ComfyUI 可见（`/object_info`），下载未完成时明确报错。**未做 GPU 实测**（权重下载中）；
验证用例 `h3-control-test.svrun` 已写好，check/plan 通过，权重就位后直接 `hypit build` 即可。

## 请求路由

按请求形态走两条已在你机器上验证过的图模板：

| 请求 | 模板 | 关键节点 |
| --- | --- | --- |
| 纯文本（T2V）、首帧图、参考图/声音锚 | 无缝链采样单镜头 | `H3MultishotSampler`（ComfyUI-H3-Multishot 包） |
| 带尾帧（首帧可选，FL2VA 本职） | 原生首尾帧路径 | `MiniMaxH3ImageToVideo` + `SamplerCustomAdvanced` |

两条模板共用部署配置：FL2VA int8-convrot 权重 → fl2v turbo 8-step LoRA → SolAttnPatch（你的
euler/beta/8 步参数），输出经 `VHS_VideoCombine` 合成 h264+AAC mp4（24 fps），再回收到 Hypit Result。

## 端口映射与限制（`supports` 如实上报）

| Hypit 端口 | 映射 | 说明 |
| --- | --- | --- |
| `prompt` | `script` / `prompt` 输入 | 单镜头请求；含 `---` 分行会被拒绝（那是 multishot 分镜分隔符） |
| `duration` | `frames_per_shot` / `length` | H3 的 17k+5 帧格网向上取整（124–362 帧）；**只接受 6–15 秒** |
| `resolution` | 分辨率像素预算 | 768P ≈ 1280×736（你的验证配方）；2K ≈ 2048×1152（未在本机验证过） |
| `aspectRatio` | width/height（对齐 32） | 帧引导模式禁用（Model 约束），改用引导图的宽高比 |
| `firstFrame` | `start_image` / `first_frame`（先 lanczos 缩放） | |
| `lastFrame` | `last_frame` | 走原生模板 |
| `referenceImage`（≤9） | `reference_images`（多图用 `ImageBatch` 批处理） | 作为 `<Picture 1..N>` 进条件 |
| `referenceAudio`（≤3） | `voice_ref` / `_2` / `_3` | 作为 `<Audio 1..3>` 声音锚 |
| `referenceVideo` | **不支持，明确拒绝** | 该部署没有视频参考输入通路 |

其他行为：并发 1（单卡）；轮询 `/history` + `/queue`（队列位置会在进度里显示）；取消 = 删队列 +
`/interrupt`（尽力而为）；本机渲染 `pricing: local`，无凭据槽（局域网地址只接受 http 回环/内网，
公网需 https）。

## Profile 配置（hypit.runtime.json）

```json
"comfyui.5090": {
  "use": "provider-comfyui",
  "config": {
    "baseUrl": "http://<comfyui-host>:8000",
    "concurrency": 1,
    "pollIntervalMs": 5000
  }
},
"bindings": { "@hypit/minimax-h3@1#minimax-h3": "comfyui.5090" }
```

可覆盖配置项（均有部署默认值）：`steps`、`sampler`、`scheduler`、`crf`、`filenamePrefix`、
`unetName`、`loraName`（设为 `""` 可关掉 LoRA 节点）、`clipName`、`videoVaeName`、`audioVaeName`、
`useSolAttn`、`chainEngine`（`auto`/`infinite`/`multishot`，链式能力的引擎路由）、
`refUnetName`（ref2va 权重名，设 `""` 关闭视频参考）、`refLoraName`、`refTurbo`（true=ref2v 4步
turbo LoRA，5× 快但 v0.1 质量）、`refSteps`/`refSampler`/`refScheduler`（默认官方档
20/res_multistep/simple）。

## 自动参数推导（2026-09-22）

作者不写的参数从**参考素材和文案**推导，显式指定的永远优先：

| 参数 | 推导规则 |
| --- | --- |
| 画面比例 | 视频参考 → mp4 头解析宽高比；图像参考/首帧 → 图片宽高比；都无 → 16:9 |
| 分辨率 | 参考素材像素面积 ≥1.6MP → 2K，否则 768P；**默认封顶 768P**（2K 未实测，配置 `allowAuto2K: true` 解锁自动 2K） |
| 时长 | `h3c:TakeVideo` 不写 duration：无缝链按每窗词密度估读（中文字/英文词 × 0.6s，钳 8–15.1s/窗，17k+5 格网取整）；无限窗按窗数落相位干净阶梯。`h3ctl:ControlVideo` 不写 duration：**跟随控制视频自身时长**（≤15s） |
| 音频 | 视频参考（`<h3:ReferenceVideo video=...>`）未给显式音频参考时，**参考视频自己的音轨自动挂上**（`ref_video_audios`，声音身份跟随） |

实测：h3-auto-test（只给脚本+方图参考）→ 双窗 × 345 帧（按词密度推出 14.4s/窗）= 28.7s 成片，
档位 768P ✓；比例推导在参考路径（视频/图片）与链式路径均已接入。

## 视频参考能力（`referenceVideo` 端口 → R2V 引擎）

带 `video` 参考的 `<h3:ReferenceVideo>` 自动切到 **ref2va 权重 + 原生 `MiniMaxH3ReferenceToVideo`**
（官方 R2V 配方：无 SolAttn、无 fl2v LoRA）：图像/视频/音频参考经多模态文本编码器进条件，
**动作按提示词走、主体身份跟随参考**。提交前校验 ref2va 权重对 ComfyUI 可见（下载未完成时明确报错）。
显存策略：fl2va 与 ref2va 按请求形态自动切换，ComfyUI 自动逐出/重载（切换 ~1 分钟内），绝不并存。

## Retake 能力（`@local/h3-retake@1#h3-retake`）

源视频经 `/upload/image` 传到 input 目录 → `VHS_LoadVideo(force_rate=24)` → `H3Retake`
（窗口重渲 + 两侧冻结）→ VHS 合成。mode 映射：`video+audio`/`video`(保声音)/`audio`(只改声音)。
**内存约束：源全帧载入内存**——30s@768P ≈ 8 GB 可行，61s 源 16.6 GB 会 OOM（31 GB 机器实测），长源先裁剪。

## 链式能力（`@local/h3-chain@1#h3-chain-take`）

| 请求 | 引擎 | 图 |
| --- | --- | --- |
| 无参考 | 无限窗（`H3InfiniteTakeSampler`，243/34 相位干净几何，单轨迹升余弦混合，强制 euler） | 一窗一段 JSON prompts |
| 有参考图/音频/首帧 | 无缝链（`H3MultishotSampler` core，`---` 块=窗数，shot_count=0，≥2 窗自动 save_every_shot） | 参考逐窗携带 |

时长语义：无限窗可选 **19/27/36/44/53/61/70/78/87s**（N 窗=204N+39 帧，supports 阶段如实拒绝
其余值）；无缝链 16–90s 任意（每窗 ≤362 帧，帧数向上取 17k+5 格网）。其余限制同单镜头
（referenceVideo 拒绝、768P/2K、局域网地址策略、并发 1）。

## 重新构建

```bash
cd packages/provider-comfyui && npm install && npm run build
cd ../.. && npm install ./packages/provider-comfyui
```

## 验证记录（2026-09-21）

| 用例 | 结果 |
| --- | --- |
| `h3-test.svrun`（T2V 6s 768P 16:9） | ✅ 1280×736 h264+AAC，6.58s（158 帧），约 1m41s 渲染 |
| `h3-frame-test.svrun`（首+尾帧 6s） | ✅ 首尾帧逐像素锚定（帧 0 = 首图、帧 157 = 尾图），6.58s |
| `h3-ref-test.svrun`（1 张参考图 9:16） | ✅ 736×1280 竖幅，6.58s；参考主体（金发猫耳少女 + 橘猫、绿眼 wink、红项圈金铃铛、米白针织衫、2D 动漫画风）完整迁移到生成视频 |
| `h3-chain-60s.svrun`（61s 无限窗 7 窗） | ✅ 61.125s=1467 帧精确；需 memmap 补丁（PATCHES.md）+ 内存预检 |
| `h3-retake-test.svrun`（30s 源改写 12–20s 窗，加橘猫） | ✅ 时长不变；窗口外帧差 2–3（冻结）、窗口内 72–76（重渲）；橘猫出现。61s 源会 OOM（源全帧 16.6GB），长源先裁剪 |
| `h3-refvideo-test.svrun`（20s 视频参考 → 8s 新场景，ref2va+R2V） | ✅ 身份逐项保持（发色/猫耳/项圈铃铛/针织衫/橘猫），场景动作按提示词全新；~30.5 分钟（含权重首载 + 视频过 32B 视觉编码器 + 20 步） |
| `h3-dahuangmao-test.svrun`（**换台词保声音保人物去水印**：52s 真人 talking-head → 大黄猫台词） | ✅ 54.5s/4 窗；人物身份保持（黑长直+圆框眼镜+白上衣+暖光房间）；**画面无水印**（参考帧裁剪+全新生成）；语音节拍符合脚本（气闸开场+窗口间自然停顿）；自动参数全程生效（比例/档位从参考图推导，时长显式 52）。声线相似度需人耳判断（7s 声音锚机制为包作者的实测声线钉扎路径）。注意：**声音锚必须 ≤12s**（52s 全片音轨会炸 HostBuffer.read_file_slice，已加预检） |
| `h3-dahuangmao32-test.svrun`（v2：32s + 转写节拍 + ref2va链 + 首帧锚 + selfAnchorVoice） | ✅ 32.417s 精确；**输出转写逐行命中新台词**（含"这样子？/瘦了？"原片节拍镜像）；画风与参考一致（帧分析确认）；无水印；ref2va+4步turbo 使 32s 渲染仅 ~17.5 分钟。声线统一性机制齐备（self_anchor_voice），人耳验收 |
| `h3-dahuangmao33-test.svrun`（v3：正确净化参考[水印实为右下角] + 按摩挑逗修正脚本） | ✅ **水印彻底消除**（右下文字梯度 1.2-1.5 vs 原片 4.2）；台词实质全命中（"我给你按舒不舒服呀/收按摩费/宠你这一次"，个别字词弹性）；窗口 3 帧验证：人物三要素+画风一致、双手朝右下揉捏按摩动作正确；32.417s。**流程契约跑通**：detect→delogo→extract→transcribe→brief 过目→用户修正→生成→verify |
| `h3-dahuangmao34-test.svrun`（v4：fl2va@8 + 脸部裁片参考 + 去短视频措辞 + 成品 delogo 后处理） | ✅ 身份中段帧验证（三要素+按摩动作+无字幕）；台词实质全命中；32.417s；**字幕条（模型自生成的抖音先验）由成品后处理 delogo 消除**。经验：模型对"对镜头说话"内容有画字幕条的强先验，提示词只能部分抑制，成品后处理是稳妥兜底 |

注意：`.svml` 里提示词正文中的 `<Subject 1>` 这类尖括号必须写成 `&lt;Subject 1&gt;`（XML 实体）。
| `upscale16.svrun`（**1080P 超分 GAN 档**：tonghuashun 16s 1280×736 → 1920×1080，4x-UltraSharp + VHS meta-batch 48 帧批） | ✅ 2026-09-24：1920×1080/24fps/294 帧精确、AAC 音轨保留、时长不变；1.06s/帧（48 帧批；16 帧批 2.3s/帧）；QC 网格：发丝/边缘/织物细节提升，无过锐伪影无色偏。**meta-batch 追踪机制**：VHS 重排队后代由 poll 按上传文件名领养（trackVideo handle 字段，所有 wakeAfter 必须携带） |
| `upscale16-sv2.svrun`（**1080P 超分 SeedVR2 档**：同源，seedvr2_3b_int8 + 原生节点链，单 prompt 无分批） | ✅ 2026-09-24：1920×1080/24fps/294 帧、音轨保留；1.19s/帧（≈官方 5090 口径）；QC：发丝成缕重建/缎面织物高光自然、五官零漂移、四节拍稳定。护栏：源 ≤45s（主机 RAM 约束），超限在 start 阶段拒绝并建议 gan 档 |
