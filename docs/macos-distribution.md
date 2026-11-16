# macOS 客户端打包与直发

本文记录当前 Electron 客户端的 macOS Apple Silicon（`arm64`）**站外直发**流程。它适用于把已签名、公证的 DMG 发给用户下载和安装，不会提交 App Store 审核。

当前正式的打包入口是 `pnpm dist:mac`，实现位于 `scripts/package-macos.sh`。原生 Brave/Chromium 迁移仍是实验工作；本手册描述目前可交付的 Electron 安装包。

### 邀请码分支的签名先决条件（2026-11-16，尚未发布）

- 打包现在编译 `native/desktop-access.mm`，仅使用系统 Foundation/Security.framework；需要 Xcode CLI 和 Node N-API 头文件（默认 `/opt/homebrew/include/node`，可设 `MINDUCK_NODE_HEADERS`）。产物为 `Resources/native/desktop-access.node`，afterPack 核对其与本次编译输出相同。
- 要发布可强制激活的客户端，设置 `MINDUCK_DESKTOP_ACCESS_PROFILE` 为授权此 App ID/Keychain Access Group 的 macOS profile 绝对路径，并设置 `MINDUCK_DESKTOP_ACCESS_REQUIRED=1`。预检拒绝非 macOS、过期、标识/访问组不匹配的 profile；主应用 entitlement 由原文件复制并追加，保留照片等现有能力。带 profile 的构建必须签名。
- 当前没有适用的 macOS profile，未打邀请码签名包、未替换安装版或公开更新。原生编译与隔离 Electron 测试不能替代真实 Keychain 创建、升级/重装恢复和锁屏验收；未验收前后端 `MATTER_DESKTOP_ACCESS=off`。发布新客户端前须先部署 policy 兼容接口，详见[改造记录](desktop-invite-activation-plan.md)。

## 当前本地发布记录

### 0.1.10 本机目录与任务授权测试包（2026-11-16，已签名、公证及验证）

- 独立目录 `release/path-access-workspace-test-20261116/`，版本 0.1.10、arm64，沿用现有应用名、应用 ID 和 Developer ID 指定签名要求。包含取消每会话空目录、实际输出按需创建目录、启动安全清理旧空目录、指定配置与应用数据的当前任务原生确认，以及此前的照片权限修复。使用本地现有前端，不拉取远端分支。
- 在隔离源码快照中通过 `pnpm dist:mac` 构建，再按既有流程对 21 个 Mach-O、8 个嵌套 bundle 及主应用定向签名。应用公证 `cad2af29-d9f0-4a54-9254-36b3c2092944`、DMG 公证 `53c609e4-9554-4ef7-98b5-5b9f3516a448` 均为 Accepted，票据、深度签名与系统分发检查通过。
- DMG：195,750,825 字节，SHA-256 `acca9acc4613cbef9297499817492689260fd8d8fd89b0642e2b8e5049e92dff`；ZIP：192,084,045 字节，SHA-256 `728cbbcdc990840395ba61bb8d7bcbe906823bf419a3d9469a6e18d5d68e6c1e`。
- 245 项单测、真实 Electron 执行回归通过；392 个包内源码／前端文件字节一致，138 个执行时源码／扩展文件未偏离冻结输入。最终 DMG 内实际签名可执行文件的 worker／Shell／沙箱与 14 项目录授权回归通过，DMG／ZIP 的 5,552 项内容／权限／链接一致，最终 DMG 9,368 个增量块和更新元数据校验通过。
- 验证记录与测试步骤在该目录；临时源码、应用、提交 ZIP 和验证挂载已清理。未替换安装版、未上传或修改公开更新清单；配套服务端提示词尚未部署，真实授权按钮仍由用户验收。

### 0.1.10 照片授权测试包（2026-11-16，已签名、公证及验证）

- 测试包独立保存在 `release/photos-permission-test-20261116/`，版本仍为 0.1.10、arm64，应用名、应用 ID 和 Developer ID 指定签名要求与当前安装版一致。补齐主应用 `com.apple.security.personal-information.photos-library` 及 `NSPhotoLibraryUsageDescription`；打包前确认当前 135 个源码／扩展文件与安装版字节一致，前端沿用现有本地构建。
- 在独立临时源码快照中运行标准 `pnpm dist:mac`，使用显式 prebuilt 前端模式和既有 21 个 Mach-O／8 个嵌套 bundle 定向签名流程。应用公证 `23bacc86-da8f-4f8a-939c-ac21b9c688ef`、DMG 公证 `4135b627-17b8-44cc-8720-32be101c5228` 均为 Accepted；签名、票据及系统分发检查通过。
- DMG：`MinduckMatter-0.1.10-arm64.dmg`，195,745,039 字节，SHA-256 `ba9eef3c7c4098a650a182f808695aed25f700f21cdd2a23cc37bd18fa7bf075`。ZIP：`MinduckMatter-0.1.10-arm64.zip`，192,088,020 字节，SHA-256 `f90ad87e67139ccfe9886123e62c832b7490b07c6c9822fc3ecd89b699436132`。
- 复用已通过的 231 项桌面测试，核验 389 个包内源码／前端文件、实际签名可执行文件的 worker／Shell、照片签名能力与用途说明、DMG／ZIP 的 5,552 项内容和权限一致性、最终 DMG 9,407 个增量块及更新元数据。记录在测试目录的 `validation/`；临时应用和验证挂载已清理。
- 未替换当前安装版、未覆盖常规 0.1.10 发布产物、未上传服务器或切换公开更新清单。用户可退出当前应用后从测试 DMG 覆盖安装并验收实际照片授权弹窗；未重置 TCC 或代替用户作出系统授权决定。

### 0.1.10 共享客户端导航（2026-11-13，已签名、公证及验证）

- 版本由 `0.1.9` 更新为 `0.1.10`。使用本次已验证的本地共享 Web 构建，包含用户提供的房子图标、外层首页/资产/知识库/扩展/组织与成员/智能体导航、左下角账户面板和统一 16px 图标；首页保留原侧栏，功能页隐藏首页侧栏。复用原组件和 Tooltip，普通 Web 布局不变；未将输入表述为最新远端 dev。
- 从标准 `pnpm dist:mac` 入口完成预检、图标和打包后，因既有静态图片逐个签名过慢，沿用项目已有的 21 个 Mach-O、8 个嵌套 bundle 及主应用定向签名方式。Developer ID、指定签名要求、项目权限和 Hardened Runtime 保持一致。
- 最终应用公证 `98a7cb53-f7be-4e4f-bed7-4bd3baa7deea`、DMG 公证 `79792664-22b7-4e1d-b9f8-fc5ebc81d203` 均为 Accepted，装订票据、深度签名及系统分发检查通过。中途 Apple 票据接口出现 TLS 错误，保留产物并重试后，最终 DMG/ZIP 内应用的票据复核全部通过。
- 安装包 `release/MinduckMatter-0.1.10-arm64.dmg` 为 195,744,996 字节，SHA-256 `0deb1aec50378264f25a1f22be2faf399dcd460c7df819d9cab2a8eef43f7145`；更新包 `release/MinduckMatter-0.1.10-arm64.zip` 为 192,087,933 字节，SHA-256 `64f5fc0eb41dc85b5d54745e760cc60fd5f1267178431181e0e8094ee19bfec6`。
- 227 项桌面单测、原生浏览器 chrome 回归及前端构建/类型/共享导航回归通过。最终包内 4,875 项输入字节哈希、两个 macOS 版本字段 `0.1.10`、应用 ID `com.minduck.matter`、实际签名包文件 worker/Shell/沙箱拒绝通过；DMG/ZIP 的 5,552 项 bundle 内容、权限和链接一致，9,408 个最终 DMG 增量块及更新清单大小/SHA-512 校验通过。
- 记录位于 `release/metadata/build-0.1.10-20261113/` 和 `release/metadata/MinduckMatter-0.1.10-arm64.release.json`。本次临时应用、提交 ZIP、验证解压副本和挂载卷已清理；正常 DMG/更新 ZIP 与校验记录保留。未替换本机安装版、未上传服务器或切换公开更新清单。

