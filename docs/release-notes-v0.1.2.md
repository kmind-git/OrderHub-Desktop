# OrderHub Desktop v0.1.2 — 内网 HTTP 更新服务支持

发布日期：2026-10-20。状态：内部试装 / 预发布，不是生产版本。

## 变更

- 新增 `[update].allow_insecure_http = true`：允许更新服务使用纯 HTTP；
- Tauri updater 开启 `dangerousInsecureTransportProtocol`，HTTP 的更新检查和安装包下载可工作；
- 更新服务支持显式 `ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL=1`，用于非回环 IP 的
  HTTP artifact 根地址；
- 默认仍要求 HTTPS。只有显式开启才允许 HTTP，避免误把生产配置降级为明文。

## 本机配置

```toml
[update]
base_url = "http://8.159.158.144:8787"
channel = "beta"
auto_check = true
auto_download = false
enforce_min_version = false
allow_insecure_http = true
allow_insecure_loopback = false
check_interval_secs = 3600
```

客户端 `base_url` 是更新服务 API 根地址，不带 `/v1`。`8787` 是默认端口；如果实际服务
使用其他端口，只改这一行。

更新服务端对应配置示例：

```powershell
$env:ORDERHUB_UPDATER_HOST = '0.0.0.0'
$env:ORDERHUB_UPDATER_PORT = '8787'
$env:ORDERHUB_UPDATER_DB = 'D:\OrderHub\updater.sqlite3'
$env:ORDERHUB_UPDATER_ARTIFACT_DIR = 'D:\OrderHub\artifacts'
$env:ORDERHUB_UPDATER_PUBLIC_BASE_URL = 'http://8.159.158.144:8787/artifacts'
$env:ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL = '1'
$env:ORDERHUB_UPDATER_ADMIN_TOKEN = '<admin-token>'
node services/updater/dist/server.js
```

## 更新服务部署包

更新服务是独立 Node 进程，不属于桌面安装包。部署包在单独 Release：

[OrderHub Update Service v0.1.2](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/updater-v0.1.2)

下载 `OrderHub-Updater-0.1.2.zip`，按包内 README 启动。

## 安全边界

HTTP 会明文传输安装包、签名、版本信息和 `X-Installation-ID`，不传输业务 Bearer Token。
仅允许在受信内网、防火墙限制来源地址的环境使用；不要在公网或不可信网络开启。

## 校验

```text
be7b343a64ce1ad15f792e21df63ced5fe0969a76c68d01c11c7d64e3412c204  OrderHub-Desktop_0.1.2_x64-setup.exe
```

安装包同时带 `.sig`、`SHA256SUMS.txt` 和 `release-manifest.json`。仍使用测试 updater
签名密钥，未做 Authenticode 签名。
