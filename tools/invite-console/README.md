# Matter 邀请码摇号页

独立 H5 发码工具，放在桌面仓库的 `tools/` 下，不进入客户端打包目录。纯 HTML/CSS/JavaScript，无构建步骤、无新增依赖，也不依赖 Web 项目的运行时或源码路径。

本页按**打开页面摇码后复制发放**的流程制作，移动端优先，只保留摇码区和记录表格。`web-primitives.css` 提取现有 Web 的 Button、Input、DataTable 所需样式并保留原类名；字体、颜色和图标沿用 Web，未修改 Web 项目。当前是原生 HTML，未声称直接运行 React 组件。

## 打开页面

在桌面仓库根目录运行：

```sh
node tools/invite-console/serve.cjs
```

然后直接访问 `http://127.0.0.1:4179/`，无需登录或 token。默认连接本地 `http://127.0.0.1:8080` 的真实邀请码 API；失败时显示实际错误，不生成演示码。修改端口可用 `PORT=4180 node tools/invite-console/serve.cjs`。仅查看离线样式时，可用浏览器直接打开本目录的 `index.html`，此时为演示模式。

### 本机真实发码（2026-11-17 更新）

本地 API `http://127.0.0.1:8080` 已应用 138、139 迁移并启用邀请码与备注。页面服务只需要 API，无需启动 Web 或登录账号：

```sh
INVITE_API_ORIGIN=http://127.0.0.1:8080 node tools/invite-console/serve.cjs
```

入口固定为 `http://127.0.0.1:4179/`。打开即可摇码、查看记录、作废未使用码，以及吊销已使用码对应的设备激活资格；无需管理员账号、邮箱、Web 登录、URL 参数或 fragment 密钥。原 `/internal/invites/` 路径仍可直接打开。

独立发码 API 不验证身份，也不读取链接密钥；页面请求使用 `credentials: 'omit'`，不发送账号 JWT、Cookie 或 `X-Invite-Console-Key`。已移除 `MATTER_DESKTOP_INVITE_CONSOLE_KEY` 配置。邀请码的 lookup/encryption 存储密钥和客户端设备签名验证继续保留。

本地覆盖文件 `.env.desktop-access.local` 保存邀请码存储配置，Git 忽略且权限 0600。本机服务仅监听回环、校验 Host、只代理邀请码 API，其他 API/页面返回 404；根路径直接返回摇码页。静态资产仍用白名单；API 故障不降级演示模式。已移除 `INVITE_WEB_ORIGIN` 和 Web 登录代理。

客户端需将“配置 Matter 服务地址...”设为 `http://127.0.0.1:8080`。`192.168.11.70:8080` 为另一套服务，不是本机。公网未更新；本地回环链接不能直接发给其他电脑或手机使用。正式分享需将静态目录及对应 API 同源部署至 HTTPS 站点（无需改 Web SPA）。

0.1.10 测试包的有效 profile、Secure Enclave 激活、跨进程/包路径恢复及吊销已验收，详见桌面 wiki；正常卸载重装、锁屏和新系统用户环境仍待验收。本次 H5 吊销入口不修改安装包。

## 已实现

- 六位滚轮摇码，逐位停止；支持系统“减少动态效果”。
- 浅色/深色主题切换，记住本地选择；默认跟随系统主题。
- 一键复制，剪贴板不可用时提供兼容复制/选中文本。
- 发码记录、状态筛选、邀请码与备注的模糊搜索、刷新、作废/吊销前确认。输入任意连续片段即可匹配，不区分英文字母大小写；“作废／吊销”为红色胶囊按钮，手机保留可点击尺寸。
- 点击邀请码下方的“添加备注”或已有备注，可添加、编辑、清空最多 200 个 Unicode 字符的备注。所有状态均可备注，真实模式保存到当前后端数据库，刷新后保留；只改备注，不改变邀请码或设备状态。手机保持原四列表格，长备注单行截断，点击查看全文。
- 默认“当前”隐藏已作废邀请码和过期设备资格；“已使用”仅显示仍有效的设备，“已作废”集中显示两种失效记录，分别标注“已作废”和“已过期”。未使用码提供“作废”，已使用码提供“吊销”，操作成功后刷新列表补齐当前页。
- 吊销不删除本机钥匙串，而是让服务端资格过期；卸载重装不能自行恢复，但允许同一设备密钥输入一枚新的有效邀请码重新激活。原邀请码始终不能再使用，二次确认说明需要新码。
- 每页 20 条与“继续加载”，筛选/搜索使用服务端游标契约，记录数为当前已加载条数。
- 手机与桌面布局、键盘焦点、屏幕阅读器状态提示。
- 手机上的摇码/复制为 44px 控件，表格保留可读字号，时间分两行显示；桌面端保持单行表格。
- 防连续点击；请求失败沿用原请求编号，刷新当前标签页后仍可重试。

