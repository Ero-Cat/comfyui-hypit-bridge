# prompts/ltx25 — LTX-2.5 提示词预制库

按场景预制的 LTX-2.5 提示词模板。每份含：中文意图、可直接用的英文 prompt、参数卡（画幅/帧数/档位）与音频写法要点。写新提示词前先读 `.zcode/skills/ltx-video/SKILL.md` 的硬契约。

## 提示词结构速记（音画同文）

```
一整段英文：镜头/景别 → 主体+外观 → 动作 → 环境/光线 → 运镜 → 声音描述（环境声/产品声效/旁白引号原句）。
多镜头/台词用 [VISUAL] / [SPEECH] / [SOUNDS] 三段模板（IC-LoRA 已烘入本检查点，精度最高）。
无配乐写 "Unscored"（禁否定句）；声音不写会被发明，带货片必须显式写。
```

## 参数速记

| 项 | 值 |
| --- | --- |
| 画幅 | 横 1280×768（16:9）/ 竖 768×1280（9:16），必须 %64==0 |
| 时长 | 4–10s，帧数 8k+1：97/121/145/169/193/217/241 @24fps |
| 采样 | distilled (8 steps) → latent x2 → refine (3 steps)，节点预设；CFG 恒 1，负提示词留空 |
| i2v | 写"接下来发生什么"；首帧勿预缩放（节点自行居中裁切） |

## 目录

| 文件 | 场景 | 画幅/时长 |
| --- | --- | --- |
| [promote-goods/01_product_turntable.md](promote-goods/01_product_turntable.md) | 产品特写旋转展示（纯背景棚拍感） | 竖 768×1280 / 5s |
| [promote-goods/02_unboxing_hands_on.md](promote-goods/02_unboxing_hands_on.md) | 开箱上手（手部交互 + 包装细节） | 竖 768×1280 / 6s |
| [promote-goods/03_usage_scene_ambience.md](promote-goods/03_usage_scene_ambience.md) | 使用场景氛围（生活方式植入） | 横 1280×768 / 5s |
| [promote-goods/04_multishot_narrative.md](promote-goods/04_multishot_narrative.md) | 多镜头一镜过叙事（VISUAL/SPEECH/SOUNDS 全模板） | 竖 768×1280 / 10s |

带货合规：所有 [SPEECH] 台词与画面文案过 `tools/check_compliance.py`（禁价格/时间限制/产地/
功效宣称/配料表/极限词）。台词声线不做人物绑定（LTX 无声音锚），需要口播人物出镜保声线走 H3
promote-goods 主配方，LTX 素材作 B-roll 层。
