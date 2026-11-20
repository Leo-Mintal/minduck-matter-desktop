# 西装鸭十动作源素材

用户于 2026-11-20 提供的完整合集逐字节保存为 `source/collection.svg`。
`collection.json` 记录原始 SHA-256、十个语义组 ID 和拆分文件哈希；`sources.json` 记录轨道、路径与滤镜数量。
`scripts/build-suit-duck.py` 每次先按 `project.json` 的语义组重建独立 SVG，再生成运行资源。

询问和抱资料的袖子各有 29 个单白色轮廓遮罩。生成时将这些遮罩转为同坐标、同路径的 `clipPath`，避免缩小时袖子边缘混出底下的黄色；原始 SVG 不修改，`sources.json` 的 `repairedSleeveClips` 记录处理数量，其他遮罩保持原样。

| 原组序号 | 独立文件 | 用途 |
| --- | --- | --- |
| 01 | walking.svg | 连续步态片段用于走路和跑步 |
| 02 | idle.svg | 8 秒待机；语义部件生成通用动作基础图 |
| 03 | working.svg | 电脑工作 |
| 04 | writing.svg | 纸笔书写 |
| 05 | confirmation.svg | 询问与确认 |
| 06 | success.svg | 成功庆祝 |
| 07 | failure.svg | 失败 |
| 08 | thinking.svg | 思考 |
| 09 | flag.svg | 文件与红旗 |
| 10 | carry.svg | 抱资料等待 |

十个源动作均为 8 秒，共 1,820 条轨道。`project.json` 保持形象 ID `minduck-suit-duck`，通过原始脚掌的局部边界统一比例与地线。
工作稿约需放大 1.0515 倍；其他动作按实测脚掌宽度对齐。保留原 SVG 188×1140 内层视口，避免 motion-path 和 transform-box 坐标发生变化。
基础图按 Eyes、Wings、Legs、Suit 等语义组生成，保留新西装袖口；`base.svg` 是旧版静态素材留存，不再参与生成。

```sh
python3 scripts/build-suit-duck.py
python3 scripts/build-suit-duck.py --check
node --test scripts/companion-suit-pose.test.cjs
MINDUCK_COMPANION_SUIT_POSE_ONLY=1 pnpm run test:companion
```

生成目标：`src/companion/figures/minduck-suit-duck/` 的 `artwork.svg`、`artwork.js`、`flow-artwork.js`。
本批素材只有电脑工作动作含有非法 `inf/-inf` 滤镜区域，共 192 个。
`filter-bounds.json` 按滤镜所属图形的局部 `getBBox()` 加四倍高斯模糊标准差测得有限边界；构建时仅替换这四个区域属性，保留滤镜原语及原文件。
校准数据绑定源 SHA-256，源变更或出现未校准的非法区域会明确报错；使用项目现有 Electron 重新测量：

```sh
./node_modules/.bin/electron scripts/measure-suit-duck-filters.cjs
```

本地 `coopanion-svg` 的完整动作编译器不支持成功素材中的 `offset-distance`，因此使用项目内扩展转换器；未修改全局 CLI。
原画权利归原权利人，本目录不授予公开许可。
