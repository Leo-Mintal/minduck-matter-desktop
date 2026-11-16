# Matter 邀请码摇号页

独立 H5 发码工具，放在桌面仓库的 `tools/` 下，不进入客户端打包目录。纯 HTML/CSS/JavaScript，无构建步骤、无新增依赖，也不依赖 Web 项目的运行时或源码路径。

本页按**管理员摇码后复制发放**的流程制作，移动端优先，只保留摇码区和记录表格。`web-primitives.css` 提取现有 Web 的 Button、Input、DataTable 所需样式并保留原类名；字体、颜色和图标沿用 Web，未修改 Web 项目。当前是原生 HTML，未声称直接运行 React 组件。

## 打开页面

直接用浏览器打开本目录的 `index.html` 即可预览，或者在桌面仓库根目录运行：

```sh
node tools/invite-console/serve.cjs
```

然后访问 `http://127.0.0.1:4179`。修改端口可用 `PORT=4180 node tools/invite-console/serve.cjs`。预览服务仅监听本机，且只允许访问页面资产，不提供发码 API，也不会暴露仓库文件。

## 已实现

- 六位滚轮摇码，逐位停止；支持系统“减少动态效果”。
- 浅色/深色主题切换，记住本地选择；默认跟随系统主题。
- 一键复制，剪贴板不可用时提供兼容复制/选中文本。
- 发码记录、状态筛选、大小写无关的完整六位码搜索、刷新、作废前确认。
- 每页 20 条与“继续加载”，筛选/搜索使用服务端游标契约，记录数为当前已加载条数。
- 手机与桌面布局、键盘焦点、屏幕阅读器状态提示。
- 手机上的摇码/复制为 44px 控件，表格保留可读字号，时间分两行显示；桌面端保持单行表格。
- 防连续点击；请求失败沿用原请求编号，刷新当前标签页后仍可重试。

## 演示与真实发码的边界

默认 `config.js` 为 `mode: 'demo'`。演示码在浏览器使用 Web Crypto 生成，包含字母和数字，排除 `I/O/0/1`，并检查当前演示记录中的重复值。**演示码不能激活客户端，作废也只影响本地演示数据。**

演示记录保存在当前浏览器源的 `localStorage`，键名 `matter:invite-console:demo:v1`；主题使用 `matter:invite-console:theme`；未确认请求编号使用当前标签页的 `sessionStorage`，并按模式隔离。未保存管理员令牌、邮箱或设备凭证。支持 Web Locks 的环境会串行处理同源演示记录写入；其他环境的演示模式不保证跨标签页并发一致性，不能用于真实发码。

后端发码/核销和客户端拦截源码已实现，详见[客户端邀请码改造记录](../../docs/desktop-invite-activation-plan.md)。尚未部署或启用；真实 macOS 签名密钥持久化和卸载重装恢复待验收。

## 接入服务端

`core.js` 的 `createApiAdapter()` 独立于 UI。后端邀请码分支已实现以下接口，正式环境尚未部署：

| 操作 | 接口 | 返回 |
| --- | --- | --- |
| 加载记录 | `GET /api/admin/desktop-invites?status=all&q=&cursor=` | `{ "items": [Invite], "nextCursor": "..." }`；末页可省略游标 |
| 生成一码 | `POST /api/admin/desktop-invites`，空 JSON body | `Invite` |
| 作废一码 | `POST /api/admin/desktop-invites/:id/revoke`，空 JSON body | 作废后的 `Invite` |

```json
{
  "id": "opaque-server-id",
  "code": "ABC234",
  "status": "active",
  "createdAt": "2026-11-16T08:00:00.000Z"
}
```

`status` 只能为 `active`、`used`、`revoked`。发码返回 `active`；同一请求编号重试返回原记录的**当前状态**，已经核销或作废的码不会恢复为可用。固定每页 20 条，按 `(created_at,id)` 倒序游标；`q` 仅完整六位码精确查询，不能子串搜索 HMAC 摘要。演示适配器采用同一分页/搜索契约。

适配器已对接现有 Bearer JWT，真实接口仍需部署及正式认证验收：

1. 把静态目录放在 Web 的同源子路径，例如 `/internal/invites/`，由静态服务配置路由，无需改 Web SPA 源码。管理员先在原 Web 登录；手机上也需先在同一浏览器登录管理员。
2. `app.js` 读取现有 `localStorage['matter.token']`，只在请求头发送 JWT。未新增令牌存储，不放 URL 或 `config.js`，不使用 Cookie/CSRF。不同域不能读取这个登录态；本机预览不会签发管理员会话。
3. 后端每次检查 JWT、当前账号状态及数据库里的管理员角色；角色撤回后旧 JWT 不能继续发码。数据库唯一约束保障跨实例/重启的幂等，核销用事务和行锁。
4. 后端先部署兼容接口，默认关闭强制。macOS profile 和签名客户端验收完成后再开启真实发码/激活；隔离联调环境可先测试。通过认证、权限、并发和手机验收后，再将 `config.js` 切为 `mode: 'api'`。

API 模式网络失败、无权限或返回格式错误会报错，**不会降级成演示发码**。超时或结果未知时原请求编号保留，点击“重试本次摇码”执行同一次操作。清理 `sessionStorage` 或关闭标签页后恢复编号不再保留，先通过记录核对结果再决定是否新发码。服务端持久保留幂等记录和已用/作废码，不回收重发。

本页是发码工具，不是任何人都能领码的公开抽奖活动页。如果未来开放自助领取，需要另行确定资格、限额和防滥用规则，再由服务端落实。

## 移植

可以整体复制本目录到静态站点。若移植到 React/Web 项目，保留 `core.js` 的请求与幂等逻辑，将 `app.js` 的 DOM 渲染改为公共 Button/Input/DataTable 组件；`styles.css` 中的语义 token 和 `assets/` 可直接映射到 Web 设计系统，再移除已被公共样式覆盖的 `web-primitives.css`。

## 验证

```sh
node --check tools/invite-console/core.js
node --check tools/invite-console/app.js
node --check tools/invite-console/serve.cjs
node --test tools/invite-console/core.test.cjs
```

当前版本已重跑 375/390/430/768/1024/1440px 深浅主题，检查 20 条首屏、27 条继续加载、完整/部分搜索、作废与当前码不可复制。记录在 `release/metadata/invite-activation-20261116/`。真实 iPhone Safari 的触摸/剪贴板、正式同源 JWT 与已部署 API 另行验收。
