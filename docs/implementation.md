# OrderHub Desktop MVP 实现说明

日期：2026-10-19。对应方案：[OrderHub-Desktop-MVP方案.md](OrderHub-Desktop-MVP方案.md)。

## 1. 已实现范围

| 方案区域 | 实现 |
| --- | --- |
| Windows 桌面客户端 | Tauri 2 + React 19 + TypeScript + Vite；x64 NSIS 配置 |
| 原生 gRPC | Rust `tonic/prost`，冻结 proto，TLS + CA + 服务身份 + Bearer metadata |
| 连接与同步 | Snapshot 分页、WatchEvents、检查点 ack、断线续传、epoch/权限/慢消费触发全量重同步 |
| 业务闭环 | 受限报单、独立撤单 request_id、请求记录、RequestLookup 查询未知结果 |
| 本地安全存储 | Windows DPAPI 加密请求记录、原子替换、安装 ID、策略缓存 |
| 更新客户端 | 更新策略获取、Tauri updater 检查/下载/验签、安装前 eligibility、启动确认 |
| 更新服务 | Hono + `node:sqlite`、迁移、发布/暂停/撤回、通道策略、灰度、最低版本、审计、事件限流 |
| 发布工具 | `tools/release`：immutable staging、SHA-256、注册、发布、暂停、撤回、策略、客户端检查 |
| 契约 | IPC DTO、更新 HTTP Zod schema、OpenAPI 生成、proto 冻结与 validation 记录 |
| 界面 | 连接、工作台、报单、订单详情、请求记录、四类预留查询页、更新/关于、诊断 |
| 测试 | 契约、update service、release CLI、前端 reducer/十进制/格式化、Rust 单元与只读 live probe |

## 2. 运行时结构

```text
React WebView
   │ typed invoke / Channel (camelCase DTO, all 64-bit values as strings)
   ▼
Tauri Rust native layer
   ├─ ConfigLoader        config/client.toml, relative CA/token paths
   ├─ GrpcClient          tonic channel + per-RPC auth metadata
   ├─ SessionRuntime      Snapshot + WatchEvents + generation/checkpoint
   ├─ RequestStore        DPAPI envelopes under %LOCALAPPDATA%
   ├─ UpdateManager       Hono policy + tauri-plugin-updater + eligibility
   └─ Diagnostics         redacted in-memory ring + user-confirmed export
   │
   ├─ HTTPS/HTTP2/TLS ──► existing OrderHub gRPC service
   └─ HTTPS/JSON ───────► Hono update service ──► SQLite + artifact store
```

WebView 不持有 gRPC 客户端、Bearer Token、安装器或 page/resume token。所有写入都要经过原生
命令白名单。

## 3. 关键实现点

### 3.0 WebView2 数据目录

在部分 Windows 用户配置（包括本次验证机）上，WebView2 使用隐式 LocalAppData 目录创建窗口会
返回 `0x8000FFFF`/拒绝访问。`main.rs` 在 Tauri 建立首个窗口之前调用
`prepare_webview_data_dir()`，创建 `<ORDERHUB_DATA_DIR 或 %LOCALAPPDATA%\\com.orderhub.desktop>/webview2`
并设置 `WEBVIEW2_USER_DATA_FOLDER`。这样窗口创建与业务数据目录使用同一用户可写路径；不改变
Tauri capability 或 WebView 安全边界。

### 3.1 配置与凭证

- 配置根目录解析顺序：`ORDERHUB_CONFIG_DIR` → 可执行文件旁 `config` → 当前目录向上查找 →
  编译期源码树 `config`。
- `ca_file` / `token_file` 必须是相对路径，canonicalize 后必须仍在 config 根目录内，防止
  配置把任意本地文件读入。
- Token 只保存于 `Token` 包装类型，`Debug` 输出固定为 `Token(***)`；没有 Serialize。
- 配置摘要只返回 `tokenConfigured: true/false`。真实 Token 不跨 IPC。
- 更新配置缺失时：开发构建不启用最低版本策略，界面明确提示；配置了 `base_url` 但策略缺失/
  过期时进入写入受限模式。

### 3.2 Snapshot + WatchEvents

1. `GetState(Snapshot)`，`page_size=1000`，按 `next_page_token` 取完所有页。
2. 只有 `active_orders` 累加；`positions/accounts/instruments/inputs/committed_health` 只取
   第一页，避免每页重复累加。
3. 每页校验 `journal_epoch` / `state_cursor` 一致；分页失败或 60 秒租约超时整份重取，不拼接
   两个基线。
4. 末页的 `resume_token` 与 `state_cursor` 建立 Watch 检查点；token 只在 Rust 内存中。
5. Watch 事件按收到顺序转为 DTO，`event_id`（空时 `epoch:seq:kind`）由前端去重；Progress
   不参与业务去重，但更新水位。前端每批事件通过 `ack_checkpoint` 回传，Rust 保存“已应用
   seq + 配套 token”。
6. 断线使用最后 ack 检查点续传；`OUT_OF_RANGE`、`SLOW_CONSUMER`、`RESYNC_REQUIRED`、
   epoch 变化、未知事件、前端消费积压（>256 未 ack）触发重新 Snapshot。
7. 重连使用指数退避 + 抖动；认证失败停止并进入 `reauth_required`，不盲目循环。
8. 运行控制事件同步更新原生 baseline 的 `readiness/writable`，报单命令在原生层再次检查。

