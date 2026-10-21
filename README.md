# OrderHub Desktop MVP

[GitHub 仓库](https://github.com/kmind-git/OrderHub-Desktop) ·
[预发布 v0.1.3](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/v0.1.3)

OrderHub Desktop 是面向 Windows x64 的桌面客户端 MVP：React + TypeScript + Vite 界面，
Tauri 2 / Rust 原生层连接现有 `orderhub.v1` gRPC 服务，独立 Hono + SQLite 更新服务负责
版本策略、灰度、发布元数据和 Tauri updater 响应。

**当前状态：可构建、可测试的 MVP 实现。** 业务连接已在本地开发配置上完成只读 TLS
Snapshot 验证；未在授权测试环境执行真实报单或撤单。详见 [验收矩阵](docs/acceptance.md)。

## 两个闭环

1. **业务状态同步、报单和撤单**
   - 原生 gRPC / HTTP2 / TLS，Bearer Token 只在 Rust 层读取；
   - Snapshot 分页建立基线，WatchEvents 有序应用、检查点确认、断线续传、epoch/权限变化全量重同步；
   - 报单前生成 `request_id`，DPAPI 加密保存请求记录后再发送；
   - 结果未知时仅按原 epoch/request_id 查询，不自动重发、不换新 ID 补单；
   - 精确十进制字符串跨 IPC，不使用 `Number` 计算价格/数量。
2. **发布新版本、下载验签、安装重启**
   - Hono 更新服务 + SQLite WAL + 版本化迁移，管理 API 与客户端读取接口分离；
   - SemVer 选包、stable/beta 隔离、稳定哈希灰度、最低版本、暂停/撤回、revision 一致性；
   - Tauri updater 完整 NSIS 包下载与签名校验，安装前复核 eligibility；
   - 安装前关闭新写入、关闭事件流、保留未知请求，新版本启动确认上报。

## 工程布局

```text
apps/desktop/            React UI + src-tauri Rust 原生层
services/updater/        Hono 更新服务、SQLite 迁移、策略与管理 API
packages/contracts/      IPC DTO、更新 HTTP schema、OpenAPI 生成
contracts/orderhub/      冻结 proto、来源 revision/hash
tools/release/           安装包 staging、发布、通道策略 CLI
scripts/                 图标生成、开发启动脚本
config/                  业务连接配置与 TLS 文件（真实凭证不进入源码）
assets/images/           已生成的四张装饰图及素材记录
test-artifacts/          测试包、签名归档、脱敏验证输出（运行时数据不入库）
docs/                    MVP 方案、实现、安全、部署与验收记录
```

## 下载测试安装包

从 [GitHub Release v0.1.3](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/v0.1.3)
下载 Windows x64 NSIS 安装包、`.sig`、`SHA256SUMS.txt` 和
[release-manifest.json](https://github.com/kmind-git/OrderHub-Desktop/releases/download/v0.1.3/release-manifest.json)。

v0.1.3 包含 2026-10-20 代码评审的状态一致性、请求恢复、发布门禁和启动路径修复；仍使用
测试 updater 密钥，未做 Authenticode 签名。HTTP 是明文传输，只应在受控内网显式开启。

> 这是内部试装预发布版本，使用测试 updater 签名密钥，未做 Authenticode 签名；安装包不包含
> 业务配置或凭证。运行前必须提供 `config/` 或设置 `ORDERHUB_CONFIG_DIR`。详见
> [发布说明](docs/release-notes-v0.1.3.md) · [从 v0.1.2 升级](docs/upgrade-v0.1.2-to-v0.1.3.md)。

## 更新服务部署包（CentOS Stream）

更新服务是独立的 Node 进程，不包含在桌面安装包里。从
[Updater v0.1.3 Release](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/updater-v0.1.3)
下载 `OrderHub-Updater-0.1.3-centos-stream.tar.gz`：

```bash
tar -xzf OrderHub-Updater-0.1.3-centos-stream.tar.gz -C /opt/orderhub-updater
cd /opt/orderhub-updater
cp .env.example .env
vi .env
./start.sh
```

部署包包含自包含的 `dist/server.js`、`migrations/`、`.env.example`、`start.sh` 和
`orderhub-updater.service`，不需要 `node_modules`。需要 Node.js 22.13+，默认监听
`0.0.0.0:8787`，健康检查 `/healthz`、`/readyz`。按你的
`orderhub-updater` 用户和 `/home/orderhub-updater` 家目录整理的逐步安装文档见
[CentOS Stream 安装步骤](docs/install-centos-stream-orderhub-updater.md)。

## 快速开始

前置条件：

- Windows 10/11 x64，WebView2 Runtime；
- Node.js ≥ 22.13，pnpm 12；
- Rust stable（MSVC target）；
- Visual Studio Build Tools（C++ 工具链）与 Windows SDK。

```powershell
pnpm install

# 1) 浏览器界面预览：明确标注“开发演示数据”，不会连接、报单或安装
pnpm --filter @orderhub/desktop dev

# 2) Tauri 桌面客户端（使用 config/client.toml）
# 推荐在 "x64 Native Tools Command Prompt for VS" 中运行；
# 或使用 scripts/dev.ps1 自动加载 vcvars64.bat。
scripts/dev.ps1

# 3) 更新服务（本地开发配置）
Copy-Item services/updater/.env.example services/updater/.env
pnpm updater:dev
```

业务配置读取当前工作区的 [`config/client.toml`](config/client.toml)，相对路径以
[`config`](config) 为基准。没有 `[update].base_url` 时更新检查与最低版本策略在开发构建中
关闭，界面会明确显示该状态。

## 常用命令

```powershell
pnpm typecheck                 # 所有 TypeScript 工程
pnpm test                      # contracts + updater + web
pnpm --filter @orderhub/desktop test
pnpm --filter @orderhub/updater test
pnpm openapi                   # 生成 packages/contracts/openapi/updater.v1.json

cd apps/desktop/src-tauri
cargo test                     # Rust 单元测试（DPAPI、十进制、存储等）
cargo check                    # 需要 MSVC 环境

pnpm --filter @orderhub/desktop build:web
pnpm --filter @orderhub/desktop tauri build --config src-tauri/tauri.update.conf.json
```

## 安全基线

- 业务 Token 只从 `config/tls/client-token.txt` 读取，不进入 UI、日志或诊断文件；
- 本地请求记录使用 Windows DPAPI 加密、原子替换写入，数据目录做 ACL 加固；
- 自定义 Tauri 命令白名单，未启用 shell / 任意文件读写 / 任意 URL 请求；
- 严格 CSP、单窗口 capability、本地打包前端；
- 更新包由 Tauri updater 签名校验，公钥内置；发布私钥只在受控签名环境；
- 管理 API 使用独立高熵 Token，客户端不包含发布密钥。

## 文档

- [MVP 总体方案](docs/OrderHub-Desktop-MVP方案.md)
- [实现说明](docs/implementation.md)
- [安全设计](docs/security.md)
- [部署与发布手册](docs/runbook.md)
- [验收矩阵与证据](docs/acceptance.md)
- [测试记录](docs/test-report.md)
- [更新服务 API](packages/contracts/openapi/updater.v1.json)
- [HTTP schema 说明](packages/contracts/README.md)

## 已知边界

- 当前 proto 没有可枚举历史订单、历史成交、全账户资金/持仓或行情查询；对应页面明确显示
  “后台暂未提供该查询接口”并禁用真实查询/导出，不伪造结果。
- MVP 不持久化完整业务视图；重启、升级、窗口状态丢失后统一重新 Snapshot。
- 不承诺安装器原子回退、差分更新、跨进程断点续传或无人值守自动回退。
- 更新服务置于受控内网/VPN；对外分发还需 Authenticode 代码签名。
