# 独立去水印工作流（保留原片像素，不重新生成）

适用：只想去掉原视频水印/logo/字幕，其余画面不动。与 `clean_watermark.sh`（delogo 快速路径，
供重新生成流程净化参考素材）互补。

## 状态

- **LaMa 路线已安装待启用**：`comfyui-inpaint-nodes`（Acly，1244★）已 clone 到 5090 的
  custom_nodes，`simple-lama-inpainting` 已 pip 装入 venv（--no-deps，避开了被占用中的 cv2）。
  **下次重启 ComfyUI 后节点生效**；首次运行自动下载 LaMa 模型（Big-Lama ~200MB 到 models/inpaint/）。
- Mask 用 `MaskRectAreaAdvanced`（KJNodes，像素坐标矩形，已在库）。

## 路线一：LaMa 逐帧修补（推荐，质量/速度均衡）

```
VHS_LoadVideo(原片, force_rate=0) ──images──┐
                                            ├─ LaMaInpaint ── VHS_VideoCombine(音频=原片audio)
MaskRectAreaAdvanced(x,y,w,h) ──mask───────┘
```

API-format 工作流模板（bbox 换成 watermark_detect 的实测值）：

```json
{
  "load": {"class_type":"VHS_LoadVideo","inputs":{"video":"SOURCE.mp4","force_rate":0,"custom_width":0,"custom_height":0,"frame_load_cap":0,"skip_first_frames":0,"select_every_nth":1,"format":"None"}},
  "mask": {"class_type":"MaskRectAreaAdvanced","inputs":{"x":518,"y":1084,"width":198,"height":160,"image_width":720,"image_height":1280,"blur_radius":12}},
  "lama": {"class_type":"LaMaInpaint","inputs":{"image":["load",0],"mask":["mask",0]}},
  "out": {"class_type":"VHS_VideoCombine","inputs":{"images":["lama",0],"audio":["load",2],"frame_rate":30,"loop_count":0,"filename_prefix":"WatermarkRemoved","format":"video/h264-mp4","pix_fmt":"yuv420p","crf":18,"save_metadata":true,"trim_to_audio":false,"pingpong":false,"save_output":true}}
}
```

提交：`curl -X POST http://$COMFYUI_HOST:8000/prompt -H "content-type: application/json" -d '{"prompt": <上图>, "client_id":"lama-clean"}'`
（SOURCE.mp4 先经 `/upload/image` 传入 input 目录）

## 路线二：H3 Fun ControlNet mask 重绘（生成式，动静大时更稳）

5090 权重已就位（`minimax_h3_fun_controlnet_union_pruned_int8_convrot`）。原生节点
`MiniMaxH3FunControlNetApply` 带 `mask`（"1 marks the regions to regenerate"）+ `source_video`
（mask 后面的原画面）。适合水印区域结构复杂、LaMa 修补糊掉的场景；代价是整段重渲（分钟级）。
未实测——需要时通过 `@local/h3-control` 的 mask 扩展接入。

## 路线三：官方 LTX 2.3 去水印流

comfy.org 官方模板（LTX 2.3 LoRA 逐帧 diffusion inpaint），ComfyUI 模板库里自带；需要 LTX 权重
（未下载）。适合已装 LTX 的部署。

## 选择建议

| 场景 | 路线 |
| --- | --- |
| 重新生成流程的素材净化 | `clean_watermark.sh`（delogo，秒级） |
| 保留原片、静态小水印 | LaMa（路线一） |
| 保留原片、复杂区域/大块 | H3 mask 重绘（路线二）或 LTX（路线三） |