### 本机／云端协作测试客户端热更新（2026-11-13）

- 在独立 `Minduck Shell Test` 0.1.9 测试应用中更新已验证的客户端执行／二进制传输模块和云电脑前端；保留 app ID、Developer ID 指定签名要求、原 profile 和正式安装版。仅热更测试 `.app`，下方原 DMG/ZIP 未重打，不能用旧安装包验收本次新增协议。
- 修正手动 ASAR 打包的 worker 解包匹配，验证 642 项归档文件内容保持一致、实际 unpacked worker 与测试输入相符；真实签名 GUI 主进程经沙箱 worker 读取 NUL／非 UTF-8 临时二进制通过。应用已重启并确认窗口、登录、runtime 连接正常；当时该独立测试应用未获本机完全磁盘访问，未伪造或变更系统授权。
- 真实模型明确云端后，使用 `cloud_shell` 返回退出码 0 和预期输出，无执行位置问答，不受本机 Shell 未授权影响；一次性验证会话已停止并删除。临时 loopback 主进程调试入口已关闭。
- 修正后应用公证 `c1e1e8cb-9927-408e-a195-21dd66eb932c` 为 Accepted，已装订并通过票据／深度签名检查。记录位于 `release/cloud-test-20261113/validation/dual-computer-20261113/`。真实两端文件传输仍需升级服务器原 Runner 并取得本机系统授权后验收。

### 云电脑独立测试客户端（2026-11-13，已打包并启动）

- 从当前桌面源码的隔离快照构建 `0.1.9` Apple Silicon 测试包；前端重新构建自 `minduck-matter-web-prod` 的 `codex/20261113-cloud-computer-mintal` 工作区，包含基于 dev `32f5062780c7d56950bd4d7b26f26673de0868a7` 的未提交云电脑改动。使用显式 prebuilt 模式，未切换分支或以默认远端 dev 覆盖这些改动。
- 测试产品名为 `Minduck Shell Test`，应用 ID 为 `com.minduck.matter.shell-test`，连接 `http://127.0.0.1:8080`。复用独立的 `minduck-matter-shell-test` profile；实际客户端已显示本地服务页面，原测试登录及会话保留。正式安装版、正式 profile、常规 DMG/ZIP 和线上更新清单均未替换。
- 可运行客户端保存在 `release/cloud-test-20261113/client/Minduck Shell Test.app`，DMG/ZIP、元数据及验证记录位于 `release/cloud-test-20261113/`。测试应用保留在应用程序目录之外；当前更新器不会在该路径执行安装。
- 本次包含已有服务器设备配对与 Shell 路由：桌面客户端发送 `choose` 执行模式，Web 发送 `cloud`。按用户分配固定 HOME/apps 目录、应用安装能力及完整云桌面没有在本次打包中新增。
- 213 项桌面单测、23 项相关前端测试、前端及 desktop-shell 构建、本机执行和前端代理 smoke 通过。最终签名客户端的 4,622 项源码/运行时文件和 254 项前端文件字节哈希、8 个签名原生文件的深度签名、实际文件 worker、Shell 和越界写入拒绝通过。启动验证采用原生应用 UI 读取，确认独立测试窗口和 `127.0.0.1:8080` 页面已显示；不将启动探针的早期可见性断言失败记为通过。
- 应用及 DMG 公证成功，签名、票据和系统分发检查通过。DMG/ZIP 的 5,552 项 bundle 内容、权限及链接一致，最终 DMG 的 9,315 个增量块及更新清单大小/SHA-512 校验通过。临时构建目录及验证挂载已清理，保留用户要求的测试应用；未上传服务器。

### 0.1.9 桌宠工作区窗口与首页入口（2026-11-13，已签名、公证及验证）

- 桌宠恢复为始终覆盖当前显示器工作区的透明 BrowserWindow；清理小窗口裁切、原生反向偏移、渲染器几何 IPC。待机、移动、落地及气泡显示均不再改变原生窗口尺寸。左侧临时首页按钮、图标资源及其专用 focus 命令移除，更新/桌宠设置仍在底部。
- 桌面端以 0.1.8 实际发布源为基线；106 个其他源文件保持哈希一致，四个外壳文件仅删除首页相关内容。原有免配对 runtime、任务权限直达与跨启动记忆、Shell/浏览器能力和更新器保留。`package.json` 相对 0.1.8 仅更改版本为 `0.1.9`。
- 0.1.8 前端来自隔离工作树，相关修改尚不在远端 `dev`。本次按用户的保留要求使用已验证的 0.1.8 完整前端，**不使用默认远端 dev 构建**；253 个原始前端输入和实际 0.1.8 更新 ZIP 内的 254 个文件逐一一致。使用现有显式模式：`MINDUCK_WEB_ALLOW_PREBUILT=1 MINDUCK_WEB_DIST=/Applications/File/WorkSpace/jomec/Minduck/Shell工作树/.runtime/release-source/minduck-matter-desktop/web-dist pnpm dist:mac`。默认远端 dev 的首次构建在签名期间受控中止，其临时应用已清理，未提交公证。
- 213 项单测、原生 macOS 桌宠 workArea/走路/跑动/拖放/落地/QA 150%/透明度回归、完整浏览器 chrome、免配对浏览器、本机 Shell/任务授权、首次权限设置、更新及前端协议 smoke 通过。切换最终 0.1.8 前端输入后重新执行 chrome 和前端 smoke 通过。完整桌宠交互/隐藏重开也通过；完整套件原有 100 秒总时限小于其 panel-only 子集，现完整/panel 套件给 200 秒、定向 100 秒，父进程多 20 秒，断言不变。质量扫描 10 个文件无错误，三个既有大文件长度告警保持，不扩展无关重构。
- 正式产物为 `release/MinduckMatter-0.1.9-arm64.dmg`（196,443,288 字节，SHA-256 `4af7482f093fc50f8f9c911e7e8b44ab00b3ba1b3b82b51d62835e1276704caa`）和更新 ZIP `release/MinduckMatter-0.1.9-arm64.zip`（190,719,136 字节，SHA-256 `4c9dfe93557e6b667bc9d0efc3cb2fd5b6b8e4130c6e28d4d8da7fb59ebb0b8c`）。
- 应用公证 `de0e1859-3244-45a6-bc98-b76caeabb54b`、DMG 公证 `10010185-6575-43c6-acb7-fa0b6a501b62` 均为 Accepted；Developer ID 深度签名、应用/DMG 装订票据、系统分发检查通过。最终包的两个 macOS 版本字段均为 `0.1.9`，应用 ID 为 `com.minduck.matter`。
- 最终签名包内 4,878 项输入字节哈希、253 个 0.1.8 前端文件、实际 worker/Shell 执行与沙箱拒绝通过；DMG/ZIP 的 5,552 项 bundle 内容、权限和链接一致。最终 DMG 9,470 个及 ZIP 9,238 个增量块、更新清单大小和 SHA-512 均通过校验。
- 未锁屏时已通过 macOS 原生窗口截图和 CGWindow 边界回归。最终签名包验收时电脑已锁屏，使用该包实际主进程的 `BrowserWindow.getBounds()` 和渲染器截图完成相同运动/工作区/透明度断言；两类证据分别保留，未将渲染器截图标记为原生系统截图。最后调整的窗口验收脚本补扫无错误或告警。
- 输入基线、差异、回归日志、窗口截图、公证记录及最终发布记录位于 `release/metadata/0.1.9-*` 和 `release/metadata/MinduckMatter-0.1.9-arm64.release.json`。临时构建应用、解压副本、测试宿主和挂载卷已清理；未替换本机安装版或上传服务器。

