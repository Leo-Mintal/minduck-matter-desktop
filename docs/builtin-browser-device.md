# 内置浏览器设备接入方案

## 背景

Matter agent 执行时支持一套浏览器工具（截图、点击、读页面、填表单等），目前这套工具通过用户自己安装的 Chrome 扩展（`minduck-matter-browser`）接入：扩展主动拨出一条 WebSocket 到服务端，在这条链路上扮演一台 MCP server，服务端作为 MCP client 发工具调用请求。

本方案的目标是：**让桌面端内置的 Electron Chromium 直接作为这台「浏览器设备」接入服务端**，用户不需要另外安装 Chrome 扩展，agent 操控的是桌面端右侧面板里那个浏览器。

---

## 可行性基础

### 服务端侧（零改动）

服务端 `platform/extension/mcp/reverse/` 已完整实现了反向 WS 设备接入的全部逻辑：

- `hub.go` — WS 握手、认证帧、心跳、每设备串行调用队列
- `tokens.go` — 配对码/设备令牌的生成与哈希存储
- `caller.go` — 向设备发 MCP 请求（`initialize` → `tools/list` → `tools/call`）
- `devices.go` — 设备健康状态管理

服务端的 `reverse.Hub` 对连接来源没有任何假设：只要首帧 auth 通过（有效设备令牌 + 设备 ID），就是一台合法设备。它不知道对面是 Chrome 扩展还是桌面端进程。

配对路由也已就绪（`bootstrap.go`）：

```
POST   /api/extensions/device-link/redeem   核销配对码换设备令牌
GET    /api/extensions/device-link/ws       WebSocket 升级
DELETE /api/extensions/device-link/self     扩展侧主动解绑
```

### 桌面端侧（已有能力）

`src/agentBrowserCompatibility.cjs` 已实现了操作 Electron 内置浏览器标签页的全部底层能力：

- 标签页 CRUD（`tabsCreate` / `tabsUpdate` / `tabsRemove` / `tabsGroup`）
- 导航（`tabsHistory` back/forward、`tabsReload`）
- CDP 转发（`debuggerSendCommand`）——9 个页面级方法：截图、鼠标/键盘事件、JS 执行、对话框处理、设备指标覆写
- 标签组管理（`tabsGroup`）

`src/local-exec/connection.cjs` 的 `connectDesktop` 函数已实现了完整的设备 WS client 模式：首帧 auth、心跳看门狗、MCP dispatch、取消信号、退避重连。

`src/local-exec/pairing.cjs` 的 `createPairing` 已实现了配对码核销 + safeStorage 加密令牌存储的完整流程，并复用了 `/api/extensions/devices/pairings` + `/api/extensions/device-link/redeem` 这两条接口。

---

## 方案架构

```
Matter 服务端
  reverse.Hub（MCP client）
       ↑ WebSocket（device-link/ws）
       │  首帧: { type:"auth", token, device_id, browser:"Matter Desktop" }
       │  服务端发: initialize → tools/list → tools/call
       │  桌面端答: 工具结果 JSON-RPC response
       ↓
src/browser-device-link.cjs（新模块，~250 行）
  - 维护 WS 连接（复用 connectDesktop 模式）
  - 处理 initialize / tools/list / tools/call
  - tools/call → AgentBrowserCompatibility.request(method, params)
       ↓
src/agentBrowserCompatibility.cjs（已有，零改动）
  - chrome.tabs.* / chrome.windows.* / chrome.debugger.*
       ↓
Electron WebContents（内置 Chromium 标签页）
```

---

## 工具清单

与 Chrome 扩展暴露的工具集完全一致（`packages/shared/src/tools.ts`），共 15 件：

