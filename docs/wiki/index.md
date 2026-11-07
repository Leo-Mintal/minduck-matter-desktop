# Minduck Matter Desktop Wiki

## Project

- Electron desktop app that bundles the existing Matter Web project's build output, keeping one frontend source and the business backend remote.

## Main Modules

- Default single-window Electron shell: `src/main.cjs`
- Bundled frontend and network pass-through: `src/bundledFrontend.cjs`; shared Web build: `scripts/build-web.cjs`
- Electron Chromium browser host: `src/electronBrowserHost.cjs`
- Native browser device: `src/browser-device/`
- Experimental Matter Browser Electron compatibility bridge: `src/extensionApiBridge.cjs`, `src/agentBrowserCompatibility.cjs`
- Integrated desktop pet and explicit settings: `src/companion/`; pinned runtime: `vendor/coopanion/`
- Experimental external Chromium launcher: `src/chromium-shell.cjs`, `src/chromiumBrowser.cjs`
- Chromium-hosted extension compatibility prototype: `minduck-matter-chromium/`

## References

- [Architecture](architecture.md)
- [Conventions](conventions.md)
- [Decisions](decisions.md)
- [Companion integration](companion.md)
- [macOS 客户端打包与直发](../macos-distribution.md)

## Recent Updates

- 2026-11-07: 用户截图指出开发预览的 Matter 主页面未加载；定位到临时启动器的中文 app name 进入 User-Agent，触发 Electron 请求头 ByteString 转换失败。已停掉该预览并以项目标准入口 `node_modules/.bin/electron .` 启动，保留原开发 profile 与服务地址；实际窗口已验证显示 `http://127.0.0.1:8080/` 的“欢迎登录”及邮箱/密码表单，内置前端 Electron 路由/资源/认证 POST/上传/SSE/媒体转发 smoke 通过。无需修改业务代码、重建前端或重新安装。

- 2026-11-07: 将桌面端全部既有状态提交为 `7f3a599`，在 `codex/builtin-browser-device` 开始原生浏览器设备改造。主进程以 `kind=browser` 自动配对并提供 15 件工具，复用固定引擎、隔离 world、反向 WS 和右侧标签兼容层；默认不启动 Matter Browser 扩展 worker。新增独立加密凭证、在线 presence、内置浏览器设置和账号/取消边界，原有本机执行保持独立。168 项单测、原生设备/旧扩展兼容/主入口浏览器/本机执行 Electron smoke、8 个相关模块质量扫描通过；设置 360/560px 深浅色截图与无横向溢出验证通过。开发版已打开设置，当前等待登录；真实服务端/模型联合验收与解锁后的可见窗口验收另行确认，未替换安装版或重打发布包。

- 2026-11-06: 仅修改桌面端标准目录授权：显式访问桌面/文稿/下载时由主进程按需访问目录，交给 macOS 系统授权；成功后将该标准目录加入当前会话沙箱，其他自定义目录仍用原生选择器。增加三个目录用途声明和「文件与文件夹权限…」入口，拒绝后给设置引导；取消、关闭或切账号后的迟到结果不授权。`workspace-v2` 要求旧用户重新阅读范围并开启，不静默扩大既有同意。154 项单测、一次性 home 下的真实 Electron 目录探测/Seatbelt worker/设置 IPC/四宽深浅 smoke 及 4 个相关 CJS 文件的临时副本质量扫描通过。本轮未改后端、重打包或替换安装版；签名新包在未授权状态下的首次真实 TCC 弹窗仍待实机验证。

- 2026-11-06: 桌面端新增应用菜单“检查更新…”，独立读取静态发布清单；只在严格 `x.y.z` 版本更高时通过系统浏览器打开同源、精确匹配版本的 arm64 DMG，不访问 Matter Web/后端，也不在应用内自动安装。加入一键 `pnpm release:mac <版本>`：先拒绝降级、建立临时 SSH ControlMaster、检查公证凭据和单测，再从远端 Web `dev` 签名/公证、上传 SHA-256 校验过的临时 DMG，并原子替换清单，且不控制服务器容器。159 项单测、桌宠完整性及真实 Electron 浏览器 smoke 通过。`0.1.3` 使用远端 `dev` 的 `6beb91cbf357d19d2f0b62819b86f970b5ac43b8` 获得应用与 DMG Apple Accepted 公证、DMG 票据验证通过，但打包环境尚无 `root@124.70.149.30` SSH 凭据，自动上传未开始；静态下载源仍为 `0.1.2`。

- 2026-11-06: 发布并安装 `0.1.2` macOS arm64，包含本机执行首次授权/目录选择器、默认中文和当前图标。Web 从远端 `dev` 的 `6beb91cbf357d19d2f0b62819b86f970b5ac43b8` 构建；应用与 DMG 均完成 Developer ID 签名、Apple 公证与票据验证。实际 DMG 内 94 个源码文件与工作区一致，包内 worker/Shell 沙箱测试通过；9,382 个最终 DMG 增量块和 SHA-256 校验通过。同源 ZIP 解压内容/权限/链接一致，签名/票据/发布检查通过。139 项单测、本机执行、前端转发、浏览器栏、桌宠完整/首次启动重启/QA smoke 通过；修正 smoke 对跨多个交互探针后旧设置窗口仍存活的假设，不改生产窗口行为。安装后 5,551 项 bundle 内容/权限/链接与 DMG 一致，原 0.1.1 的 5,548 项保留于 `~/Library/Application Support/Minduck Matter Backups/20261106-133955-0.1.1/`。安装版已启动，服务地址仍为 `http://127.0.0.1:8080`，未复制开发版权限或登录数据；本机执行/联网现有开关已开启。旧 r1 包及辅助文件 7 项原样归档至 `release/archive/0.1.1/`。未提交、推送或配置远端，未做另一台 Mac 的新版本首次安装验证。

- 2026-11-06: 本机执行改为 QA 风格首次授权、授权范围内 Shell/文件自动执行，新目录由显式 cwd/path 自动打开系统选择器并按会话保存；可选联网持久授权，撤销会终止执行。旧逐次确认 consent 不升级，远程页面无执行 IPC；保留文件摘要冲突保护与 Seatbelt。修正权限错误误判 TCC，提供 allowed_directories/permission_hint。139 项单测、隔离真实 Electron 自动执行/目录适配器/联网撤销/设置来源隔离和四宽深浅布局通过。后端提示词已更新并重启；开发版自动展示新页，用户开启/选择 Desktop 后，真实模型以 cwd=~/Desktop 调用成功并回传文件列表，未替换安装版或重打发布包。

- 2026-11-06: 桌面入口在主客户端和独立桌宠宿主启动前设置 `--lang=zh-CN`，首次使用默认简体中文，保留有效的 `matter.locale` 用户选择；正常远端 Web `dev` 打包同样生效。真实 Electron 加载当前共享 Web 构建，验证首次中文、已保存英文/日文保留、无效偏好回退与清除偏好后恢复中文，且渲染层仍无 Node.js；132 项单测与入口语法检查通过。未修改共享 Web 源码、重打发布包或替换本机安装版；原生角色菜单不由此开关翻译。

- 2026-11-06: 应用图标源 `build/sidebar-logo.svg` 移除底图与裁切区域的两处手工圆角，保持原嵌入图稿、位置和比例，底图铺满方形画布，最终圆角交给 Icon Composer/macOS。已重建 10 个尺寸 PNG、传统 ICNS、AppIcon.icns 和 Assets.car；所有源 PNG 全画布 alpha 为 255，中心图稿保持一致，编译后系统图标预览的边角空隙消失。132 项单测及脚本语法检查通过。已从当前安装版定向替换 3 个图标资源、重新签名、公证和装订（`c17125b4-16d7-40ad-aae6-c8c28f8acfd5` Accepted），4,814 项其余 bundle 文件/链接一致；安装后 4,820 项文件/链接与已验证副本一致，原签名要求、权限及 Info.plist 保留，票据/深度签名/发布检查通过，旧应用保留为备份。公证中途的 profile 查询失败未阻止原提交最终完成，本次无需恢复配置。客户端已重启，现停在登录页，未自动登录或恢复之前会话；未重打现有发布包。