### 应用内更新源码接入与本地验证（2026-11-12）

已接入 `electron-updater` 6.8.11、侧栏下载进度、任务重启确认、原生安装准备与桌宠退出交接，补齐 DMG/ZIP 和双清单发布流程。202 项单测、完整浏览器 chrome smoke、真实更新库 HTTP 下载/坏包校验 smoke、375/768/1024/1440px 深浅主题状态及七份相关文件质量检查通过。临时无签名 DMG/ZIP 构建验证了包内运行时依赖、`app-update.yml`、最终文件大小和 SHA-512，临时应用及安装包已清理。测试中的系统安装接口使用替身；真实签名版本间的替换和自动重启尚待正式发布包验收。本次没有升版本、替换当前安装版、覆盖原 0.1.7 分发包或上传服务器。

### 本机重复应用清理（2026-11-12）

已将四份旧版回滚备份和三份旧版打包应用移到废纸篓；额外一份 `0.1.7` 打包应用在 ZIP 内容、权限和符号链接逐项验证后归档并移到废纸篓。用户随后明确不需要回滚备份，该次额外创建的归档 ZIP 也已移到废纸篓。保留当前运行的 `/Applications/Minduck Matter.app`（`0.1.7`）、原用户数据、正常分发的 DMG/ZIP 与发布记录。已定向清理过期应用注册，原生应用解析只列出正式安装路径。下方早期发布记录中的备份 `.app` 路径属于历史记录，已不再保留原始应用。

### 0.1.7 测试服地址修复安装包（2026-11-11）

按用户要求，将当前版本从 `0.1.6` 升为 `0.1.7` 并重新打包。新增精确测试服白名单 `http://192.168.11.70:8080`，保留旧 `:3001`，默认业务后端仍为 `https://matter.minduck.com`。前端由本次标准打包流程从远端 `dev` 的 `c8b99a1909a205965eb979e92fb14b051466aac3` 临时浅克隆、按锁定依赖重新构建，未使用相邻 Web 工作区的未提交内容。

- 安装包：`release/MinduckMatter-0.1.7-arm64.dmg`，193,898,590 字节，SHA-256 `4ead526aad4ab07fe080e99b54191b290818f27688eddae51e996c770afdfefe`。最终 `.blockmap`、SHA-256 和发布记录在 `release/metadata/`；完整日志、输入哈希和验证脚本在 `release/metadata/build-0.1.7-20261111T100908Z/`。
- 标准签名器逐个处理静态图片资源，故停止本次确认为所属构建的签名进程，由同一已核对输入重新生成应用，再沿用此前验证过的 21 个 Mach-O、8 个嵌套 bundle 及主应用定向签名流程。使用原 Developer ID、项目权限声明、Hardened Runtime 和安全时间戳，主应用指定签名要求与现有安装版一致；没有修改正式打包脚本。
- 应用公证 `c70e491c-4b9e-43d3-83e8-9ad01cc92de7`、DMG 公证 `39cb21b7-ebec-479d-a9d2-4608189f09f4` 均为 Accepted，应用/DMG 票据、深度签名和系统分发检查通过。包内 ASAR 与两个 macOS 版本字段均为 `0.1.7`。
- 188 项单测、完整原生浏览器回归和服务设置页深浅主题检查通过；实际最终 DMG 内的应用完成测试服地址保存/重读、文件 worker、版本冲突保护及 Shell 沙箱回归。386 个包内输入哈希、5,552 项 bundle 内容/权限/链接及最终 9,286 个增量块逐项验证通过。
- 本次只生成本地安装包，未替换本机应用、上传服务器或切换更新清单；旧版本分发包与上传脚本保留。

### 0.1.6 本地签名公证安装包（2026-11-10）

用户明确要求本次安装包升级版本，已将 `package.json` 从 `0.1.5` 升为 `0.1.6`，从当前本地源码和既有预览 `web-dist/` 重新打包；没有仅重命名旧包。包内 ASAR、`CFBundleVersion` 和 `CFBundleShortVersionString` 均已核对为 `0.1.6`。本次产物取代下方误沿用调试版本的 `0.1.5` 包。

- 安装包：`release/MinduckMatter-0.1.6-arm64.dmg`，193,820,633 字节，SHA-256 `95f68ce5aa9ebcfac424edb54b1ede6f57aa03db53788053191335c2469206fb`。最终 `.blockmap`、校验文件和发布记录位于 `release/metadata/`；详细构建与校验记录在 `release/metadata/local-build-0.1.6-20261110-181638/`。
- 应用公证 `3d4a55cf-902c-4d74-9d0c-e6890a871c42`、DMG 公证 `767bf76a-0e78-48e6-b7e1-029b3f99e1f2` 均为 Accepted，Developer ID 签名、应用/DMG 票据及系统分发检查通过，指定签名要求与现有安装版一致。
- 177 项单测和升级版本后的完整浏览器回归通过；更新检查 fixture 根据当前版本生成下一版本，不再固定为 0.1.5/0.1.6。385 个包内输入哈希、实际包内 worker/Shell、只读挂载应用 5,552 项内容/权限/链接和两个版本字段，以及最终 9,280 个增量块校验通过。
- 继续使用本地已有前端，未拉取远端或重编译 Web；本次没有替换本机客户端或上传服务器，旧版本分发产物保留。

已准备仅上传现有 0.1.6 安装包的命令，由用户在打包 Mac 执行：

```bash
bash /Applications/File/WorkSpace/jomec/Minduck/minduck-matter-desktop/release/metadata/upload-0.1.6.sh
```

脚本先验证本地 SHA-256，再上传 `.uploading` 文件并在服务器复核，保留首次 `latest.json.before-0.1.6` 备份后原子切换清单；为兼容已安装的 0.1.5 客户端，`downloadUrl` 沿用旧 IP 同源格式，新版仍转换为 HTTPS 下载域名。最后校验公网清单字段与 DMG 的 HTTPS 响应。已通过本地模拟的传输校验失败不发布及成功发布/备份两种流程；本任务未执行 SSH 上传。

