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
     Tests  11 passed (11)
```

覆盖：health/ready、admin 认证、发布/暂停/撤回、revision 冲突、stable/beta、灰度 0/100、
最低版本强制、无升级路径 409、204/200、eligibility 410、事件幂等、危险 URL 拒绝、
release CLI staging → register → publish → policy → updates → 包下载 → eligibility。

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

## 9. 前端生产构建

```powershell
pnpm --filter @orderhub/desktop build:web
```

结果：

```text
dist/index.html                   0.50 kB
dist/assets/index-*.css          40.46 kB │ gzip: 8.82 kB
dist/assets/index-*.js          347.23 kB │ gzip: 103.99 kB
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
OrderHub Desktop_0.1.0_x64-setup.exe       8.30 MiB
OrderHub Desktop_0.1.0_x64-setup.exe.sig   448 bytes
sha256 455ac77e910ec54b6750bf435eb9062b5c088fe4c397d8085f8bcc95fc7b8720
```

安装包以无空格文件名上传到 GitHub 预发布：
[v0.1.0](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/v0.1.0)。
重新下载发布资产校验 SHA-256 与本地一致。首次尝试时 NSIS 下载曾超时，重试后成功；
网络受限环境的处理见 [runbook](runbook.md#3-发布一个新版本)。

## 10. 未执行

- 真实报单/撤单、超时、撤单竞争、epoch 迁移；
- 已构建签名 NSIS，但 v0.1.0 安装/卸载与 0.1.0 → 0.2.0 升级重启尚未在干净 Windows 环境执行；
- 篡改包/错签名/撤回包的实际 Tauri 安装器拒绝；
- 两台客户端灰度分桶与最低版本强制；
- SQLite + 安装包备份恢复演练。