- 2026-11-06: 在本地 `codex/20261106-matter-local-shell-mintal` 分支初始化 Git 并暂存原有桌面代码；新增默认关闭的 Matter 本机执行（四件工具、加密配对/反向 WS、账号/源绑定、原生目录授权、独立逐次确认、Seatbelt、设置菜单与请求头转发）。132 项测试和真实 Electron smoke 通过，未新增依赖。命令前缀免确认暂缓；仅继承 PATH、使用文件内容哈希。未配置远端、未提交/推送、未更新安装版；迁移后真实后端与模型联合验收待完成。

- 2026-11-06: 整理发布目录：顶层仅保留当前 `0.1.1-r1` DMG 和直接应用 ZIP，辅助 JSON/SHA256/blockmap 收入 `metadata/`，已被替代的 `0.1.0` 和原 `0.1.1` 包及其辅助文件收入 `archive/<版本>/`；13 个原文件移动前后 SHA-256 全部一致。打包脚本后续将增量文件和持久化 SHA-256 写到 `metadata/`，默认远端 Web `dev` 构建和签名/公证逻辑不变。脚本语法、真实发布输出片段在临时目录的路径/校验验证、当前 DMG/ZIP 校验文件及 119 项单测通过，本次未重跑完整签名构建。文档补充无独立下载站时的飞书网页版附件、AirDrop/U 盘及已验证的定向隔离恢复方式；未把 ZIP 或其他传输路径当作已完成的目标机测试。

- 2026-11-06: 用户确认按发布方签名和固定 CDHash 验证后，定向清除飞书隔离标记、重新安全评估即可打开目标 Mac 上的 `r1` 应用，确认此前执行拒绝的直接原因；另一台 Mac 尚未单独复验。另从相同已签名、已装订票据的应用生成 `MinduckMatter-0.1.1-arm64-r1-app.zip` 作为传输对照包；解压后 5,548 个文件/目录/链接条目内容和权限一致（含 14 个符号链接），ZIP CRC、深度签名、固定代码指纹、应用票据及发布检查通过，无隔离标记。ZIP 经飞书传输后的实际启动尚未测试，不视为已验证的替代修复；未改客户端源码或本机安装版。

- 2026-11-06: 用户确认 `r1` 在目标 Mac 仍不能启动。该机 macOS `26.5.1`（`25F80`），深度签名有效，但 `spctl` 返回 `File created by an AppSandbox, exec/open not allowed`，LaunchServices 返回 `-10810`。应用及主程序的隔离属性均为 `0187;6aed4292;Feishu;`，用户确认通过飞书传输。重新挂载实际 `r1` DMG，完整应用无 `com.apple.quarantine`，深度签名、应用票据及发布检查仍通过；因此此次执行拒绝与目标机器上飞书添加的隔离标记对应，补票据并未解决此拒绝。优先浏览器重新下载；无法重下时，仅在核对发布方签名及本次发布代码指纹后，定向移除此应用的隔离标记，并重新安全评估、启动。目标 Mac 修复后的启动结果仍待确认，未改系统安全策略或覆盖本机并发更新的应用。

- 2026-11-06: 针对 M2 Pro/M4 上 DMG 拖入应用程序后无法打开的反馈，定位到原 `0.1.1` 安装包内 `.app` 缺少装订票据：外层 DMG 票据有效、应用深度签名有效，但 `syspolicy_check distribution` 报致命 `Notary Ticket Missing`。相同应用仅补入 `Contents/CodeResources` 后检查通过。已生成 `MinduckMatter-0.1.1-arm64-r1.dmg`，保留原 `dev` 构建与全部应用代码/权限，仅补应用票据并签名、重新公证外层 DMG（`19df9b11-bc4e-4ec7-a4f1-5c6ced053bc4` Accepted）。最终安装包内应用票据、深度签名及发布检查通过，9,368 个增量块校验通过；119 项单测、打包脚本语法检查通过。以后签名打包将 profile 交给 electron-builder，在生成 DMG 前完成应用公证/装订，再验证应用票据和发布状态、签名并公证 DMG。未覆盖正在由其他工作区维护的本机安装版；目标 Mac 的实际启动结果仍待用户验证。

- 2026-11-06: 发布 `0.1.1` macOS arm64 包，Web 来自远端 `dev` 的 `6beb91cbf357d19d2f0b62819b86f970b5ac43b8`，独立临时检出构建，不使用相邻工作区分支或未提交内容。119 项单测、完整 Web/桌面入口构建、前端转发和浏览器栏 smoke 通过；Developer ID 签名、Apple 公证（`7dc758aa-bac1-4bb1-8a18-fffe189aac0e`）与 DMG/本机应用票据验证通过。修正打包末尾在装订后刷新 `.blockmap`，最终 9,354 个块逐项校验通过。已替换并启动本机客户端，4,820 项文件/链接与已装订应用一致；默认鸭、单选 QA、并发设置页更新和原整屏透明桌宠保留，原生窗口与 Electron 工作区均为 2560×1410 DIP。首次全屏启动空白通过菜单切换全屏后恢复，未修改相关 UI 逻辑；本机 Gatekeeper 评估受现有系统策略覆盖，未作为干净机器验证依据。

- 2026-11-05: 按用户反馈回退动态小窗口和默认鸭混合模式试改，恢复上次修改前的动作渲染及原来的整屏透明窗口，移除动态裁切、坐标适配和对应试验探针；单选互斥、QA 功能及其他工作区的设置/客户端更新保留。119 项单测、运行时完整性、完整官方沙箱/面板 smoke 及原生 QA/新聊天/追加/停止链路回归通过。 已定向替换、验签并重启，实际运行的 6 个窗口/面板模块和 2 个默认鸭模块与回退源码一致，最新单选 QA 保留；实测桌宠窗口为整屏工作区 1512×859 DIP。378 个其余归档条目和 4,806 项其余 bundle 文件/链接保留。

- 2026-11-05: 桌宠单选 QA 的普通选项与“其他我来说明”改为互斥：聚焦/输入其他说明或成功上传即取消普通选项，选择普通选项则清空自定义文字/附件；必选单选题也可独立提交自定义回答，本地校验拒绝两者并存。保留补充输入协议选项、多选与逐题草稿。122 项单测、严格类型、四宽深浅真实交互与原生 QA 提交链路通过。 已定向替换本机客户端、验签并重启，运行中 QA 资源与源码一致；378 个其余归档条目和 4,814 项其余 bundle 文件/链接保留。

- 2026-11-05: 【已回退，见上条】修复默认鸭 idle/work/ask 过渡中两层半透明叠加造成的透底闪烁，保留原图稿/时序；原生透明窗口改为包围鸭子、效果、会话和输入内容的小窗口，逻辑桌面坐标独立于窗口尺寸，保留拖拽、走动、悬浮、QA、追加和终止。120 项单测、完整官方沙箱/面板 smoke、48 帧双朝向过渡透明度及原生输入/拖拽恢复/走动验证通过。已从并发更新后的最新安装版定向合入、验签并重启，默认鸭导入副本同步更新；378 个其余归档条目和 4,806 项其余 bundle 文件/链接保留，实际运行资源一致，另一工作区的新设置页构建保留。物理多屏跨 DPI 切换未做实机验证。