## 演示与真实发码的边界

默认 `config.js` 为 `mode: 'demo'`。演示码在浏览器使用 Web Crypto 生成，包含字母和数字，排除 `I/O/0/1`，并检查当前演示记录中的重复值。**演示码不能激活客户端，作废也只影响本地演示数据。**

演示记录保存在当前浏览器源的 `localStorage`，键名 `matter:invite-console:demo:v1`；主题使用 `matter:invite-console:theme`；未确认请求编号使用当前标签页的 `sessionStorage`，并按模式隔离。请求编号只用于防重复发码，不是访问凭证。支持 Web Locks 的环境会串行处理同源演示记录写入；其他环境的演示模式不保证跨标签页并发一致性，不能用于真实发码。

后端发码/核销和客户端拦截源码已实现，详见[客户端邀请码改造记录](../../docs/desktop-invite-activation-plan.md)。本地 8080 已部署启用；公网未更新。正常卸载重装恢复仍待验收。

## 接入服务端

`core.js` 的 `createApiAdapter()` 独立于 UI。后端邀请码分支已实现以下接口，正式环境尚未部署：

| 操作 | 接口 | 返回 |
| --- | --- | --- |
| 加载记录 | `GET /api/desktop-access/invites?status=current&q=&cursor=` | `{ "items": [Invite], "nextCursor": "..." }`；末页可省略游标 |
| 生成一码 | `POST /api/desktop-access/invites`，空 JSON body | `Invite` |
| 保存/清空备注 | `POST /api/desktop-access/invites/:id/note`，`{"note":"发给张三"}` | 更新后的 `Invite`；空字符串清空，非法或超过 200 字符返回 400 |
| 作废一码 | `POST /api/desktop-access/invites/:id/revoke`，空 JSON body | 作废后的 `Invite` |
| 吊销对应设备 | `POST /api/desktop-access/invites/:id/revoke-activation`，空 JSON body | 保持 `status=used`，附 `activation.status=revoked` 的 `Invite`；重复请求幂等 |

```json
{
  "id": "opaque-server-id",
  "code": "ABC234",
  "note": "发给张三",
  "status": "active",
  "createdAt": "2026-11-16T08:00:00.000Z"
}
```

邀请码自身 `status` 只能为 `active`、`used`、`revoked`；列表中已核销记录附 `activation`，包含设备资格的 `id/status/createdAt/revokedAt`，不返回公钥。资格过期后旧码暂为 `used`；设备用新码重新激活时，旧码转 `revoked`、保留 `usedAt/revokedAt`，设备关联新码。H5 对关联资格过期、或 `revoked` 且有 `usedAt` 的历史码均显示“已过期”。旧码不能恢复可用，也不能再吊销设备的新资格。查询参数 `status=current` 排除两种失效记录，`active` 为未使用，`used` 为有效已使用，`revoked` 包含作废码和过期记录；空值或 `all` 保持兼容，查询全部。筛选在数据库分页前执行。

