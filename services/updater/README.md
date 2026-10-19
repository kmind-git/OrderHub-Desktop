# @orderhub/updater

Hono + SQLite 更新服务。负责版本策略、灰度、最低版本、发布/暂停/撤回、安装前资格复核、
Tauri updater 标准响应和简短更新事件。它不代理交易，不保存业务 Token 或订单数据。

## 运行

```powershell
Copy-Item .env.example .env
# 按需修改 .env 或直接设置环境变量
pnpm --filter @orderhub/updater dev
# 生产
pnpm --filter @orderhub/updater build
$env:ORDERHUB_UPDATER_ADMIN_TOKEN = "..."
node dist/server.js
```

默认 `http://127.0.0.1:8787`。开发时 `ORDERHUB_UPDATER_SERVE_ARTIFACTS=1` 可直接从
`/artifacts/*` 提供测试包；生产建议关闭并由反向代理/文件服务承担下载。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `ORDERHUB_UPDATER_DB` | SQLite 路径；WAL、外键、busy_timeout |
| `ORDERHUB_UPDATER_ARTIFACT_DIR` | 安装包目录 |
| `ORDERHUB_UPDATER_PUBLIC_BASE_URL` | 包下载公共前缀；生产必须 HTTPS |
| `ORDERHUB_UPDATER_ADMIN_TOKEN` | 管理 API Bearer Token；未配置时管理接口 503 |
| `ORDERHUB_UPDATER_APP_ID` | 应用标识，默认 `com.orderhub.desktop` |
| `ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL` | 发布前检查包 URL 可读，默认 1 |
| `ORDERHUB_UPDATER_SERVE_ARTIFACTS` | 是否由 Hono 静态提供 `/artifacts` |
| `ORDERHUB_UPDATER_POLICY_VALID_SECONDS` | 无 policy 或新建 policy 的默认有效期 |
| `ORDERHUB_UPDATER_EVENT_RETENTION_DAYS` | 更新事件留存天数 |
| `ORDERHUB_UPDATER_TRUST_PROXY` | 是否信任 X-Forwarded-For |
| `ORDERHUB_UPDATER_SUPPORT_URL` | 强制更新无候选时的人工安装指引链接 |

## API

见 [`packages/contracts/openapi/updater.v1.json`](../../packages/contracts/openapi/updater.v1.json)。
路由：

- `GET /healthz`, `GET /readyz`
- `GET /v1/update-policy/{channel}/{target}/{arch}/{currentVersion}?installer=nsis`
- `GET /v1/updates/{channel}/{target}/{arch}/{currentVersion}?installer=nsis&release_id=...&policy_revision=N`
- `GET /v1/releases/{releaseId}/eligibility?channel=...&target=...&arch=...&current_version=...&installer=nsis&policy_revision=N`
- `POST /v1/update-events`
- `POST /v1/admin/releases`
- `POST /v1/admin/releases/{id}/publish|pause|revoke`
- `PUT /v1/admin/channels/{channel}/policy`

客户端请求需要 `X-Installation-ID`（UUID）；`X-Installation-Type` 如提供必须与
`installer=nsis` 一致。策略/更新/资格响应 `Cache-Control: no-store`。

## 选择规则

1. 应用、通道、平台、架构、安装类型；
2. 已发布且兼容的 release；
3. 最低版本要求；
4. 灰度资格（稳定哈希 `release_id + installation_id`）；
5. 最高合适 SemVer。

没有在通道策略中 promote 的 release 不会自动下发。灰度目标被排除时，其他已发布兼容版本可
作为兜底。低于最低版本的客户端绕过灰度，但必须存在 ≥ 最低版本的已发布包，否则策略更新被
拒绝，运行期返回 `FORCED_UPDATE_UNAVAILABLE` 并给人工安装指引。

## SQLite

迁移在 `migrations/`，启动时按 `schema_migrations` 顺序应用。表：

- `releases`、`artifacts`、`channel_policies`
- `update_events`（幂等 event_id、留存清理）
- `audit_logs`（管理操作前后摘要）

使用 WAL、外键、`busy_timeout=5000`、短写事务。首轮单实例；不要用共享网络盘让多个进程直接写
同一个 SQLite 文件。备份数据库时同时备份安装包和签名归档。

## 测试

```powershell
pnpm --filter @orderhub/updater typecheck
pnpm --filter @orderhub/updater test
```

测试覆盖：发布/暂停/撤回、revision 并发冲突、stable/beta 隔离、灰度、最低版本、无候选 503、
204/200 更新响应、eligibility 410、事件幂等、发布 CLI 到服务的端到端 staging/publish/policy。