- 2026-11-05: 桌宠设置顶部移除上游版本号/GitHub 链接区域、分隔线及 GitHub 更新链接，保留后退/前进、侧栏切换和主题按钮。120 项单测、运行时完整性、真实设置页四宽深浅与原有设置回归通过。已定向更新本机客户端、验签并重启，实际页面确认顶部链接消失；380 个归档条目与 4,815 项其余 bundle 文件/链接保持一致，安装资源与源码一致。

- 2026-11-05: 桌宠设置进一步隐藏使用统计、声道、气泡尺寸、气泡速度、Coo 的名字及称呼，保留其余通用/显示/音效设置和已保存的配置值。117 项单测、运行时完整性检查、真实设置页四宽深浅、侧栏切换与保留控件可见性验证通过。已定向更新本机客户端、验签并重启，实际设置页确认六项均隐藏；380 个归档条目与 4,815 项其余 bundle 文件/链接保持一致，安装资源与源码一致。

- 2026-11-05: 桌宠 QA 的“其他我来说明”改为直接可输入的整行 32px 胶囊，与选项同宽、标记/文字对齐，左侧复用主会话 QA 编辑图标；placeholder 为“其他我来说明”，支持系统深浅模式与中性悬浮/聚焦。输入或上传自定义内容按原 QA 约束处理选项，保留必选项、补充说明选项、逐题草稿和原发送/提交/跳过。117 项单测、严格类型、四宽深浅真实点击/输入及原生 QA 提交链路通过。已仅定向替换桌宠 QA 源码与构建资源、验签并重启，378 个其余归档条目和 4,811 项其余 bundle 文件/链接一致，实际运行资源与源码一致。

- 2026-11-05: 桌宠设置隐藏侧栏展开时的文字 Logo、收起时的图片 Logo，并移除底部启停按钮及用户资料区域；保留标题栏展开/收起按钮和习惯、装扮导航。117 项单测、运行时完整性检查、真实设置页四宽深浅及展开/收起原生点击验证通过。已定向更新本机客户端、验签并重启，实际确认两种侧栏状态；380 个归档条目与 4,815 项其余 bundle 文件/链接保持一致，安装资源与源码一致。

- 2026-11-05: 首次安装配置明确启用桌宠及其原生窗口，默认形象为默认鸭 `minduck-duck`；无需手动点击显示桌宠，已有用户主动保存的显示和形象选择保留。真实 Core 全新数据首次启动/再次启动自动显示及 117 项单测通过，无设置页弹出。已定向替换默认 seed、验签并重启；380 个归档条目和 4,815 项其余 bundle 文件/链接保持一致，运行状态确认默认鸭已在桌面显示。

- 2026-11-05: 桌宠设置默认配色改为 DeepSeek 大肥鱼 · Claude，左栏收敛为习惯与装扮；习惯保留通用、显示、音效，隐藏行为与互动、说话声、电脑操作、其他。装扮隐藏 Coo/大肥鱼，应用菜单改名“桌宠设置…”。保留默认鸭、自定义形象导入与显式独立配色。115 项单测和真实 Core/设置页四宽深浅、旧入口/高级偏好、原生点击、装扮和配色重启持久化验证通过。已从最新安装版定向替换菜单及 3 个设置资源、验签并实际打开确认；379 个其余归档条目与 4,811 项其余 bundle 文件/链接保持一致。

- 2026-11-05: 桌宠会话标题与副标题增加 8px 间距，14px 字体使用 20px 行高；QA、普通提示和运行中卡片保持上下 12px、左右 16px 内边距，移除固定/最小卡片高度，内容自然撑开，无副标题不占行。输入框与按钮尺寸及交互保持原样。115 项单测、四宽深浅模式及 2/3 自由回答/无副标题/原交互回归通过；已定向替换安装、验签并重启，379 个其余归档条目和 4,812 项其余 bundle 文件/链接保持一致，运行资源与源码核对通过。

- 2026-11-05: 桌宠会话卡片悬浮时不再显示橙色描边，点击/聚焦也保持原中性边缘；悬浮关闭按钮、原有路由/QA/追加/终止和键盘访问保留。只定向修改桌宠面板 CSS。115 项单测及四宽深浅模式真实交互回归通过；已定向替换安装、验签并重启，380 个归档条目和 4,815 项其余 bundle 文件/链接保持一致，运行中桌宠资源与源码一致。

- 2026-11-05: 桌宠 QA 输入框改为与选项一致的 32px 胶囊，长文本在框内滚动；卡片保持上下 12px、左右 16px 内边距，编辑聚焦时取消输入框和外层卡片的橙色描边，保留按钮键盘焦点提示。仅修改桌宠样式和输入尺寸配置。115 项单测、严格类型检查及四宽深浅的真实点击、长输入滚动和原 QA/追加/终止回归通过。已定向替换安装并重启，378 个其余归档条目和 4,810 项其余 bundle 文件/链接保持一致；验签及运行中资源核对通过。

- 2026-11-05: 桌宠进行中会话按参考 SVG 增加追加和终止按钮：追加在标题下展开 42px 公共输入框，向该会话原消息接口排队；终止直接调用该会话的原停止接口。校验组织/会话/轮次、附件归属和重复提交，保留失败草稿与进度更新中的输入；底部仍默认和 Matter 新聊天。115 项单测、严格类型、四宽深浅真实点击及原生 QA/排队/终止/任务状态链路通过。已基于最新安装版定向替换、验签并重启，372 个其余归档条目和 4,808 项其余 bundle 文件/链接保持一致，运行中桌宠资源与本次源码一致；默认鸭和其他工作区的客户端样式保留。未改后端或共享 Web。

- 2026-11-05: 桌宠多条活动消息改为稳定队列和向下重叠显示：当前一张完整卡片，后面最多露出两层底卡，每层下移 6px、两侧各收进 16px；更多消息继续排队。悬浮左上角 × 关闭当前提示后显示下一条，不取消任务、不清除通知；进度排序和迟到的 turn 锚点不会挤走正在阅读的会话。队列内 QA 保持各自会话/轮次/问题的原有操作和有界公开数据。112 项单测、四宽深浅真实点击/QA 切换、原生任务与 QA 链路通过。已从最新安装版定向替换 2 个桌宠模块及 3 个运行资源、验签并重启；377 个其余归档条目及 4,811 项其余 bundle 文件/链接一致，运行中资源与源码一致，默认鸭及其他工作区的客户端样式保留。

- 2026-11-05: 桌宠 QA 选项改为每项一行、名称与说明同排、超出省略并保留完整悬浮文本；对齐已安装主会话 QA 的中性胶囊底色、单选圆形/多选复选勾选、深浅模式和 14px 字体。标题不再回填重复的任务摘要，显式说明与标题相同也省略。110 项单测、严格类型、四宽深浅真实点击和原生 QA 提交链路通过；仅修改桌宠 QA 源码与对应构建资源，底部输入与主客户端保持原样。已基于最新安装版定向替换、验签并重启，377 个其余归档条目及 4,811 项其余 bundle 文件/链接保持一致；运行中桌宠加载的资源与本次源码一致。

- 2026-11-05: 修正桌宠 QA 的输入位置：自由回答直接在卡内输入，自定义选项使用同一卡内输入区，右下仅一套下一个/发送/提交/跳过操作，取消额外“保存回答”和外置 composer；按参考 SVG 保持 16px 侧距、12px 底距/按钮间距、32px 按钮和 14px 字体。底部编辑按钮改为就地展开 332×42px 公共输入组件，原容器 260ms 向两侧展开，支持系统深浅/减少动效、原公共发送图标、附件、草稿和失败重试。发送按“和 Matter 聊天”的原接口创建新 platform 会话，不向当前项目/团队/会话发送，也不切换主界面。110 项单测、严格类型、四宽深浅真实点击/动效、原生 QA/新聊天与唤起路由验证通过；已基于当时最新安装包定向替换、验签并重启，其余 371 个归档条目和 4,807 项 bundle 文件/链接保持一致。

