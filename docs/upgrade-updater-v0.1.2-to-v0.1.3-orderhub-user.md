# 更新服务升级：v0.1.2 → updater-v0.1.3

适用部署：

```text
/home/orderhub-updater/
  app/                        当前 updater v0.1.2 程序
  config/orderhub-updater.env 现有环境配置
  data/                       SQLite 和安装包
```

执行账号：`orderhub-updater`。本文的文件操作全部使用该用户，不使用 root，不使用 `sudo`
复制、解压、改权限或删除文件。

> 重启服务是唯一可能需要额外权限的动作。先按第 1.4 节探测现有服务由谁管理；如果既没有
> `orderhub-updater` 的用户级 systemd unit，也没有管理员预先授予的免密重启权限，**停止升级并
> 报告**，不要用 root 或 `pkill -f node` 绕过。

Agent 执行时必须遵守：

1. 以下任一项失败立即停止，不继续覆盖：用户不是 `orderhub-updater`、`CONFIG` 不存在、
   `APP`/`DATA` 不可写、压缩包 SHA-256 不匹配、`MODE=unknown`、备份失败。
2. 不删除、不移动 `data/`；不修改 `ORDERHUB_UPDATER_DB`、`ORDERHUB_UPDATER_ARTIFACT_DIR`、
   `ORDERHUB_UPDATER_PORT`、`ORDERHUB_UPDATER_ADMIN_TOKEN`。
3. 不在输出、日志或聊天中打印 admin token。
4. 升级后健康检查失败时按第 9 节回滚，不要试图“再覆盖一次”掩盖问题。

## 1. 升级前检查

### 1.1 当前账号和目录

```bash
id
echo "$HOME"
test "$(id -un)" = "orderhub-updater" && echo "user ok"

BASE=/home/orderhub-updater
APP="$BASE/app"
CONFIG="$BASE/config/orderhub-updater.env"
DATA="$BASE/data"

test -f "$APP/dist/server.js" && echo "app ok"
test -f "$CONFIG" && echo "config ok"
test -d "$DATA" && echo "data ok"
test -w "$APP" && test -w "$BASE/config" && test -w "$DATA" && echo "writable ok"
```

任一项失败就停止，不要继续覆盖文件。

### 1.2 Node.js 和端口

```bash
command -v node
node --version
node -e "const {DatabaseSync}=require('node:sqlite'); console.log('node:sqlite ok')"

ss -lntp | grep ':8787' || echo "8787 not listening"
```

要求 Node.js 22.13+，且 `node:sqlite ok`。记录 `command -v node` 的绝对路径。

### 1.3 磁盘空间

```bash
df -h "$BASE"
```

至少保留当前 `app/` 和数据库大小的两倍空间。

### 1.4 先确认服务如何启动

```bash
MODE=unknown

if systemctl --user cat orderhub-updater.service >/dev/null 2>&1; then
  MODE=user
elif systemctl cat orderhub-updater.service >/dev/null 2>&1; then
  MODE=system
elif pgrep -u "$(id -u)" -f 'dist/server.js' >/dev/null 2>&1; then
  MODE=manual
fi

echo "MODE=$MODE"
[ "$MODE" = "manual" ] && pgrep -u "$(id -u)" -af 'dist/server.js'
```

按 `MODE` 选择重启方式：

| 结果 | 重启方式 |
| --- | --- |
| `MODE=user` | `systemctl --user restart orderhub-updater` |
| `MODE=system` 且管理员已授权该用户免密重启 | 仅 `sudo -n systemctl restart orderhub-updater` 这一条使用 sudo |
| `MODE=manual` | 第 3.3 节和 7.3 节的 kill/启动方式 |
| `MODE=unknown` | **停止升级，报告给有权限的人** |

检查免密 sudo 时不要触发密码提示：

```bash
sudo -n true 2>/dev/null && echo "passwordless sudo ok" || echo "no passwordless sudo"
```

`sudo -n true` 成功不代表有权重启 unit；最终以实际 restart 命令是否成功为准。没有授权就不要
执行 sudo。

如果 `systemctl --user` 报 “Failed to connect to bus”，先确认当前会话有用户级 systemd：

```bash
echo "${XDG_RUNTIME_DIR:-}"
systemctl --user is-system-running || true
```

没有用户级 bus 时不要强行设置环境变量或 `loginctl enable-linger`（可能需要 root）；按
`MODE=unknown` 停止并报告。

