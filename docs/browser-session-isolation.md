# 多会话浏览器隔离方案

## 目标

- 每个 Matter 会话独立一套 Playwright BrowserContext（独立 cookie / storage / 登录态）
- 所有 Context 共享一个 Chromium 进程，内存消耗从 N×200MB 降至 150MB + N×30MB
- 切换会话时，右侧面板自动切换到对应 Context 的画面
- 服务端（Matter 后端）零改动，WS 工具调用协议不变

---

## 架构概览

```
Matter 主视图 (WebContentsView)
  └── URL /c/<convId> 变化 → 触发 session 切换

PlaywrightBrowserManager（新）
  └── 单个 chromium 进程（headless=false 可选）
       ├── BrowserContext "session-abc" → Page[] → CDP Session
       ├── BrowserContext "session-xyz" → Page[] → CDP Session
       └── BrowserContext "session-def" → Page[] → CDP Session

SessionBrowserManager（新）
  ├── convId → { context, device, screencastCanvas }
  └── activate(convId) → 切换右侧面板显示源

右侧面板（现有 ElectronBrowserHost / 简化）
  └── 一个 canvas WebContentsView，接收当前激活 session 的 screencast 帧
```

---

## 需要引入的依赖

```json
"playwright-core": "1.49.1"
```

只用 `playwright-core`（不下载浏览器），使用系统 Chromium 或 Electron 自带 Chromium。

Electron 本身的 Chromium 可通过 CDP 被 Playwright 直接接管：

```js
const { chromium } = require('playwright-core')
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
```

启动 Electron 时加 `--remote-debugging-port=0` 自动分配端口，通过
`app.commandLine.appendSwitch('remote-debugging-port', '0')` 实现，
再从 `http://127.0.0.1:${port}/json/version` 读取实际端口。

---

## 新增文件

### `src/playwrightBrowserManager.cjs`

管理 Playwright 与 Electron Chromium 的连接，以及 BrowserContext 的生命周期。

```js
// 伪代码，展示接口
class PlaywrightBrowserManager {
  async connect(debugPort)         // 连接 Electron Chromium
  async getOrCreateContext(sessionId, partition)  // 懒创建 BrowserContext
  async disposeContext(sessionId)  // 释放（clearStorageData）
  listContexts()                   // 返回 Map<sessionId, BrowserContext>
  dispose()                        // 关闭所有 context，断开连接
}
```

**BrowserContext 创建参数：**

```js
const context = await browser.newContext({
  // 独立存储目录（Playwright 默认内存，需要持久化时用 launchPersistentContext）
  storageState: loadSavedState(sessionId) ?? undefined,

  // 视口与当前右侧面板宽度一致
  viewport: { width: panelWidth, height: panelHeight },

  // 注入 Agent 光标覆盖层（复用现有 agent-cursor.svg 逻辑）
  // 通过 addInitScript 实现，取代现有 agentCursorOverlay.cjs
})
```

**懒创建逻辑：**

```js
getOrCreateContext(sessionId) {
  if (this.contexts.has(sessionId)) return this.contexts.get(sessionId)
  // 只在 Agent 实际发出工具调用时创建，不预先为所有会话分配
  const ctx = await this.browser.newContext({ ... })
  this.contexts.set(sessionId, ctx)
  return ctx
}
```

---

### `src/sessionBrowserManager.cjs`

将 Matter convId 映射到 `{ context, device, screencast }`。

```js
class SessionBrowserManager {
  constructor({ playwrightManager, createDevice, activateScreencast, userData })

  // 当 Agent 发起第一次工具调用时懒创建
  async getOrCreateSession(convId) → { context, device, compatibility }

  // 当 Matter URL 切换到 /c/<newConvId> 时调用
  async activate(convId)   // 切换右侧面板的 screencast 源

  // 释放一个会话的所有资源
  async disposeSession(convId)

  // LRU：活跃 context 上限（建议 5）
  // 最近最少使用的会话在下次 activate 时先 suspend（停止 screencast）
  // 再次激活时恢复

  dispose()   // 全部释放
}
```