- 2026-11-05: 桌宠会话区域按参考 SVG 支持 330×56 默认消息条、悬浮关闭与可操作 QA；关闭只隐藏当前提示，QA 复用客户端原组件和既有 resolve/upload API，支持确认、单/多选、逐题草稿、文字与原生附件选择，文档编辑和外部授权回 Matter 处理。绿条靠近鸭子，与双按钮顶部对齐并向下展开；保留单会话、通知和默认鸭。107 项单测、QA 类型检查、四尺寸深浅与真实 QA/通知/原生唤起路由探针通过；不改后端或共享 Web。 已从当时最新安装版定向替换、按原 Developer ID 重签并重启，369 个其余归档条目和 4,806 项其余 bundle 文件/链接保持一致；运行中 5 个桌宠 JS/CSS 资源与源码相同，继续使用默认鸭。

- 2026-11-05: 桌宠底部收起时显示用户提供的 27×6 绿色横条，悬浮身体/横条展开原双按钮，保留连续感应范围与键盘访问；无通知显示上箭头，有通知改为所给铃铛及绿色数量徽标（超过 99 为 `99+`）。通过现有只读会话列表按未读、等待/pending、失败/停止/risk 统计，每个未归档会话只计一次，断开/退出登录/切组织清空陈旧角标；未改共享 Web、后端、鸭子或主窗口样式。98 项单测、真实页面四尺寸深浅模式、任务通知全链路与原生唤起/路由探针通过。仅定向更新安装版 2 个主进程模块、3 个桌宠资源及必要签名/元数据，4,807 项其他 bundle 文件/链接保持一致；已重新签名、重启并确认实载资源与源码一致，仍使用默认鸭。

- 2026-11-05: `pnpm dist:mac` 默认启用 Developer ID 签名、Apple 公证和票据装订，不再要求每次设置 `MINDUCK_MACOS_SIGN=1`；只在不对外分发的本地调试场景以 `MINDUCK_MACOS_SIGN=0` 生成无签名 DMG。打包机因此必须具备有效证书和 `MinduckNotary` 钥匙串 profile。

- 2026-11-05: 去掉应用的全局远程调试端口：浏览器助手兼容层改为 Agent Browser session 的 Service Worker 预加载脚本（`src/extension-worker-preload.cjs`），在扩展代码执行前注入，经该 Worker 自己的 IPC 与主进程通信，并持有 `startTask()` 保持原有常驻；网站 Worker 不注入、主进程只认扩展 scope。扩展转发的调试命令改为只放行扩展实际使用的 9 个页面级方法，阻止 `Target.*` 跨 session 触达 Matter 视图。扩展兼容 smoke 与 bridge 探针改用测试自带的页面调试器，并修正失败时仍返回 0 的退出码；桌宠探针的调试客户端移到 `scripts/devtools-test-client.cjs`。96 项单测、扩展兼容 smoke、bridge 探针及浏览器壳 smoke 通过；桌宠 smoke 未运行。

- 2026-11-05: `pnpm dist:mac` 现在始终从 Matter Web 远端最新 `dev` 分支临时浅克隆、按 lockfile 安装并构建；不会使用同级 Web 工作区的当前分支或未提交改动。默认忽略遗留 `MINDUCK_WEB_DIST`，仅允许受控 CI 以 `MINDUCK_WEB_ALLOW_PREBUILT=1` 显式消费已验证产物；无兄弟仓库的打包机可设置 `MINDUCK_WEB_REMOTE`。

- 2026-11-05: 修复逻辑检查发现的问题：Matter 当前页打开同源 `/api/`、`/media/` 改为下载（子框架重定向仍拦截）；扩展兼容桥的 `tabs.create/update`、`windows.create` 只放行 HTTP(S) 和 `about:blank`；已保存的服务地址不再合规时只回退该字段，保留面板宽度等其他设置；`package.json` 声明 Node `^20.19.0 || >=22.12.0` 并新增 `.nvmrc`（pnpm 仅告警，不阻止脚本）；移除未被引用的过期根目录 `main.cjs`。89 项单测及 Electron 浏览器壳 smoke 通过。远程调试端口取舍、启动时完全磁盘访问提示、会话 SSE 轮换回放仍待决定，未改动。

- 2026-11-05: 顶部安全区收紧为红黄绿按钮下方到 Matter 内容区 12px 间距：保留原生按钮占用的 24px，总避让高度由 52px 改为 36px；完整顶部拖拽热区随之收紧，侧栏、共享 Web、浏览器和桌宠样式不变。87 项单测及真实 Electron 三种窗口宽度、浏览器开关/拖拽、深浅主题回归通过。安装版仅定向更新一个布局文件，348 个其余归档文件及 4,811 项 bundle 文件/链接保持一致，签名验证通过。

- 2026-11-05: 按用户要求彻底清理已取消的外部浏览器移植：移除原生源码、补丁、工具链/下载缓存、专用测试、`brave:*` 命令、无用图标与本次浏览器临时备份；保留当前 Electron 应用、用户数据、桌宠和原有独立兼容实验。 共清理 52 个任务临时目录，实际回收约 12 GiB；87 项单测、桌面壳构建、定向 ESLint、桌宠完整性、安装版界面产物与签名检查通过。

- 2026-11-05: 按用户要求撤回本轮左侧专属安全区试改，恢复原来的整个 Matter 内容区顶部 52px 安全区及完整顶部原生拖拽热区；不保留加宽收起栏、零宽侧栏或额外顶部控件。恢复后的 87 项单测及完整 Electron 浏览器壳回归通过。基于并发更新后的安装包定向恢复 3 个安全区文件，保留其他工作区的新浏览器样式及 346 个其余归档文件；重新签名安装并启动，确认 Matter 视口恢复顶部 52px 避让。

- 2026-11-05: 用户取消外部浏览器同步与原生移植，恢复原有 Minduck 公共 Panel、胶囊标签及面板/标签动效；保留搜索、基础设置和快捷键。现有产品继续使用 Electron/Chromium；取消后的移植残留已在后续清理中移除。桌面壳构建、TypeScript、定向 ESLint、13 项单测及真实 Electron 深浅模式/三种宽度/拖拽/搜索/设置/快捷键回归通过；已从当前安装版定向更新浏览器资源并重启，4,811 项其他应用文件保持一致，验签与实际运行 bundle/胶囊标签检查通过。



- 2026-11-05: 新增 macOS Electron 站外分发手册，记录 Developer ID 证书、App Store Connect API Key `.p8` 的仓库外保管和钥匙串 profile 初始化、签名、公证、装订、验签及发布检查；明确这不是 Mac App Store 提交流程。

- 2026-11-05: 原生移植累计八份补丁已应用，新增默认打开 Matter、原生菜单 Minduck 图标、关闭末标签保留窗口、移除 Brave 首启推广及精简原版新标签页设置。固定 Chromium commit，增加 gclient 前置源码保护和缺失树恢复，避免不完整初始化移动已有 Brave 工作目录；恢复时区分 Gitlink，并直接读取 commit 根树。Gitiles、递归镜像元数据和 Chromium 归档恢复均校验 Git 对象 ID；完整目录树已恢复并遍历通过，文件对象仍在导入。缺失对象盘点改用本地集合差集，受控停止不再触发备用下载；归档因上游属性导出 CRLF 时，还原 LF 后仍须精确匹配固定 blob ID。113 项单测、12 项 Python 测试、八份补丁累计校验和 24 份源码副本质量检查通过；改动的三份原版 TSX 语法检查通过。已再次 fetch/merge 共享 Web 并确认包含最新 origin/dev，Brave 官方最新正式版仍为当前固定 v1.98.63。Chromium 源码同步继续，尚未原生编译、实机验证或安装。

