# 测试记录

日期：2026-10-19。所有命令在仓库根目录执行，除非注明。结果以实际运行输出为准。

## 1. TypeScript 类型检查

```powershell
pnpm --filter @orderhub/contracts typecheck
pnpm --filter @orderhub/release typecheck
pnpm --filter @orderhub/updater typecheck
pnpm --filter @orderhub/desktop typecheck
```

结果：全部通过（无输出/exit 0）。

## 2. 契约包

```powershell
pnpm --filter @orderhub/contracts openapi
pnpm --filter @orderhub/contracts test
```

结果：

```text
Test Files  1 passed (1)
     Tests  8 passed (8)
```

生成 `packages/contracts/openapi/updater.v1.json`。

## 3. 更新服务

```powershell
pnpm --filter @orderhub/updater test
```

结果：

```text
Test Files  2 passed (2)
     Tests  12 passed (12)
```

覆盖：health/ready、admin 认证、发布/暂停/撤回、revision 冲突、stable/beta、灰度 0/100、
最低版本强制、无升级路径 409、204/200、eligibility 410、事件幂等、危险 URL 拒绝、
Tauri v2 单行 base64 签名、release CLI staging → register → publish → policy → updates →
包下载 → eligibility。

## 4. 发布工具

```powershell
pnpm --filter @orderhub/release test
```

结果：

```text
Test Files  1 passed (1)
     Tests  2 passed (2)
```

## 5. 前端

```powershell
pnpm --filter @orderhub/desktop test
```

结果：

```text
Test Files  3 passed (3)
     Tests  16 passed (16)
```

覆盖：精确十进制、步进、BigInt notional、超安全整数、Snapshot 替换、Progress、事件去重、
未知/乱序事件、世代切换、控制事实、状态事件乱序、策略门禁、字节/纳秒显示。

## 6. Rust

构建环境：Visual Studio Build Tools 18 + Windows SDK；`vcvars64.bat`；`CARGO_PROFILE_DEV_DEBUG=0`；
`CARGO_BUILD_JOBS=2`；临时目录指向工作区 `test-artifacts/tmp`（系统 temp 上 prost-build 的
临时目录曾返回 PermissionDenied，改用 OUT_DIR 固定 descriptor 路径规避）。

```powershell
cd apps/desktop/src-tauri
cargo check --all-targets
cargo test
```

结果：

```text
cargo check --all-targets: Finished (exit 0)
cargo test --lib:
  running 14 tests
  test result: ok. 13 passed; 0 failed; 1 ignored
```

通过：精确十进制、配置解析（路径逃逸/空 Token）、DPAPI 往返与篡改检测、原子写入、安装 ID、
请求记录 `sending → unknown` 恢复、分页 Snapshot 只累加订单（tonic mock server）、诊断脱敏。

## 7. 只读 Live Snapshot（真实部署配置）

```powershell
cd apps/desktop/src-tauri
$env:ORDERHUB_LIVE_PROBE = "1"
cargo test live_snapshot_smoke -- --ignored --nocapture
```

结果：

```text
live snapshot ok: epoch=2144513667773369273 cursor=130 durable=130 readiness=READY writable=true active_orders=1 instruments=1
live watch ok: seq=130 kind=progress event_id=
test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out
```

该测试只执行 `GetState(Snapshot)` 和从该快照 `state_cursor + resume_token` 启动的
`WatchEvents`，读取一条 Progress 后关闭流；没有发送报单或撤单。日志未输出 Token、
page_token 或 resume_token。

## 7.1 打包后的更新服务

```powershell
pnpm --filter @orderhub/updater build
node services/updater/dist/server.js
```

`tsup` 将 `@orderhub/contracts` 一并打包，并通过 `createRequire` 保留
`node:sqlite`；以本地临时 DB/包目录启动后：

```json
{"status":"ok","service":"orderhub-updater","time":"..."}
{"status":"ready","database":true,"artifact_store":true,"time":"..."}
```

## 8. Tauri 桌面运行时

在 Windows 交互式桌面启动 `target/debug/orderhub-desktop.exe`，配置指向当前 `config`：