发码返回 `active`；同一请求编号重试返回原记录的**当前状态**，已经核销或作废的码不会恢复为可用。固定每页 20 条，按 `(created_at,id)` 倒序游标；`q` 同时对邀请码和备注做不区分大小写的包含匹配，`%`、`_` 等按普通文字处理。邀请码继续以 HMAC/AES-GCM 存储，后端按状态与游标顺序分批读取、解密匹配，收集到下一页探测所需的 21 条匹配即停止，不将邀请码另存明文；匹配后再分页，不局限于首屏或当前已加载记录。当前灰测规模采用该无迁移实现，搜索少见片段可能遍历该状态的全部记录；数据量增长时需评估专用检索索引。演示适配器采用同一分页/搜索契约。

独立发码接口无需任何身份凭证；吊销入口按邀请码 ID 定位其已激活设备，不能传任意设备 ID。原 `/api/admin/desktop-invites` 与 `/api/admin/desktop-activations/:id/revoke` 兼容接口仍受管理员 JWT 保护，H5 不调用它们。

数据库唯一约束保障跨实例/重启的发码幂等。独立发码继续使用固定 issuer `desktop-invite-console`，移除链接密钥后同一请求 UUID 仍返回原结果；不同 UUID 可以并发各生成一码。已有账号发码记录继续保留和可查询。旧页面如有未确认发码，先查询记录核对结果。

API 模式网络失败、无权限或返回格式错误会报错，**不会降级成演示发码**。超时或结果未知时原请求编号保留，点击“重试本次摇码”执行同一次操作。清理 `sessionStorage` 或关闭标签页后恢复编号不再保留，先通过记录核对结果再决定是否新发码。服务端持久保留幂等记录和已用/作废码，不回收重发。

本页是由用户自行分发链接的发码工具，没有账号权限、领取资格或抽奖概率机制。

### 环境隔离与部署

本地、测试、正式的独立性取决于实际后端连接的数据库，而不是代码仓库或页面 URL。各环境应使用独立数据库、Redis、两把邀请码存储密钥及精确的 `MATTER_DESKTOP_ACCESS_ORIGIN`，应用 138、139 迁移并部署当前 API 后，再启用 `MATTER_DESKTOP_ACCESS=on`。H5 操作当前上游数据库；备注与码一同隔离，不向其他环境同步。

2026-11-17 已确认本地为 `127.0.0.1:5433/weave_db`，来自本机 Docker 独立卷；尚未获得测试/正式运行配置，不能确认其数据库是否彼此或与本地共用。测试 `http://192.168.11.70:8080`、正式 `https://matter.minduck.com` 的 `/health` 为 200，`/api/desktop-access/policy` 均为 404，当前不能仅切客户端地址就使用邀请激活。

客户端钥匙串标签和挑战签名按服务 origin 隔离，进入目标环境仍需该环境自己的有效资格；切回已激活环境可恢复原资格。独立库回归证明跨环境的码、激活和吊销不共享，不代表已核实远端实际部署。

## 移植

可以整体复制本目录到静态站点。若移植到 React/Web 项目，保留 `core.js` 的请求与幂等逻辑，将 `app.js` 的 DOM 渲染改为公共 Button/Input/DataTable 组件；`styles.css` 中的语义 token 和 `assets/` 可直接映射到 Web 设计系统，再移除已被公共样式覆盖的 `web-primitives.css`。

## 验证

```sh
node --check tools/invite-console/core.js
node --check tools/invite-console/app.js
node --check tools/invite-console/serve.cjs
node --test tools/invite-console/core.test.cjs
node --test tools/invite-console/serve.test.cjs
```

此前已重跑 375/390/430/768/1024/1440px 深浅主题，检查 20 条首屏、27 条继续加载、完整/部分搜索、作废与当前码不可复制，原记录路径为 `release/metadata/invite-activation-20261116/`（发布目录迁移见 wiki）。当前 H5 测试共 20 项通过，包含无凭证备注请求、校验和演示持久化，以及模糊搜索、特殊字符、筛选和跨页。备注此前通过真实本地接口 10 项与添加/编辑/取消/清空/刷新/超长/纯文本浏览器验证，记录在 `/tmp/matter-invite-notes-20261117/`。本次搜索和胶囊按钮验证记录在 `/tmp/matter-invite-search-20261117/`；真实 iPhone Safari 的触摸/剪贴板、正式 HTTPS 站点另行部署验收。
