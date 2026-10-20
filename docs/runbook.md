# 部署、发布与联调手册

日期：2026-10-19。

## 1. 本地开发

### 1.1 依赖

- Windows 10/11 x64；
- Node.js ≥ 22.13、pnpm 12；
- Rust stable + `x86_64-pc-windows-msvc`；
- Visual Studio Build Tools（C++ 工具链）与 Windows SDK；
- WebView2 Runtime（Windows 11 通常自带）。

MSVC 未进入 PATH 时，`cargo` 可能无法编译 native 依赖。使用：

```powershell
scripts/dev.ps1
```

或打开 “x64 Native Tools Command Prompt for VS” 后运行 `pnpm dev:tauri`。脚本会加载
`vcvars64.bat`，设置 `ORDERHUB_CONFIG_DIR=<repo>/config` 和
`ORDERHUB_DATA_DIR=<repo>/test-artifacts/runtime/desktop-data`。

### 1.2 启动

```powershell
pnpm install

# 仅界面预览（开发演示数据，不发单）
pnpm --filter @orderhub/desktop dev

# 真实桌面客户端
scripts/dev.ps1
```

业务配置使用 [`config/client.toml`](../config/client.toml)。Token 文件不可在日志、界面或诊断
中回显。

## 2. 更新服务部署

### 2.1 目录

```text
/opt/orderhub-updater/
  app/            dist/server.js（pnpm --filter @orderhub/updater build）
  migrations/     001_init.sql
  data/           updater.sqlite3（WAL）
  artifacts/      不可变安装包目录
```

```bash
pnpm --filter @orderhub/updater build
node app/dist/server.js
```

环境变量见 [`services/updater/.env.example`](../services/updater/.env.example)。生产要求：

- `ORDERHUB_UPDATER_HOST=127.0.0.1`（由反向代理暴露 HTTPS）；
- `ORDERHUB_UPDATER_PUBLIC_BASE_URL=https://updates.example.com/artifacts`；
- `ORDERHUB_UPDATER_ADMIN_TOKEN` 为高熵随机值，只注入服务进程；
- `ORDERHUB_UPDATER_SERVE_ARTIFACTS=0`，安装包由反向代理/文件服务提供；
- `ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=1`，发布前 HEAD/GET 验证包可达；
- 数据目录与安装包目录使用磁盘加密和 ACL，进程以低权限账号运行。

受信内网没有 HTTPS 域名时，可以显式使用 IP + HTTP：

```powershell
$env:ORDERHUB_UPDATER_HOST = '0.0.0.0'
$env:ORDERHUB_UPDATER_PORT = '8787'
$env:ORDERHUB_UPDATER_PUBLIC_BASE_URL = 'http://8.159.158.144:8787/artifacts'
$env:ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL = '1'
node app/dist/server.js
```

客户端同时设置 `[update].allow_insecure_http = true`，且只允许受控网段访问 8787。
这是明文传输，不能用于公网。服务端 `ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL`
必须显式设置，否则 `PUBLIC_BASE_URL` 仍会被拒绝。

### 2.2 反向代理

- 客户端接口与 `/artifacts/*`：HTTPS；
- `/v1/admin/*`：仅受控内网或 VPN 可达，附加网络 ACL；
- `Cache-Control: no-store` 由 Hono 对策略/更新/资格响应设置；安装包为不可变长缓存；
- 限制请求体大小、连接数和更新事件速率。

### 2.3 备份

备份 SQLite（使用在线备份或 WAL checkpoint）**以及**其引用的安装包与签名归档。不要只复制
运行中的主 `.db` 而遗漏 WAL。每季度做一次恢复演练。

## 3. 发布一个新版本

### 3.1 构建与签名

1. 更新 `apps/desktop/src-tauri/tauri.conf.json` 中的版本号和产品版本（两者需一致）。
2. 生成/使用生产签名密钥（当前仓库内置测试公钥，仅内部试装）：

```powershell
pnpm --filter @orderhub/desktop tauri signer generate --ci `
  -w D:\secure\orderhub-prod.key
# 将 .pub 内容填入 tauri.conf.json plugins.updater.pubkey；私钥离线保管
```

3. 构建 NSIS + updater artifacts：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content D:\secure\orderhub-prod.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
pnpm --filter @orderhub/desktop tauri build `
  --config src-tauri/tauri.update.conf.json