**LRU 策略（重要）：**

```
active sessions: [A, B, C, D, E] (最多 5 个)
用户切到 F：
  1. 找到最旧的 A → 调 suspendSession(A)：
     - 停止 A 的 screencast
     - 保存 A 的 storageState（下次恢复登录态）
     - 保留 context（不销毁，省去重建 Chromium context 的开销）
  2. 激活 F → 创建/恢复 context，启动 screencast
```

---

### `src/playwrightCompatibility.cjs`

取代 `AgentBrowserCompatibility`，把 `chrome.*` API 映射到 Playwright API + CDP Session。

这是改动最重的部分，以下逐方法说明映射关系。

#### Tab 模型映射

Playwright 的 `Page` 对应现在的 Electron `WebContentsView` tab。

| 现在（Electron） | 改后（Playwright） |
|---|---|
| `tab.view.webContents.id` | `page._guid` 或自增 `tabId`（维护 `Map<tabId, Page>`）|
| `tab.view.webContents.getURL()` | `page.url()` |
| `tab.view.webContents.getTitle()` | `page.title()` |
| `tab.view.webContents.isLoading()` | `page.evaluate(() => document.readyState) !== 'complete'` |
| `tab.navigationCommitted` | `page` 事件 `'framenavigated'` 设 flag |

建议在 context 层维护 tab 列表：

```js
class PlaywrightTabRegistry {
  constructor(context)
  // page 创建时注册，关闭时注销
  // 维护 Map<numericTabId, page>
  tabById(tabId) → Page
  allTabs() → Array<{ tabId, page, title, url, ... }>
  getActiveTabId() / setActiveTab(tabId)
}
```

#### `tabs.*` 方法映射

```js
// tabs.create
async tabsCreate({ url, active }) {
  const page = await context.newPage()
  if (url !== 'about:blank') await page.goto(url)
  if (active) tabRegistry.setActiveTab(tabId)
  return tabShape(tabId, page)
}

// tabs.update
async tabsUpdate({ tabId, updateProperties }) {
  const page = tabRegistry.tabById(tabId)
  if (updateProperties.url) await page.goto(updateProperties.url)
  if (updateProperties.active) tabRegistry.setActiveTab(tabId)
  return tabShape(tabId, page)
}

// tabs.remove
async tabsRemove({ tabIds }) {
  for (const tabId of asArray(tabIds)) {
    const page = tabRegistry.tabById(tabId)
    await page.close()
  }
}

// tabs.reload
async tabsReload({ tabId }) {
  await tabRegistry.tabById(tabId).reload()
}

// tabs.goBack / goForward
async tabsHistory({ tabId }, direction) {
  const page = tabRegistry.tabById(tabId)
  if (direction === 'back') await page.goBack()
  if (direction === 'forward') await page.goForward()
}
```

#### `debugger.*` 方法映射

Playwright 底层走 CDP，可以直接拿到每个 Page 的 CDP session：

```js
// 现有：contents.debugger.sendCommand(method, params)
// 改后：
async debuggerSendCommand({ target, method, commandParams }) {
  const page = tabRegistry.tabById(target.tabId)
  const cdpSession = await page.context().newCDPSession(page)
  return cdpSession.send(method, commandParams)
}

// debugger.attach → 记录 owner，建立 CDP session，Page.enable + Target.setAutoAttach
// debugger.detach → 关闭 CDP session
```

允许的 CDP 方法集合（`EXTENSION_DEBUGGER_METHODS`）保持不变。

#### `scripting.executeScript` 映射

现有的 `page-runtime.cjs` 逻辑（isolated world 注入 helper）完整保留，
只需把 `contents.debugger.sendCommand` 替换为 Playwright CDP session 的 `.send()`：

```js
// 现在
const response = await command(tabId, 'Runtime.evaluate', params, frame.sessionId)

// 改后
const cdp = tabRegistry.cdpSessionFor(tabId)
const response = await cdp.send('Runtime.evaluate', params)
// 子 frame 用 sessionId 仍然有效（CDP 协议不变）
```

