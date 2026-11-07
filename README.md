# Minduck Matter Desktop

**原有浏览器已恢复（2026-11-05）：** 按用户要求恢复原有 Minduck 浏览器样式，
继续使用当前 Electron/Chromium 内核，不再同步或移植外部浏览器。
未完成的移植源码、补丁、工具链、下载缓存和命令入口已清理；它从未替换已安装应用。

macOS Electron application that bundles the build output of the existing Matter Web
project. The Web and desktop projects remain independent; frontend source is maintained
only in `minduck-matter-web-prod`. Business APIs default to
`https://matter.minduck.com`.
The package does not include the business backend or a separate Chromium runtime.

By default, the application remains one native Electron window: Matter occupies
the left area and the built-in browser panel occupies the right. The panel uses
Electron's Chromium renderer and keeps the original in-window tab, address-bar,
and navigation controls. The browser frontend uses the original shared Panel and pill-shaped tabs,
a local new-tab search page with the existing Minduck brand icon, and a small browser-settings dialog.
Native browser-device tools operate the right-side Agent Browser views through
the existing tab/group compatibility controller and private page helpers.

Browser settings are opened from the gear in the right-side toolbar. They save
the search engine (Bing or Google) and new-tab page locally, and can clear only
the browser HTTP cache while keeping login cookies. Cmd/Ctrl+L focuses the address
bar, Cmd/Ctrl+T creates a tab and Cmd/Ctrl+W closes the active browser tab. The
visible assistant and sandbox buttons are removed; native browser automation
and the bundled Xiaohongshu extension remain available. The chrome uses the project's original shared React components, layout tokens
and panel/tab transitions. No external browser UI or runtime is synchronized.

The main process connects the built-in browser directly as a Matter browser device.
It reuses the pinned 15-tool engine in a private VM, with isolated page helpers and
page-scoped Electron APIs. The default app does not start a Matter Browser extension
worker or a DevTools endpoint. The older extension compatibility bridge remains for
explicit regression tests and experimental entry points.

应用菜单 **内置浏览器设置…** 可查看在线状态、关闭或解除配对。默认在登录后自动配对，
仅操作 Matter 自己创建的任务标签；切换账号后需要重新开启。浏览器设备凭证与本机执行
独立加密存储，写操作仍遵循服务端审批。详见 [内置浏览器设备接入](docs/builtin-browser-device.md)。

```bash
pnpm run test:browser-device  # 一次性 profile、真实 Electron/WS、15 件工具与隔离/取消验证
```

The standalone `minduck-matter-chromium/` prototype is retained for separate
full-Chromium compatibility testing. It is not included in the main Electron
DMG and does not meet the single-window product requirement.

## 内置 Coopanion 桌宠

桌宠已替换为内置的 Coopanion 0.2.16 Core 和桌宠宿主，默认使用提供的“西装鸭”
API 2 形象包。支持漫游、拖拽/抛放、点击、对话气泡、工作与询问动作，以及原版
装扮、模型、习惯、声音和语音配置。启动和打包均不需要安装或运行独立 Coopanion。

空闲时会随机显示用户提供的思考气泡动画：累计空闲 20～45 秒后播放一轮 6 秒动画。
单击桌宠直接播放一轮思考动画，替代原点击抖动/弹跳；拖拽和长按不触发。
效果跟随当前角色的位置、大小和朝向，兼容现有形象，不替换服装或修改导入包；
拖拽、工作、询问和对话等操作会收起气泡。动画与主业务逻辑分开。

打开配置：应用菜单 **Minduck Matter → 设置…**（macOS **⌘,**），
或右键桌宠后点击 **设置**。配置窗口仅在用户打开时出现；首次默认不启用麦克风、
不运行自动引导，不发送使用统计，也不自动更新独立 Coopanion。
桌宠对话需要在配置界面的模型服务中填写可用凭据；不读取 Matter 或独立 Coopanion
的 API Key。没有模型凭据时，动画与拖拽仍可用。

实现边界：`src/companion/` 管理桌宠进程、设置 session、IPC 和形象；
`src/main.cjs` 只连接生命周期与菜单。没有将桌宠接入 Matter 业务状态。
关闭主窗口时隐藏桌宠，重新激活客户端可恢复；退出客户端时停止 Core 和窗口子进程。
桌宠菜单的“退出”只关闭桌宠，保留 Minduck 主窗口。

配置、记忆、下载、日志与窗口 profile 均在当前 Electron userData 下的 `companion/`，
与业务数据分开；不覆盖原独立 Coopanion 的数据。开发版与安装版继续使用不同 userData。
内置运行时固定保存在 `vendor/coopanion/runtime/`，打包复制为 `Resources/companion-runtime/`；
形象复制为 `Resources/companion-figures/`，所以 Core 的 Node 子进程无需读取 ASAR。
上游许可、来源和改动记录见 `vendor/coopanion/README.md`、`LICENSE` 与 `UPSTREAM.json`。