- 2026-11-04: 桌宠顶部改为最多一个活动会话：执行中优先，同类按最近活动选择；没有执行中时显示最近的 pending/waiting，会话结束后隐藏或切换下一条，点击仍定位所显示会话。所有任务的真实状态和自动动作汇总保留。客户端内置并为新配置默认选择 `minduck-duck`（默认鸭），包含刚更新的工作动画，当前用户继续使用默认鸭；西装鸭仅保留为可选形象。87 项单测、完整原生桌宠回归、真实多任务状态链路、四尺寸深浅模式与安装版单卡片/切换点击验证通过。基于当前安装版仅更新 4 个桌宠资源并增加 9 个默认鸭文件，以原 Developer ID 保持签名有效；其余 4,550 个已跟踪资源/用户形象文件一致，保留其他工作区的浏览器改造与客户端样式，重开桌宠后生效。

- 2026-11-04: Brave 原生移植的 macOS 源码已补齐，五份固定版本补丁已应用，覆盖同窗口 Matter、品牌、原版新标签页精简、存储隔离和导航/上传接入。修复重叠补丁的累计校验与重跑，保留真实 Git index；增加固定 depot_tools、校验分段下载及官方 CIPD 工具包恢复流程。11 项 Node 与 10 项 Python 回归通过，16 份新增/修改工具和原生源码的质量扫描无错误或警告。Chromium/工具链仍在初始化，尚未编译、实机验证或安装原生版本；本轮未替换现有 Electron 安装版。

- 2026-11-04: 用户明确纠正目标为移植 Brave 原版原生浏览器及界面，并同意右侧改用其原生运行时；停止 React 仿写路线。开始固定版本原生源码、构建环境和同窗口接入验证。当前安装版仍是此前的 Electron 实现，尚未完成 Brave 原生移植。

- 2026-11-04: 精简浏览器前端及品牌搜索图标已安装到 `/Applications/Minduck Matter.app` 并重启。安装版 4,797 项文件/链接与暂存构建一致，4,795 项原有资源保持一致，仅应用归档及完整性元数据更新；正在运行的安装版确认加载新版浏览器 bundle 与 28px 品牌原图。保留现有内核、桌宠资源、业务前端和用户数据，原应用已备份。

- 2026-11-04: 新标签搜索页中央图标改为共享 Web 的 `sidebar-logo.svg` 品牌原图，按 28px 显示；输入框内保留搜索图标。

- 2026-11-04: 右侧浏览器改为参考 Brave 原生浏览器结构的两行精简前端，保留现有 Electron/Chromium 与自动化扩展，移除助手和本地沙盒可见入口。恢复共享 Web `src/desktop/` 与独立构建脚本，新增无品牌本地搜索页、Bing/Google 与新标签页偏好、仅清 HTTP 缓存的原生设置窗口及 Cmd/Ctrl+L/T/W。前端是现有公共组件上的适配实现，未移植 Brave 的原生 C++ 标签栏或加载 Brave 运行时。

- 2026-11-04: 当前桌宠使用默认鸭 `minduck-duck`，工作动作替换为用户优化的 `Duck_Working_Animated (1).svg`。保留原有掏电脑/打字/收起时序和宿主时钟，仅定向替换当前用户形象包的工作图形与关键帧；询问数据逐字节一致，待机、西装鸭、其他形象及客户端样式保持原样。暂存版与安装版均通过真实沙箱的自动循环、工作/询问切换、拖拽/落地/抛掷恢复，左右朝向各阶段共 15,236 项源姿态采样比对通过。已重开桌宠并确认运行服务加载新版文件；未重打包或替换客户端。

- 2026-11-04: 客户端和后续打包的默认 Matter 服务保持正式环境 `https://matter.minduck.com`；环境变量和用户保存的服务地址仍优先。设置页仍支持测试环境 `http://192.168.11.70:3001`，地址校验仅额外允许这个完整 HTTP origin，其他非回环 HTTP 地址继续拒绝。

- 2026-11-04: 修复西装鸭工作时手臂/袖口错位。核对用户原始 `Character_And_Suit_Animated.svg`，21 条基础路径和手臂分组均对应；旧工作参数把整条手臂前移 12 SVG 单位，现改为固定肩膀转动，并把电脑移至手可触及的位置。原图路径、颜色、滤镜、待机/询问参数与其他形象不变。新增肩膀连接与键盘位置回归，84 项单测及左右朝向连续工作 72 点真实沙箱检查通过。 完整六形象/拖拽/面板回归通过；安装版仅替换一个西装鸭动作模块并重开桌宠，客户端主进程及其余 4,528 项资源保持不变，安装版实载几何检查通过。

- 2026-11-04: macOS 打包新增受控对外发布模式：默认 `pnpm dist:mac` 仍生成无签名本地 DMG；`MINDUCK_MACOS_SIGN=1` 自动选择本机 Developer ID Application 证书，通过 electron-builder 对完整 Electron bundle 签名，启用 Hardened Runtime 与主/子进程 entitlements，提交最终 DMG 到 `MinduckNotary` 钥匙串 profile、公证后装订并验证票据。首个发布包已获 Apple submission `5347b902-cab1-4dde-91f5-d55a2b8c7641` 接受，DMG 票据、完整嵌套签名与 Hardened Runtime 均已验证。`.p8` 私钥不进入项目或脚本；可用 `MINDUCK_NOTARY_PROFILE` 与 `CSC_NAME` 覆盖默认选择。

- 2026-11-04: 桌宠自动动作正式接入真实 Matter 状态：running→工作，pending/waiting→询问，done→happy 一次，failed/stopped→sad 一次。原工作/询问完整播完再切换并持续循环；拖拽后等落地/摔晕恢复结束，再进入最新状态。多任务工作优先，全部结束后汇总结果，错误优先；历史结果/断网/退出登录不误触发表情。仅改桌宠逻辑，保留原形象、独立会话胶囊与客户端样式。 82 项单测、真实原生任务全链路、六形象沙箱/恢复、四尺寸深浅模式与运行时哈希校验通过；从当前安装版定向替换桌宠逻辑并重启，4,520 项其余资源及 25 个已安装形象文件保持一致，运行中六个逻辑资源与源码一致。

- 2026-11-04: 按用户纠正桌宠状态映射：`pending` 与 `waiting` 均为询问，`stopped` 与 `failed` 均为错误；无活动任务保持待机并允许走动。此次仅同步映射约定，未开启自动动作切换；所选鸭子没有独立错误动画，尚未选用 `sad` 等替代动作。

- 2026-11-04: 桌宠每张会话胶囊可独立点击，悬浮/键盘聚焦显示跟随系统深浅模式的 Matter 品牌橙色描边。公共进度带上当前 turn ID，经严格 ID 校验的原生 `open-conversation` 动作唤起主客户端并路由 `/c/<id>`，利用既有消息锚点定位当前轮次；相同会话不重载。只修改桌面端，未修改共享 Web/后端与鸭子原始形象。73 项单测、真实跨进程多卡片路由/前台激活/异步消息定位/同会话保留，以及警察鸭四尺寸深浅模式真实鼠标/滚轮验证通过。 已重新打包、替换并启动本机 App；4,796 个文件/链接与 DMG 一致，运行中加载新版卡片/恢复逻辑，警察鸭的 8 个原始文件及所选形象均保留。