### 首次本地安装包（2026-11-10，已由 0.1.6 替代）

首次打包误沿用了之前本机调试保留版本号的要求，以当时本地桌面源码和开发预览既有 `web-dist/` 生成 `0.1.5` arm64 安装包，包含灰色外壳、统一圆角方形按钮、浏览器区域适配、底部宿主圆角及当前桌宠设置样式。没有拉取远端 Web 或重编译前端；Web 索引 SHA-256 仍为 `86471fb0336d8676fe30e61add03ce7ed2265cd85c674b79b4d99a1ea924d2b0`，默认业务服务为 `https://matter.minduck.com`。

- 安装包：`release/local-debug-20261110-180353/MinduckMatter-0.1.5-arm64.dmg`，193,820,364 字节，SHA-256 `11e1651356bdb79f5fafd524ac6acef07c758d2859c86914a185ff810d6f439a`。同目录保存校验文件、最终 `.blockmap`、输入哈希、签名/公证/挂载检查日志及 `result.json`。
- 定向签名 21 个 Mach-O、8 个嵌套应用/框架及主应用，保留项目权限声明、Hardened Runtime 和安全时间戳；新应用的指定签名要求与现有安装版一致。应用公证 `9354a825-0411-4055-9337-15a92a8c6862`、DMG 公证 `02a43614-c09e-4c28-9a19-04b005766039` 均为 Accepted，应用与 DMG 的票据和签名验证通过。
- 177 项单测通过，385 个包内源码/前端文件哈希与本地输入一致；实际签名包内 Electron 文件 worker、读写版本保护及 Shell 沙箱通过。最终 DMG 只读挂载的应用 5,552 项内容/权限/链接与签名产物一致，深度签名、票据和系统分发检查通过，最终 9,284 个增量块逐项验证通过。
- 本次只生成本地安装包，保留版本号，没有替换本机应用或上传服务器；旧 `release/MinduckMatter-0.1.5-arm64.dmg` 哈希保持不变。

### 同版本本机光标更新（2026-11-10）

按用户要求更新并重启 `/Applications/Minduck Matter.app`，版本保留 `0.1.5`。以当前安装版为基础，仅替换 ASAR 中的光标覆盖层和 SVG 两个文件；372 个包内文件的归属、解包标记和可执行标记一致，Info.plist 只更新 ASAR 完整性哈希。重新签名后指定要求和权限与旧版一致，主程序除代码签名及其长度字段外字节一致。

- 新光标为 22px，带柔和绿色呼吸光晕及以尖端为轴的轻摆；实际包内模块通过深浅主题、CDP 点击穿透、截图隐藏、减少动态效果和四档宽度验证。
- Apple 公证 `428c465b-2565-4516-ad5b-37870151207d` 为 Accepted，票据、深度签名及系统分发检查通过；安装后 5,552 项 bundle 内容/权限/链接与验证产物一致。实际窗口已确认正常加载，原登录和服务地址保留。
- 旧应用完整备份于 `~/Library/Application Support/Minduck Matter Backups/20261110-141552-0.1.5-before-cursor/Minduck Matter.app`；签名、公证和安装校验记录在 `release/metadata/local-cursor-20261110T061304Z/`。本次只更新本机应用，没有生成或替换分发 DMG、修改服务器清单。

### 同版本本机调试（2026-11-09）

按用户要求保留 `0.1.5`，从当前桌面源码和既有 `web-dist/` 构建并替换 `/Applications/Minduck Matter.app`，未发布服务器或更新清单。包含内置浏览器登录后自动注册、移除独立设置入口、走动选项恢复且新用户默认多待机，以及桌宠原生窗口范围收紧。

- 标准签名流程逐个处理静态资源过慢，本次仅在临时调试产物中对 21 个 Mach-O、8 个嵌套应用/框架及主应用定向签名；正式发布脚本不变。新旧应用的指定签名要求完全一致，仍为同一应用 ID 和 Developer ID 团队。应用公证 `f9b4241e-5385-473d-a253-9e5938385c9d` 为 Accepted，装订、深度签名和系统分发检查通过。
- 406 项打包输入、其中 405 项字节哈希及规范化 package.json 校验通过；全部运行时补丁已覆盖。打包后实际 Electron 文件 worker、读写版本保护和 Shell 沙箱通过，相关源码此前 175 项单测及真实 Electron smoke 通过。
- 新安装的 5,552 项 bundle 内容/权限/链接与验证产物一致；旧应用 5,551 项原样备份至 `~/Library/Application Support/Minduck Matter Backups/20261109-152119-0.1.5-before-local-debug/Minduck Matter.app`。沿用原 profile，实际启动保留登录和既有服务地址；菜单无内置浏览器设置，设置页显示三个走动选项且多待机选中，原气泡等偏好保留。
- 调试构建和校验记录在 `release/metadata/local-debug-20261109-150508/`。没有生成新版 DMG，既有 `MinduckMatter-0.1.5-arm64.dmg` 与上传脚本保持原样；原 DMG SHA-256 仍为 `af35f542b9f28e62bd14b4ce1e6a80e6744e1d38e18269b3d43727c8a553794f`。

### 0.1.5 分发包历史记录

2026-11-07 按用户要求从当前本地桌面代码和现有 `web-dist/` 生成 `0.1.5` arm64 包，包含气泡 100–150% 同步缩放、精简设置和系统完全磁盘访问流程；默认正式服仍为 `https://matter.minduck.com`。

- 安装包：`release/MinduckMatter-0.1.5-arm64.dmg`，195,895,866 字节，SHA-256 `af35f542b9f28e62bd14b4ce1e6a80e6744e1d38e18269b3d43727c8a553794f`。
- 应用公证 `2db8fcb6-ab81-479f-b65d-64fe75b2b831`、DMG 公证 `72ccf05a-fcc9-4265-9cc7-75c81d9af387` 均为 Accepted；最终 DMG 挂载应用的深度签名、票据和发布检查通过。405 个文件字节哈希、规范化 package.json、9,410 个最终增量块全部通过；165 项单测与打包 worker/Shell 沙箱验证通过。
- 提供 `release/metadata/upload-0.1.5.sh`：校验本地 SHA-256，上传临时 DMG，远端复核后发布安装包并原子替换 `latest.json`，无需重启容器；已在临时目录验证校验失败不切换及成功清单。脚本未执行上传。本机仍为 0.1.4，安装内容未替换；使用其实际更新检查模块验证待发布的 0.1.5 清单可被识别。

从此打包 Mac 上传并切换更新清单：

```bash
cd /Applications/File/WorkSpace/jomec/Minduck/minduck-matter-desktop
bash release/metadata/upload-0.1.5.sh
```

2026-11-07 后续只读核对时，服务器公开清单已为 0.1.5，对应 DMG 的 HEAD 返回 200；本任务没有执行上传。现有 0.1.4 的“检查更新…”菜单可用于测试，安装仍需用户手动覆盖；版本不高于当前应用时不提供下载。

按用户要求，下载源的 HTTPS 切换仅修改源码，随下一版本打包生效；本地已验证的 0.1.5 安装包、元数据和上传脚本保持原样，不重打包、不替换本机。

