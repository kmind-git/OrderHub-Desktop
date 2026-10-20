# OrderHub Update Service — CentOS Stream 安装步骤

适用环境：

- CentOS Stream 9/10 x86_64
- 系统用户：`orderhub-updater`
- 家目录：`/home/orderhub-updater`
- 压缩包已上传到该家目录
- Node.js 24 已安装（与本地开发环境一致）
- 业务服务 IP：`8.159.158.144`
- 更新服务端口：`8787`

部署布局：

```text
/home/orderhub-updater/
  OrderHub-Updater-0.1.3-centos-stream.tar.gz
  app/                        程序文件
  config/orderhub-updater.env 环境配置
  data/                       SQLite 和安装包
```

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

### 1.3 用户和家目录

```bash
id orderhub-updater
getent passwd orderhub-updater
```

确认家目录为：

```text
/home/orderhub-updater
```

### 1.4 Node.js 版本

```bash
command -v node
node --version
node -e "const {DatabaseSync}=require('node:sqlite'); console.log('node:sqlite ok')"
```

要求 Node.js 22.13+；已安装 Node.js 24，应输出 `v24.x.x` 和 `node:sqlite ok`。
记录 `command -v node` 的绝对路径，后面 systemd 会使用它。

### 1.5 压缩包和校验值

```bash
ARCHIVE=/home/orderhub-updater/OrderHub-Updater-0.1.3-centos-stream.tar.gz
ls -lh "$ARCHIVE"
sha256sum "$ARCHIVE"
```

SHA-256 应为：

```text
dd5be2a2b3639bea965c208ef41804491b982bf758b556568dfeadc01eb97eaf
```

### 1.6 端口占用

```bash
sudo ss -lntp | grep ':8787' || echo "8787 is free"
```

如果已有进程监听 8787，先停止该进程或改用其他端口。

### 1.7 磁盘空间

```bash
df -h /home
```

## 2. 解压到用户目录

```bash
BASE_DIR=/home/orderhub-updater
APP_DIR="$BASE_DIR/app"
CONFIG_DIR="$BASE_DIR/config"
DATA_DIR="$BASE_DIR/data"
SERVICE_USER=orderhub-updater
NODE_BIN="$(command -v node)"

sudo install -d -m 0755 -o root -g root "$APP_DIR"
sudo install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CONFIG_DIR"
sudo install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"

sudo tar -xzf "$ARCHIVE" -C "$APP_DIR"
sudo chown -R root:root "$APP_DIR"
sudo chmod 0755 "$APP_DIR/start.sh"
```

确认文件：

```bash
ls -l "$APP_DIR"
ls -l "$APP_DIR/dist/server.js" "$APP_DIR/migrations/001_init.sql"
```

## 3. 创建配置文件

```bash
CONFIG_FILE="$CONFIG_DIR/orderhub-updater.env"
sudo cp "$APP_DIR/.env.example" "$CONFIG_FILE"
sudo chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"
sudo chmod 0600 "$CONFIG_FILE"

openssl rand -hex 32
sudo vi "$CONFIG_FILE"
```

至少确认：

```text
ORDERHUB_UPDATER_HOST=0.0.0.0
ORDERHUB_UPDATER_PORT=8787
ORDERHUB_UPDATER_DB=/home/orderhub-updater/data/updater.sqlite3
ORDERHUB_UPDATER_ARTIFACT_DIR=/home/orderhub-updater/data/artifacts
ORDERHUB_UPDATER_PUBLIC_BASE_URL=http://8.159.158.144:8787/artifacts
ORDERHUB_UPDATER_ADMIN_TOKEN=<上一步生成的随机值>
ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL=1
ORDERHUB_UPDATER_SERVE_ARTIFACTS=1
```

模板默认使用 `/var/lib/orderhub-updater`，这里必须改成上面的
`/home/orderhub-updater/data` 路径。

`PUBLIC_BASE_URL` 必须能被客户端访问；如果端口不是 8787，同时修改
`ORDERHUB_UPDATER_PORT`、`PUBLIC_BASE_URL` 和客户端配置。

## 4. 创建 systemd 服务

```bash
sudo tee /etc/systemd/system/orderhub-updater.service >/dev/null <<EOF
[Unit]
Description=OrderHub Desktop Update Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$CONFIG_FILE
ExecStart=$NODE_BIN $APP_DIR/dist/server.js
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
```

检查 unit：

```bash
grep -E '^(User|Group|WorkingDirectory|EnvironmentFile|ExecStart|ReadWritePaths)=' \
  /etc/systemd/system/orderhub-updater.service
```

预期：

```text
User=orderhub-updater
Group=orderhub-updater
WorkingDirectory=/home/orderhub-updater/app
EnvironmentFile=/home/orderhub-updater/config/orderhub-updater.env
ExecStart=/usr/bin/node /home/orderhub-updater/app/dist/server.js
ReadWritePaths=/home/orderhub-updater/data
```

`ExecStart` 的 node 路径以 `command -v node` 的结果为准。

## 5. 启动服务

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now orderhub-updater
sudo systemctl status orderhub-updater --no-pager
```

查看日志：

```bash
sudo journalctl -u orderhub-updater -n 50 --no-pager
```

## 6. 验证

```bash
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

如果本机成功、远端失败，检查 `ORDERHUB_UPDATER_HOST=0.0.0.0` 和 8787 端口是否可达。