| 工具名 | 功能 | 风险级 |
|---|---|---|
| `get_windows_and_tabs` | 列 Matter 标签组的所有窗口/标签 | L1 只读 |
| `chrome_navigate` | 打开 URL / 刷新 / 前进后退 | L1 |
| `chrome_read_page` | 读无障碍树（含 fileInputs） | L1 只读 |
| `chrome_get_web_content` | 抓页面文本/HTML | L1 只读 |
| `chrome_get_interactive_elements` | 列可交互元素 | L1 只读 |
| `chrome_click_element` | 按 selector/ref/坐标点击 | L1 |
| `chrome_fill_or_select` | 填表单、勾 checkbox | L1 |
| `chrome_keyboard` | 模拟键盘输入/组合键 | L1 |
| `chrome_computer` | 鼠标+键盘+截图万能工具 | L1/L2 |
| `chrome_screenshot` | 截图 | L1 只读 |
| `chrome_switch_tab` | 切换标签 | L1 |
| `chrome_close_tabs` | 关闭标签 | L1 |
| `chrome_handle_dialog` | 处理 alert/confirm/prompt | L1 |
| `chrome_upload_file` | 上传 /media/ 文件到页面 file input | **L2（需审批）** |
| `chrome_javascript` | 在页面执行 JS | **L2（需审批）** |

工具 schema 直接从插件的 `packages/shared/src/tools.ts` 移植成 CommonJS，放在新模块里维护。

---

## 实现计划

### 新文件：`src/browser-device-link.cjs`

核心逻辑，约 250 行。结构与 `src/local-exec/connection.cjs` 完全对称：

```js
// 对外暴露两件事：
// 1. start(config) → 建连、返回 stop()
// 2. TOOL_SCHEMAS — 工具清单（供 tools/list 应答）

const TOOL_SCHEMAS = [ /* 从插件 tools.ts 移植 */ ]

function connectBrowserDevice({ url, token, deviceId, version, browserCompat, onState, onRevoked }) {
  // 握手帧：
  // { type:'auth', token, device_id, browser:'Matter Desktop',
  //   extension_version: version, capabilities:{ tab_groups:true } }
  //
  // tools/list → { tools: TOOL_SCHEMAS }
  //
  // tools/call → browserCompat.request(name, args) → JSON-RPC result
  //
  // 取消：notifications/cancelled → AbortController.abort()（当前工具调用不可中断，
  //        只标记，下次调用不再派发）
  //
  // 重连：与 connectDesktop 同一套退避策略（500ms 起，指数，最大 30s）
}

module.exports = { connectBrowserDevice, TOOL_SCHEMAS }
```

**工具调用的派发逻辑**：

`chrome_computer`、`chrome_screenshot` 等工具在扩展里走的是 CDP（通过 inject-scripts），但 `agentBrowserCompatibility.cjs` 已经通过 `debuggerSendCommand` 把相同的 CDP 方法封装好了。新模块只需要把 MCP 的工具名和参数格式转译成 `AgentBrowserCompatibility.request(method, params)` 能接受的格式。

转译表（工具名 → `agentBrowserCompatibility` 内部方法名）：

| MCP 工具名 | `AgentBrowserCompatibility` 方法 |
|---|---|
| `get_windows_and_tabs` | `tabsQuery` |
| `chrome_navigate` | `tabsCreate` / `tabsUpdate` / `tabsHistory` |
| `chrome_screenshot` | `debuggerSendCommand({ method:'Page.captureScreenshot' })` |
| `chrome_computer` (action=screenshot) | 同上 |
| `chrome_computer` (action=left_click 等) | `debuggerSendCommand({ method:'Input.dispatchMouseEvent' })` |
| `chrome_computer` (action=key/type) | `debuggerSendCommand({ method:'Input.dispatchKeyEvent' })` |
| `chrome_read_page` | `debuggerSendCommand({ method:'Runtime.evaluate', … })` |
| `chrome_javascript` | `debuggerSendCommand({ method:'Runtime.evaluate' })` |
| `chrome_handle_dialog` | `debuggerSendCommand({ method:'Page.handleJavaScriptDialog' })` |
| `chrome_close_tabs` | `tabsRemove` |
| `chrome_switch_tab` | `tabsUpdate({ active:true })` |

inject-scripts（`accessibility-tree-helper.js`、`click-helper.js` 等）目前只在 Chrome 扩展的 content script 环境里运行。`chrome_read_page`、`chrome_click_element`、`chrome_fill_or_select` 这几个依赖注入脚本的工具，需要通过 `Runtime.evaluate` 把对应的 inject-script 内容注入到页面执行，而不是走 `chrome.scripting.executeScript`（那是扩展专有 API）。**这是实现里最主要的适配工作**，inject-scripts 本身是纯 JS 函数，不依赖扩展 API，可以直接通过 CDP `Runtime.evaluate` 注入并调用。