验证命令：

```bash
pnpm run check:companion
pnpm test
pnpm run test:companion
```

真实 Electron smoke 使用临时数据，验证官方宿主、API 2 沙箱、工作/询问时序、取消、
走路、拖拽/放下、设置保存、隐藏/恢复；不发送真实模型请求。

## 日常运行与打包

需要 macOS、Node.js 和 pnpm。两个项目默认放在同一父目录：

```text
Minduck/
  minduck-matter-web-prod/   # 唯一的前端源码
  minduck-matter-desktop/    # Electron、内置浏览器、桌宠和打包脚本
```

首次准备依赖（两个项目各安装一次；本项目不自动修改依赖）：

```bash
cd /path/to/Minduck/minduck-matter-web-prod
pnpm install --frozen-lockfile
cd ../minduck-matter-desktop
pnpm install --frozen-lockfile
```

**本地运行**，在桌面项目执行：

```bash
pnpm start
```

启动前会检查内置桌宠运行时，然后自动运行 Web 项目的 `pnpm run build`（包括 TypeScript 检查）和 `pnpm run build:desktop-shell`，
把 `dist/` 复制到桌面项目的 `web-dist/`，然后打开 Electron。
无需先启动 Web 开发服务器。修改 Web 源码后重新执行此命令即可加载新构建。

**生成 macOS Apple Silicon 已签名、公证安装包**，在桌面项目执行：

```bash
pnpm dist:mac
```

此命令会从 Web 仓库远端拉取最新 `dev` 分支到临时目录，按锁定依赖构建共享 Web、生成图标并打包；
不会使用兄弟 Web 工作区当前分支或未提交的改动。输出为
`release/MinduckMatter-<package.json 中的 version>-arm64.dmg`，对应 `.blockmap` 和 `.sha256` 保存在 `release/metadata/`。发布记录 JSON 也归入 `metadata/`，已替代的旧包及其辅助文件归入 `release/archive/<版本>/`。
默认会使用 Developer ID 签名整个 Electron 应用，提交最终 DMG 至 Apple 公证服务，等待结果并装订票据。
打包机的“登录”钥匙串必须已安装 `Developer ID Application` 证书，且 Apple 公证凭据须已通过
`xcrun notarytool store-credentials` 保存为 `MinduckNotary`。默认不会读取或保存 `.p8` 文件；凭据从 macOS 钥匙串中名为
`MinduckNotary` 的配置读取。可用 `MINDUCK_NOTARY_PROFILE=<名称>` 使用其他 profile，
以及用 `CSC_NAME='Developer ID Application: ...'` 选择特定签名证书。签名和公证会访问
Apple 服务，通常需要几分钟；失败时不会替换 `release/` 中的旧安装包。

只有不对外分发的本地调试包才显式关闭签名和公证：

```bash
MINDUCK_MACOS_SIGN=0 pnpm dist:mac
```

Apple 证书、App Store Connect API Key（`.p8`）、钥匙串 profile、公证、验证和对外发布的
完整操作见 [macOS 客户端打包与直发手册](docs/macos-distribution.md)。

### 检查客户端更新

macOS 应用菜单 **Minduck Matter → 检查更新…** 由桌面主进程读取固定的发布清单
`http://124.70.149.30:8091/latest.json`。发现更高版本时，客户端会用系统默认浏览器
打开对应 DMG；用户下载后将应用拖入“应用程序”覆盖即可。它不依赖 Matter Web 或业务后端，
也不会自动下载安装或替换正在运行的应用。

清单和 DMG 当前由独立静态下载服务发布。客户端仅接受与清单同源、文件名严格匹配
`MinduckMatter-<version>-arm64.dmg` 的下载链接，且忽略相同或更低版本。每次发布必须先上传
DMG，再原子替换 `latest.json`，详见 [macOS 客户端打包与直发手册](docs/macos-distribution.md)。
当前地址是过渡期裸 IP HTTP；对外长期分发前应迁移到 HTTPS 域名并将清单地址同步改为该域名。

日常发布使用一个命令，并显式传入要发布的版本号：

```bash
pnpm release:mac 0.1.4
```

该命令先读取服务器当前版本，拒绝降级或覆盖已发布版本，并在打包前建立服务器 SSH 连接；然后检查 `MinduckNotary`、运行单测、更新
`package.json`、从远端 Web `dev` 打包并公证、计算 DMG SHA-256、上传临时文件、在服务器复核 SHA-256，
最后原子替换 `latest.json` 并从公网回读验证。它不重启 Caddy 或其他服务器容器。若打包或公证失败，
不会上传文件或变更服务器清单；本地版本号会保留，便于修复凭据后用同一个版本重试。

