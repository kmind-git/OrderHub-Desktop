# OrderHub Update Service — CentOS Stream 安装步骤

适用于以下环境：

- CentOS Stream 9/10 x86_64
- 已创建系统用户 `orderhub-updater`
- 用户家目录：`/home/orderhub-updater`
- 已把 `OrderHub-Updater-0.1.3-centos-stream.tar.gz` 上传到该家目录
- 业务服务 IP：`8.159.158.144`
- 更新服务端口：`8787`

以下命令默认使用具有 `sudo` 权限的账号执行。**不要**用 `orderhub-updater` 用户直接解压到 `/opt`，安装目录由 root 管理，运行进程使用 `orderhub-updater` 用户。

## 0. 变量

先设置变量，后续命令直接复用：

```bash
ARCHIVE=/home/orderhub-updater/OrderHub-Updater-0.1.3-centos-stream.tar.gz
APP_DIR=/opt/orderhub-updater
DATA_DIR=/var/lib/orderhub-updater
SERVICE_USER=orderhub-updater
SERVICE_NAME=orderhub-updater
PUBLIC_IP=8.159.158.144
PUBLIC_PORT=8787
```

确认文件和用户：

```bash
ls -l "$ARCHIVE"
id "$SERVICE_USER"
getent passwd "$SERVICE_USER"
```

预期 `getent` 显示家目录为 `/home/orderhub-updater`。

## 1. 安装 Node.js 22

CentOS Stream 默认 Node.js 版本通常低于 22.13，而服务使用 `node:sqlite`，必须 **Node.js 22.13+**。

```bash
sudo dnf install -y curl ca-certificates tar
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
```

检查版本和 `node:sqlite`：

```bash
node --version
node -e "const {DatabaseSync}=require('node:sqlite'); console.log('node:sqlite ok')"
```

`node --version` 必须是 `v22.13.0` 或更高。若低于 22.13，先升级 Node 再继续。

## 2. 校验压缩包

```bash
cd /home/orderhub-updater
sha256sum OrderHub-Updater-0.1.3-centos-stream.tar.gz
```

应为：

```text
dd5be2a2b3639bea965c208ef41804491b982bf758b556568dfeadc01eb97eaf
```

不一致时停止，不要解压。

## 3. 创建安装目录和数据目录

```bash
sudo install -d -m 0755 -o root -g root "$APP_DIR"
sudo install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
```

目录职责：

- `/opt/orderhub-updater`：程序文件，root 所有，服务用户只读；
- `/var/lib/orderhub-updater`：SQLite、安装包、运行数据，服务用户可写。

## 4. 解压安装

```bash
sudo tar -xzf "$ARCHIVE" -C "$APP_DIR"
sudo chown -R root:root "$APP_DIR"
sudo chmod 0755 "$APP_DIR/start.sh"
```

确认文件：

```bash
ls -l "$APP_DIR"
ls -l "$APP_DIR/dist/server.js" "$APP_DIR/migrations/001_init.sql"
```

应能看到：

```text
dist/server.js
migrations/001_init.sql
.env.example
start.sh
orderhub-updater.service
README.md
```

## 5. 配置环境变量

复制模板：

```bash
sudo cp "$APP_DIR/.env.example" /etc/orderhub-updater.env
sudo chown root:root /etc/orderhub-updater.env
sudo chmod 0600 /etc/orderhub-updater.env
```

生成管理令牌：

```bash
openssl rand -hex 32
```

编辑配置：

```bash
sudo vi /etc/orderhub-updater.env
```

至少确认以下值：

```text
ORDERHUB_UPDATER_HOST=0.0.0.0
ORDERHUB_UPDATER_PORT=8787
ORDERHUB_UPDATER_DB=/var/lib/orderhub-updater/updater.sqlite3
ORDERHUB_UPDATER_ARTIFACT_DIR=/var/lib/orderhub-updater/artifacts
ORDERHUB_UPDATER_PUBLIC_BASE_URL=http://8.159.158.144:8787/artifacts
ORDERHUB_UPDATER_ADMIN_TOKEN=<上一步生成的随机值>
ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL=1
ORDERHUB_UPDATER_SERVE_ARTIFACTS=1
```

说明：

- `PUBLIC_BASE_URL` 是客户端下载安装包的地址，必须能在客户端访问；
- `ORDERHUB_UPDATER_ADMIN_TOKEN` 不要复用业务 Token，也不要提交到 Git；
- `ALLOW_INSECURE_ARTIFACT_URL=1` 是纯 HTTP 的显式开关，只用于受信内网；
- 如果实际端口不是 8787，同时修改 `PORT`、`PUBLIC_BASE_URL` 和客户端配置。

## 6. 安装 systemd 服务

复制 unit：

```bash
sudo cp "$APP_DIR/orderhub-updater.service" /etc/systemd/system/orderhub-updater.service
```

把 unit 中的运行用户从模板的 `orderhub` 改成你的 `orderhub-updater`：