### 修改文件：`src/main.cjs`

约 40 行改动，接入新模块的生命周期：

1. `app.on('ready')` 里：检查是否已配对 + 是否启用 → 调 `connectBrowserDevice`
2. Matter 服务地址/账号变更时：重新配对或断开（与 `local-exec` 同一套检测逻辑）
3. `app.on('before-quit')` 里：调 `stop()` 优雅关闭

### 修改文件：`src/local-exec/pairing.cjs` 或新建 `src/browser-device/pairing.cjs`

配对逻辑与 local-exec 完全相同，复用 `createPairing`，只需传不同的 `store` key（`browserDevicePairing` 而非 `pairing`），令牌分开存。

### 配对触发时机

两个选项（最终实现选其一）：

**A. 自动配对（推荐）**：用户登录后，桌面端主进程自动使用当前 JWT 调 `POST /api/extensions/devices/pairings` 签发配对码，再自己调 `redeem` 换令牌。用户无感知，设备出现在 Matter 网页「设置 → 扩展 → 已配对浏览器」列表里，显示名为「{hostname} · Matter 桌面端」。

**B. 手动配对**：在「本机执行设置」页面加一个「配对内置浏览器」按钮，点击后走和 Chrome 扩展相同的配对码流程。

---

## 不需要改动的部分

- **服务端**：0 行改动。服务端视桌面端为一台普通浏览器设备。
- `src/agentBrowserCompatibility.cjs`：0 行改动（直接调用其 `request` 方法）。
- `src/extensionApiBridge.cjs`：0 行改动（Chrome 扩展那条路继续并存）。
- Chrome 扩展（`minduck-matter-browser`）：两条路完全独立，互不影响。

---

## 工作量估计

| 文件 | 类型 | 规模 |
|---|---|---|
| `src/browser-device-link.cjs` | 新建 | ~250 行 |
| inject-scripts 的 CDP 注入适配 | 新建（可放在同文件） | ~150 行 |
| `src/main.cjs` | 修改 | ~40 行 |
| `src/local-exec/pairing.cjs` 或新建 `src/browser-device/pairing.cjs` | 复用/新建 | ~30 行 |
| **合计** | | **~470 行** |

---

## 风险与注意事项

1. **inject-scripts 注入方式不同**：扩展走 `chrome.scripting.executeScript`（有 content script 权限），CDP `Runtime.evaluate` 效果相同但需要把脚本文件内容内联。脚本本身是纯函数，不依赖扩展 API，可以直接用。

2. **`chrome_upload_file`**：扩展走 `chrome.debugger` 的 `DOM.setFileInputFiles`，CDP 侧同样支持，路径一致。但文件路径限制（只接受 `/media/...` 路径）需要在桌面端侧同样做校验。

3. **`chrome_computer` 的截图坐标系**：扩展走 `Page.captureScreenshot` + 设备指标覆写（`Emulation.setDeviceMetricsOverride`），这两个 CDP 方法已在 `EXTENSION_DEBUGGER_METHODS` 白名单里，直接可用。

4. **设备令牌独立存储**：与 `local-exec` 的设备令牌分开存（不同的 safeStorage key），避免一方撤销影响另一方。

5. **单设备限制**：服务端 `CloseReplaced(4002)` 会把同一 `device_id` 的旧连接踢掉。桌面端重启时会用同一个 `device_id` 重连，这是正常行为。

---

## 与 Chrome 扩展的关系

两条路完全独立并存：

- 用户安装了 Chrome 扩展 → Chrome 里的浏览器作为一台设备
- 桌面端运行 → 内置浏览器作为另一台设备（不同 `device_id`）
- 两台设备都出现在「设置 → 扩展 → 已配对浏览器」
- agent 执行时按团队版本里 `tool_refs` 里钉的是哪台用哪台

如果只用桌面端，不装 Chrome 扩展也能获得完整的浏览器控制能力。
