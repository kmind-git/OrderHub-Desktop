# 代码评审修复记录（2026-10-21）

评审基线：`3e5fd808d43fd6022b8e72dbb2669a5d244821a4`。本记录对应
`reviews/2026-10-20/OrderHub-Desktop-代码评审.md` 中的 F01–F14、S01–S06 及三项其他缺陷。

## 1. 业务状态、请求恢复与身份一致性

| 编号 | 修复 |
| --- | --- |
| F01 | 工作台持仓/资金改用 reducer 的实时 `state.positions` / `state.accounts`；快照只作为同步基线。成交或资金占用事件后不再显示旧值。 |
| F02 | reducer 拒绝更小 generation 的状态和快照；`bootstrap` 不会用旧 generation 覆盖当前会话；快照必须匹配当前 generation。原生快照返回后、建流成功后都复核取消状态。 |
| F03 | 订单事件先按 journal seq 判断乱序，乱序事件只记录诊断、不再应用 view；订单合并按精确整数 `version`，只接受不落后的视图。`OrderLookupResult` 增加 generation，reducer 同时校验 generation 与 journal epoch。 |
| F04 | submit/cancel/OrderLookup 从同一个不可变 `SessionShared` 取配置、凭证和 gRPC Channel；发送前再次确认全局 generation 未被切换。切换时未发送的本地记录标记为 Failed。 |
| F05 | `RequestStore` 改为按 `request_id` 合并并持久化：admission 一旦存在不可被 NOT_FOUND/网络失败/迟到提交覆盖；状态不允许从 Unknown/Sending 回退；每次写入分配本地 `revision`，写盘成功后才提交内存。磁盘顺序由同一把记录锁串行化。 |
| F14 | RequestLookup 的落盘错误不再被 `let _ =` 丢弃。服务端结果仍返回，但 `found=true` 同时附带“结果已知、本地保存失败”的结构化错误。 |

## 2. 更新发布与门禁

| 编号 | 修复 |
| --- | --- |
| F06 | 发布前从最终 URL 下载完整产物，校验声明大小、SHA-256、minisign Ed25519 签名、公钥 key id、trusted comment 全局签名和签名内版本。新增 `services/updater/src/signature.ts`；`VERIFY_ARTIFACT_URL=1` 时缺少 `ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY` 直接拒绝发布。 |
| F07 | 注册/发布 URL 校验与启动配置统一：显式开启 `ALLOW_INSECURE_ARTIFACT_URL=1` 后允许非回环 HTTP，不再只允许 loopback。 |
| F08 | 缺少或无效更新配置时，release 构建的 `PolicyGateDto` 返回 `canTrade=false`；只有 debug 构建保留开发豁免。 |
| F10 | `UpdateManager` 的配置改为 `RwLock<UpdateSettings>`，`reload_config` 调用 `reconfigure`。更新源/通道变化时清空策略缓存、待安装包和已下载字节；UI 重载后同步拉取新的 UpdateState。 |
| F11 | 周期检查按 release_id + version 复用已验签下载；只有候选产物变化或资格失效才作废。周期检查与启动检查一样执行 `autoDownload`。 |
| F12 | 原生下载的所有错误出口（updater_check、下载/验签、大小不一致）统一发布 `failed` 状态；Provider 在 IPC 异常后拉取原生状态，并提供 `downloadFailed` 兜底。 |
| F13 | 策略缓存 schema 升到 2，并绑定规范化 source、application、channel、target、arch、installer；上下文不匹配视为未取得策略。 |
| F14 | 见上表。 |
| S05 | 新增 `check_update_policy`，启动时先发布最低版本门禁，再异步检查可选发布元数据；不再固定等待 1.4 秒。 |

## 3. 安装、更新体验与请求展示

| 编号 | 修复 |
| --- | --- |
| F09 | 安装先原子进入 maintenance，再获取写锁、等待在途写入结束，最后重新统计未知请求并做确认决策；期间不再先计数后等待。 |
| 其他 | CancelOrder 按 admission.result 区分受理/拒绝/已终态；RequestLookup 的上下文异常由 Provider 展示 toast；损坏/无法解密的请求记录生成可见的 Unknown 占位记录并计入待核对数量，不再只写诊断。 |

## 4. 启动与同步

| 编号 | 修复 |
| --- | --- |
| S01 | 请求仓库在后台线程恢复；`AppState` 立即注册。恢复完成前 submit/cancel/lookup/install 均拒绝写入，bootstrap 暴露 `requestRecovery`（ready/loading/total/unknown/loadErrors）。 |
| S02 | bootstrap 只返回最近 50 条请求摘要；诊断计数改用 `count()`，不再 `list().len()` 克隆排序。请求页在打开时按需加载完整列表。 |
| S03 | 快照返回后保持 `syncing`，Watch 响应头建立后才发布 `synced`/`stale`；建流阶段有独立 15 秒（或 connect_timeout，取较大值）超时并响应取消。 |
| S04 | 快照整轮预算 55 秒；每页 RPC 超时取“剩余预算与 rpc_timeout 的较小值”，返回后再次检查截止时间；只重试可重试错误，最后一次失败不 sleep，重试等待可取消。 |
| S05 | 见更新门禁表。 |
| S06 | ACL 加固移入请求恢复后台线程；`icacls` 子进程 8 秒超时并终止，不再无限占住启动流程。 |

## 5. 验证

```powershell
pnpm -r typecheck
pnpm test
$env:TEMP = "$PWD\test-artifacts\tmp"; $env:TMP = $env:TEMP
$env:CARGO_PROFILE_DEV_DEBUG = "0"
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

- TypeScript：contracts、release、updater、desktop 全部通过。
- TypeScript 测试：47 项通过（contracts 8、release 2、updater 18、desktop 19）。
- Rust：18 项通过，1 项真实只读快照探针保持 `#[ignore]`。
- 新增针对性用例：旧 generation 状态/快照、迟到订单查询不回退、乱序事件不覆盖视图、admission 不被 NOT_FOUND 覆盖、损坏记录可见、非回环 HTTP 注册、发布前大小/摘要/签名版本校验、策略缓存绑定来源/通道、release 构建门禁关闭。

未在本轮执行：真实报单/撤单、真实 NSIS 双版本升级、生产签名密钥轮换、目标机器冷启动性能复测。这些仍按评审第 4 节在授权测试环境验收。