首次可以使用 SSH 密码，命令会在开始时询问一次，并在打包、上传和清单切换间复用连接。长期建议配置服务器 SSH 公钥，之后全程无交互。

只构建前端或运行相关验证：

```bash
pnpm run build:web
pnpm test
pnpm run test:bundled-frontend
pnpm run test:browser-chrome
```

`web-dist/` 是生成目录，不维护前端源码，已从 Git 排除；它会被包含在 Electron 的
`app.asar` 内。浏览器工具栏和拖拽层也由 Web 的 `src/desktop/` 构建，直接复用公共组件、样式和图标；桌面项目不维护另一份界面源码。
`desktop-build.json` 记录构建时间和入口 SHA-256，方便确认构建版本。

预构建产物必须同时包含业务入口 `dist/index.html` 和共享桌面入口 `dist/desktop-shell/index.html`。
在 Web 项目中依次执行 `pnpm run build`、`pnpm run build:desktop-shell`；单独重跑普通 build 会清空 dist，需要再运行桌面入口构建。

### Web 远端与本地运行

打包默认从兄弟 Web 仓库读取 `origin` URL，再临时克隆远端 `dev`。若打包机没有该兄弟仓库，
指定远端 URL：

```bash
MINDUCK_WEB_REMOTE=git@github.com:your-org/matter-web.git pnpm dist:mac
```

`MINDUCK_WEB_SOURCE` 在 `pnpm start` 时仍用于选择本地开发源码；在 `pnpm dist:mac` 中仅用于定位
该仓库的 `origin`，不会读取其当前分支。普通发布即使传入 `MINDUCK_WEB_DIST` 也会忽略它，避免将旧
构建打进安装包。

CI 只有在已对预构建产物进行来源校验时，才能显式绕过远端 `dev` 构建：

```bash
MINDUCK_WEB_ALLOW_PREBUILT=1 MINDUCK_WEB_DIST=/path/to/matter-web/dist pnpm dist:mac
```

安装后的客户端不依赖原来的 Web 源码目录或开发服务器。页面和静态资源来自安装包，
登录、会话、模型、上传等业务仍需要连接配置的云端后端；这不是完整离线业务版本。
线上部署不会自动更新安装包内的前端，需要重新打包发布客户端。

### 资源加载与后端配置

Electron 在默认 session 中接管配置的 Matter origin：页面、静态资源和 SPA 路由
从 `web-dist/` 读取，`/api`、`/media`、`/p` 及其子路径保留原始网络请求。
其他 origin 的请求直接走网络，右侧浏览器独立 session 不受影响。
页面 URL 仍使用配置的 Matter origin，因此保留既有 JWT、本地存储、相对地址、
扩展设备标识和导航策略；无需修改 Web 源码。响应头 `X-Minduck-Frontend: bundled`
可用于确认页面来自本地安装包。Matter 页面仍不开启 Node.js 或 Bash 桥接。

修改业务后端地址（页面仍加载本地构建）：

```bash
MINDUCK_MATTER_ORIGIN=http://localhost:8080 pnpm start
```

也可以在 `Minduck Matter > 配置 Matter 服务地址...` 中配置其他 HTTPS 后端。
环境变量优先于保存设置；HTTP 仅允许回环地址及内置测试服
`http://192.168.11.70:3001`。本地 API 服务无需提供前端页面。

## Other commands

```bash
pnpm chromium:download
pnpm test:extension-compatibility
bash scripts/package-macos.sh
pnpm chromium:smoke
pnpm chromium:start
pnpm chromium:dist:mac
```

The resulting Apple Silicon DMG is written to `release/`; it contains Electron,
the shared Web build, the independent Coopanion runtime, and both unpacked extension directories,
but not the Matter business service or a second Chromium runtime. Recipients only
need to install the application and have network access to the configured Matter
deployment; they do not run `localhost:3001`. The package script deliberately keeps the
bundled Electron framework signatures intact. It signs and notarizes the distribution
DMG by default; `MINDUCK_MACOS_SIGN=0` produces an unsigned local-installation DMG.
The bundled frontend can open without the backend; business operations still need
the configured Matter deployment. The existing unavailable page is used if the
local frontend itself cannot load.
`scripts/package-macos.sh` is the manually runnable equivalent of `pnpm dist:mac`;
it checks the local toolchain, rebuilds the Web frontend and icon, and prints the
DMG SHA-256 after packaging. Block maps and checksum files are stored in
`release/metadata/`; superseded installers and their sidecars are kept under
`release/archive/<version>/`.
右侧面板只保留浏览器：标签页、地址栏、导航、分隔拖拽和 Matter Browser 扩展控制桥。
独立 Local Agent 会话、模型配置、会话流、操作确认、本机文件/Bash 工具和 Go Gateway
已经移除，启动和打包不再依赖 Go。Matter 后续通过保留的扩展与浏览器控制桥接入，
本次未改动 Web 业务逻辑。若扩展曾配对到旧本地 Gateway，需要在扩展中改为配对实际 Matter 服务。
既有业务登录、浏览器 profile 和桌宠配置继续保留；旧本地助手数据和加密凭据不会被主动删除或读取。