- 2026-11-04: 桌宠工作/询问被拖拽中断后，在完整落地/摔晕恢复结束进入 idle 时接回原动作，较新的动作可替换或取消恢复；不改原形象包。活动 Matter 状态、Core 状态和成功/失败表情停止走动，只有待机恢复原有漫游配置。每个活动会话各自显示相同两行胶囊，稳定向上叠加，超高可滚动；两条会话 SSE 轮转回放以保留 HTTP/1 连接余量。71 项单测、四会话原生全链路、六形象沙箱兼容/恢复、四尺寸深浅模式与十二卡片真实滚轮验证通过。状态→动作映射表已写入 companion wiki，待用户确认，尚未自动切换动作。

- 2026-11-04: 桌宠顶部接入真实 Matter 状态与公共进度，只修改桌面端。隔离 Matter 视图复用既有登录/组织，通过只读会话列表及全局/会话 SSE 跟踪任务，避免后台读取详情带来的已读副作用；运行显示动作/正文，等待显示确认/补充/授权提示，待启动及完成/失败/停止隐藏。多个任务优先运行中，再按最近活动选择；切页/重载/后台运行、退出登录、组织切换、重连与旧事件回放均有验证。66 项单测、真实 Electron 任务全链路、底部按钮、四尺寸深浅模式及运行时校验通过。复用与原安装版一致的共享 Web 构建，不修改 Web/后端源码；已重新打包、替换并启动本机 App，4,795 个文件/链接与 DMG 一致，运行中加载新版接收代码并保留警察鸭选择。

- 2026-11-04: 修复桌宠底部按钮在鼠标移过去时消失：首次悬浮形象后，形象完整包围盒与按钮组成带 12px 容差的连续区域；原生鼠标轮询与页面指针命中共用该区域，透明边角、斜向路径和间隙均保留输入。移出区域收起，隐藏按钮不会因空白区域悬浮而出现；形象与现有唤起行为不变。64 项单元测试，以及西装鸭/警察鸭真实页面的斜向移动、原生轮询、鼠标点击和深浅模式验证通过。已重新打包、替换并启动本机 App，4,795 个文件/链接与 DMG 一致，运行中的桌宠加载新版命中代码并保留警察鸭选择。顶部任务区仍待数据桥接，已根据现有会话 SSE 梳理运行/等待/完成及重连的接入规则。

- 2026-11-04: 桌宠底部按钮接入主客户端：第一个唤起 Matter 并进入 `/new-chat`，第二个恢复/显示/聚焦窗口并保留当前页面。隔离预加载与原生宿主只转发这两个动作，通过每次启动生成凭据的本地桥接回主进程；macOS 同时激活应用与窗口。64 项单元测试、真实原生按钮跨进程唤起/隐藏与最小化恢复/前台焦点/页面保留/新聊天验证，以及深浅模式与悬浮回归通过。已重新打包、替换并启动本机 App，4,795 个文件/链接与 DMG 一致，运行中的桌宠已加载新版按钮逻辑。实际任务输出仍待接入。

- 2026-11-04: 桌宠新增参考图样式的顶部两行输出胶囊和底部双图标胶囊，保留原形象与动画；14px 字号、每行最多十个字素，面板独立跟随系统深浅模式。按反馈，无任务时隐藏顶部，任务进行中不受悬浮影响；底部仅在悬浮桌宠/按钮时显示，并保留两者之间的可达区域。桌面端替换原悬停工具栏/右键菜单，浏览器预览保留原控件。两个 Matter 按钮与实时执行输出等待后续桥接。59 项单元测试、运行时完整性校验和真实 Electron 面板验证通过；已重新打包、替换并启动本机 App，4,795 个文件/链接与 DMG 一致，运行中的桌宠静态资源与安装版一致。

- 2026-11-04: Matter 服务地址弹窗改为直接加载共享 Web 设计样式，并采用公共 Input/Button 的 DOM 约定：服务地址输入框为胶囊形 `input--pill`，恢复、取消和保存均为 `b-pill`；共享打包样式新增稳定 `desktop-shell/assets/shared.css` 入口，避免弹窗依赖 Vite 的带 hash 文件名。保留原有 IPC、校验、重启和环境变量锁定行为。

- 2026-11-04: macOS 的固定 Matter 视图在保留全尺寸原生背景框的前提下，从 52px 标题栏安全区下方渲染，`hiddenInset` 红黄绿窗口按钮不再遮挡左上导航。正常布局和右侧栏开关动画帧共用同一安全区计算；非 macOS 平台不增加留白。布局单测与 Electron 浏览器壳 smoke 都覆盖了这一边界。

- 2026-11-03: 修复右侧浏览器工具栏底部出现的横向滚动条。浏览器壳现在通过共享 Panel 的静态正文模式承载固定导航，不再创建 OverlayScroll；标签条保留键盘切换和活动项自动定位，但不显示横向轨道。Electron smoke 覆盖三种宽度、无横向 thumb 与导航无溢出。

- 2026-11-03: 右侧浏览器首次打开和用户新建标签页默认导航至 `https://www.google.com/`；地址栏关键词搜索与扩展显式创建的 URL 行为保持不变。相关 Electron smoke 覆盖两个入口。

- 2026-11-03: 右侧浏览器新增克制的打开、收起和标签切换动效。原生内容区在 220ms 内同步移动 Matter 宽度、右栏容器、工具栏与活动浏览页，关闭时页面保留到退出结束；快速反向、窗口缩放和开始拖拽均可中断并立即回到实时布局。共享 Web 壳补充淡入/位移和 140ms 标签导航效果，`prefers-reduced-motion` 禁用其 CSS 动画。56 项单元测试、桌面壳构建和真实 Electron 三种窗口尺寸 smoke 通过。

- 2026-11-03: 按反馈撤回 Dock 图标的裁切、二次圆角与运行时 `app.dock.setIcon` 覆盖。`sidebar-logo.svg` 现直接按每个系统尺寸渲染，原图形状不变；`AppIcon.icns` / `Assets.car` 仅由该原图编译，Dock 槽位、视觉处理和悬停放大完全交给 macOS。原图直接渲染与 Icon Composer 输入像素一致；53 项保留单元测试通过。

- 2026-11-03: 按截图移除地址框内部打开图标，保留 Enter 导航和框外打开系统浏览器；标签文本按钮取消额外状态底色，活动标签整体选中底色保留；标签关闭按钮改为 2px padding、20px 圆形反馈区，标签整体左右各保留 6px padding、文字与关闭按钮间距 6px，移除文字按钮叠加横向 padding，公共组件默认样式不变。原生 smoke 增加三种窗口尺寸的图标/尺寸检查，以及深浅主题 hover/active/focus-visible 检查。53 项单元测试、7 项组件回归、相关 lint/桌面入口类型检查与构建通过，原生 smoke 验证深浅主题、三种窗口尺寸和两侧 6px 留白。已重新打包、替换并启动本机 App，4791 个文件/链接校验一致；安装版确认无框内图标、文字状态透明、关闭按钮 20px/2px padding、标签左右各 6px。

- 2026-11-03: 按用户要求撤回 Ego Lite 地址栏试改，回到项目共享 Web 公共组件版本；地址框恢复标准 Input 的高度、响应式字号、主题描边与聚焦状态及原提交入口。圆形图标按钮、胶囊输入框/文字 Tab、贴合分界、侧栏关闭恢复和实时拖拽继续保留。未引入 Ego SDK 或客户端代码。53 项单元测试、7 项组件回归、相关 lint、工具栏范围类型检查及 Electron 三种尺寸/导航/主题/聚焦/实时拖拽验证通过；已打包替换并启动本机 App，4791 个文件/链接校验一致，安装版确认 36px 标准胶囊、响应式字号、公共蓝色聚焦边框且无阴影。全量 Web 类型检查受未修改的 LiveConversation.tsx 中 onOpenMember 未定义阻塞，恢复包使用撤回前基线 App 的已验证业务构建与本次重新构建的共享工具栏。

