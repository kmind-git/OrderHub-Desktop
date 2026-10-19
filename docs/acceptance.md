# MVP 验收矩阵与证据

日期：2026-10-19。状态标记：

- **通过**：已有运行结果/自动化测试证据；
- **部分**：实现完整、自动化覆盖有边界，仍需部署环境验证；
- **待联调**：需要授权业务环境、签名安装包或第二台测试机。

> 本文件区分“代码/自动化已验证”和“真实部署验收尚未执行”。不以文档审阅代替运行结果。

## 1. 实施阶段

| 阶段 | 交付 | 状态 | 证据/剩余 |
| --- | --- | --- | --- |
| A：连接与只读 | Tauri 壳、配置、凭证保护、Snapshot + Watch、工作台 | **部分** | Rust 只读 Live Snapshot + WatchEvents 已通过（见 §3）；Tauri 窗口在真实配置下启动并显示 READY/WRITABLE 与 1 条活动订单，无写入；分页/断线/epoch 逻辑有单元覆盖，事件级故障演练待联调 |
| B：业务闭环 | 报单、撤单、请求记录、未知结果查询 | **待联调** | 实现与校验/记录测试完成；未向授权环境发送任何报单或撤单 |
| C：更新闭环 | Hono + SQLite、发布 CLI、签名包、更新页、安装保护 | **部分** | 服务 + CLI + staging/publish/policy/eligibility 端到端测试通过；NSIS 安装包与 updater `.sig` 已构建并发布到 GitHub 预发布 v0.1.0；0.1.0→0.2.0 实际安装重启待干净 Windows 环境 |
| D：策略与故障 | beta/stable、灰度、暂停、最低版本、修复版本、审计 | **部分** | 策略/灰度/暂停/撤回/最低版本自动化通过；两台客户端分桶与真实发布审计待联调 |

## 2. 方案第 10 节验证场景

| 验证场景 | 结果 | 证据 |
| --- | --- | --- |
| TLS 与认证 | **部分** | 真实只读 TLS Snapshot 成功；错误 CA/服务名/Token 拒绝由 `config.rs` 校验与 tonic 错误映射覆盖，未做真实错误凭证探测；Token 不进入日志/诊断/前端 |
| 数字精度 | **通过** | `decimal.test.ts`（BigInt、超 `Number.MAX_SAFE_INTEGER`、步进、notional）；Rust `decimal.rs` 单元测试；IPC DTO 全部字符串 |
| 快照与流 | **部分** | Snapshot 分页只累加 active_orders、页间 epoch/cursor 校验、Progress 同 seq、事件去重/乱序/未知、重同步 reducer 测试；未在真实服务制造 seq 跳跃/重复事件 |
| 故障恢复 | **部分** | 断线续传/重同步/慢消费/认证失败分支实现；`WATCH_STALLED`、`SLOW_FRONTEND_CONSUMER` 等路径；真实断网与 token 过期演练待联调 |
| 未知写结果 | **部分** | 请求先持久化再发送、重启 `sending→unknown`、原键查询、不自动重发、`REQUEST_NOT_FOUND` 语义；Rust 请求存储测试；真实超时写请求待授权环境 |
| 撤单竞争 | **待联调** | 撤单独立 request_id、受理不等于撤成、终态来自服务端；需授权环境观察受理期间成交 |
| 更新协议 | **通过** | updater 测试：无更新 204、有更新 200、平台/通道/灰度隔离、409 revision、410 暂停/撤回、503 无强制候选、Tauri 响应字段；release E2E |
| 包安全 | **部分** | 发布要求完整签名文本、包 URL 可读、不可变 staging、SHA-256/大小；Tauri `download/verify/install`；未用篡改包/错签名包实际触发 Tauri 安装器 |
| 安装与恢复 | **待联调** | 维护门禁、写锁、未知请求确认、restart marker、启动确认、人工修复说明；需实际构建签名 NSIS 并安装验证 |
| 发布一致性 | **部分** | 缺包不能发布、revision 冲突、暂停/撤回、审计；SQLite+安装包备份恢复演练未执行 |

## 3. 只读 Live Snapshot 证据

命令：

```powershell
cd apps/desktop/src-tauri
$env:ORDERHUB_LIVE_PROBE = "1"
cargo test live_snapshot_smoke -- --ignored --nocapture
```

实际结果：

```text
live snapshot ok: epoch=2144513667773369273 cursor=130 durable=130 readiness=READY writable=true active_orders=1 instruments=1
live watch ok: seq=130 kind=progress event_id=
```

该探针调用 `GetState(Snapshot)`，再从快照的 `state_cursor + resume_token` 启动
`WatchEvents` 并读取一条 Progress；不发送 `SubmitOrder` 或 `CancelOrder`。输出不含
Token、page_token 或 resume_token。

另在交互式 Windows 桌面启动 Tauri 二进制，窗口成功创建并自动连接同一部署；工作台显示
READY / WRITABLE、完整 Snapshot 和 1 条活动订单。未提交或撤销任何订单。

## 4. 自动化测试清单

| 测试 | 覆盖 |
| --- | --- |
| `packages/contracts/test/contracts.test.ts` | Zod schema、strict 输入、Tauri 响应、OpenAPI 文件 |
| `services/updater/test/updater.test.ts` | 发布/暂停/撤回、并发 revision、灰度、最低版本、204/200、eligibility、事件幂等 |
| `services/updater/test/release-e2e.test.ts` | staging → 注册 → 发布 → policy → updates → 安装包下载 → eligibility |
| `tools/release/test/artifact.test.ts` | SHA-256、不可变路径、manifest 校验 |
| `apps/desktop/test/decimal.test.ts` | 精确十进制、步进、超安全整数、notional |
| `apps/desktop/test/reducer.test.ts` | Snapshot 替换、Progress、去重、乱序/未知、世代切换、控制事实、策略门禁 |
| `apps/desktop/test/format.test.ts` | 字节/纳秒/ID 显示 |
| Rust `decimal.rs` / `storage.rs` / `crypto.rs` | 十进制、原子写、安装 ID、DPAPI 往返与篡改检测 |
| Rust `requests.rs` | DPAPI 记录、重启 `sending→unknown` |
| Rust `grpc.rs` live probe | 真实 TLS 只读 Snapshot |

## 5. 尚未执行 / 需要输入

1. 授权测试环境的报单、撤单、超时、撤单竞争和最终状态验证；
2. 真实 TLS 错误凭证/错误 CA 负向探测（避免对部署服务造成无意义认证噪音）；
3. 在干净 Windows 环境完成 v0.1.0 安装/卸载，并再构建 v0.2.0 验证升级/重启；
4. 两台客户端稳定哈希分桶、暂停/撤回阻断、最低版本强制；
5. 篡改包、错签名包、版本不匹配包的实际 Tauri 拒绝验证；
6. SQLite + 安装包备份恢复演练；
7. Authenticode 代码签名与正式分发体验；
8. 真实业务负载下的启动/快照/事件/内存/更新耗时基线。

## 6. 联调前需要部署方确认

- 幂等结果保留时间、服务重启后的可见性、Token 过期/撤销方式；
- 是否允许自动原键重试（当前实现仍只自动查询，不自动重发）；
- 更新服务 HTTPS 域名/证书、内网/VPN 可达性、发布操作者、生产签名私钥托管；
- 最低版本生效宽限、自动下载默认值、维护时段与策略有效期。