### 0.1.4 历史记录

2026-11-07 按用户要求复用本地现有 `web-dist/`，已生成并验证 `0.1.4`：

- 安装包：`release/MinduckMatter-0.1.4-arm64.dmg`；正式服务默认地址仍为 `https://matter.minduck.com`。本机开发版和安装版保存的本地地址覆盖项均已清除，下次启动按默认地址解析。
- 本次不拉取远端 Web 或重编译前端；原本地前端索引 SHA-256 为 `86471fb0336d8676fe30e61add03ce7ed2265cd85c674b79b4d99a1ea924d2b0`。打包当前桌面代码，包含原生浏览器设备、嵌套按钮名称修复及用户提供的箭头光标。
- 应用公证 `33ab7599-e538-4b02-8dee-b34fbd010a99`、DMG 公证 `20d3bcef-46a7-40e0-ab2d-c18fabd74e9d` 均为 `Accepted`；从最终 DMG 只读挂载的应用通过深度签名、票据及发布检查。应用 CDHash 为 `604b9519dade418a02fab0ddc8cc26fb10f85b9a`。
- 包内 380 个源码、扩展及前端文件与本地输入一致；168 项单测，以及前端转发、原生浏览器设备、浏览器界面三组 Electron smoke 通过。最终 DMG 的 SHA-256 和 9,419 个增量块校验通过。
- DMG 为 195,891,588 字节，SHA-256 为 `4d747bb10a568a12869bab5219f1da0cc5981c3f701ac860a10a6367e11fda39`；发布记录、输入哈希、校验文件与最终 `.blockmap` 位于 `release/metadata/`。仅生成本地安装包，未上传或替换安装版。

### 0.1.2 历史记录

2026-11-06 已生成并验证 `0.1.2`：

- `release/MinduckMatter-0.1.2-arm64.dmg`
- `release/MinduckMatter-0.1.2-arm64-app.zip`
- 两个包的发布记录和 SHA-256 位于 `release/metadata/`，DMG 的最终 `.blockmap` 同目录保存，9,382 个块逐项通过校验。

Web 输入为远端 `dev` 的 `6beb91cbf357d19d2f0b62819b86f970b5ac43b8`。应用公证 `bfc6f640-caa3-46e3-b684-2b91d45c380f`、DMG 公证 `09d34e95-bec8-4624-bc34-1d9e0dd2a63a` 均为 `Accepted`，票据验证通过。实际 DMG 内应用、ZIP 解压副本和本机安装版的内容/权限/链接一致；应用 CDHash 为 `0ef967f4d581382d3ff7154d5e35e00a4bf8d2c9`。签名、发布检查及实际包内文件 worker/Shell 沙箱执行通过，未把本机受既有策略覆盖的 `spctl` 结果当作干净机器验收。

本机安装版已替换并启动，旧版保留在 `~/Library/Application Support/Minduck Matter Backups/20261106-133955-0.1.1/Minduck Matter.app`；原服务配置仍为 `http://127.0.0.1:8080`，未将开发版 profile 覆盖到安装版。对其他用户的新安装仍使用包的默认正式服务地址。新版本经飞书等传输后在另一台 Mac 的首次启动尚未验证。

本机执行在首次登录且尚未看过新版引导时自动打开 QA 风格授权页；授权目录内执行 Shell/读写文件不再逐次确认，新目录自动打开系统文件夹选择器并按会话记住。联网是首次页上的独立可选开关，未开启时可从应用菜单「本机执行设置…」补开。完全磁盘访问需用户在引导页点击「系统隐私设置…」并在 macOS 中确认，应用不会自行授予，也不会据此扩大自身目录范围。

## 两种发布方式

| 方式 | 所需 Apple 凭据 | 用户安装方式 | 本文是否覆盖 |
| --- | --- | --- | --- |
| 站外直发 DMG | `Developer ID Application` 证书和 Apple 公证凭据 | 下载 DMG，将应用拖入“应用程序” | 是 |
| Mac App Store | Mac App Distribution、App Sandbox、配置描述文件和 App Store Connect 提交 | App Store 安装 | 否，需单独实现和提审 |

站外直发的完整链路为：

```text
更新版本 → 验证 → 构建 Web → 应用签名 → 应用公证与装订
       → 生成并签名 DMG → DMG 公证与装订 → 验证 → 发布 DMG 与 SHA-256
```

公证状态为 `Accepted` 且装订验证成功后，DMG 可以提供给其他用户安装。它不代表 App Store 审核通过，也不会自动上架 App Store。

## 静态下载与菜单检查更新

桌面端应用菜单的“检查更新…”只读取一个静态 JSON，不调用 Matter Web 或业务后端。源码中的发布源为
`https://matter-desktop.yogeeai.com/download/latest.json`，下载地址为 `https://matter-desktop.yogeeai.com/download/` 后拼接 `MinduckMatter-<version>-arm64.dmg`。例如 `https://matter-desktop.yogeeai.com/download/MinduckMatter-0.1.5-arm64.dmg`。Caddy 容器 `minduck-download` 只读提供服务器目录
`/root/minduck-matter-download/releases/`。不要改动 `/opt` 下的其他服务、Caddy、MinIO 或现有容器。

清单格式如下，版本必须是 `x.y.z`，DMG 文件名必须和版本完全一致。`downloadUrl` 保留旧值供现有安装版做同源校验，新源码读取后转换为上述 HTTPS 下载地址：

```json
{
  "version": "0.1.3",
  "downloadUrl": "http://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.dmg"
}
```

新源码仅接受精确匹配下载目录、版本和文件名的 HTTPS 地址，或上例精确匹配的旧地址；带认证、参数、片段或其他路径的地址均拒绝，旧地址只用于兼容清单，不会成为新版浏览器的下载目标。版本不高于当前应用时不会打开下载页。0.1.5 及更早安装版仍访问旧 IP 并要求下载与清单同源，所以后续发布继续保留清单里的旧地址字段。发布时一定先上传和验证 DMG，再以 `mv` 原子替换清单，避免用户读到指向不存在文件的版本。

### 标准一键发布

恢复好 `MinduckNotary` 钥匙串 profile 和服务器 SSH 登录后，每次只需在桌面项目根目录运行，传入一个明确的新版本号：

```bash
pnpm release:mac 0.1.4
```

`release:mac` 依次执行：读取当前公开清单并拒绝回退、建立可复用的服务器 SSH 连接、验证公证 profile、运行单测、更新 `package.json`、
从最新远端 Web `dev` 构建签名并公证 DMG/ZIP、校验本地文件与应用内更新清单、上传三个 `.uploading` 临时文件、让服务器复核全部 SHA-256，
再替换安装包、`latest-mac.yml` 与兼容旧客户端的 `latest.json`，最后从公网读取两个清单并检查 DMG/ZIP 响应。上传文件校验失败时不切换清单；切换后的公网验证失败会报错，不自动回退。整个过程不会重启 Caddy、MinIO 或其他容器。若失败发生在本地版本更新后，可在修复问题后用相同版本重试；脚本允许本地版本等于目标版本，但仍要求目标版本高于服务器当前版本。