- 2026-11-03: 【已撤回，见上条】浏览器地址框按本机 Ego Lite 实机样式调整为 32px 胶囊、14px 文字、平面底色和浅绿聚焦环；通过 Web 公共 Input 的 address appearance 与设计 token 复用，浅色主题做对应适配，移除地址框内重复打开图标。53 项单元测试、7 项组件回归、相关 lint、Web 类型检查/完整构建与 Electron 三种窗口尺寸、默认/聚焦、Enter/Escape、实时拖拽回归通过。已替换并启动本机安装版，4791 个文件/链接与 DMG 一致；安装版确认新 appearance、32px/14px、102px 自然工具栏高度及真实聚焦边框。

- 2026-11-03: 右侧浏览器改为构建 Web 项目 `src/desktop/`，直接使用公共 Panel/Button/Input/Icon/OverlayScroll、主题和 SVG；Web 与桌面共用 ResizeHandle。分界改为 1px 贴合，不再保留 8px 透明留缝；原生两侧视图按帧实时调整，释放保存宽度，取消/失焦清理捕获。图标按钮为圆形，地址框和文字 Tab 为胶囊形。53 项单元测试、Web 构建/类型检查/相关 lint 与 10 项组件回归、960/1280/1440px Electron 实时拖拽/圆角/关闭恢复/主题验证及扩展兼容 smoke 通过。安装包已替换本机应用并启动，4791 个文件/链接校验一致；安装版确认加载共享入口、圆形按钮和胶囊地址框。


- 2026-11-03: 右侧栏右上角新增关闭按钮，点击收起面板并让 Matter 占满可用宽度；保留已打开标签和页面，右上角入口可恢复原活动标签。52 项测试及真实 Electron 三种尺寸的点击/布局验证通过，已更新本机安装版并验证关闭与恢复。

- 2026-11-03: 移除右侧独立 Local Agent 会话及模型、流式会话、确认、本机文件/Bash 和 Go Gateway 逻辑，启动/打包不再依赖 Go；浏览器占满右侧内容区，保留标签、导航、分隔拖拽、扩展控制桥与独立桌宠。应用设置保留旧文件名以兼容服务地址和面板宽度，旧助手数据不主动清理。52 项单元测试、Electron 扩展兼容、前端请求转发和完整主入口的三种尺寸/标签生命周期验证通过；已重新打包并替换本机客户端，安装版无聊天窗口及 Gateway。

- 2026-11-02: 修复默认 thoughtShown 偏好被误当作活动状态、导致真实桌宠思考动画始终被阻止的问题。单击直接播放，替代点击抖动/弹跳；新增完整 pet-app 页面的真实鼠标、可见气泡和结束验证。

- 2026-11-02: 思考气泡增加单击随机触发（50%），保留原点击反馈并等待短动作结束；拖拽、长按、工作及对话不触发，空闲随机播放继续保留。

- 2026-11-02: 新增独立的通用空闲思考效果，复用用户 SVG 的原气泡和 6 秒时序；累计空闲 20～45 秒随机播放，交互/工作/询问时收起。通过 API 2 沙箱统一接入，现有 6 种形象兼容验证通过，形象包本身保持原样。

- 2026-11-02: 按用户反馈撤回护头和难受表情试改；西装鸭形象全部恢复为用户提供的原始 ZIP 内容。

- 2026-11-02: 原桌宠 Demo 替换为模块化 Coopanion 0.2.16 Core/官方桌宠宿主，内置原始西装鸭 API 2 包；设置按用户操作弹出，运行时/数据/session 与业务隔离，客户端负责子进程生命周期。新增沙箱动作、设置持久化和真实 Electron 验证，打包不依赖独立 Coopanion 安装。

- 2026-11-02: 桌面端内置同一份 Matter Web 源码的构建产物；`pnpm start` / `pnpm dist:mac` 自动构建兄弟 Web 项目，支持 `MINDUCK_WEB_SOURCE` 或预构建 `MINDUCK_WEB_DIST`。页面与静态资源本地加载，`/api`、`/media`、`/p` 继续请求配置的后端，保留原 origin、登录和 BrowserRouter 路由；新增单元与 Electron 集成验证及 README 打包说明。

- 2026-10-16: 桌宠动作改为独立 SVG 姿态文件，统一 52×52 渲染画布；默认使用 47×52 待机图，拖拽使用 38×42 坐姿图，悬浮叉腰，空闲随机叉腰/背面动作，并同步双眼眨眼。
- 2026-09-30: 右侧浏览器前端按 deepseek-harness 的 BrowserBody 结构接入桌面 shell，复用 38px 工具栏、28px 控件、地址栏聚焦操作、系统浏览器打开按钮和 dsh 16px 图标；Electron host、扩展兼容服务和左侧对话区域保持不变。
- 2026-10-15: 增加独立透明桌宠 Demo，启动客户端自动显示用户提供的鸭子 SVG，支持空闲呼吸、悬停、点击跳动、拖拽、位置保存和右键菜单；暂未接入 Agent 状态。
- 2026-10-15: 桌宠动画改为保留 `src/assets/duck.svg` 原始路径、颜色和滤镜，只在 `src/pet.html` 增加分层包装，分别驱动眼睛、嘴、翅膀、脚和头顶羽毛，避免改变鸭子原始形象。
- 2026-10-15: 集成 `src/assets/duck-actions.svg` 动作精灵图；桌宠按悬停、点击和拖拽切换源 SVG 中的姿态，拖拽水平位移决定侧身鸭子的朝向，右向使用水平镜像。
- 2026-10-15: 从 Dock 重新激活桌面客户端时恢复主窗口并重新显示桌宠；本地 macOS DMG 已包含桌宠页面和动作 SVG。
- 2026-10-15: 使用 Blender 4.5.3 实际生成 `build/duck-pet.blend`；场景从未修改的 SVG 导入 11 条曲线，按部位建立控制器、Z 分层、循环 2.5D 动画和透明正交相机，并保留 Electron SVG 桌宠作为交互运行方案。
- 2026-10-15: 新增 `scripts/build-duck-3d-blender.py` 并生成 `build/duck-pet-3d.blend`；原 SVG 路径被挤出为带倒角的 3D 曲线，脚部做交替步态，身体、翅膀和根节点加入循环行走动画。
- 2026-10-15: 修正 Blender 3D 分层的父级变换同步，所有部位现在保持 SVG 原始相对位置并组成完整鸭子；增加完整构图预览和走路帧验证。
- 2026-09-30: 参考 deepseek-harness 的浏览器生命周期与紧凑工具栏规范，补充 Electron Tab 的待导航地址、加载失败重试、加载状态指示和 16px 网站图标；保留右侧本地对话区与 Electron Chromium 页面。
- 2026-09-30: 修复 Matter 固定视图在渲染架构拆分后一直保持隐藏的问题；线上默认地址继续使用 `https://matter.minduck.com`，并兼容清理旧版本的本地开发默认地址。
- 2026-09-30: 右侧浏览器收敛为 Electron 内嵌 Chromium 架构：固定 Matter 单页与 `ElectronBrowserHost` 管理的浏览器 Tab 分离，应用入口不再切换到外部 Chromium。
- 2026-09-30: 扩展 CDP 兼容桥只接收 `chrome-extension://` Service Worker，并对非扩展执行上下文做无异常跳过，避免启动时重复报错。
- 2026-09-30: 隐藏拖拽引导线，保留透明可拖拽热区；收紧助手输入框、发送按钮和自动允许控件，并统一垂直居中。
- 2026-09-30: Matter 与 Agent Browser 改为独立的 8px 圆角分块，中间保留 8px 可拖拽留缝；拖拽期间只更新透明热区，松手后一次提交原生视图尺寸，避免重影。
- 2026-09-29: 本地 Agent 在“允许访问本机文件和 Bash”开启后提供受限的 `local_run_bash` 工具；每条命令始终逐次确认，支持工作目录、超时、取消及 stdout/stderr 截断。
- 2026-10-04: Matter 右侧面板增加独立的“本地沙盒”入口，打开 WebVM 的本地客户端 Linux 环境；沙盒使用独立 Electron session，禁止系统权限、下载和跳出 WebVM 域名。
- 2026-09-29: Matter 服务请求失败或超时时隐藏本地对话栏，让 Agent Browser 占满右侧内容区域；重试连接成功后自动恢复对话与浏览器分栏。
- 2026-09-29: 桌面安装包默认连接 `https://matter.minduck.com`，支持应用菜单配置其他 HTTPS Matter 部署与本地开发环境变量覆盖；其他用户无需启动 `localhost:3001`。
- 2026-09-29: 修复右侧栏拖拽闪屏；拖拽期间保持 Matter 主视图尺寸稳定，减少原生视图重复显隐和合成重绘，结束拖拽时再提交最终布局。
- 2026-09-29: 助手默认输入框收敛为 42px 起步并按内容增长；界面固定使用 DeepSeek，隐藏本地模型来源和冗余说明文案。
- 2026-09-29: 本地助手会话区按 Matter transcript/composer 规范重做，支持浅色主题、动态输入高度、公共风格下拉菜单与 16/20px SVG 图标；Matter 的主题变化会继续同步到助手。

