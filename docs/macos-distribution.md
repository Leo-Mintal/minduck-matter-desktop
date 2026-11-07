# macOS 客户端打包与直发

本文记录当前 Electron 客户端的 macOS Apple Silicon（`arm64`）**站外直发**流程。它适用于把已签名、公证的 DMG 发给用户下载和安装，不会提交 App Store 审核。

当前正式的打包入口是 `pnpm dist:mac`，实现位于 `scripts/package-macos.sh`。原生 Brave/Chromium 迁移仍是实验工作；本手册描述目前可交付的 Electron 安装包。

## 当前本地发布记录

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

桌面端应用菜单的“检查更新…”只读取一个静态 JSON，不调用 Matter Web 或业务后端。当前过渡发布源为
`http://124.70.149.30:8091/latest.json`，Caddy 容器 `minduck-download` 只读提供服务器目录
`/root/minduck-matter-download/releases/`。不要改动 `/opt` 下的其他服务、Caddy、MinIO 或现有容器。

清单格式固定如下，版本必须是 `x.y.z`，DMG 文件名必须和版本完全一致：

```json
{
  "version": "0.1.3",
  "downloadUrl": "http://124.70.149.30:8091/MinduckMatter-0.1.3-arm64.dmg"
}
```

客户端只接受同源、无参数且名为 `MinduckMatter-<version>-arm64.dmg` 的 URL；版本不高于当前应用时不会打开下载页。发布时一定先上传和验证 DMG，再以 `mv` 原子替换清单，避免用户读到指向不存在文件的版本。当前 HTTP 裸 IP 仅用于临时内测；清单没有签名，公网长期分发前应使用 HTTPS 域名，并在 `src/updateCheck.cjs` 与清单同步切换到该 HTTPS 地址。

### 标准一键发布

恢复好 `MinduckNotary` 钥匙串 profile 和服务器 SSH 登录后，每次只需在桌面项目根目录运行，传入一个明确的新版本号：

```bash
pnpm release:mac 0.1.4
```

`release:mac` 依次执行：读取当前公开清单并拒绝回退、建立可复用的服务器 SSH 连接、验证公证 profile、运行单测、更新 `package.json`、
从最新远端 Web `dev` 构建签名并公证 DMG、校验 SHA-256、上传 `.uploading` 临时文件、让服务器复核 SHA-256、
原子替换 `latest.json`，最后从公网读取新清单和 DMG 响应。公证、打包、上传或验证任一失败时，公开
`latest.json` 保持原样，且不会重启 Caddy、MinIO 或其他容器。若失败发生在本地版本更新后，可在修复问题后用相同版本重试；脚本允许本地版本等于目标版本，但仍要求目标版本高于服务器当前版本。

未配置服务器 SSH 密钥时，命令会在开始时询问 `root@124.70.149.30` 密码一次，并通过 SSH ControlMaster
复用到后续上传和清单切换。长期发布建议配置公钥；连接失败发生在打包前，不浪费 Apple 公证时间。

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

download_url="${scheme}://${public_host}:${port}/${dmg}"
printf '%s\n' \
  '{' \
  "  \"version\": \"${version}\"," \
  "  \"downloadUrl\": \"${download_url}\"" \
  '}' > "$release_dir/latest.json.next"
mv "$release_dir/latest.json.next" "$release_dir/latest.json"

curl --silent --fail "${scheme}://127.0.0.1:${port}/latest.json"
REMOTE_SCRIPT

curl --head --noproxy '*' "http://124.70.149.30:8091/${dmg}"
curl --silent --noproxy '*' "http://124.70.149.30:8091/latest.json"
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

即使环境中存在 `MINDUCK_WEB_DIST`，正常发布也会忽略它，防止旧产物进入安装包。只有 CI 在已验证预构建产物来源时，才可显式设置 `MINDUCK_WEB_ALLOW_PREBUILT=1` 和 `MINDUCK_WEB_DIST=/path/to/dist` 跳过远端 `dev` 构建。

脚本会先检查签名身份和钥匙串 profile，再克隆远端 Web `dev`、安装锁定依赖、构建 Web、桌宠运行时和图标。接着向 `electron-builder` 提供已验证的钥匙串 profile，签名完整 Electron bundle，并在生成 DMG 前完成应用公证与票据装订。构建后再次验证应用的嵌套签名和票据；系统提供 `syspolicy_check` 时，同时执行应用发布检查。随后签名 DMG、提交其公证并等待结果，最后装订和验证 DMG 票据。装订后重新生成 `.blockmap`，使增量校验对应最终 DMG 字节。中途任一步失败时，临时构建目录会清理，`release/` 中已有的发布文件不会被替换。

成功后的文件为：

```text
release/MinduckMatter-<version>-arm64.dmg
release/metadata/MinduckMatter-<version>-arm64.dmg.blockmap
release/metadata/MinduckMatter-<version>-arm64.dmg.sha256
```

`release/` 顶层保留当前可分发的 DMG/ZIP。发布记录 JSON、SHA-256 和增量 `.blockmap` 放在 `release/metadata/`；已被替代的旧包及其对应辅助文件放在 `release/archive/<版本>/`，整理时保留文件原内容。打包脚本自动将新生成的 `.blockmap` 和 `.sha256` 写入 `metadata/`；旧包归档仍在确认替代关系后进行。日常给收件人发包只需选择 DMG 或 ZIP，不必附带内部发布记录和增量文件。

`pnpm dist:mac` 默认生成已签名且公证的对外发布包。只有不对外分发的本地调试场景，才使用 `MINDUCK_MACOS_SIGN=0 pnpm dist:mac` 生成无签名 DMG。

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
