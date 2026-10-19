# @orderhub/release

发布工具：把已构建的 NSIS 安装包放入不可变目录、计算 SHA-256、读取 Tauri `.sig`，调用
Hono 管理 API 注册/发布版本和更新通道策略。

## 命令

```powershell
$env:ORDERHUB_UPDATER_API_BASE = "http://127.0.0.1:8787"
$env:ORDERHUB_UPDATER_ADMIN_TOKEN = "<admin token>"

# 1. staging：复制到 <version>/windows-x86_64/，拒绝覆盖不同字节
pnpm release stage `
  --file "apps/desktop/src-tauri/target/release/bundle/nsis/OrderHub Desktop_0.2.0_x64-setup.exe" `
  --version 0.2.0 --channel beta `
  --artifact-root "test-artifacts/artifacts" `
  --public-base-url "http://127.0.0.1:8787/artifacts" `
  --out "test-artifacts/manifest-0.2.0.json"

# 2. 注册 draft
pnpm release register --manifest test-artifacts/manifest-0.2.0.json

# 3. 发布（revision 来自注册响应）
pnpm release publish rel_... --revision 0

# 4. 通道策略（乐观并发）
pnpm release policy --channel beta --revision 0 `
  --rollout-release rel_... --rollout-percent 10 `
  --min-version 0.1.0 --min-effective-at 2026-10-20T00:00:00Z `
  --valid-for-seconds 86400

# 5. 模拟客户端检查
pnpm release check --channel beta --version 0.1.0
```

其它：

```powershell
pnpm release pause rel_... --revision 1
pnpm release revoke rel_... --revision 2
pnpm release register --file ... --url https://... --version ... --channel ... --publish
```

`--token` 不提供，管理 Token 只从环境变量读取，避免出现在进程列表。`stage` 会拒绝覆盖同
路径不同字节，保证已发布安装包不可变。

## 签名

发布包必须先用 Tauri updater 私钥签名：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content D:\secure\orderhub-prod.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
pnpm --filter @orderhub/desktop tauri build `
  --config src-tauri/tauri.update.conf.json
```

`stage` 默认读取 `<installer>.sig`，也可通过 `--signature` 指定。`signature` 必须是完整
`.sig` 文本，不是 URL。

## 测试

```powershell
pnpm --filter @orderhub/release typecheck
pnpm --filter @orderhub/release test
pnpm --filter @orderhub/updater test   # 包含 release → service 端到端
```