The standalone prototype package remains under
`minduck-matter-chromium/release/`.

## Matter 本机执行（macOS，默认关闭）

应用菜单「本机执行设置…」可显式开启 Shell 与文件工具。需要后端先应用迁移 `000109`、`000110`，配置既有设备通道并设置 `MATTER_LOCAL_EXEC=on`。本机通过既有配对 API 生成 `kind=desktop` 设备，safeStorage 加密保存设备令牌；开关关闭不连接、不注入设备头。解除配对会调用撤销 API；失败时保留加密凭证供重试。账号、Matter 服务源变化会停止执行并要求重新开启。

首次登录自动展示复用桌宠 QA 样式的本地授权页；用户开启一次后，会话/授权目录内自动执行 Shell 与文件读写，不再逐条显示「允许这一次」。当前本地 consent 为 `workspace-v2`：旧版逐次确认或 `workspace-v1` 的开启/联网状态不会静默升级，需要重新阅读范围说明并开启。每个会话使用 `~/Matter/<清理后的标题>-<完整会话ID>/`，设置可更换根目录、移除会话授权或在 Finder 打开。显式访问标准桌面、文稿或下载目录时，主进程先按需访问对应目录，由 macOS 处理系统授权；成功后将整个标准目录加入当前会话的沙箱授权范围。系统已允许时沿用已有选择，其他会话不直接继承本地目录映射。其他外部目录继续使用原生文件夹选择器；不存在或被符号链接替换的标准目录也退回选择器。Shell 须显式设置 `cwd`，例如 `cwd:"~/Desktop", command:"ls -la"`。本地设置页独立于远程 Matter，主进程验证 WebContents、主帧与精确 file URL，远程页面无执行 IPC。

执行走 macOS `/usr/bin/sandbox-exec`，缺失时停用，不退回裸执行。默认无网络，只允许会话/授权目录及私有临时目录写入；读取限授权范围和必要系统/工具链，敏感凭证、Keychains、Application Support 与 userData 始终拒绝。命令只继承登录 PATH 和白名单环境，缓存重定向到会话 `.matter-cache/`。联网须在本机设置持久开启可选联网权限，并在命令中声明 `needs_network=true`；撤销会终止当前操作。命令输出与文件内容回传服务端；文件写入保留内容摘要冲突检查并返回 diff。自动模式下，被盗 JWT 或受控服务端可能触发授权范围内的执行，此风险不能靠设备请求头消除。

macOS 系统权限需要用户亲自确认，安装不能静默授予。当前按需请求具体文件夹，不预先要求辅助功能或录屏。标准目录访问被拒绝后返回设置引导，可从本机执行设置的「文件与文件夹权限…」进入系统设置；不反复重试或强制重新弹窗。`Operation not permitted` 只是权限错误，先核对返回的 `allowed_directories` / `permission_hint`；完全磁盘访问不会扩大 Matter 自有沙箱。登录后展示授权页是启动新版客户端后的行为，旧安装包不会因后端更新而获得此入口。

文件工具仅支持整个文件不超过 256KB 的 UTF-8 文本；覆盖前需同一会话读取，内容哈希变化时要求重读。Shell 上限 2 分钟，stdout/stderr 各 1MB；退出、取消、超时及断线清理进程组。无 PTY、持续 stdin、后台任务、Windows/Linux 或团队成员执行支持。普通平台/团队聊天可用，组队及公开/触发/自定义 API 不挂载。

实现位于 `src/local-exec/`。`main.cjs` 连接菜单/生命周期，默认 session 请求头与内置前端转发共用精确源、账号、就绪设备策略；`file-worker.cjs` 打包到 ASAR 外供受沙箱保护的 Electron Node 子进程调用。未替换本机安装版、未部署后端，真实模型全栈验收尚待进行。

```bash
pnpm test                 # 含真实 macOS Seatbelt 与 WebSocket 回归
pnpm run test:local-exec   # 独立临时数据目录的真实 Electron 确认/文件/Shell/请求头/设置隔离 smoke
```