```bash
sudo sed -i \
  -e 's/^User=orderhub$/User=orderhub-updater/' \
  -e 's/^Group=orderhub$/Group=orderhub-updater/' \
  /etc/systemd/system/orderhub-updater.service

grep -E '^(User|Group|EnvironmentFile|ExecStart|ReadWritePaths)=' \
  /etc/systemd/system/orderhub-updater.service
```

预期包含：

```text
EnvironmentFile=/etc/orderhub-updater.env
ExecStart=/usr/bin/node /opt/orderhub-updater/dist/server.js
ReadWritePaths=/var/lib/orderhub-updater
User=orderhub-updater
Group=orderhub-updater
```

启用并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now orderhub-updater
sudo systemctl status orderhub-updater --no-pager
```

查看日志：

```bash
sudo journalctl -u orderhub-updater -n 50 --no-pager
```

## 7. 防火墙

如果 `firewalld` 正在运行：

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-port=8787/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

建议只允许客户端网段访问 8787，而不是对全网开放。例如把来源限制为实际客户端网段：

```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="8787" protocol="tcp" accept'
sudo firewall-cmd --reload
```

请按实际客户端网段替换 `192.168.1.0/24`；如果同时加了 `--add-port=8787/tcp`，需要删除该全开放规则，避免绕过来源限制。

## 8. SELinux（如果启用）

```bash
getenforce
```

如果是 `Enforcing`，先检查是否有拒绝：

```bash
sudo ausearch -m avc -ts recent
```

如有文件上下文问题：

```bash
sudo restorecon -Rv /opt/orderhub-updater /var/lib/orderhub-updater
sudo systemctl restart orderhub-updater
```

不要直接关闭 SELinux；先根据 audit 日志处理。若确认是端口标签问题，再使用 `semanage` 调整并记录变更。

## 9. 验证服务

本机：

```bash
ss -lntp | grep 8787
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/readyz
```

预期 `/readyz` 返回包含：

```json
{"status":"ready","database":true,"artifact_store":true}
```

从客户端机器或同网段另一台机器：

```bash
curl -fsS http://8.159.158.144:8787/readyz
```

如果本机成功、远端失败：

- `ss` 显示只监听 `127.0.0.1`：检查 `ORDERHUB_UPDATER_HOST=0.0.0.0`；
- 连接超时：检查 firewalld/云安全组/网络 ACL；
- 连接被拒绝：检查 `systemctl status` 和 `journalctl`；
- SELinux 拒绝：检查 `ausearch`。

## 10. 客户端配置对应关系

客户端 `client.toml` 应配置为：

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

注意：

- 客户端 `base_url` 是**API 根地址**，不要加 `/v1` 或 `/artifacts`；
- 服务端 `PUBLIC_BASE_URL` 才带 `/artifacts`；
- 改完客户端配置后必须完全退出并重启客户端。

## 11. 发布第一个可用更新

服务启动后还需要一个比客户端更高的版本。例如客户端是 `0.1.2`，需要构建 `0.1.3` 安装包，然后在发布机上执行：

```bash
export ORDERHUB_UPDATER_API_BASE=http://8.159.158.144:8787
export ORDERHUB_UPDATER_ADMIN_TOKEN='<上一步的令牌>'

pnpm release stage \
  --file "/path/OrderHub Desktop_0.1.3_x64-setup.exe" \
  --artifact-root /var/lib/orderhub-updater/artifacts \
  --public-base-url http://8.159.158.144:8787/artifacts \
  --version 0.1.3 --channel beta \
  --out /root/manifest-0.1.3.json

pnpm release register --manifest /root/manifest-0.1.3.json
pnpm release publish <release_id> --revision 0
pnpm release policy --channel beta --revision 0 \
  --rollout-release <release_id> --rollout-percent 100
```

没有更高版本包和 policy 时，客户端只会显示“已是最新”或没有可用更新。

## 12. 升级更新服务

升级前备份：

```bash
sudo systemctl stop orderhub-updater
sudo cp /etc/orderhub-updater.env /root/orderhub-updater.env.bak
sudo tar -czf /root/orderhub-updater-data-$(date +%F).tar.gz -C /var/lib orderhub-updater
```

解压新包覆盖程序文件，保留 `/etc/orderhub-updater.env` 和 `/var/lib/orderhub-updater`：

```bash
sudo tar -xzf /home/orderhub-updater/OrderHub-Updater-<新版本>-centos-stream.tar.gz -C /opt/orderhub-updater
sudo chown -R root:root /opt/orderhub-updater
sudo systemctl start orderhub-updater
```

不要删除 `/var/lib/orderhub-updater`，否则会丢失 SQLite 数据和已发布安装包。

## 13. 安全提醒

- 当前更新服务使用 HTTP，安装包、签名、策略和 `X-Installation-ID` 会明文传输；
- 只允许受信内网访问 8787，管理 API 只允许发布机/VPN 访问；
- `/etc/orderhub-updater.env` 权限保持 `0600`；
- 不要把管理 Token、SQLite 数据库或业务 Token 放进 Git；
- 未来有 HTTPS 域名时，应关闭客户端 `allow_insecure_http`、Tauri insecure transport 和服务端 insecure artifact 开关。