### 1.5 记录当前状态

```bash
date -Is | tee "$BASE/upgrade-start.txt"
sha256sum "$APP/dist/server.js" | tee -a "$BASE/upgrade-start.txt"
curl -fsS http://127.0.0.1:8787/healthz | tee -a "$BASE/upgrade-start.txt"
curl -fsS http://127.0.0.1:8787/readyz | tee -a "$BASE/upgrade-start.txt"
```

## 2. 获取并校验新包

目标文件：

```text
/home/orderhub-updater/OrderHub-Updater-0.1.3-centos-stream.tar.gz
```

如果服务器可以访问 GitHub：

```bash
cd "$BASE"
curl -fL --retry 3 -o OrderHub-Updater-0.1.3-centos-stream.tar.gz \
  https://github.com/kmind-git/OrderHub-Desktop/releases/download/updater-v0.1.3/OrderHub-Updater-0.1.3-centos-stream.tar.gz
```

如果服务器不能访问 GitHub，由本机下载后上传到 `orderhub-updater` 家目录：

```powershell
scp release-assets/OrderHub-Updater-0.1.3-centos-stream.tar.gz `
  orderhub-updater@8.159.158.144:/home/orderhub-updater/
```

校验：

```bash
cd "$BASE"
sha256sum OrderHub-Updater-0.1.3-centos-stream.tar.gz
```

必须是：

```text
716c863e03db99a466cc11e7393d3925086f5fa6777e675dc49f91e87a75cb93
```

不一致就停止，不要解压。

## 3. 停止服务

按第 1.4 节确定的 `MODE` 执行，只选一种。

### 3.1 用户级 systemd

```bash
systemctl --user stop orderhub-updater
systemctl --user is-active orderhub-updater || true
```

### 3.2 系统级 systemd（仅限已授权免密 sudo）

```bash
sudo -n systemctl stop orderhub-updater
systemctl is-active orderhub-updater || true
```

没有免密授权时不要执行这一节。

### 3.3 手工启动的进程

```bash
PID=$(pgrep -u "$(id -u)" -f 'dist/server.js' | head -n1)
test -n "$PID" && echo "PID=$PID"
kill -TERM "$PID"

for i in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
kill -0 "$PID" 2>/dev/null && echo "still running; stop and report" || echo "stopped"
```

确认 8787 已释放：

```bash
ss -lntp | grep ':8787' || echo "8787 free"
```

## 4. 备份

只备份程序、配置和数据库；`data/artifacts` 是不可变安装包，不需要整目录复制。

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$BASE/backup-$STAMP"
mkdir -p "$BACKUP"

cp -a "$APP" "$BACKUP/app"
cp -a "$CONFIG" "$BACKUP/orderhub-updater.env"
cp -a "$DATA/updater.sqlite3" "$BACKUP/updater.sqlite3"
[ -f "$DATA/updater.sqlite3-wal" ] && cp -a "$DATA/updater.sqlite3-wal" "$BACKUP/"
[ -f "$DATA/updater.sqlite3-shm" ] && cp -a "$DATA/updater.sqlite3-shm" "$BACKUP/"

echo "$BACKUP" > "$BASE/last-upgrade-backup.txt"
ls -l "$BACKUP"
```

如果数据库路径不是 `$DATA/updater.sqlite3`，以 `$CONFIG` 里的
`ORDERHUB_UPDATER_DB` 为准，不要猜。

## 5. 解压新程序

```bash
cd "$BASE"
tar -xzf OrderHub-Updater-0.1.3-centos-stream.tar.gz -C "$APP"
chmod 0755 "$APP/start.sh"
ls -l "$APP/dist/server.js"
```

新包只覆盖 `dist/`、`migrations/`、`.env.example`、`README.md` 和 `start.sh`，不会覆盖
`config/` 和 `data/`。确认：

```bash
test -f "$APP/dist/server.js"
test -f "$CONFIG"
test -f "$DATA/updater.sqlite3"
```

## 6. 修改现有配置

只追加/替换两个键，保留数据库路径、安装包路径、端口、admin token 和其他现有配置。

```bash
grep -q '^ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=' "$CONFIG" \
  && sed -i 's|^ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=.*|ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=1|' "$CONFIG" \
  || echo 'ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=1' >> "$CONFIG"

grep -q '^ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=' "$CONFIG" \
  && sed -i 's|^ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=.*|ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=RWRtAgrMQPWrFtbBoKP7cyFHWFGbcWblw9XI6gsbRDZ5W37wqu/CeQw6|' "$CONFIG" \
  || echo 'ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=RWRtAgrMQPWrFtbBoKP7cyFHWFGbcWblw9XI6gsbRDZ5W37wqu/CeQw6' >> "$CONFIG"
```

