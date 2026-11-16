# 客户端内置浏览器与本机执行

## 当前状态（2026-11-13，已合入 0.1.9）

内置浏览器和 Shell 是当前客户端能力。登录后主进程建立一个 `/api/client-runtime/ws` 连接，无配对、核销、设备注册或长期设备 token，不向 `mcp_devices`／设备 server 写入。旧文档中的 `kind=browser` 自动配对、独立浏览器设置与 `data-matter-device` 注入已废止。用户自行安装的外部 Chrome 扩展仍使用原配对链路。

## 实际架构

```text
Matter RunManager → AgentRuntime → ToolProvider
        ↕ /api/client-runtime/ws（登录 JWT 首帧认证）
src/client-runtime.cjs（主进程身份、能力、连接生命周期）
        ↕ src/local-exec/connection.cjs（复用 RPC／心跳／取消传输）
        ├─ src/local-exec/controller.cjs → Shell／文件／Seatbelt／系统授权
        └─ src/browser-device/tools.cjs → 固定 1.3.2 工具引擎
                 ↓
          AgentBrowserCompatibility + page-runtime.cjs
                 ↓
          右侧任务标签 WebContents／隔离 CDP world／子 iframe
```

服务端固定 15 件原生浏览器工具及四件 localexec 工具，保留风险门和原有 Shell 阶段范围。一个进程随机生成 runtime ID，重连使用新连接代次；当前登录过期或切账号后旧连接和执行上下文失效，不自动重放有副作用的调用。

桌面请求由主进程按精确 origin 和账号注入短时 `X-Matter-Runtime`。普通 Web 通过仅监听 `127.0.0.1:19473/context` 的桥接取得同一电脑上下文：校验精确 Host、Origin、JWT 账号，并请求 `/api/me` 验证。桥接只返回状态和短时 proof，没有执行接口，不返回登录／设备 token。Electron 自定义协议省略 Origin 时，仅对精确桥接地址、来自当前 Matter origin 的可信请求 referrer 补回 Origin；不扩大桥接允许的来源。浏览器阻止回环访问时在客户端内操作；不会按账号任取另一台在线电脑。

工具引擎仍在私有主进程 VM 中复用，`extensions/matter-browser/background.js` 的两个宿主入口提供引擎和 nativeImage 压缩。页面只有无 Node／IPC 的隔离 CDP world。保留原有任务组、站点、ref、可信输入、导航和上传边界，避免重新实现工具语义。

## 工具与范围

保留既有 15 件工具：`get_windows_and_tabs`、`chrome_navigate`、`chrome_read_page`、`chrome_get_web_content`、`chrome_get_interactive_elements`、`chrome_click_element`、`chrome_fill_or_select`、`chrome_keyboard`、`chrome_computer`、`chrome_screenshot`、`chrome_switch_tab`、`chrome_close_tabs`、`chrome_handle_dialog`、`chrome_upload_file`、`chrome_javascript`。

- 工具统一经过引擎的「Minduck Matter」任务标签组校验。手动标签不能被显式 tabId、默认目标或批量关闭路径接管；左侧固定 Matter 页不属于浏览器标签集合。
- 对外的扩展调试接口仍只允许原有 9 个页面级 CDP 方法。原生运行时内部单独使用 frame tree、隔离 world，以及当前任务页的子 iframe 自动附加，不开放浏览器范围的 `Target.getTargets` 给工具或扩展。
- 页面 ref 存在私有 world，导航后必须重新读取；页面主世界看不到 ref 容器或 Node API。
- 同源 frame 和跨源独立进程 frame 使用各自的隔离执行环境；frameId 在当前标签生命周期内映射，0 为主 frame。MAIN 世界脚本仅支持主 frame。复杂站点中的具体 iframe 交互仍沿用固定引擎能力，不承诺完整 Chrome 扩展 API 兼容。
- 文件上传读取当前 Matter 源的 `/media/` 字节，通过页面内的 File/DataTransfer 设置 file input，不读取本机任意路径，也不使用 `DOM.setFileInputFiles`。拒绝重定向、其他源、file URL 和超过 20MB 的响应；同时检查声明长度与实际流长度。
- 截图用 nativeImage 转 JPEG，不改变像素尺寸；工具引擎继续负责截图与视口之间的坐标映射。

## 生命周期与数据

- 未登录时等待；登录账号／服务源变化、窗口关闭或退出时停止旧连接并清空 proof，取消旧操作。重新打开窗口建立新的有效连接。
- runtime ID 和 proof 仅存内存；不读取或续用旧浏览器设备凭证。旧配对模块和数据保留给兼容回归，不从生产主入口加载。
- 浏览器与 Shell 单独上报能力。Shell 未获得系统授权时浏览器仍可连接；撤销权限会取消活跃本地调用，保留统一浏览器传输。
- JS 对话框暂停渲染器时，仅已观察到的任务页对话框处理可以使用最近验证且未过期身份；其他操作读取实时身份。
- 浏览器每条客户端连接串行执行，取消释放调试资源。已提交页面动作、JavaScript 和已发生文件副作用不能回滚；未知结果不盲目重试。
- Matter 页面不新增 Shell 执行 preload／IPC；执行器仍在主进程。本机权限、凭据目录保护和 Seatbelt 规则不因免配对而放宽。
- 测试包的 `shellTestOrigin` 元数据将服务指向 `http://localhost:3003`，并使用独立 `minduck-matter-shell-test` profile；正常包无此元数据时原配置优先级不变。

## 验证

```bash
pnpm test
pnpm run test:browser-device
pnpm run test:local-exec
pnpm run test:extension-compatibility
```

本轮 173 项单测通过；真实 Electron 本地执行 smoke 验证 Seatbelt、目录保护、取消、系统权限撤销和账号切换；浏览器 smoke 覆盖全部 15 件工具、手动标签隔离、子 iframe、ref、截图、上传、对话框及取消，fixture 对配对／核销／注册请求直接报错。真实 API＋模型＋客户端联合执行 Shell 并保存会话记录通过。

首轮真实 macOS 系统授权仍需用户操作，自动化使用注入授权状态和一次性 home，不更改用户 TCC。另一台物理电脑的本机定位与首次授权尚未实测。升级扩展工具包时须同步宿主入口和后端固定 schema，重跑相关测试。
