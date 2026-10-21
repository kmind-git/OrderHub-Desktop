# 从 v0.1.2 升级到 v0.1.3

这里有两个独立对象，不要混淆：

- **桌面客户端**：`v0.1.2` → `v0.1.3`
- **更新服务**：部署包 `updater-v0.1.3`（服务端，不是桌面版本）

客户端自动升级的前提是：更新服务已经登记并发布桌面 `0.1.3`，且 beta 策略选中它。

## 1. 先升级更新服务（如果仍是旧代码）

按 [`install-centos-stream-orderhub-updater.md`](install-centos-stream-orderhub-updater.md)
第 7 节操作。核心是只替换 `/home/orderhub-updater/app`，保留：

```text
/home/orderhub-updater/config/orderhub-updater.env
/home/orderhub-updater/data/
```

并在环境文件中补齐：

```text
ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=1
ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=RWRtAgrMQPWrFtbBoKP7cyFHWFGbcWblw9XI6gsbRDZ5W37wqu/CeQw6
```

然后：

```bash
sudo systemctl restart orderhub-updater
curl -fsS http://127.0.0.1:8787/readyz
```

如果暂时不升级服务端，旧的更新服务仍可登记和分发安装包，但不会执行新的发布前完整性校验。

## 2. 登记并发布桌面 0.1.3

在仓库根目录执行，`ORDERHUB_UPDATER_ADMIN_TOKEN` 使用服务端环境文件中的同一个值：

```powershell
$env:ORDERHUB_UPDATER_API_BASE = "http://8.159.158.144:8787"
$env:ORDERHUB_UPDATER_ADMIN_TOKEN = "<admin-token>"

pnpm release register --manifest release-assets/v0.1.3/release-manifest.json
```

输出中记录 `release_id` 和 `revision`（新登记通常为 `0`）：

```powershell
pnpm release publish rel_xxxxxxxx --revision 0
```

查看当前 beta 策略 revision：

```powershell
pnpm release check --channel beta --version 0.1.2
```

把该 revision 用于更新策略。下面假设当前 revision 为 `0`：

```powershell
pnpm release policy --channel beta --revision 0 `
  --rollout-release rel_xxxxxxxx `
  --rollout-percent 100 `
  --valid-for-seconds 86400
```

不要急着把 `--min-version` 设为 `0.1.3`。在全部客户端完成升级前，最低版本应保持为空或
`0.1.2`，否则旧客户端会被立即禁止新增报单。

验证服务已经选中 0.1.3：

```powershell
pnpm release check --channel beta --version 0.1.2
```

应看到 `update_available: true`、`selected_release.version = "0.1.3"`。

## 3. 客户端自动升级

已安装的 0.1.2 客户端使用现有 `config/client.toml`：

```toml
[update]
base_url = "http://8.159.158.144:8787"
channel = "beta"
auto_check = true
auto_download = false
enforce_min_version = false
allow_insecure_http = true
```

操作：

1. 打开客户端，进入“更新”页，点击“检查更新”；
2. 发现 0.1.3 后下载，Tauri 使用内置 updater 公钥验签；
3. 点击安装，安装器退出应用并安装，随后自动重启；
4. 重启后“关于/诊断”应显示 `0.1.3`，配置和请求记录保留。

如果 `auto_download = true`，检查到更新后会直接下载，但仍需用户确认安装。

## 4. 无法自动升级时

直接安装 GitHub 上的 0.1.3：

[OrderHub-Desktop_0.1.3_x64-setup.exe](https://github.com/kmind-git/OrderHub-Desktop/releases/download/v0.1.3/OrderHub-Desktop_0.1.3_x64-setup.exe)

SHA-256：

```text
3a05fe398a6b0c23242dfe7e8e93b90659582b19b284b7dcd2a3552d145b6f23
```

人工安装会覆盖程序文件，通常保留 `%LOCALAPPDATA%\com.orderhub.desktop` 下的请求记录和
WebView2 数据；升级前仍建议备份该目录。

## 5. 失败排查

- 客户端仍显示无更新：检查 policy revision、`rollout_percent`、客户端 channel 是否为 `beta`；
- 下载 404：确认 GitHub Release `v0.1.3` 的安装包已上传，manifest 中的 URL 可访问；
- 下载后验签失败：确认服务端登记的是配套 `.sig`，且客户端 `tauri.conf.json` 的 updater
  `pubkey` 与服务端登记/签名密钥一致；
- 安装后仍显示 0.1.2：确认安装器实际安装到了客户端正在运行的目录；
- 服务端 `publish` 返回 `SIGNING_KEY_NOT_CONFIGURED`：补齐
  `ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY` 后重试。
