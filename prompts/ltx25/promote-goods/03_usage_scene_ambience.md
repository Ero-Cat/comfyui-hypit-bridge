# 03 使用场景氛围（lifestyle ambience）

**意图**：生活方式植入——商品出现在真实使用场景里，环境氛围与人物（可远景/侧影）共同讲
"用了它生活更好"。适合：家居、餐厨、出行、办公品。横幅素材层，多用于口播视频的过场 B-roll。

## 英文 prompt（可直接用）

```
A slow lateral dolly across a sunlit morning kitchen: {场景与商品, e.g. a glass carafe of
fresh orange juice catching the light beside a bowl of fruit} on the wooden counter, steam
rising from a mug, a soft curtain breathing in the breeze, a woman in a cream sweater reaching
in from the edge of frame to pour a glass. Golden window light, gentle dust motes. The camera
glides at counter height and settles on the pouring glass. A bright kitchen ambience with
birds outside, the liquid pour, a distant cheerful hum. Unscored.
```

## 参数卡

| 项 | 值 |
| --- | --- |
| 画幅 | 横 1280×768（16:9） |
| 帧数 | 121（5s） |
| 工作流 | `LTX25_T2V_Baseline.json` |

## 写法要点

- **商品是画面的光线焦点**（catching the light / framed by ...），但场景元素占同等篇幅——
  氛围片卖的是场景联想，不是单品参数。
- 人物只写**轮廓与局部**（a woman in a cream sweater、hands reach in）——LTX 无身份参考，
  面部特写一致性弱；人物别给正脸台词（要口播人物走 H3）。
- 环境声是氛围片灵魂：三件以上（ambience + 一个主声源 + 一个远景声 birds/traffic）。
- 运镜选一个**单一连续**动作（lateral dolly / slow push-in / glide + settle），一段一镜；
  "then cut to" 留给 04 多镜头模板。
- 变体：雨天窗边（rain streaking the glass, a low rumble of thunder outside）、夜晚台灯
  （warm pool of lamplight, crickets faint through the window）、户外（handheld walk-along）。

## 合规提醒

"fresh / healthy / energizing" 可用；疾病/功效联想（boosts immunity、cures fatigue）禁。