### 3.3 报单与撤单

- 报单/撤单先在原生层校验生成世代、epoch、授权策略、合约、方向、TIF、布尔选项、精确十进制
  步进、数量上限。
- 生成 `ohd-<timestamp>-<random>` request_id；将 RPC 方法、原始参数、epoch、环境指纹、凭证
  指纹和状态写入 DPAPI 记录，成功后才发送。
- 发送前状态写为 `sending`；进程在发送中退出时重启后转换为 `unknown`。
- gRPC `OK` 但 `result=REJECTED` 是业务拒绝；`ADMITTED` 只表示接纳，不表示成交/刷盘。
- 超时、UNAVAILABLE、取消、幂等冲突、epoch 变化等保留为 `unknown`；只有参数/认证类错误
  标记为 `failed`（未发送）。
- `RequestLookup` 使用原 environment、RPC 方法、epoch、request_id；凭证或环境不一致时拒绝
  自动查询。`REQUEST_NOT_FOUND` 不证明请求未执行，不自动换新 ID。
- 撤单可以不依赖 `writable=true` 发起，最终是否可用由业务服务决定；撤单过程中仍可能成交。

### 3.4 更新策略

- `GET /v1/update-policy/...` 返回 revision、最低版本、有效期、选中 release；客户端固定
  `release_id + policy_revision`。
- `GET /v1/updates/...` 重新计算选择，revision 变化返回 `409 POLICY_CHANGED`，未选中返回
  409，无更新返回 204。
- 安装前 `GET /v1/releases/{id}/eligibility` 再复核；暂停/撤回返回 410。
- 灰度桶 = `sha256(release_id + "\0" + installation_id) mod 10000`，比例按百分比；最低版本
  强制候选绕过灰度但仍校验平台/架构/签名。
- 客户端策略缓存 `update-policy.json`；过期或缺失时禁止新报单，但允许查询、诊断、服务端允许
  的撤单。更新服务短暂不可达不改变尚有效策略。
- 安装：写入 `pending-install.json`，关闭新写入，取写锁等待在途写入，取消 Watch，校验
  eligibility，启动 Tauri updater 安装器；新版本启动后写 `start_confirmed` 更新事件。

### 3.5 精确数值

- Rust `DecimalValue` 与 TS `DecimalValue` 都基于十进制数字字符串；TS 使用 BigInt 只做校验
  和展示乘法，不把值转成 Number。
- 64 位 epoch、seq、version、纳秒时间、金额、价格、数量、字节数跨 IPC 全部为字符串。
- 快照内筛选、请求记录、订单详情都显示服务端原始字符串。

### 3.6 预留查询

`packages/...` 中的 `queryCapabilities.ts` 是能力适配边界。历史订单、历史成交、全账户
资金/持仓、行情四页：

- 显示真实接口能力与缺口；
- 筛选控件、分页位置保留但禁用；
- 查询/导出按钮禁用；
- 表格只显示计划字段，不显示“查询成功、暂无数据”；
- 后续接入新接口时替换适配实现。

## 4. 与方案的差异 / 解释

1. **更新服务未配置时最低版本策略不启用**：方案 3.4 明确当前 config 尚无更新服务地址。
   若强制“无策略即受限”，开发构建无法完成业务联调。实现区分“未配置更新服务”（开发模式，
   界面明示）与“已配置但策略缺失/过期”（受限模式）。正式发布必须配置 `[update].base_url`。
2. **更新服务静态包下载**：MVP 为便于本地联调，`serveArtifacts=true` 时 Hono 直接提供
   `/artifacts/*` 只读静态文件；生产方案仍由反向代理/文件服务承担下载，Hono 只返回 URL。
3. **下载保存在内存**：Tauri updater 的 `download` 返回字节，MVP 保存于原生内存直到安装；
   不承诺崩溃后保留，方案允许重新下载。大型安装包的内存占用需在发布验收中记录。
4. **未实现自动安装重启后的业务会话自动恢复**：新版本启动后前端自动重新连接并重新 Snapshot；
   请求记录与配置保留，但不会持久化完整业务视图。
5. **未启用 Authenticode**：当前只使用 Tauri updater 测试签名做内部验证；正式分发前需
   单独接入 Windows 代码签名。
6. **无更新服务凭证**：MVP 客户端读取接口放在受控内网/VPN，不发送额外更新访问 Token；
   方案允许后续扩展独立更新访问凭证。

## 5. 代码入口

| 关注点 | 文件 |
| --- | --- |
| Tauri 启动/状态 | `apps/desktop/src-tauri/src/lib.rs`, `state.rs` |
| 配置 | `apps/desktop/src-tauri/src/config.rs` |
| gRPC/Snapshot | `apps/desktop/src-tauri/src/grpc.rs` |
| 会话/续传 | `apps/desktop/src-tauri/src/session.rs` |
| 请求记录/DPAPI | `requests.rs`, `crypto.rs`, `storage.rs` |
| 更新客户端 | `update.rs` |
| 前端 reducer | `apps/desktop/src/lib/reducer.ts` |
| 前端 bridge | `apps/desktop/src/lib/bridge.ts` |
| 更新服务 | `services/updater/src/app.ts`, `policy-service.ts`, `repository.ts` |
| 发布 CLI | `tools/release/src/cli.ts` |
| IPC 契约 | `packages/contracts/src/ipc.ts` |
| HTTP schema | `packages/contracts/src/update-api.ts` |
