# @orderhub/desktop

React + TypeScript + Vite 前端与 Tauri 2 Rust 原生层。

## 目录

```text
src/
  app/            AppProvider、Layout、hash 路由
  components/     Icon、Panel/Modal/Toast/表格等基础组件
  lib/            bridge、非法币精确十进制、reducer、更新/查询适配、demo fixture
  pages/          连接、工作台、报单、订单详情、请求、预留查询、更新、诊断
src-tauri/
  src/config.rs   config/client.toml 解析与路径/凭证校验
  src/grpc.rs     tonic、Snapshot 分页、Watch、OrderLookup/RequestLookup、报撤单
  src/session.rs  同步状态机、检查点、重连/重同步
  src/requests.rs DPAPI 请求记录
  src/update.rs   更新策略、Tauri updater、eligibility、启动确认
  src/commands.rs Tauri 命令白名单
  src/dto.rs      IPC DTO（camelCase、64 位字符串）
```

## 前端开发

```powershell
pnpm --filter @orderhub/desktop dev
```

浏览器开发服务器使用 `demoBackend`，界面顶部持续显示“开发演示数据”。它不读取真实 config、
不连接服务、不发单、不写文件。生产构建的浏览器环境（非 Tauri）会显示“需要桌面客户端运行时”。

```powershell
pnpm --filter @orderhub/desktop typecheck
pnpm --filter @orderhub/desktop test
pnpm --filter @orderhub/desktop build:web
```

## Tauri

```powershell
# 从仓库根目录，自动加载 vcvars
scripts/dev.ps1

# 或 x64 Native Tools Command Prompt
pnpm dev:tauri
```

原生层要求 `config/client.toml` 和 TLS 文件。开发数据目录默认是 Tauri 的 app local data；
`scripts/dev.ps1` 会把 `ORDERHUB_DATA_DIR` 指向 `test-artifacts/runtime/desktop-data`。

能力配置只有单窗口 `core:default`；没有 shell、文件对话框、opener 或任意 HTTP 插件。自定义
命令在 `lib.rs` 的 `invoke_handler` 中显式注册。

## 测试

```powershell
cd src-tauri
cargo test
# 只读真实部署探针（不会报单/撤单）
$env:ORDERHUB_LIVE_PROBE = "1"
cargo test live_snapshot_smoke -- --ignored --nocapture
```

## 关键约束

- 原生层拥有 gRPC、Token、检查点、DPAPI、updater；WebView 只有受限 DTO。
- 价格/数量/金额/游标不使用 JS `Number` 计算。
- Snapshot 只累加活动订单分页，其他快照数据不重复累加。
- 未知事件、乱序事件、慢消费、epoch 变化都会关闭新增报单并重同步。
- 报单保存成功后才发送；结果未知只查询，不自动换新 ID 重发。
- 预留查询页不伪造结果；没有接口就显示能力缺口并禁用操作。
