# OrderHub Update Service — CentOS Stream 安装步骤

适用环境：

- CentOS Stream 9/10 x86_64
- 系统用户：`orderhub-updater`
- 家目录：`/home/orderhub-updater`
- 压缩包已上传到该家目录
- 业务服务 IP：`8.159.158.144`
- 更新服务端口：`8787`

以下命令使用具有 `sudo` 权限的账号执行。程序安装到 `/opt/orderhub-updater`，
数据写入 `/var/lib/orderhub-updater`，服务以 `orderhub-updater` 用户运行。

## 1. 环境检查

### 1.1 系统版本和架构

```bash
cat /etc/centos-release
uname -m
```

应为 CentOS Stream 9/10，架构为 `x86_64`。

### 1.2 sudo 权限

```bash
sudo -v
```

没有报错再继续。

### 1.3 用户和家目录

```bash
id orderhub-updater
getent passwd orderhub-updater
```

确认用户存在，并且家目录是：

```text
/home/orderhub-updater
```

### 1.4 压缩包和校验值

```bash
ARCHIVE=/home/orderhub-updater/OrderHub-Updater-0.1.3-centos-stream.tar.gz
ls -lh "$ARCHIVE"
sha256sum "$ARCHIVE"
```

SHA-256 应为：

```text
dd5be2a2b3639bea965c208ef41804491b982bf758b556568dfeadc01eb97eaf
```

不一致时停止，不要继续安装。

### 1.5 端口占用

```bash
sudo ss -lntp | grep ':8787' || echo "8787 is free"
```

如果已有进程监听 8787，先停止该进程或改用其他端口。

### 1.6 磁盘空间

```bash
df -h /opt /var
```

`/opt` 和 `/var` 需要足够空间存放程序、SQLite 数据库和安装包。

### 1.7 Node.js 版本

如果已经安装 Node.js：

```bash
command -v node && node --version || echo "node is not installed"
```

要求 **Node.js 22.13+**。未安装或版本过低时执行第 2 步。

## 2. 安装 Node.js 22

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

`node --version` 必须不低于 `v22.13.0`。

## 3. 创建目录

```bash
APP_DIR=/opt/orderhub-updater
DATA_DIR=/var/lib/orderhub-updater
SERVICE_USER=orderhub-updater

sudo install -d -m 0755 -o root -g root "$APP_DIR"
sudo install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
```

## 4. 解压程序

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

应包含：

```text
dist/server.js
migrations/001_init.sql
.env.example
start.sh
orderhub-updater.service
README.md
```

## 5. 配置环境变量

```bash
sudo cp "$APP_DIR/.env.example" /etc/orderhub-updater.env
sudo chown root:root /etc/orderhub-updater.env
sudo chmod 0600 /etc/orderhub-updater.env

openssl rand -hex 32
sudo vi /etc/orderhub-updater.env
```

生成随机管理令牌后，填入 `ORDERHUB_UPDATER_ADMIN_TOKEN`。至少确认：

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

`PUBLIC_BASE_URL` 必须能被客户端访问；如果实际端口不是 8787，同时修改
`ORDERHUB_UPDATER_PORT`、`PUBLIC_BASE_URL` 和客户端配置。

## 6. 安装 systemd 服务

```bash
sudo cp "$APP_DIR/orderhub-updater.service" /etc/systemd/system/orderhub-updater.service
```

把运行用户改为 `orderhub-updater`：

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

## 7. 防火墙

如果 `firewalld` 正在运行，放行 TCP 8787：

```bash
sudo systemctl enable --now firewalld
sudo firewall-cmd --permanent --add-port=8787/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

## 8. 启动后验证

```bash
sudo journalctl -u orderhub-updater -n 50 --no-pager
sudo ss -lntp | grep ':8787'
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8787/readyz
```

`/readyz` 应返回：

```json
{"status":"ready","database":true,"artifact_store":true}
```

从客户端机器验证：

```bash
curl -fsS http://8.159.158.144:8787/readyz
```

如果本机成功、远端失败，检查 `ORDERHUB_UPDATER_HOST=0.0.0.0` 和防火墙 8787。

## 9. 常用运维命令

```bash
sudo systemctl status orderhub-updater --no-pager
sudo systemctl restart orderhub-updater
sudo journalctl -u orderhub-updater -f
```

更新服务使用纯 HTTP，仅应在受信内网使用，不要暴露到公网。
