# 西装鸭

Coopanion manifest 2 / API 2，ID：minduck-suit-duck。
形象包版本 1.1.0，使用 2026-11-16 提供的新西装、单片眼镜原画。

| 素材 | 宿主动作 | 播放 |
| --- | --- | --- |
| Duck_Walk_InPlace_Idle_Transition.svg | 基础形象、走路/跑步/拖拽等通用动作 | 静态源图，部位由宿主驱动 |
| Duck_Idle_Animated.svg | neutral 待机 | 原始 6 秒循环，含呼吸与眨眼 |
| Duck_Working_Animated.svg | work 工作 | 原始完整 6 秒 |
| Duck_Confirmation_Animated.svg | ask 确认 | 原始完整 6 秒 |
| Duck_Success_Animated.svg | happy 成功 | 原始完整 3 秒，保留彩纸路径运动 |
| Duck_Failure_Animated.svg | sad 失败 | 原始完整 2.6 秒 |

Matter 已有任务映射继续使用 work / ask / happy / sad，无需修改全局运行时。
所有动画仅由宿主 `step(dt)` 推进，切换和拖拽不会遗留自动播放的 CSS 动画。
工作与确认取消时收回道具；完成播放返回待机；隐藏动作不参与渲染，首次使用才创建轨道。
走路、跑步、跳跃、招手、扑翅膀、说话和拖拽继续使用新基础图的分组与现有宿主动作。
最后一份虽以 Walk 命名，但没有动画关键帧；上述通用动作为程序适配，并非该 SVG 自带的完整走路序列。

源 SVG 保存在仓库 `assets/companion-suit-duck/source/`，文件哈希与轨道清单见同目录上层的 `sources.json`。
使用 `python3 scripts/build-suit-duck.py` 重新生成画稿；`--check` 验证产物与源文件一致。
转换器只使用 Python 标准库，支持本批素材的 transform / opacity / offset-distance 与原静态 motion-path 样式；未知属性明确报错。
`project.json` 的画布对齐来自原图脚掌尺寸和位置比对，不按各动画画布宽度重新缩放角色。
原始路径、颜色、滤镜原语与图层顺序保留；不联网加载素材。
部分原 SVG 的滤镜边界为非法 `inf/-inf`，生成时按实际图形范围加模糊余量修正，原始文件保持不变。

用户提供的西装原画未被赋予公开许可；官方运行时许可见LICENSE-Coopanion.txt。