```

> 公共构建配置默认 `createUpdaterArtifacts=false`，避免在没有签名密钥时误生成不可用包；
> 发布时必须叠加 `tauri.update.conf.json`。

产物位于 `apps/desktop/src-tauri/target/release/bundle/nsis/`，包含 `*-setup.exe` 与 `.sig`。
启用 Authenticode 时，先签所有二进制，再生成最终安装包和 updater 签名。

Tauri bundler 首次打包会从 GitHub 下载 NSIS 3.13。若构建网络无法访问 GitHub，可能报
`failed to bundle project: timeout: global`；release 二进制已生成时，可先把 NSIS 缓存到
构建机（Tauri 工具缓存目录）或使用可访问 GitHub 的内网镜像/构建机，再重跑打包。
`tauri build --no-bundle` 只验证 release 二进制，不生成安装包。

### 3.2 上传与 staging

```powershell
pnpm release stage `
  --file "apps/desktop/src-tauri/target/release/bundle/nsis/OrderHub Desktop_0.2.0_x64-setup.exe" `
  --version 0.2.0 --channel beta `
  --artifact-root "D:\updates\artifacts" `
  --public-base-url "https://updates.example.com/artifacts" `
  --out "test-artifacts\manifest-0.2.0.json"
```

staging 会将安装包复制到 `<version>/windows-x86_64/`，计算 SHA-256/大小，读取完整 `.sig`，
并拒绝覆盖同路径的不同字节。

### 3.3 注册、发布、配置策略

```powershell
$env:ORDERHUB_UPDATER_API_BASE = "https://updates.example.com"
$env:ORDERHUB_UPDATER_ADMIN_TOKEN = "<admin token>"

pnpm release register --manifest test-artifacts\manifest-0.2.0.json
# 输出 release_id 和 revision

pnpm release publish rel_... --revision 0

# 例如：10% beta 灰度，最低版本 0.1.0
pnpm release policy --channel beta --revision 0 `
  --rollout-release rel_... --rollout-percent 10 `
  --min-version 0.1.0 --valid-for-seconds 86400
```

- 发布前服务会验证安装包 URL 可读（`VERIFY_ARTIFACT_URL=1`）。
- 最低版本策略要求存在已发布、兼容且版本 ≥ 最低版本的包，否则 409
  `MIN_VERSION_HAS_NO_UPGRADE_PATH`。
- 策略 revision 必须与读取时一致，否则 409 `POLICY_REVISION_CONFLICT`。
- 暂停：`pnpm release pause rel_... --revision N`；撤回：`revoke`。暂停/撤回后客户端安装前
  复核会取消安装。
- 普通客户端版本发布只需新增包和 release 记录，不需要重新部署 Hono；只有更新服务代码或
  DB 结构变化时才升级服务。

### 3.4 客户端验证

```powershell
pnpm release check --channel beta --version 0.1.0 --installation-id <uuid>
```

应输出 policy、标准 update 响应和 eligibility。无更新时 policy 的 `selected_release=null`，
updates 返回 204。

## 4. 故障处置

| 现象 | 处置 |
| --- | --- |
| `CONFIG_MISSING` / `CONFIG_PARSE` | 修正 `config/client.toml`；不要覆盖真实凭证 |
| TLS 证书/名称失败 | 核对 `ca.pem`、`tls_domain` 与服务器证书；不要关闭验证 |
| `PERMISSION_DENIED` | 核对 Token 和授权策略；不要换身份或循环重试 |
| 快照分页失败 | 检查租约 60s、网络与 `page_token`；客户端会整份重取 |
| `RESYNC_REQUIRED` / `SLOW_CONSUMER` | 等待客户端重新 Snapshot；检查前端事件消费 |
| 未知写结果 | 在请求记录查询原 request；`REQUEST_NOT_FOUND` 不代表未执行 |
| `FORCED_UPDATE_UNAVAILABLE` | 立即人工安装可信包；不要继续交易 |
| `ARTIFACT_UNREACHABLE` | 检查包目录、反向代理、URL、HEAD/Range 支持 |
| `POLICY_CHANGED` | 客户端重新获取 policy；不要复用旧 release_id |
| 更新安装失败 | 使用保留的可信安装包人工修复；MVP 不自动回退 |
| 诊断导出失败 | 检查下载目录权限或 `%LOCALAPPDATA%\com.orderhub.desktop\exports` |

## 5. 回滚与修复版本

MVP 不支持客户端自动降级。发现问题版本时：

1. 立即 `pause` 或 `revoke` 问题版本；
2. 从已知可用源码重新构建更高的修复版本；
3. 按正常发布流程发布，必要时使用强制最低版本；
4. 已安装的问题版本由用户人工安装可信修复包。

不要复用已发布 version/channel；不要覆盖不可变安装包路径。
