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
- 发码记录、状态筛选、大小写无关搜索、刷新、作废前确认。
- 手机与桌面布局、键盘焦点、屏幕阅读器状态提示。
- 手机上的摇码/复制为 44px 控件，表格保留可读字号，时间分两行显示；桌面端保持单行表格。
- 防连续点击；请求失败沿用原请求编号，刷新当前标签页后仍可重试。

## 演示与真实发码的边界

默认 `config.js` 为 `mode: 'demo'`。演示码在浏览器使用 Web Crypto 生成，包含字母和数字，排除 `I/O/0/1`，并检查当前演示记录中的重复值。**演示码不能激活客户端，作废也只影响本地演示数据。**

演示记录保存在当前浏览器源的 `localStorage`，键名 `matter:invite-console:demo:v1`；主题使用 `matter:invite-console:theme`；未确认请求编号使用当前标签页的 `sessionStorage`，并按模式隔离。未保存管理员令牌、邮箱或设备凭证。支持 Web Locks 的环境会串行处理同源演示记录写入；其他环境的演示模式不保证跨标签页并发一致性，不能用于真实发码。

客户端填写、登录与核销见改造方案；本次不包含客户端拦截、钥匙串、设备绑定或后端核销实现。

## 后续接入服务端

`core.js` 的 `createApiAdapter()` 独立于 UI。以下是**待实现的接口契约**，不是现有后端已经提供的接口：

| 操作 | 接口 | 返回 |
| --- | --- | --- |
| 加载记录 | `GET /api/admin/desktop-invites` | `{ "items": [Invite] }` |
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

`status` 只能为 `active`、`used`、`revoked`。发码返回 `active`；重复请求必须返回原记录的**当前状态**，已经核销或作废的码不能因重试恢复为可用。列表为当前操作员可见记录的完整集合，小规模灰测版本尚未做分页。

完整的后端、客户端、Apple 签名要求及并发方案见 [客户端邀请码改造方案](../../docs/desktop-invite-activation-plan.md)。当前预留适配器使用同源 Cookie＋CSRF，**与现有后端的 Bearer JWT 认证尚未对接**。正式接入按该方案执行：

1. 同源子路径托管 H5，复用现有管理员登录态，将认证适配改为 Bearer JWT；若以后改用 Cookie 会话，再启用当前 CSRF 方案。当前本地预览不会签发任何管理会话。
2. 实现管理员 API、数据库唯一约束与持久幂等事务，再接入服务端筛选和游标分页；不能仅修改 `mode` 就上线。前端合并点击不能替代事务及权限检查。
3. 由激活服务原子核销：一次成功只激活一台设备，作废与核销争用同一记录；禁止将 `used` 状态改为 `revoked` 或重新可用。
4. 通过真实认证、权限、并发及手机验收后，才将 `config.js` 切换为 `mode: 'api'`。

API 模式网络失败、无权限或返回格式错误时会报错，**不会降级成演示发码**。超时或结果未知时，原请求编号保留，点击“重试本次摇码”重新查询/执行同一次操作。`sessionStorage` 被清理或标签页关闭后，恢复编号不再保留；生产接入应让管理员先通过记录核对结果，再决定是否新发码。服务端的幂等记录保留期需覆盖允许的重试期。

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

浏览器验收重点覆盖 375、390、430px，再覆盖 768、1024、1440px 的深浅主题；检查滚轮、复制、已有记录重新打开、空表格与筛选切换、作废确认、键盘与减少动态效果。真实手机 Safari、API/权限/核销在对应环境另行验收。
