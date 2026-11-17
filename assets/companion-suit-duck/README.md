# 新西装鸭源素材

用户于 2026-11-16 提供六份 SVG；原文件字节保留于 `source/`。

- `base.svg` ← `Boss Duck/Original IP Suit/Duck_Walk_InPlace_Idle_Transition.svg`（静态基础图）
- `idle.svg` ← `Duck_Idle_Animated.svg`
- `working.svg` ← `Duck_Working_Animated.svg`
- `confirmation.svg` ← `Duck_Confirmation_Animated.svg`
- `success.svg` ← `Duck_Success_Animated.svg`
- `failure.svg` ← `Duck_Failure_Animated.svg`

`project.json` 保持原形象 ID `minduck-suit-duck`，通过源脚掌尺寸统一各画稿的比例与基线。
工作原画脚掌宽度为其他动作的约 1/1.0515，画布另有平移，需独立归一化。
成功与失败的角色自带水平画布偏移，已在放置参数中抵消；彩纸及道具保持相对位置。
基础原画没有语义分组；构建脚本的节点分组只针对这份已核对的具体文件，节点结构变更会要求重新核对。

```sh
python3 scripts/build-suit-duck.py
python3 scripts/build-suit-duck.py --check
node --test scripts/companion-suit-pose.test.cjs
MINDUCK_COMPANION_SUIT_POSE_ONLY=1 pnpm run test:companion
```

生成目标：`src/companion/figures/minduck-suit-duck/` 的 `artwork.svg`、`artwork.js`、`flow-artwork.js`。
`sources.json` 记录源 SHA-256、路径/滤镜数和原始轨道数，不自动修改原 SVG。
工作、成功、失败源文件分别有 188、4、4 个滤镜区域被导出为 `inf/-inf`。
`filter-bounds.json` 按滤镜所属图形的局部 `getBBox()` 加四倍高斯模糊标准差测得有限边界；构建时仅替换这四个区域属性，保留滤镜原语及原文件。
校准数据绑定源 SHA-256，源变更或出现未校准的非法区域会明确报错；使用项目现有 Electron 重新测量：

```sh
./node_modules/.bin/electron scripts/measure-suit-duck-filters.cjs
```

本地 `coopanion-svg` 的完整动作编译器不支持成功素材中的 `offset-distance`，因此使用项目内扩展转换器；未修改全局 CLI。
原画权利归原权利人，本目录不授予公开许可。
