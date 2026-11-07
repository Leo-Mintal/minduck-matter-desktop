# 默认鸭 · Coopanion 形象包 v0.3

接口：Coopanion `manifest: 2` / `api: 2`。待机保留原始鸭子分组图形；工作和询问使用用户最新提供的完整 SVG 动画。

## 导入

在 Coopanion 的「装扮」页点「导入」，选择 `默认鸭-Coopanion.zip`，然后选择「默认鸭」。也可导入包含本文件及 `figure.json` 的 `minduck-duck` 文件夹。保留原有 ID `minduck-duck`，旧名称为「小黄鸭」。

## 工作和询问

```js
body.do('work'); // 掏电脑 1.35 秒 → 打字 3 秒 → 收回 1.5 秒 → 待机
body.do('ask');  // 掏纸笔 1.35 秒 → 询问 3.15 秒 → 收回 1.5 秒 → 待机
body.do('stand'); // 收好当前道具，再恢复待机
```

两种动作均单次播放，完成后发出 `done` 事件。动作词表不标记 `lasting`。重复触发同一动作不重头播放；切换其他动作或走路时先收回道具，拖拽时立即中断。

工作和询问的姿势、眼睛、纸笔、电脑及符号均由各自 SVG 控制。播放期间不叠加待机图形的眨眼或口型。其他动作继续使用基础鸭子的呼吸、走路、小跑、跳跃、招手、扑翅膀、表情和拖拽。

## 文件

- `figure.json`：形象资料及提供给模型的动作词表。
- `figure.js`：待机与基础分件动画，导出 `createDuckBody`。
- `flow-state.js`：工作、询问、自动结束、退出和排队动作。
- `flow-player.js`：SVG 动画挂载、宿主时钟同步和释放。
- `flow-artwork.js`：由最新两个 SVG 生成的图形和关键帧。
- `artwork.svg` / `artwork.js`：基础鸭子图形及内嵌模块。

图形全部内嵌，不依赖远程图片或第三方动画引擎。由宿主提供官方 `kit.createBody`，动画只在 `step(dt)` 中推进。

Minduck Matter 桌面端的默认形象。工作 SVG 已于 2026-11-04 更新为用户优化版，保留 1.35 秒进入、3 秒打字、1.5 秒收起；已通过官方沙箱与安装版的循环、切换、拖拽恢复和左右朝向检查。
原画由用户提供，未替用户指定公开许可。

官方接口说明：
https://github.com/Pal-AI-Lab/Coopanion/blob/main/packages/cortico-world-desktop-pet/examples/whale/README.md#写一个形象包
