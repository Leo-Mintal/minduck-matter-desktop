# 西装鸭动作源素材

待机、工作、询问、成功和失败来自 2026-11-23 提供的五个独立 SVG。原件逐字节保存在下表对应文件中。`project.json` 的 `motionGroup` 指向每张卡片的角色组；生成时保留 440×266 视口、道具、完整动作，去掉标题、时长文字和卡片底色。待机也是缩略图与通用表情的基础图。
走路和书写从 2026-11-20 的十动作原件 `source/collection.svg` 拆分。`collection.json` 记录本次仍从合集拆分的动作，`sources.json` 记录所有使用中的源文件哈希和轨道数。

新版工作、询问、成功、失败各有 49、29、49、49 个深蓝袖子外描边。生成时仅在描边与实心填充同色、同路径且遮罩确为其反向轮廓时解除描边遮罩，让交界处覆盖黄色翅膀。白色袖口保留。询问原有的单白色轮廓遮罩继续转为同路径裁剪。以上处理只发生在生成物中。

| 原组序号 | 独立文件 | 用途 |
| --- | --- | --- |
| 01 | walking.svg | 连续步态片段用于走路和跑步 |
| 02 | idle.svg | 8 秒待机；语义部件生成通用动作基础图 |
| 03 | working.svg | 电脑工作 |
| 04 | writing.svg | 纸笔书写 |
| 05 | confirmation.svg | 询问与确认 |
| 06 | success.svg | 成功庆祝 |
| 07 | failure.svg | 失败 |

七个源动作均为 8 秒，共 1,488 条轨道。`project.json` 保持形象 ID `minduck-suit-duck`，通过原始脚掌的局部边界统一比例与地线。
工作稿约需放大 1.0515 倍；其他动作按实测脚掌宽度对齐。保留各自的原始内层视口，避免 motion-path 和 transform-box 坐标发生变化。
基础图按 Eyes、Wings、Legs、Suit 等语义组生成，保留新西装袖口；`base.svg` 是旧版静态素材留存，不再参与生成。

```sh
python3 scripts/build-suit-duck.py
python3 scripts/build-suit-duck.py --check
node --test scripts/companion-suit-pose.test.cjs
MINDUCK_COMPANION_SUIT_POSE_ONLY=1 pnpm run test:companion
```

生成目标：`src/companion/figures/minduck-suit-duck/` 的 `artwork.svg`、`artwork.js`、`flow-artwork.js`。
五份独立原稿中，工作有 188 个非法滤镜区域，成功、失败各 4 个。
`filter-bounds.json` 按滤镜所属图形的局部 `getBBox()` 加四倍高斯模糊标准差测得有限边界；构建时仅替换这四个区域属性，保留滤镜原语及原文件。
校准数据绑定源 SHA-256，源变更或出现未校准的非法区域会明确报错；使用项目现有 Electron 重新测量：

```sh
./node_modules/.bin/electron scripts/measure-suit-duck-filters.cjs
```

本地 `coopanion-svg` 的完整动作编译器不支持成功素材中的 `offset-distance`，因此使用项目内扩展转换器；未修改全局 CLI。
原画权利归原权利人，本目录不授予公开许可。
