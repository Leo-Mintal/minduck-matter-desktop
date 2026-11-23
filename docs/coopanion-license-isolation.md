# Coopanion 许可证隔离方案

> 本文档说明为什么以及如何把 Coopanion 二开代码从客户端主程序中解耦，使客户端能以闭源商业软件形式分发，同时满足 AGPL 义务。
>
> **免责声明**：本文档是对 AGPL 条款的技术和工程层面解读，不构成法律建议。在正式发布前请咨询具有开源许可证经验的律师确认"聚合"认定。

---

## 一、背景

Minduck Matter Desktop 集成了 [Coopanion 0.2.16](https://github.com/Pal-AI-Lab/Coopanion) 作为桌宠运行时，并对约 30 个文件做了二次开发（见 `vendor/coopanion/UPSTREAM.json`）。

Coopanion 使用 **AGPL-3.0-or-later** 许可证。AGPL 是强 copyleft 许可证：分发含有 AGPL 代码或其衍生作品的软件时，必须以 AGPL 向用户开放完整源码（包括修改部分），并允许用户获取和重新分发。

**这意味着：如果不做处理，向用户分发 Minduck 客户端时，可能需要同时开放整个客户端的源码。**

---

## 二、问题根源

AGPL 的"传染性"依赖于"作品整体被视为一个派生作品"这一判断。核心判断标准是：你的代码和 AGPL 代码之间是**模块级链接**（derive）还是**独立程序协作**（aggregate）。

### 当前代码中的直接 `require`

`src/companion/index.cjs` 第 14 行：

```javascript
const { CoreHost } = require(path.join(root, 'app/core-host.cjs'))
```

`src/companion/host.cjs` 第 18 行：

```javascript
const { runPetHost } = require(path.join(root, 'node_modules/cortico-world-desktop-pet/host/electron-main.cjs'))
```

这两行是 Node.js 模块级别的直接加载，法律上等同于"静态链接"。这是传染性最强的情形，意味着加载了 AGPL 模块的程序整体都可能被视为衍生作品。

### 已经合规的部分

以下代码虽然和 Coopanion 协作，但通过进程边界和 loopback HTTP 通信，已经符合"聚合"的技术特征：

| 文件 | 通信方式 |
|---|---|
| `src/companion/matter-actions.cjs` | loopback HTTP + 随机令牌 |
| `src/companion/settings.cjs` | loopback HTTP 代理到 Core 控制台端口 |
| `src/companion/task-bridge.cjs` | 在 Matter WebContents 的隔离 World 执行，无 Coopanion 依赖 |
| `src/companion/task-monitor.cjs` | 同上 |

这些部分不需要改动。

---

## 三、法律论点

GPL/AGPL 社区和法律实践中有较广泛接受的判断标准：

> **如果两个程序之间只通过标准系统通信机制交互——独立进程、管道、IPC、本地网络协议——通常被视为"聚合"（aggregate）而非"衍生"（derivative），传染性不跨越该边界。**

这个标准在 FSF 的 GPL FAQ 和多起开源许可证相关案例中被引用。进程分离 + loopback HTTP 是当前法律实践中最有利于"聚合"认定的技术结构。

**改造目标：** 切断所有 `require` 级别的依赖，使客户端和 Coopanion 修改版之间的全部交互都通过：
1. 子进程启动（命令行参数传递配置）
2. Node.js IPC（`child_process.fork`，匿名管道）
3. loopback HTTP（已有的 `matter-actions`、`panel()` 接口）

改造完成后，客户端"使用"Coopanion 的方式，和使用一个独立安装的系统服务在技术上是等价的。

---

## 四、改造内容

### 4.1 新建 `createCoreProcess()`

这是改造的核心：一个纯 Node.js 子进程管理类，完整复现 `CoreHost` 对外暴露的接口，但不 `require` 任何 Coopanion 文件。

**`CoreHost` 对外接口（需要完全覆盖）：**

| 属性/方法 | 说明 |
|---|---|
| `state` | `'stopped' \| 'starting' \| 'running' \| 'restarting' \| 'failed'` |
| `port` | Core 控制台端口，`null` 表示未就绪 |
| `start()` | 启动子进程 |
| `stop(graceMs)` | 优雅关闭，超时后 SIGKILL |
| `restart()` | 重启 |
| `send(msg)` | 向子进程发 IPC 消息 |
| `expectStop()` / `forgetStop()` | 标记预期的关闭（避免误判崩溃） |
| `on('ready', cb)` | Core 就绪，`cb({ port, language })` |
| `on('state', cb)` | 状态变更，`cb(state, detail)` |
| `on('language', cb)` | 语言变更，`cb(language)` |
| `on('open', cb)` | 控制台请求打开某路由，`cb(route)` |
| `on('hide', cb)` | 控制台请求隐藏 |
| `on('quit', cb)` | 桌宠 Exit 动作 |
| `on('browse', cb)` | 请求打开外部 URL，`cb(url)` |

**关键实现细节：**

Core 子进程启动命令完全不变，仍然是：
```javascript
fork(path.join(root, 'core', 'boot.ts'), [], {
  execArgv: ['--use-env-proxy', '--use-system-ca', '--expose-gc', '--import', 'tsx'],
  env: coreEnvironment(env),
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
})
```

代理查询（`companion:proxy` IPC 消息）直接调用 `createCompanion` 传入的 `resolveProxy` 回调（即 `session.defaultSession.resolveProxy`），不需要 Coopanion 的 `lookupProxy` 和 `coreEnvironment` 工具。

崩溃重启逻辑（约 60 行）需要自己实现，参照 `CoreHost` 的逻辑：
- 普通崩溃：3 秒后重启，连续崩溃超过阈值标记为 `failed`
- `ERR_MODULE_NOT_FOUND` 在 ready 前退出：按 Coopanion 定义的等待序列重试（运行时文件仍在写入的情形）
- 被 `expectStop()` 标记的退出：不算崩溃

### 4.2 改造 `src/companion/index.cjs`

**修改前：**
```javascript
const { CoreHost } = require(path.join(root, 'app/core-host.cjs'))  // ❌ 直接 require
const core = new CoreHost({ appRoot: root, logDir, resolveProxy, env })
```

**修改后：**
```javascript
const { createCoreProcess } = require('./core-process.cjs')  // ✅ 自己写的，无 Coopanion 依赖
const core = createCoreProcess({ appRoot: root, logDir, resolveProxy, env })
```

`createCompanion` 对外接口（`start / stop / show / hide / setTaskOutput / openSettings`）完全不变，`main.cjs` 一行不用改。

### 4.3 `src/companion/host.cjs` 的处理

`host.cjs` 目前在独立子进程里运行（由客户端 spawn，带 `--minduck-companion-host` 参数），它的 `require(runPetHost)` 不会进入客户端主进程的模块图，从进程边界来说已经隔离。

但是：**这个文件本身仍然 require 了 Coopanion 模块**，所以它是衍生作品，必须归入 AGPL 二开包一起开源。它不应该继续放在客户端主仓库里。

处理方式：把 `host.cjs` 移入 `minduck-coopanion` 包，客户端通过包暴露的 `hostCommand()` 工具函数构造启动命令（路径还是客户端运行时动态拼接的，不 `require` host 文件本身）。

### 4.4 `coreEnvironment` 的处理

`CoreHost` 内部调用了 `vendor/coopanion/runtime/app/core-env.cjs` 里的 `coreEnvironment()` 对环境变量做过滤和处理。

这个函数目前被 `CoreHost` 内部调用，不需要客户端直接 `require`。自己实现 `createCoreProcess` 时，可以：
- 把 `coreEnvironment` 的逻辑直接内联（它主要是过滤掉不应传给子进程的 Electron 相关变量）
- 或者把它也纳入 `minduck-coopanion` 包的公开接口

---

## 五、发布结构

### 5.1 新的 Coopanion 二开包（AGPL 开源）

建立独立仓库，建议命名 `minduck-coopanion`，以 AGPL-3.0-or-later 发布。

**包含内容：**
- `runtime/`：Coopanion 0.2.16 原始运行时（含 `vendor/coopanion/UPSTREAM.json` 记录的所有改动）
- `figures/`：形象包（`minduck-duck`、`minduck-suit-duck`），如形象包深度依赖 API 2 接口规范则必须开源；如可证明为独立资产则可选
- `host.cjs`：桌宠宿主进程入口（从 `src/companion/host.cjs` 移入）
- `runtime.cjs`：路径工具（从 `src/companion/runtime.cjs` 移入）
- `index.js`：包的公开入口，导出 `runtimeRoot()`、`hostCommand()`、`assertRuntime()`、`figuresRoot()` 等

**不包含（留在客户端仓库）：**
- `src/companion/index.cjs`（改造后无 Coopanion 依赖）
- `src/companion/core-process.cjs`（新建，纯 Node.js，无 Coopanion 依赖）
- `src/companion/settings.cjs`、`settings-protocol.cjs`（纯 loopback HTTP）
- `src/companion/matter-actions.cjs`、`task-bridge.cjs`、`task-monitor.cjs`（Matter 业务逻辑）

### 5.2 客户端引用方式

**开发环境：**
```json
{
  "dependencies": {
    "@minduck/coopanion": "file:../minduck-coopanion"
  }
}
```

**生产环境（发布后）：**
```json
{
  "dependencies": {
    "@minduck/coopanion": "^0.2.16"
  }
}
```

客户端代码中只调用包的公开接口：
```javascript
const { runtimeRoot, hostCommand, assertRuntime } = require('@minduck/coopanion')
// 不再 require 任何 Coopanion 内部模块
```

**打包不变：** `extraResources` 仍然引用运行时和形象包目录，只是路径从 `vendor/coopanion/runtime` 改为通过包的 `runtimeRoot()` 返回。`electron-builder` 配置小改。

---

## 六、改造后的依赖边界

```
┌────────────────────────────────────────────────────┐
│  Minduck 客户端（闭源商业软件）                       │
│                                                    │
│  src/companion/index.cjs                           │
│    └─ createCoreProcess()                          │
│         └─ child_process.fork() ──IPC──▶ Core 子进程 │
│         └─ IPC 消息处理（自有代码）                   │
│    └─ panel()  ──loopback HTTP──▶ Core 控制台端口    │
│    └─ settings.cjs  ──loopback HTTP──▶ 同上         │
│    └─ matter-actions.cjs  ──loopback HTTP──▶ 桥接服务│
│                                                    │
│  @minduck/coopanion（作为数据依赖，仅读取路径）        │
│    └─ runtimeRoot()  → 路径字符串，不 require 任何模块│
│    └─ hostCommand()  → 命令行参数数组                │
└────────────────────────────────────────────────────┘
                    ↕ 进程边界（IPC / loopback HTTP）
┌────────────────────────────────────────────────────┐
│  Coopanion 运行时（由客户端启动，AGPL 开源）           │
│                                                    │
│  runtime/core/boot.ts  ← 由 createCoreProcess fork │
│  runtime/app/core-host.cjs  ← 不再被 require        │
│  host.cjs  ← 由客户端 spawn 独立进程，非 require     │
│  figures/  ← extraResources 路径引用               │
└────────────────────────────────────────────────────┘
```

---

## 七、AGPL 合规义务清单

完成改造并发布 `minduck-coopanion` 包后，需要履行的 AGPL 义务：

| 义务 | 操作 |
|---|---|
| 开放修改后的源码 | 在 `minduck-coopanion` 仓库公开（含 `UPSTREAM.json` 记录的所有改动） |
| 保留版权声明 | 保留 `vendor/coopanion/LICENSE` 和各文件头部版权行 |
| 标注修改 | `UPSTREAM.json` 已记录，继续维护 |
| 使用相同许可证 | `minduck-coopanion` 包使用 AGPL-3.0-or-later |
| 用户可获取源码 | 在客户端 App 的"开源许可"页面链接到 `minduck-coopanion` 仓库和 AGPL 全文 |
| 不附加进一步限制 | 不在 AGPL 包上加 DRM、访问限制等 |

客户端主程序在改造完成并经律师确认后，作为独立的闭源商业软件分发，不承担上述义务。

---

## 八、工作量

| 任务 | 预计规模 |
|---|---|
| 新建 `src/companion/core-process.cjs`（复现 CoreHost 进程管理逻辑） | ~120 行 |
| 改造 `src/companion/index.cjs` | 修改约 10 行 |
| 新建 `minduck-coopanion` 仓库，整理包结构和公开接口 | 半天 |
| 改造 `electron-builder` 配置，路径改用包接口 | 约 5 行 |
| 单测（`createCoreProcess` 的假子进程测试） | 约 60 行 |
| 实机验证（打包后桌宠正常启动、形象加载、Matter 状态同步） | 半天 |

---

## 九、尚未解决的问题

以下问题在实施前需要确认：

1. **形象包是否属于衍生作品**：`minduck-duck` 的 SVG 文件是自有资产，但 `figure.json` 和 `figure.js` 使用了 Coopanion API 2 接口规范。如果 API 规范本身不受版权保护（接口通常不受保护），形象包可以作为独立作品保留在客户端仓库；如果律师认为深度依赖接口规范的实现也构成衍生作品，则需要归入 AGPL 包。

2. **打包在同一个 App 分发是否影响"聚合"认定**：即使技术上完全进程隔离，部分法律观点认为打包在同一个 `.app` bundle 里共同分发会减弱"聚合"论点的说服力。这是本方案中最需要律师确认的一点。

3. **`coreEnvironment()` 的处理方式**：需要决定是把这个工具函数内联到 `createCoreProcess` 里，还是将其纳入 `minduck-coopanion` 的公开接口。前者对客户端更简洁，后者对包的完整性更好。