- 窗口成功创建；此前隐式 WebView2 目录导致的 `0x8000FFFF` 已通过
  `prepare_webview_data_dir()` 修复；
- 自动连接真实部署，工作台显示 `READY` / `WRITABLE`、完整 Snapshot 和 1 条活动订单；
- 事件流建立，未提交或撤销任何订单；
- 关闭应用后不再保留业务 Watch 流。

## 8.1 v0.1.1 启动修复

安装版启动慢并短暂出现控制台窗口的根因：

- 启动时对数据根目录执行 `icacls /T`，递归扫描了约 73.5 MB 的 WebView2 缓存；
- GUI 子进程没有 `CREATE_NO_WINDOW`，Windows 为 `icacls.exe` 创建了短暂控制台。

修复：

- 不再扫描数据根目录，只对 `requests` 目录做一次 ACL 加固；
- 加固成功写 `.acl-hardened`，后续启动跳过；
- `icacls` 使用 `CREATE_NO_WINDOW`，不创建控制台；
- `index.html` 增加深色启动占位页。

在安装版 v0.1.1 上实测：已有 WebView2 缓存时窗口创建约 284 ms，首次启动约 1 s；
清空 WebView2 缓存后的首次初始化约 3 s（WebView2 正常行为）。进程树中仅剩
`msedgewebview2.exe`，没有 `conhost.exe`/`cmd.exe` 子进程。

## 9. 前端生产构建

```powershell
pnpm --filter @orderhub/desktop build:web
```

结果：

```text
dist/index.html                   2.76 kB │ gzip: 1.15 kB
dist/assets/index-*.css          40.46 kB │ gzip: 8.82 kB
dist/assets/index-*.js          347.54 kB │ gzip: 104.13 kB
✓ built
```

## 9.1 Release 构建

```powershell
pnpm --filter @orderhub/desktop tauri build --no-bundle
```

结果：release 二进制成功生成于
`apps/desktop/src-tauri/target/release/orderhub-desktop.exe`（约 21.7 MB）。

带 `--config src-tauri/tauri.update.conf.json` 生成 NSIS + updater artifacts 成功：

```text
OrderHub Desktop_0.1.1_x64-setup.exe       8.31 MiB
OrderHub Desktop_0.1.1_x64-setup.exe.sig   448 bytes
sha256 cc000e38ef8d73262d8d02c93ac136253ed1a5c2bae50ee77b01a6fb6bbf38b6
```

安装包以无空格文件名上传到 GitHub 预发布：
[v0.1.1](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/v0.1.1)。
v0.1.0 的安装包（SHA-256 `455ac77e...`）仍保留在旧 release。重新下载发布资产校验
SHA-256 与本地一致。首次尝试时 NSIS 下载曾超时，重试后成功；网络受限环境的处理见
[runbook](runbook.md#3-发布一个新版本)。

## 9.2 真实 GitHub 发布物 → 更新服务

用本地更新服务加载 `release-assets/release-manifest.json`（指向 GitHub Release v0.1.0 安装包）：

- 注册 draft → publish → beta 通道 policy revision 1 / 100%；
- `pnpm release check --channel beta --version 0.0.9` 返回 `update_available=true`，
  `selected_release`、Tauri 标准 update 和 eligibility 的 URL/size/SHA-256 均与 GitHub 资产一致；
- 包签名是 Tauri v2 单行 base64 `.sig`；首次注册暴露了服务端只接受 multiline 签名的问题，
  已修复并增加单行签名回归测试；
- 该环境 Node fetch 对 GitHub 资产 URL 的发布前 HEAD 检查失败，publish 测试使用
  `ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=0`；PowerShell/Curl `HEAD` 同一 URL 返回 200。
  生产构建机应保持校验开启并验证出站访问。

## 10. 未执行

- 真实报单/撤单、超时、撤单竞争、epoch 迁移；
- 已构建签名 NSIS，但 v0.1.0 安装/卸载与 0.1.0 → 0.2.0 升级重启尚未在干净 Windows 环境执行；
- 篡改包/错签名/撤回包的实际 Tauri 安装器拒绝；
- 两台客户端灰度分桶与最低版本强制；
- SQLite + 安装包备份恢复演练。