SSH 上传目标固定为 `root@124.70.149.30`，与公网下载域名分开配置。未配置服务器 SSH 密钥时，命令会在开始时询问密码一次，并通过 SSH ControlMaster
复用到后续上传和清单切换。长期发布建议配置公钥；连接失败发生在打包前，不浪费 Apple 公证时间。

### 上传已公证安装包并清理旧版

已经完成打包、公证及本地验证后，固定使用：

```bash
cd "/Applications/File/WorkSpace/jomec/Minduck/minduck-matter-desktop" && pnpm upload:mac
```

命令自动读取 `package.json` 的版本，使用 `release/MinduckMatter-<版本>-arm64.dmg`、对应 ZIP 和 `release/metadata/latest-mac.yml`，不会改版本、重新构建或重新提交公证。先校验安装包与清单；存在版本及两个 SHA-256 均匹配的 Accepted 公证记录时复用，否则验证 DMG 签名和票据。服务器 SSH 登录正常只需输入一次密码，后续上传、清单切换和清理复用连接。

DMG、ZIP、`latest-mac.yml` 全部上传并在服务器校验成功后，切换安装包及两个更新清单，兼容旧客户端的下载地址字段继续保留。公网两个清单内容及 DMG/ZIP 响应验证成功后，再确认服务器清单 SHA-256 仍属于本次发布，才清理发布目录中版本更旧的 arm64 安装包及其匹配辅助文件、版本不高于当前版的旧清单备份。保留当前版、未来版、正在上传文件、符号链接、目录和其他文件；不清理本地包或其他服务。

允许同版本重试，方便补齐此前漏传的 ZIP 或更新清单；仍禁止向服务器发布更旧版本。同版本重试应使用同一份已验证产物，新内容须升级版本并重新打包。校验或公网验证失败不会进入旧包清理；若失败发生在切换清单之后，清单不会自动回退，修复原因后重试此命令。

### 手动上传一个新版本

以下命令从打包 Mac 上传 `0.1.3`。第一步会要求服务器 SSH 凭据；上传使用临时后缀，远端切换只发生在完整文件已经到达后：

```bash
cd /Applications/File/WorkSpace/jomec/Minduck/minduck-matter-desktop

version=0.1.3
dmg="MinduckMatter-${version}-arm64.dmg"
remote_dir=/root/minduck-matter-download/releases

test -f "release/${dmg}" || { echo "找不到 release/${dmg}"; exit 1; }
checksum="$(shasum -a 256 "release/${dmg}" | awk '{print $1}')"

scp "release/${dmg}" \
  "root@124.70.149.30:${remote_dir}/${dmg}.uploading"

ssh root@124.70.149.30 'bash -s' -- "$version" "$checksum" <<'REMOTE_SCRIPT'
set -euo pipefail
version="$1"
expected_checksum="$2"
release_dir=/root/minduck-matter-download/releases
dmg="MinduckMatter-${version}-arm64.dmg"
scheme=http
public_host=124.70.149.30
port=8091

test -s "$release_dir/$dmg.uploading"
actual_checksum="$(shasum -a 256 "$release_dir/$dmg.uploading" | awk '{print $1}')"
test "$actual_checksum" = "$expected_checksum"
mv "$release_dir/$dmg.uploading" "$release_dir/$dmg"

# Keep the manifest compatible with the same-origin check in installed 0.1.5 and earlier.
download_url="${scheme}://${public_host}:${port}/${dmg}"
printf '%s\n' \
  '{' \
  "  \"version\": \"${version}\"," \
  "  \"downloadUrl\": \"${download_url}\"" \
  '}' > "$release_dir/latest.json.next"
mv "$release_dir/latest.json.next" "$release_dir/latest.json"

curl --silent --fail "${scheme}://127.0.0.1:${port}/latest.json"
REMOTE_SCRIPT

curl --head --noproxy '*' "https://matter-desktop.yogeeai.com/download/${dmg}"
curl --silent --noproxy '*' "https://matter-desktop.yogeeai.com/download/latest.json"
```

这套命令不会重启 Docker 容器：Caddy 直接读取同一目录，新文件和清单会立即生效。请仅在签名、公证和本地验证完成后发布；客户端版本低于新清单时会打开 DMG，`0.1.3` 自身安装后才能通过菜单发现后续版本。

## 一次性 Apple 侧准备

### 1. Apple Developer Program 与权限

使用已加入 Apple Developer Program 的组织账号。操作人员需要有创建/下载证书的权限；创建 App Store Connect API Key 则需要 App Store Connect 中相应的密钥管理权限。团队标识（Team ID）要与签名证书所属团队一致。

### 2. 创建并安装 Developer ID Application 证书

1. 在 [Apple Developer Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list) 创建 `Developer ID Application` 证书。
2. 在打包 Mac 的“钥匙串访问”中创建或选择登录钥匙串里的证书签名请求（CSR），并按 Apple 页面流程上传。
3. 下载 `.cer` 后双击安装到“登录”钥匙串；其私钥必须与证书成对存在。
4. 在终端确认能找到签名身份：

```bash
security find-identity -v -p codesigning
```

输出中应出现类似 `Developer ID Application: Your Organization (TEAMID)` 的有效身份。证书文件和私钥不得提交到仓库；若要迁移打包机，用受控密码管理或企业密钥管理方式转移，不要放在项目目录。

项目的 `build/entitlements.mac.plist` 和 `build/entitlements.mac.inherit.plist` 是受版本控制的应用权限声明。凭据配置时不要修改它们。

### 3. 创建 App Store Connect API Key 与 `.p8`

`.p8` 私钥用于让 `notarytool` 代表团队调用 Apple 公证服务。它不是打包脚本直接读取的文件；项目使用 macOS 钥匙串中的凭据 profile。