检查不重复、值正确：

```bash
grep -nE '^ORDERHUB_UPDATER_(VERIFY_ARTIFACT_URL|SIGNING_PUBLIC_KEY)=' "$CONFIG"
```

`SIGNING_PUBLIC_KEY` 必须与客户端 `tauri.conf.json` 的 updater `pubkey` 配对；当前内部测试
密钥就是上面这行。

## 7. 重启服务

### 7.1 用户级 systemd

```bash
systemctl --user restart orderhub-updater
systemctl --user status orderhub-updater --no-pager
```

### 7.2 系统级 systemd（仅限已授权免密 sudo）

```bash
sudo -n systemctl restart orderhub-updater
systemctl status orderhub-updater --no-pager
```

### 7.3 手工启动

```bash
set -a
. "$CONFIG"
set +a

mkdir -p "$BASE/logs"
cd "$APP"
nohup "$(command -v node)" dist/server.js >> "$BASE/logs/updater.log" 2>&1 &
echo $! > "$BASE/updater.pid"
sleep 2
kill -0 "$(cat "$BASE/updater.pid")" && echo "started"
```

不要用 `start.sh`：它检查的是 `app/.env`，而当前配置在 `config/orderhub-updater.env`。

## 8. 验证

等待最多 30 秒：

```bash
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8787/healthz && break
  sleep 1
done

curl -fsS http://127.0.0.1:8787/readyz
```

预期 `/readyz` 包含：

```json
{"status":"ready","database":true,"artifact_store":true}
```

确认新代码已加载：

```bash
grep -aq 'SIGNING_KEY_NOT_CONFIGURED' "$APP/dist/server.js" && echo "new server code ok"
```

从客户端机器验证：

```bash
curl -fsS http://8.159.158.144:8787/readyz
```

检查日志：

```bash
# 用户级
journalctl --user -u orderhub-updater -n 50 --no-pager

# 系统级
journalctl -u orderhub-updater -n 50 --no-pager

# 手工启动
tail -n 50 "$BASE/logs/updater.log"
```

还要确认现有策略仍可读取（用任意合法 UUID）：

```bash
curl -fsS \
  -H "X-Installation-ID: 6f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c" \
  "http://127.0.0.1:8787/v1/update-policy/beta/windows/x86_64/0.1.2?installer=nsis"
```

返回 HTTP 200 即服务正常；返回内容里的策略状态在升级服务代码时不会改变。

## 9. 回滚

验证失败时按原重启方式停止，然后恢复：

```bash
BASE=/home/orderhub-updater
APP="$BASE/app"
CONFIG="$BASE/config/orderhub-updater.env"
DATA="$BASE/data"
BACKUP=$(cat "$BASE/last-upgrade-backup.txt")

test "$APP" = "/home/orderhub-updater/app"
test -d "$BACKUP/app"
test -f "$BACKUP/orderhub-updater.env"

rm -rf "$APP"
cp -a "$BACKUP/app" "$APP"
cp -a "$BACKUP/orderhub-updater.env" "$CONFIG"

# 只有确认数据库被新代码改坏时才恢复；正常情况下不要覆盖 data。
# cp -a "$BACKUP/updater.sqlite3" "$DATA/updater.sqlite3"
# [ -f "$BACKUP/updater.sqlite3-wal" ] && cp -a "$BACKUP/updater.sqlite3-wal" "$DATA/"
```

再按第 7 节原方式启动，重复第 8 节健康检查。

## 10. 升级完成后的边界

这次只升级更新服务程序，不会自动发布桌面 0.1.3。要让 v0.1.2 客户端自动升级，还需要：

1. 用发布 CLI 登记 `release-assets/v0.1.3/release-manifest.json`；
2. 发布该 release；
3. 将 beta 策略指向该 release；
4. 客户端执行“检查更新”。

发布步骤见 [`upgrade-v0.1.2-to-v0.1.3.md`](upgrade-v0.1.2-to-v0.1.3.md)。发布时需要
`ORDERHUB_UPDATER_ADMIN_TOKEN`，该值在 `$CONFIG` 中；不要把它打印到日志或聊天记录。