inject-scripts 里的 10 个 helper 文件（`accessibility-tree-helper.js` 等）**完全不需要改**，
它们是纯页面内代码，与下层 CDP 实现无关。

---

## 右侧面板显示层

### 方案：CDP Screencast → canvas

**启动 screencast（每个激活的 Page）：**

```js
// 对当前活跃 tab 的 page 启动
const cdp = await context.newCDPSession(activePage)
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 80,
  maxWidth: panelWidth * devicePixelRatio,
  maxHeight: panelHeight * devicePixelRatio,
  everyNthFrame: 1,
})
cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  // data 是 base64 JPEG
  cdp.send('Page.screencastFrameAck', { sessionId })
  // 通过 ipcMain 发送到右侧 canvas WebContentsView
  canvasView.webContents.send('screencast:frame', data)
})
```

**右侧 canvas 页（新增 `src/screencast-canvas.html`）：**

```html
<canvas id="c"></canvas>
<script>
  const canvas = document.getElementById('c')
  const ctx = canvas.getContext('2d')
  require('electron').ipcRenderer.on('screencast:frame', (_, data) => {
    const img = new Image()
    img.onload = () => { canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0) }
    img.src = 'data:image/jpeg;base64,' + data
  })
</script>
```

**用户鼠标/键盘输入转发（双向）：**

```js
// canvas 上的鼠标事件 → CDP Input 注入到目标 page
canvasView.webContents.on('input-event', async (event, input) => {
  const scale = actualPageWidth / canvasDisplayWidth
  await cdp.send('Input.dispatchMouseEvent', {
    type: input.type,
    x: input.x * scale,
    y: input.y * scale,
    button: input.button,
    clickCount: input.clickCount,
  })
})
```

### 切换会话时的 screencast 切换

```js
async activate(convId) {
  // 停止当前 screencast
  currentCdp?.send('Page.stopScreencast')

  // 取或创建目标 session 的 context + 激活 tab
  const { context, tabRegistry } = await getOrCreateSession(convId)
  const activePage = tabRegistry.getActivePage()

  // 启动新 screencast
  currentCdp = await context.newCDPSession(activePage)
  startScreencast(currentCdp)
}
```

---

## 对现有文件的改动

### `src/main.cjs`

1. 启动时加 `--remote-debugging-port=0`（开发模式，生产模式同样适用）：
   ```js
   app.commandLine.appendSwitch('remote-debugging-port', '0')
   ```

2. `app.ready` 后读取实际端口：
   ```js
   const debugPort = app.commandLine.getSwitchValue('remote-debugging-port')
   // 或通过 fetch http://127.0.0.1:${port}/json/version 确认
   ```

3. 用 `SessionBrowserManager` 替换单一的 `browserDevice`：
   ```js
   // 删除
   let browserDevice
   // 新增
   let sessionBrowserManager
   ```

4. `updateMatterPresence()` 里加 session 切换检测：
   ```js
   const convId = activeConvId()  // 解析 matterTab URL 里的 /c/<id>
   if (convId !== lastConvId) {
     lastConvId = convId
     await sessionBrowserManager.activate(convId)
   }
   ```

5. `extensionCompatibility` 的构造参数改为从 `sessionBrowserManager.currentCompatibility()` 动态取，或通过代理对象实现。

### `src/electronBrowserHost.cjs`

大幅简化：不再管理 `WebContentsView` tab 的创建和 CDP，
只保留 `openPanel / closePanel / layout()` 以及指向 screencast canvas view 的引用。

**或者**：整体替换为一个轻量的 `ScreencastPanel`，职责只有：
- 显示/隐藏右侧面板
- 转发 screencast 帧到 canvas
- 转发用户输入到 CDP

### `src/agentBrowserCompatibility.cjs`

替换为 `src/playwrightCompatibility.cjs`，接口（`request(method, params)` 等）保持一致，
内部实现从 `WebContentsView.debugger` 改为 `Playwright CDPSession`。

### `src/browser-device/controller.cjs`

**不需要改**，只需把传入的 `compatibility` 对象替换为 per-session 的 `PlaywrightCompatibility` 实例。

