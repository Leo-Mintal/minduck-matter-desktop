# 内置浏览器设备接入

## 当前状态（2026-11-07）

桌面端主进程直接作为 `kind=browser` 设备连接 Matter 的反向 WebSocket。默认入口不再启动 Matter Browser 扩展 worker；用户登录当前 Matter 服务后自动配对，无需安装 Chrome 扩展。应用菜单「内置浏览器设置…」提供开关、连接状态和解除配对。

本轮只改桌面仓库，未改 Matter Web 或后端，未新增依赖。开发版使用独立 profile；未重打包或替换安装版。原始桌面状态已保存为 `7f3a599`，改造位于 `codex/builtin-browser-device`。

## 实际架构

```text
Matter reverse.Hub
  initialize / tools/list / tools/call / notifications/cancelled
        ↕ device-link/ws
src/local-exec/connection.cjs（通用传输，浏览器模式不声明 localExec）
        ↕
src/browser-device/controller.cjs（账号、配对、开关、连接生命周期）
        ↓
src/browser-device/tools.cjs
  私有 Node VM 内复用固定版本 1.3.2 的工具引擎和全部 15 份 schema
        ↓
AgentBrowserCompatibility + src/browser-device/page-runtime.cjs
        ↓
右侧任务标签 WebContents / CDP 隔离环境 / 子 iframe 会话
```

`extensions/matter-browser/background.js` 增加两个明确的桌面宿主入口：导出既有工具引擎、使用 Electron nativeImage 压缩截图。宿主钩子只存在于主进程创建的私有 VM；网页不接触它。普通扩展运行路径保留，兼容性 smoke 继续覆盖。

### 为什么没有直接转译 15 个工具名

原方案低估了适配成本：MCP 工具名不等于兼容层方法名（实际使用 `tabs.create`、`debugger.sendCommand` 等）；可访问树、ref、跨 frame、导航等待、页面变化判断及取消都含有现成状态逻辑。复制 schema 并重写整套工具容易发生行为漂移。

本实现复用这套工具执行逻辑，新增窄的 Chrome API 适配器。辅助脚本依赖 `chrome.runtime.onMessage` 和各自的私有 ref 状态，不能当作纯函数直接塞进页面主世界。`page-runtime.cjs` 为它们建立无 Node、无 IPC 的独立 CDP world，并提供私有消息派发。

## 服务端约定

- 配对必须传 `kind=browser`。`kind=desktop` 由服务端保留给本机执行，不能直接用来调用通用浏览器 MCP 工具。
- 复用 `POST /api/extensions/devices/pairings`、`POST /api/extensions/device-link/redeem`、`GET /api/extensions/device-link/ws` 和 `DELETE /api/extensions/device-link/self`。
- 握手的 `extension_version` 使用固定工具引擎版本 `1.3.2`，与桌面应用版本分开。
- 设备在线且账号匹配时，主进程向固定 Matter 页写入 `data-matter-device`。既有 Web 请求据此发送 `X-Matter-Device`，避免仅配对成功却没有可用工具。
- 是否执行写操作继续由服务端既有权限闸决定。点击、键盘、关闭标签、上传和 JavaScript 等不能统一视为无需审批的只读操作；对话框和 computer 操作也按具体动作处理。

本地集成测试覆盖真实 WS 握手与工具调用。真实服务端、真实账号和模型连续任务的联合验收仍需在登录后的开发版完成，不能由 fixture 测试替代。

## 工具与范围

保留既有 15 件工具：`get_windows_and_tabs`、`chrome_navigate`、`chrome_read_page`、`chrome_get_web_content`、`chrome_get_interactive_elements`、`chrome_click_element`、`chrome_fill_or_select`、`chrome_keyboard`、`chrome_computer`、`chrome_screenshot`、`chrome_switch_tab`、`chrome_close_tabs`、`chrome_handle_dialog`、`chrome_upload_file`、`chrome_javascript`。

- 工具统一经过引擎的「Minduck Matter」任务标签组校验。手动标签不能被显式 tabId、默认目标或批量关闭路径接管；左侧固定 Matter 页不属于浏览器标签集合。
- 对外的扩展调试接口仍只允许原有 9 个页面级 CDP 方法。原生运行时内部单独使用 frame tree、隔离 world，以及当前任务页的子 iframe 自动附加，不开放浏览器范围的 `Target.getTargets` 给工具或扩展。
- 页面 ref 存在私有 world，导航后必须重新读取；页面主世界看不到 ref 容器或 Node API。
- 同源 frame 和跨源独立进程 frame 使用各自的隔离执行环境；frameId 在当前标签生命周期内映射，0 为主 frame。MAIN 世界脚本仅支持主 frame。复杂站点中的具体 iframe 交互仍沿用固定引擎能力，不承诺完整 Chrome 扩展 API 兼容。
- 文件上传读取当前 Matter 源的 `/media/` 字节，通过页面内的 File/DataTransfer 设置 file input，不读取本机任意路径，也不使用 `DOM.setFileInputFiles`。拒绝重定向、其他源、file URL 和超过 20MB 的响应；同时检查声明长度与实际流长度。
- 截图用 nativeImage 转 JPEG，不改变像素尺寸；工具引擎继续负责截图与视口之间的坐标映射。

## 生命周期与数据

- 凭证独立保存在 `<userData>/browser-device/settings.json`，safeStorage 加密，文件权限 0600；不与本机执行的设备 ID 或令牌共用。
- 默认开启，未登录时等待；设置损坏时安全关闭。账号或服务源不匹配、设备撤销时停止连接并要求手动重新开启。
- 每次原生操作前校验当前账号、源、开关和连接代次。配对期间关闭或切账号时，丢弃迟到结果，并尝试撤销刚签发的凭证。
- JS 对话框暂停渲染器时，仅已观察到的任务页对话框处理可使用该固定 Matter 文档最近验证且未过期的身份；其他操作仍读取实时身份。调试连接由原生运行时持有，在关闭、取消或账号变化时释放，避免工具结束时误中断对话框。
- 每台设备一次只派发一个调用。取消会中止后续原生步骤并释放调试连接；取消中的调用不会与新调用同时派发。已提交给页面的 JavaScript 或已完成的动作不能回滚，超时和取消后不能盲目重放写操作。
- 关闭主窗口只暂停连接，重新打开复用已配对设备；关闭功能立即撤销在线 presence。解除配对失败时保留加密凭证供重试。
- 网页没有新增 preload 或 IPC 权限；本机文件和 Shell 仍由独立的本机执行控制器处理，启动时检查系统完全磁盘访问，不再提供本机执行设置页。

## 验证

```bash
pnpm test
pnpm run test:browser-device
pnpm run test:extension-compatibility
pnpm run test:browser-chrome
pnpm run test:local-exec
```

`test:browser-device` 在一次性 profile 中使用真实 Electron、safeStorage、HTTP 和反向 WS fixture，覆盖 15 件工具、手动标签隔离、ref 填写与导航失效、可信点击、同源/跨源 iframe、截图、媒体上传限制、确认框、并发拒绝、取消和设置开关。采用离屏原生渲染，不依赖桌面鼠标，也不访问真实模型。系统 `prompt()` 的可用性取决于 Electron，本轮真实对话框测试使用 `confirm()`。

升级扩展工具包时必须保留或同步这两个宿主入口，并重跑以上测试；不能只替换 bundle 或只提高声明版本。锁屏环境可以完成离屏验证，但不能据此声称已人工验收开发版的可见窗口。
