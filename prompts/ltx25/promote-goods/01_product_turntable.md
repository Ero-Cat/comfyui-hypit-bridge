# 01 产品特写旋转展示（turntable）

**意图**：单品立体展示——商品在棚拍感背景中缓慢旋转，光线扫过表面材质，观众看清外观/工艺。
适合：3C、美妆瓶身、饰品、包装设计感强的品。无手部、无人物、无台词，纯产品 + 声效。

## 英文 prompt（可直接用）

```
Vertical product film: {产品英文名与外观描述, e.g. a matte aluminium power bank with rounded
edges and a small LED indicator} stands centered on a glossy dark podium in a soft-lit studio,
a slow smooth orbit around it as gentle light sweeps across the surface revealing texture and
finish, subtle reflection beneath. The camera moves in one continuous arc, then eases into a
settling close-up. Faint airy room tone and a single soft chime as the shot settles. Unscored.
```

## 参数卡

| 项 | 值 |
| --- | --- |
| 画幅 | 竖 768×1280（9:16） |
| 帧数 | 121（5s） |
| 工作流 | `LTX25_Vertical_Product.json` |
| 变体-横幅 | 1280×768 + `LTX25_T2V_Baseline.json` |

## 写法要点

- **{占位符}** 换成品名与两三个外观细节（颜色/材质/标志件）；细节越具体，材质还原越准。
- 结尾**必须落在稳定拍**（"eases into a settling close-up"）——LTX 单镜头收尾不稳会拖影。
- 声音三件套：room tone（低底噪）+ 一个收尾 chime + **Unscored**。要产品声（按键咔哒、
  瓶盖旋开）就写进正文，例：`a soft click as the cap twists a quarter turn`。
- 禁写 "no hands / no text / no watermark"——否定句被无视；正面写 `stands alone, empty
  background`。
- 变体：转速更快（`a brisk double orbit`）、拉出 reveal（`the camera pulls back revealing the
  full product line beside it`——多品陈列用）。

## 合规提醒

画面描述避免医疗/功效暗示词（whitening、anti-aging、cure 等即使写进 prompt 也不建议——
成片可能带出相应视觉表达）。