### `src/browser-device/page-runtime.cjs`

改动点：约 3 处，把 `contents.debugger.sendCommand` 替换为 CDP session 的 `.send()`，
把 `compatibility.debuggerAttach/Detach` 替换为 Playwright context 的 CDP session 管理。

所有 inject-scripts 的 helper 文件**不需要改**。

---

## 生命周期和资源管理

### 创建时机（懒创建）

```
Agent 工具调用到达
  → getOrCreateSession(convId)
    → 如果没有：PlaywrightBrowserManager.getOrCreateContext(convId)
               → SessionBrowserManager 为该 convId 初始化 PlaywrightCompatibility + BrowserDevice
  → 路由到对应 context 执行
```

### 释放时机

```
用户手动关闭浏览器（现有"内置浏览器设置"→关闭）
  → disposeSession(convId)：page.close() + context.clearStorageData() + device.dispose()

LRU 超限（5 个以上活跃 context）
  → suspendSession(convId)：停止 screencast，保存 storageState，但保留 context

应用退出
  → sessionBrowserManager.dispose() → 全部关闭
```

### 持久化登录态（可选）

```js
// 首次创建 context 时注入已保存的登录态
const storageState = loadStorageState(convId)  // 读取 userData/browser-sessions/<convId>/storage.json

// 挂起 / 销毁 session 前保存
const state = await context.storageState()
saveStorageState(convId, state)
```

---

## 分步实施建议

**Phase 1（核心可用）**

- 引入 `playwright-core`，实现 `PlaywrightBrowserManager`（connect + newContext）
- 实现 `PlaywrightCompatibility`（tabs.* + debugger.* + scripting.executeScript）
- 把现有单会话的 `AgentBrowserCompatibility` 替换为 `PlaywrightCompatibility`，验证 15 个工具全部可用

**Phase 2（多会话隔离）**

- 实现 `SessionBrowserManager`（convId → context 映射，LRU）
- `updateMatterPresence()` 加 URL 解析 + `activate(convId)` 调用
- 每个会话独立 `BrowserDevice` 实例

**Phase 3（显示层）**

- 实现 `screencast-canvas.html` + ipcMain screencast 帧转发
- 实现鼠标/键盘事件反向注入
- 简化 `ElectronBrowserHost` 为 `ScreencastPanel`

Phase 1 完成后即可验证工具正确性，Phase 2 完成后会话隔离完全生效，Phase 3 是用户可见体验的完善。

---

## 已知风险和注意点

1. **`--remote-debugging-port` 在打包应用中**：macOS App Sandbox 模式下，该端口默认只监听 localhost，不影响安全；但需要确认 Hardened Runtime entitlements 允许 localhost socket（`com.apple.security.network.client` 已在现有 entitlements 中）。

2. **Playwright 版本锁定**：使用 `playwright-core` 而非完整 `playwright`，不会触发额外的浏览器下载。版本与 Electron 的 Chromium 版本须兼容——建议查阅 `electron` 对应的 Chromium 版本，选择对应的 `playwright-core` minor 版本。当前 Electron 最新稳定版（33.x）对应 Chromium 130，Playwright 1.49.x 支持该版本。

3. **inject-scripts 的 isolated world**：Playwright 的 `Page.evaluate` 默认在 MAIN world 执行，现有 helper 需要在 isolated world（通过 `Page.createIsolatedWorld` CDP 命令）。迁移时保持原有 `Runtime.evaluate` + `contextId` 路径即可，不要改成 `page.evaluate()`。

4. **`chrome_handle_dialog` 工具**：现有逻辑检测 `Page.javascriptDialogOpening/Closed` 事件来判断 dialog 是否打开。Playwright context 的 CDP session 可以同样监听这两个事件，逻辑不变。

5. **Agent 光标覆盖层**：现有 `agentCursorOverlay.cjs` 通过 `webContents.executeJavaScript` 注入，改为通过 Playwright 的 `context.addInitScript()` 或 `page.addInitScript()` 注入同样的 DOM overlay 逻辑，效果相同。