- 2026-09-29: Added a desktop-only Agent Browser cursor overlay using a transparent cutout of the Matter sidebar logo SVG. It follows CDP mouse events inside browser pages and is hidden during screenshots; no Matter Web or extension files were changed.
- 2026-09-29: 桌面浏览器工具栏与本地助手跟随 Matter web 端的 `data-theme`（light/dark/system 实际值）同步切换；浏览器 chrome、输入框、按钮和分隔线统一采用 web 端 Linear Dark / 鸭橙 tokens，并复用 Material Symbols 字体资源。
- 2026-09-29: 启动时探测 macOS Full Disk Access 的 TCC 数据库权限；确认用户已授权时自动记忆并跳过重复提示。
- 2026-09-29: Documented the manual `scripts/package-macos.sh` DMG workflow with toolchain checks, temporary staging, local unsigned packaging, and SHA-256 output.
- 2026-09-29: Restored Electron Builder's standard unsigned local-installation DMG flow. A post-build deep-sign attempt made Electron Framework and `libffmpeg.dylib` use different signing teams, so macOS aborted the app at launch; the package script now preserves the original bundled framework signatures.
- 2026-09-29: Restored the separate Local Agent chat view inside the right panel. Matter's existing frontend and conversations remain unchanged; the chat and browser share the panel while the Go Gateway and unchanged browser extension execute browser work.
- 2026-09-28: Added a transparent, draggable divider between Matter and the Agent Browser. Its manually adjusted width persists locally while preserving minimum usable widths for both sides.
- 2026-09-28: Preserved DeepSeek thinking-mode `reasoning_content` across browser tool calls and returned it with the originating assistant message, preventing the API from rejecting the next tool-continuation request.
- 2026-09-28: Fixed DeepSeek tool-message ordering. The Gateway now preserves the selected assistant tool call and removes legacy orphaned tool results before an online-model request, preventing invalid `tool_calls` history from blocking later chat turns.
- 2026-09-28: Added an opt-in Local Agent setting for accessible local files. When enabled, the selected model can list directories, read bounded UTF-8 text chunks, import eligible files into loopback `/media/...` for the unchanged Matter Browser extension to upload, and perform confirmed safe local file operations; source files remain unmodified during import.
- 2026-09-28: Removed the Local Agent's fixed 12-step browser-operation ceiling. Long workflows now continue until completion or manual cancellation; only a fourth consecutive identical browser tool call is treated as an automation loop.
- 2026-09-28: On macOS, the desktop app now prompts to open Full Disk Access settings at startup and keeps a retry item in the app menu; macOS still requires the user to grant the permission manually.
- 2026-09-28: Added a persisted Auto-Allow Browser Operations switch beside the Local Agent input. When enabled, browser writes execute without per-action approval; Matter now uses 40% and the right Agent Browser panel 60% of desktop width.
- 2026-09-28: DeepSeek V4 Flash is now the default Local Agent model. Its API key is encrypted with Electron safe storage in application data and restored to the loopback Gateway after restart; it is still never exposed through IPC or saved in Gateway state.
- 2026-09-28: Local Agent Chat offers a model-settings entry for local Ollama or DeepSeek V4 Flash. DeepSeek requests use the existing confirmed browser-tool path, and its API key is never returned to the UI or stored in the Gateway state file.
- 2026-09-28: The opened Agent Browser now splits the desktop width evenly with Matter; its local chat and browser content use a 40/60 layout while preserving a compact fallback for narrow windows.
- 2026-09-28: Local Agent Chat now guides user-initiated account login through the right-side browser, requiring confirmation before sending a verification code while keeping one-time codes and QR confirmation out of chat history; it no longer mislabels account verification as an HTTPS or browser-security problem.
- 2026-09-28: Browser-agent URL navigation now foregrounds the created or updated right-side tab and treats a committed main-frame URL as opened, preventing long-lived site requests from becoming false navigation timeouts.
- 2026-09-28: Local Agent Chat now shows an inline thinking and browser-operation state immediately after a request, so Ollama planning latency is visible before streamed output arrives.
- 2026-09-28: Added the bundled loopback Go/Ollama Gateway. The local chat UI now displays an Electron-owned pairing code, and the unchanged Matter Browser extension can pair and receive MCP browser calls with write confirmations.
- 2026-09-28: Development Electron runs now use an isolated browser profile, preventing an installed build from taking over the same extension service worker or browser session.
- 2026-09-28: Added a transparent top drag region that excludes Agent Browser controls, so the window can move without overlapping Matter navigation or blocking the right-top entry.
- 2026-09-28: Removed the separate macOS title-bar band in the default window; Matter avoids the window controls and the closed Agent Browser entry is a native-transparent, right-top floating plus button.
- 2026-09-28: Added an independent Chromium-hosted prototype and API smoke test that load the bundled extensions unchanged with a separate profile; the existing Electron route remains available.
- 2026-09-28: Restored the single-window Electron right panel as the default. The separate Chromium-window route is now explicit experimental mode because it does not meet the in-window sidebar requirement.
- 2026-09-28: Added the in-window Matter Browser compatibility bridge: the unchanged extension can group and control Agent Browser tabs through Electron DevTools Protocol; the main DMG no longer bundles a second Chromium runtime.
- 2026-09-28: Switched the fixed Matter entry point to the local service at `http://localhost:3001`.
- 2026-09-28: Matter now shows a clear local error page when the fixed test server is unreachable; macOS packaging builds in a temporary directory so only the DMG is retained in `release/`.
- 2026-09-26: In the embedded compatibility route, Matter has no tab while `+` opens the tabbed right-side browser panel.
- 2026-09-26: Removed Xiaohongshu draft automation and the Matter-to-Xiaohongshu publisher-tab shortcut; the right-side panel keeps generic tabs without Xiaohongshu-specific workflow entries.
- 2026-09-26: Loaded the bundled Matter Browser Manifest V3 extension into the right-side browser session and added an in-app assistant entry for its popup.
- 2026-09-28: Restyled the right-side browser chrome around Ego Lite's compact dark tab and omnibox hierarchy, with functional back/forward/reload controls.
- 2026-09-25: Replaced the separate Agent Browser window with one-window browser tabs, including a Matter-to-Xiaohongshu publisher-tab bridge.
- 2026-09-25: macOS packaging now generates the application icon from the Matter sidebar logo.
- 2026-09-25: Initialized the macOS Electron shell for the existing Matter web application.
