# 02 开箱上手（unboxing / hands-on）

**意图**：手部入镜交互——拆包装/拿起/操作/合体，展示开箱体验与上手质感。适合：配件、
小家电、玩具、组合装。有手部特写但无面部无台词。

## 英文 prompt（可直接用）

```
Vertical close-up film: a pair of hands lifts {产品与包装描述, e.g. a compact white earbuds
case} out of an open gift box on a tidy desk, peels the protective film, presses the lid open
with a satisfying click and tips the earbuds onto a palm. Warm desk-lamp light, shallow depth
of field. The camera holds a tight close-up, drifting slightly with the motion. Crisp paper
rustle, the peel of film, a firm magnetic click, a quiet room behind. Unscored.
```

## 参数卡

| 项 | 值 |
| --- | --- |
| 画幅 | 竖 768×1280 |
| 帧数 | 145（6s，动作拍多给 1s） |
| 工作流 | `LTX25_Vertical_Product.json`（改 length 与 prompt） |

## 写法要点

- **动作分解成 3–4 拍**（lift → peel → open → tip），每拍一个动词短语；LTX 6s 大约容 3–5 拍，
  超了会赶/跳。参照 h3 经验：动作拍 3.5–4s/拍是长镜标准，LTX 单镜内动作拍按 1–1.5s/拍排。
- **声音是这类片子的主角**：纸盒摩擦、撕膜、磁吸咔哒——逐项写进 [SOUNDS] 位置（正文末段），
  "satisfying click" 这类质感词对声效生成有引导作用。
- 手部畸变是视频模型弱项：手部动作写**大幅度、慢速、少交叉**（重拿轻放、单手主导）；
  避免十指交叉/精细指尖动作。
- 有商品实拍图？走 **i2v**（`LTX25_I2V_Baseline`）：`Starting from the provided image as the
  first frame, hands reach in and lift the {产品} out of frame...`——首帧锁真实商品外观，
  后续动作生成。
- 变体：一键启动演示（`presses the single button, a small light blinks on`）、组装
  （`clicks the two halves together`）。

## 合规提醒

包装上不要生成品牌 LOGO/认证标（写 `unbranded packaging`）；中文卖点别写进 prompt。
