# OrderHub Update Service v0.1.2

独立部署包，用于 OrderHub Desktop 的更新检查、通道策略、灰度、最低版本、暂停/撤回、
发布元数据和安装包下载。

## 包内容

```text
OrderHub-Updater-0.1.2.zip
  dist/server.js         自包含 Hono + SQLite 服务（无需 node_modules）
  migrations/001_init.sql
  .env.example
  start.ps1
  README.md
```

要求 Node.js 22.13+（实测 Node 24）。无需安装工作区依赖。

## 启动

```powershell
Expand-Archive OrderHub-Updater-0.1.2.zip -DestinationPath D:\OrderHub\updater
cd D:\OrderHub\updater
Copy-Item .env.example .env
notepad .env
.\start.ps1
```

至少设置：

```text
ORDERHUB_UPDATER_HOST=0.0.0.0
ORDERHUB_UPDATER_PORT=8787
ORDERHUB_UPDATER_PUBLIC_BASE_URL=http://8.159.158.144:8787/artifacts
ORDERHUB_UPDATER_ADMIN_TOKEN=<long-random-token>
ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL=1
```

健康检查：

```powershell
Invoke-WebRequest http://8.159.158.144:8787/healthz
Invoke-WebRequest http://8.159.158.144:8787/readyz
```

## 校验

`SHA256SUMS-updater-0.1.2.txt` 随 Release 提供。部署包内 `server.js` 已用独立目录
（无 `node_modules`）启动验证 `/healthz` 和 `/readyz` 均返回 200。

## 安全

HTTP 仅限受信内网；管理 API 只开放给发布机/VPN，防火墙只放行客户端网段到 8787。
业务 Bearer Token 不会进入更新服务。生产环境建议恢复 HTTPS。

桌面客户端 0.1.2 的内网 HTTP 客户端支持见
[v0.1.2 发布说明](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/v0.1.2)。
