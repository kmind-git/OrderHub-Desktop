# @orderhub/contracts

共享契约包，供桌面 WebView、Tauri Rust DTO 对齐、更新服务和发布 CLI 使用。

## 内容

| 文件 | 内容 |
| --- | --- |
| `src/ipc.ts` | React ↔ Tauri 的类型化 DTO；所有 64 位游标、时间、价格、数量、字节数为字符串 |
| `src/update-api.ts` | 更新 HTTP API 的 Zod schema、枚举、路径常量；snake_case wire format |
| `src/generate-openapi.ts` | 从 Zod schema 生成 OpenAPI 3.0 文档 |
| `openapi/updater.v1.json` | 生成的 OpenAPI 文档（`pnpm openapi`） |
| `test/contracts.test.ts` | schema 验证、admin 输入 strict、Tauri 响应格式 |

## IPC 规则

1. 字段名 camelCase；Rust 使用 `#[serde(rename_all = "camelCase")]`。
2. 64 位值保持字符串，前端比较用 BigInt，禁止 `Number` 参与金额/价格/数量计算。
3. `resume_token` / `page_token` 不跨 IPC；原生层持有检查点。
4. WebView 永远拿不到 Bearer Token、Authorization header 或安装器路径。
5. 事件类型、订单状态、reason 作为可扩展字符串；未知事件触发保守展示与重同步。

## 更新 API 规则

- `GET /v1/update-policy/...` 返回 revision、最低版本、有效期、选中 release。
- `GET /v1/updates/...` 返回严格符合 Tauri updater 的
  `{version,pub_date,url,signature,notes}`；无更新 204。
- `GET /v1/releases/{id}/eligibility` 安装前复核；暂停/撤回 410，revision 变化 409。
- 管理 API 使用 Bearer Token；`expected_revision` 实现乐观并发。
- `signature` 是 `.sig` 文件完整内容，不是 URL。
- 错误响应 `{code,message,correlation_id,details?}`；不能用错误伪装成“没有更新”。

## 命令

```powershell
pnpm --filter @orderhub/contracts test
pnpm --filter @orderhub/contracts typecheck
pnpm --filter @orderhub/contracts openapi
```

Rust DTO 与 `ipc.ts` 手工同步；任何字段改动都必须同时更新
`apps/desktop/src-tauri/src/dto.rs`，并运行 Rust/前端测试。更新 HTTP schema 由服务端与
发布 CLI 共同引用，避免两侧漂移。