1. 进入 [App Store Connect - Users and Access](https://appstoreconnect.apple.com/access/users)，打开 **Integrations → Keys**。
2. 创建一个仅用于公证的 API key，记录 **Key ID** 和页面显示的 **Issuer ID**。
3. 下载 `AuthKey_<KEY_ID>.p8`。Apple 只允许下载一次，立刻将它存到仓库外的受控私密目录或密码管理系统。
4. 收紧本机文件权限，例如：

```bash
chmod 600 /absolute/secure/path/AuthKey_<KEY_ID>.p8
```

`.p8`、`.p12`、配置描述文件和任何密码都不能进入 Git、构建日志、截图或聊天记录。本项目的 `.gitignore` 已忽略常见 Apple 私钥文件名，但忽略规则不能替代受控保存。

### 4. 将 `.p8` 保存为钥匙串公证 profile

只需在每台打包 Mac 上执行一次。以下命令会把 API key 凭据保存在该 Mac 的钥匙串；尖括号内容全部替换成自己的值：

```bash
xcrun notarytool store-credentials "MinduckNotary" \
  --key "/absolute/secure/path/AuthKey_<KEY_ID>.p8" \
  --key-id "<KEY_ID>" \
  --issuer "<ISSUER_ID>"
```

确认 profile 可用：

```bash
xcrun notarytool history --keychain-profile MinduckNotary
```

默认 profile 名为 `MinduckNotary`。如需使用另一名称，在打包命令中设置 `MINDUCK_NOTARY_PROFILE=<名称>`。

## 打包机前置检查

在项目根目录执行：

```bash
cd /Applications/File/WorkSpace/jomec/Minduck/minduck-matter-desktop
xcodebuild -version
security find-identity -v -p codesigning
xcrun notarytool history --keychain-profile MinduckNotary
pnpm install
```

需要 macOS、Xcode Command Line Tools（包含 `notarytool`）以及项目锁定版本的 Node.js/pnpm。若消费已经构建好的 Web 前端，还需要有效的 `web-dist/` 目录；这适合没有相邻 Web 源码的打包机。

## 每次发布流程

### 1. 确认版本与输入内容

先修改 `package.json` 的 `version`。DMG 名称基于该版本号；不要用新发布覆盖同版本的旧产物。打包脚本会临时浅克隆 Web 仓库的远端 `dev` 分支并按其锁定依赖构建，因此不使用同级 Web 工作区当前分支或未提交修改。

默认业务后端是正式环境 `https://matter.minduck.com`。打包时的 Web 静态资源会内嵌到应用，但登录、会话和业务 API 仍按客户端服务地址配置访问后端。

### 2. 运行快速验证

至少运行：

```bash
pnpm test
pnpm run check:companion
```

涉及右侧浏览器或桌宠变更时，追加对应 smoke，例如 `pnpm run test:browser-chrome` 或 `pnpm run test:companion`。只发布验证通过的版本。

### 3. 生成已签名且公证的 DMG

```bash
pnpm dist:mac
```

默认从同级 `minduck-matter-web-prod` 仓库读取 `origin` URL，随后克隆其最新远端 `dev` 分支。打包机没有该仓库时，显式指定远端：

```bash
MINDUCK_WEB_REMOTE="git@github.com:your-org/matter-web.git" \
MINDUCK_NOTARY_PROFILE="MinduckNotary" \
CSC_NAME="Developer ID Application: Your Organization (TEAMID)" \
pnpm dist:mac
```

即使环境中存在 `MINDUCK_WEB_DIST`，正常发布也会忽略它，防止旧产物进入安装包。CI 在已验证预构建产物来源时，或用户明确要求使用本地产物打包时，可显式设置 `MINDUCK_WEB_ALLOW_PREBUILT=1` 和 `MINDUCK_WEB_DIST=/path/to/dist` 跳过远端 `dev` 构建。此时不会拉取 Web 源码、安装 Web 依赖或重新编译前端，仍会打包当前桌面源码并完成签名、公证和票据验证；发布记录应明确是本地产物，并保存输入哈希，不将其表述为最新远端版本。

复用当前桌面项目中的前端构建：

```bash
MINDUCK_WEB_ALLOW_PREBUILT=1 MINDUCK_WEB_DIST="$PWD/web-dist" pnpm dist:mac
```

脚本会先检查签名身份和钥匙串 profile，再克隆远端 Web `dev`、安装锁定依赖、构建 Web、桌宠运行时和图标。接着向 `electron-builder` 提供已验证的钥匙串 profile，签名完整 Electron bundle，并在生成 DMG/ZIP 前完成应用公证与票据装订。构建后再次验证应用的嵌套签名和票据；系统提供 `syspolicy_check` 时，同时执行应用发布检查。随后签名 DMG、提交其公证并等待结果，最后装订和验证 DMG 票据。装订后重新生成 DMG 的 `.blockmap` 并刷新 `latest-mac.yml` 中的最终文件哈希。中途任一步失败时，临时构建目录会清理，`release/` 中已有的发布文件不会被替换。

成功后的文件为：

```text
release/MinduckMatter-<version>-arm64.dmg
release/MinduckMatter-<version>-arm64.zip
release/metadata/latest-mac.yml
release/metadata/MinduckMatter-<version>-arm64.dmg.blockmap
release/metadata/MinduckMatter-<version>-arm64.dmg.sha256
release/metadata/MinduckMatter-<version>-arm64.zip.sha256
```

`release/` 顶层保留当前可分发的 DMG/ZIP。发布记录 JSON、SHA-256 和增量 `.blockmap` 放在 `release/metadata/`；已被替代的旧包及其对应辅助文件放在 `release/archive/<版本>/`，整理时保留文件原内容。打包脚本自动将新生成的 `.blockmap` 和 `.sha256` 写入 `metadata/`；旧包归档仍在确认替代关系后进行。日常给收件人发包只需选择 DMG 或 ZIP，不必附带内部发布记录和增量文件。

`pnpm dist:mac` 默认生成已签名且公证的对外发布包。只有不对外分发的本地调试场景，才使用 `MINDUCK_MACOS_SIGN=0 pnpm dist:mac` 生成无签名 DMG。

## 安装更新与避免重复应用入口

源码已接入应用内更新：正式安装的 Apple Silicon 客户端检查固定 HTTPS 下载目录的 `latest-mac.yml`，用户点击“下载并重启更新”后下载 ZIP，侧栏与 Dock 显示进度。SHA-512 校验和系统更新组件的签名验证完成后，再停止桌宠、替换并重启；执行中的任务可以选择稍后安装。普通退出不会主动准备更新，开发预览及未安装到“应用程序”的客户端不安装更新。首版关闭增量下载及旧 ZIP 缓存，不额外创建回滚备份。

首次安装、当前已安装的 0.1.7 升级到带更新器的版本，或需要手动恢复时，仍使用 DMG：

1. 使用 ⌘Q 退出 Minduck Matter，打开新 DMG。
2. 将同名 `Minduck Matter.app` 拖入“应用程序”，选择“替换”，固定使用 `/Applications/Minduck Matter.app`。不要给安装版加版本号或选择“保留两者”。
3. 从“应用程序”启动新版，确认版本和原有登录状态，再推出安装盘。

不需要先卸载旧版或删除 `~/Library/Application Support/minduck-matter-desktop`。macOS 只替换该目标位置的同名应用，不会删除其他目录的 `.app`；本机曾出现的重复入口来自开发时保留的回滚备份和打包应用。

开发与本机替换也遵循以下约束：

- 按用户要求不创建或保留回滚备份，包括旧版 `.app` 副本及额外备份 ZIP。验证新安装产物后直接替换固定路径的应用，保留用户数据和正常发布安装包。自动更新 ZIP 是必要分发产物，下载缓存和系统安装暂存文件属于更新过程；不额外保留旧版应用作为备份。只有用户明确要求时才额外备份。
- 正常打包使用 `pnpm dist:mac`，现有脚本在临时目录构建并在退出时清理。手动签名、公证或调试替代流程也必须清理自己的临时 `.app`、解压验证副本，并卸载自己挂载的 DMG；需要保留的应用改存 DMG/ZIP，日志和校验记录照常保留。
- 清理后若系统仍列出重复项，先用原生应用解析确认实际路径，再定向取消过期 Minduck 路径的注册；移到废纸篓后的路径也可能被系统跟踪。保留正式安装版的注册，不重置全局 LaunchServices 数据库。

客户端只通过系统更新器处理当前应用，不扫描磁盘或自动删除其他应用副本。

### 应用内更新的发布与验收

- `pnpm dist:mac` 同时生成 DMG 和自动更新 ZIP，builder 写入应用内的 `app-update.yml`。应用公证及票据必须在生成更新 ZIP 前完成；ZIP 外层不单独装订票据。
- 最终 DMG 装订会改变字节。脚本刷新 DMG blockmap 后，调用 `scripts/macos-update-artifacts.cjs`，重算 `latest-mac.yml` 中 DMG/ZIP 的大小与 SHA-512，避免清单引用装订前的哈希。
- `pnpm release:mac <version>` 上传 DMG、ZIP 与 `latest-mac.yml` 的 `.uploading` 文件；服务器校验所有 SHA-256 后才切换文件及清单，并保留 `latest.json` 兼容旧客户端。下载服务须支持 HTTPS 读取 `.zip` 与 `.yml`；仅有旧 `latest.json`/DMG 不足以供新更新器使用。本次未部署这些服务端文件。
- 运行 `pnpm test`、`pnpm run test:desktop-update` 和 `pnpm run test:browser-chrome`。更新 smoke 使用隔离 profile、真实更新库 HTTP/哈希校验及真实渲染器；系统安装接口被替身代替，不触碰本机安装版。
- 正式发布前，还必须在隔离测试机用两份同一发布方签名、公证的版本完成真实旧版→新版替换与自动重启，验证登录、设置、桌宠、任务提示及无重复入口；包含断网、坏包、无写入权限和安装失败场景。临时无签名打包与替身测试不能替代该验收。

## 发布前验证

将 `<dmg>` 替换为实际输出文件：

```bash
xcrun stapler validate "release/<dmg>"
spctl --assess --type open --context context:primary-signature -vv "release/<dmg>"
shasum -a 256 "release/<dmg>"
```

可额外挂载 DMG 并检查应用签名。挂载后请用“磁盘工具”或 `hdiutil detach` 卸载对应卷：

```bash
codesign --verify --deep --strict --verbose=2 "/Volumes/<mounted-volume>/Minduck Matter.app"
xcrun stapler validate "/Volumes/<mounted-volume>/Minduck Matter.app"
syspolicy_check distribution "/Volumes/<mounted-volume>/Minduck Matter.app"
```

必须检查实际 DMG 内的应用，不能只检查构建目录或另外装订过票据的本机安装版。如果 `spctl` 输出包含 `override=security disabled`，其接受结果不作为独立的分发验证依据。系统未提供 `syspolicy_check` 时，保留签名/票据验证并在另一台启用正常安全策略的 Mac 上验证首次安装启动。

在一台干净的 macOS 测试机下载 DMG，完成拖拽安装、首次启动、登录、服务地址设置和关键业务 smoke。发布页面应同时提供 DMG、版本说明、支持的系统/芯片架构以及上一步生成的 SHA-256，方便用户核对下载完整性。

## ZIP 传输对照包

需要对照压缩包安装方式时，从已验证签名并装订票据的同一份 `.app` 生成 ZIP，而不是把未经验证的本机安装版重新打包：

```bash
ditto -c -k --sequesterRsrc --keepParent "/path/to/verified/Minduck Matter.app" "/path/to/new/MinduckMatter-app.zip"
```

发布前将 ZIP 解压到独立目录，比较完整文件内容、权限和符号链接，再验证解压后应用的深度签名、票据和发布状态。ZIP 外层不能装订票据，应用内的已有票据必须保留。安装时先解压，再将 `.app` 拖入“应用程序”替换旧版本。

`0.1.1-r1-app.zip` 使用与 `r1` DMG 相同的已签名应用，解压后的内容、权限、14 个符号链接、签名、票据和发布检查已验证。用户已确认原 `r1` 应用清除飞书隔离标记后可启动；ZIP 经飞书传输的实际效果尚未验证，不能把换容器格式当作确定的修复。

## 没有独立下载站时的传输

- 异地通过飞书传输时，可在 Safari/Chrome 登录飞书网页版，从原聊天消息下载附件，无需另建下载站。接收端的实际首次安装启动仍应验证。
- 当面可用 AirDrop 或 U 盘传递已验证的 DMG/ZIP，再按格式挂载或解压，将应用拖入“应用程序”。这些路径尚未在本项目的目标机器逐一测试，不能承诺不会出现隔离提示。
- 如果只能使用飞书桌面客户端下载附件，ZIP 的实际效果仍需验证。遇到本次已确认的 `0187;…;Feishu;` 禁止执行问题时，核对可信来源、完整签名及本次发布的固定代码指纹后，才定向清除此应用的隔离标记，再安全评估和启动。`0.1.1-r1` 已由用户确认该恢复方式有效；换版本必须重新取得发布指纹，不要沿用旧指纹或关闭系统安全保护。

## 常见失败与处理

| 现象 | 处理方式 |
| --- | --- |
| 找不到 `Developer ID Application` | 检查证书及私钥是否安装在打包 Mac 的登录钥匙串，使用 `security find-identity -v -p codesigning` 确认。 |
| `MinduckNotary` 无法验证 | 检查网络和钥匙串 profile；重新用受控位置的 `.p8` 执行 `notarytool store-credentials`。 |
| 公证被拒绝 | 用 submission ID 拉取 Apple 日志：`xcrun notarytool log <submission-id> --keychain-profile MinduckNotary`。修复包内容或签名问题后重新构建新的 DMG。 |
| 已公证 DMG 被修改 | 不要重新压缩、替换或签名其中内容；任何内容变化都需要重新签名、公证和装订。 |
| 签名有效，但提示 `File created by an AppSandbox, exec/open not allowed`，启动返回 `-10810` | 先读取已安装 `.app` 与主程序的 `com.apple.quarantine`，并确认传输方式。已遇到飞书添加 `0187;…;Feishu;` 的情况，而原始 DMG 内应用无该标记。优先从可信来源用浏览器重新下载、替换；不能重下时，先校验完整签名、发布方及已验证的发布代码指纹，才定向清除此应用的隔离标记，再执行 `spctl` 评估和实际启动验证。不要关闭 Gatekeeper 或批量处理其他应用。`-10810` 本身不能单独确定原因。 |
| 证书或 API key 轮换/撤销 | 在新的打包机或钥匙串 profile 中配置新凭据后重新打包公证；撤销后的旧签名不应用于后续发布。 |

Apple 公证的 submission 记录可用以下命令查询：

```bash
xcrun notarytool history --keychain-profile MinduckNotary
```

## 发布安全清单

- 使用 `Developer ID Application`，不是开发证书或 Mac App Distribution 证书。
- `.p8` 只在仓库外的受控位置出现一次，并以钥匙串 profile 供 `notarytool` 使用。
- 每次发布前更改版本号，保留 DMG、SHA-256 与公证记录。
- 只在 `notarytool` 显示接受、`stapler validate` 和 Gatekeeper 检查均通过后对外发布。
- 不要把密钥、证书导出文件、Key ID、Issuer ID 或打包环境变量截图提交到 issue、日志或仓库。

## Mac App Store 的后续工作

如果要上架 Mac App Store，不能复用此文的直发 DMG 作为提交物。需要单独评估 App Sandbox 能力、Mac App Distribution 签名和 provisioning profile、App Store Connect app 记录、隐私信息、截图/元数据、归档上传、审核与 TestFlight 测试。上述流程目前尚未在这个项目中实现或验证。
