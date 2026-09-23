# @local/h3-chain

项目自有 Model 包：MiniMax H3 的**长镜头合约**——一次生成 16–90 秒的连续视频，突破单次 H3 生成
~15 秒的上限。只定义请求语义（端口、Surface），实现由 `provider-comfyui` 的链式 capability 完成。

```xml
<import as="h3c" from="@local/h3-chain@1"/>

<h3c:TakeVideo id="opening" prompt={script} duration="44" resolution="768P" aspect-ratio="16:9">
  <h3c:Reference image={hero.image}/>
</h3c:TakeVideo>
```

## 请求语义

| 端口 | 约束 | 说明 |
| --- | --- | --- |
| `prompt` | 文本 ≤60000 字符 | 链式脚本：**一窗一段**，`---` 单独成行分隔（也接受 JSON `{"prompts":[...]}`） |
| `duration` | 整数 16–90 秒 | 整条 take 的目标时长 |
| `resolution` | 768P / 2K | 同官方 H3 档位 |
| `aspectRatio` | 21:9 … 9:16 | 渲染画幅（有 `first-frame` 时可省略，继承引导图） |
| `firstFrame` | ≤1 图 | 开场帧；同时作为无缝链引擎的身份锚 |
| `referenceImage` | ≤9 图 | 主体参考，**每一窗**都会携带（`<Picture 1..N>`） |
| `referenceAudio` | ≤3 音 | 声音锚（`<Audio 1..3>`） |

## 引擎路由（provider 侧）

- **无参考** → 无限窗引擎（`H3InfiniteTakeSampler`）：单条去噪轨迹 + 重叠窗口升余弦混合，
  **无任何镜头边界**。相位干净几何（窗口 243f / 重叠 34f），可选时长为
  **19, 27, 36, 44, 53, 61, 70, 78, 87 秒**（N 窗 = 204N+39 帧），一窗一段脚本。
- **有参考图/音频/首帧** → 无缝链引擎（`H3MultishotSampler` core）：末帧接力 + 参考逐窗携带，
  脚本 `---` 块数 = 窗数，`duration` 决定每窗帧数（向上取 17k+5 格网，每窗 ≤362f≈15.1s），
  自动开启 save_every_shot 落盘保险。
- Profile 里 `chainEngine: "infinite" | "multishot" | "auto"`（默认 auto 按上述规则路由）。

## 脚本写法要点（来自包的 PROMPTING.md 实测规则）

- 每窗结尾落在**稳定拍**上；词、句绝不跨窗
- 无缝链引擎：第 2 窗起开头原样接住上一窗的收尾状态（同人物、位置、构图，静持 ~2s 但要有
  呼吸/视线等微动作——纯静止会渲染成卡帧）
- 每窗**逐字复述**角色外貌与场景描述（改写措辞是脸漂移的头号原因）；写"变了什么"，不写
  "没变什么"（CFG=1 下否定句会反噬）
- 每窗动作用**不可逆事件**推进剧情（检验：两句互换剧本仍成立 ⇒ 模型也分不清）

## 验证记录（2026-09-21，RTX 5090）

| 用例 | 结果 |
| --- | --- |
| 19s 无限窗（2 窗猫醒伸展） | ✅ 18.625s=447 帧精确；混合区帧间差分 3.20 < 区外 3.66，**无硬切**；~6 分钟 |
| 20s 无缝链+参考图（猫娘 2 窗） | ✅ 20.2s=486 帧；第 2 窗主体（金发猫耳 wink/红项圈铃铛/橘猫）完整保持；~8 分钟 |
| 61s 无限窗（7 窗厨房日光变化） | ✅ **61.125s=1467 帧精确**，h264+AAC 14.9MB；色调曲线完整跟随剧本（晨光→正午→雨→琥珀傍晚→靛蓝夜→暖灯）；~22 分钟。需 InfiniteTake memmap 补丁（见项目 PATCHES.md）+ provider 内存预检通过 |
