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

以下 `BASE`、`APP`、`CONFIG`、`DATA`、`DB_PATH`、`MODE`、`BACKUP` 变量需要在同一个 shell
会话中保留。每开一个新 shell，先重新执行对应变量定义。

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

if systemctl --user is-active --quiet orderhub-updater; then
  MODE=user
elif systemctl is-active --quiet orderhub-updater; then
  MODE=system
elif systemctl --user cat orderhub-updater.service >/dev/null 2>&1; then
  MODE=user
elif systemctl cat orderhub-updater.service >/dev/null 2>&1; then
  MODE=system
elif pgrep -u "$(id -u)" -f 'dist/server.js' >/dev/null 2>&1; then
  MODE=manual
fi

echo "MODE=$MODE"
if [ "$MODE" = "manual" ]; then
  pgrep -u "$(id -u)" -af 'dist/server.js'
fi
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
if systemctl --user is-active --quiet orderhub-updater; then
  echo "still active; stop and report"
  exit 1
fi
```

### 3.2 系统级 systemd（仅限已授权免密 sudo）

```bash
sudo -n systemctl stop orderhub-updater
if systemctl is-active --quiet orderhub-updater; then
  echo "still active; stop and report"
  exit 1
fi
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

先从现有配置读取数据库路径，必须是绝对路径：

```bash
DB_PATH=$(sed -n 's/^ORDERHUB_UPDATER_DB=//p' "$CONFIG" | tail -n1)
echo "DB_PATH=$DB_PATH"
case "$DB_PATH" in
  /*) ;;
  *) echo "ORDERHUB_UPDATER_DB is not absolute; stop and report"; exit 1 ;;
esac
test -f "$DB_PATH" || { echo "database not found; stop and report"; exit 1; }
```

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$BASE/backup-$STAMP"
mkdir -p "$BACKUP"

cp -a "$APP" "$BACKUP/app"
cp -a "$CONFIG" "$BACKUP/orderhub-updater.env"
cp -a "$DB_PATH" "$BACKUP/$(basename "$DB_PATH")"
if [ -f "$DB_PATH-wal" ]; then
  cp -a "$DB_PATH-wal" "$BACKUP/$(basename "$DB_PATH")-wal"
fi
if [ -f "$DB_PATH-shm" ]; then
  cp -a "$DB_PATH-shm" "$BACKUP/$(basename "$DB_PATH")-shm"
fi

echo "$BACKUP" > "$BASE/last-upgrade-backup.txt"
ls -l "$BACKUP"
```

不要改动 `ORDERHUB_UPDATER_DB` 或 `ORDERHUB_UPDATER_ARTIFACT_DIR`。`data/artifacts` 是不可变
安装包，不复制。

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
test -f "$DB_PATH"
```

## 6. 修改现有配置

只追加/替换两个键，保留数据库路径、安装包路径、端口、admin token 和其他现有配置。

```bash
if grep -q '^ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=' "$CONFIG"; then
  sed -i 's|^ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=.*|ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=1|' "$CONFIG"
else
  echo 'ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL=1' >> "$CONFIG"
fi

if grep -q '^ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=' "$CONFIG"; then
  sed -i 's|^ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=.*|ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=RWRtAgrMQPWrFtbBoKP7cyFHWFGbcWblw9XI6gsbRDZ5W37wqu/CeQw6|' "$CONFIG"
else
  echo 'ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY=RWRtAgrMQPWrFtbBoKP7cyFHWFGbcWblw9XI6gsbRDZ5W37wqu/CeQw6' >> "$CONFIG"
fi
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

## 10. 发布桌面 0.1.3（升级服务不会自动完成）

升级服务程序后，数据库里的 release 和 beta 策略不会自动变化。要完成“v0.1.2 客户端自动
发现 0.1.3”，还要做三件事：

1. 登记桌面 0.1.3 的 release；
2. 发布该 release；
3. 把 beta 策略指向它。

下面所有命令都在服务器上以 `orderhub-updater` 用户执行，只需要 `curl` 和 `node`，不要求
仓库、pnpm 或 root。`$BASE`、`$APP`、`$CONFIG`、`$DATA` 沿用前面的定义。

### 10.1 读取 admin token

```bash
CONFIG=/home/orderhub-updater/config/orderhub-updater.env
BASE=/home/orderhub-updater
DATA=/home/orderhub-updater/data
API=http://127.0.0.1:8787

TOKEN=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}ORDERHUB_UPDATER_ADMIN_TOKEN=//p' "$CONFIG" | tail -n1 | tr -d '\r"')
test -n "$TOKEN" || { echo "admin token missing; stop and report"; exit 1; }
echo "admin token loaded (not printed)"
```

不要把 `$TOKEN` 写进日志、命令历史或聊天记录。

### 10.2 上传安装包和 manifest

本部署推荐把安装包放到服务自己的 `/artifacts` 下，不让更新服务依赖 GitHub 出网。

在本地仓库目录执行（PowerShell）：

```powershell
scp release-assets/v0.1.3/OrderHub-Desktop_0.1.3_x64-setup.exe `
  release-assets/v0.1.3/release-manifest.json `
  orderhub-updater@8.159.158.144:/home/orderhub-updater/
```

如果服务器能直接访问 GitHub，也可以只上传 manifest；但当前测试环境的 Node fetch 对 GitHub
资产曾出现不可达，本地 artifact 更稳定。

在服务器上确认文件：

```bash
cd "$BASE"
ls -lh OrderHub-Desktop_0.1.3_x64-setup.exe release-manifest.json
```

校验安装包：

```bash
ACTUAL=$(sha256sum OrderHub-Desktop_0.1.3_x64-setup.exe | cut -d' ' -f1)
EXPECTED=3a05fe398a6b0c23242dfe7e8e93b90659582b19b284b7dcd2a3552d145b6f23
[ "$ACTUAL" = "$EXPECTED" ] || { echo "installer sha256 mismatch; stop"; exit 1; }
echo "installer sha256 ok"
```

### 10.3 生成本地 artifact manifest

从现有配置读取 artifact 根目录和公共 URL，不要猜：

```bash
ARTIFACT_DIR=$(sed -n 's/^ORDERHUB_UPDATER_ARTIFACT_DIR=//p' "$CONFIG" | tail -n1 | tr -d '\r"')
PUBLIC_BASE=$(sed -n 's/^ORDERHUB_UPDATER_PUBLIC_BASE_URL=//p' "$CONFIG" | tail -n1 | tr -d '\r"')
PUBLIC_BASE=${PUBLIC_BASE%/}
echo "ARTIFACT_DIR=$ARTIFACT_DIR"
echo "PUBLIC_BASE=$PUBLIC_BASE"
```

确认 `ARTIFACT_DIR` 是绝对路径且可写：

```bash
case "$ARTIFACT_DIR" in
  /*) ;;
  *) echo "ARTIFACT_DIR is not absolute; stop"; exit 1 ;;
esac
test -w "$ARTIFACT_DIR" || { echo "ARTIFACT_DIR not writable; stop"; exit 1; }
```

复制安装包到静态目录：

```bash
install -d "$ARTIFACT_DIR/0.1.3/windows-x86_64"
cp "$BASE/OrderHub-Desktop_0.1.3_x64-setup.exe" \
  "$ARTIFACT_DIR/0.1.3/windows-x86_64/OrderHub-Desktop_0.1.3_x64-setup.exe"
sha256sum "$ARTIFACT_DIR/0.1.3/windows-x86_64/OrderHub-Desktop_0.1.3_x64-setup.exe"
```

生成 manifest 副本，只改 URL，不改 size/SHA-256/signature：

```bash
MANIFEST="$BASE/release-manifest-0.1.3.local.json"
ARTIFACT_URL="$PUBLIC_BASE/0.1.3/windows-x86_64/OrderHub-Desktop_0.1.3_x64-setup.exe"

node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (m.version !== "0.1.3") throw new Error("unexpected version " + m.version);
if (m.artifacts.length !== 1) throw new Error("expected one artifact");
m.artifacts[0].url = process.argv[3];
fs.writeFileSync(process.argv[2], JSON.stringify(m, null, 2));
' "$BASE/release-manifest.json" "$MANIFEST" "$ARTIFACT_URL"

cat "$MANIFEST"
```

核对 manifest：

```bash
node -e '
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const a = m.artifacts[0];
console.log(JSON.stringify({version: m.version, channel: m.channel, size: a.size, sha256: a.sha256, url: a.url}, null, 2));
if (m.version !== "0.1.3" || a.size !== 8737252 || a.sha256 !== "3a05fe398a6b0c23242dfe7e8e93b90659582b19b284b7dcd2a3552d145b6f23") {
  process.exit(2);
}
' "$MANIFEST"
```

服务端发布时会通过 `ARTIFACT_URL` 下载并校验这个安装包。确认该 URL 能从服务器访问：

```bash
curl -fsSI "$ARTIFACT_URL" | head
```

如果这里 404/403，先修复静态路径或 `PUBLIC_BASE_URL`，不要继续发布。

### 10.4 登记 release

```bash
RESP="$BASE/release-register-0.1.3.json"

curl -fsS -o "$RESP" -X POST "$API/v1/admin/releases" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$MANIFEST" || { cat "$RESP" 2>/dev/null; echo "register failed"; exit 1; }

test -s "$RESP" || { echo "register failed; see response above"; exit 1; }
cat "$RESP"
```

成功返回 HTTP 201，响应中包含 `release_id` 和 `revision`。解析：

```bash
RELEASE_ID=$(node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!r.release_id) throw new Error("release_id missing");
process.stdout.write(r.release_id);
' "$RESP")

RELEASE_REV=$(node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(String(r.revision));
' "$RESP")

test -n "$RELEASE_ID" || { echo "release_id missing; stop"; exit 1; }
test -n "$RELEASE_REV" || { echo "release revision missing; stop"; exit 1; }
echo "RELEASE_ID=$RELEASE_ID RELEASE_REV=$RELEASE_REV"
```

如果返回 409 `RELEASE_VERSION_EXISTS`，说明该版本已登记过，不要重复创建；停止并报告现有
`release_id`，或让有权限的人从数据库/管理端确认后再发布。

如果返回 `ARTIFACT_UNREACHABLE`，按 10.3 做本地 artifact 回退后重试；不要改成
`VERIFY_ARTIFACT_URL=0`。

如果返回 `SIGNING_KEY_NOT_CONFIGURED`，说明第 6 节配置没有生效，先修复配置并重启服务。

### 10.5 发布 release

```bash
PUBLISH="$BASE/release-publish-0.1.3.json"

curl -fsS -o "$PUBLISH" -X POST "$API/v1/admin/releases/$RELEASE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"expected_revision\":$RELEASE_REV}" || { cat "$PUBLISH" 2>/dev/null; echo "publish failed"; exit 1; }

test -s "$PUBLISH" || { echo "publish failed; see response above"; exit 1; }
cat "$PUBLISH"
```

成功返回 HTTP 200，`status` 为 `published`，`revision` 会加 1。

若返回 409 `RELEASE_REVISION_CONFLICT`，重新读取该 release 的 revision 后再决定；不要在
revision 不明时重复发布。

### 10.6 将 beta 策略指向 0.1.3

先读取当前策略（公开接口）：

```bash
INSTALLATION_ID=6f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c
POLICY_BEFORE="$BASE/policy-before-0.1.3.json"

curl -fsS -H "X-Installation-ID: $INSTALLATION_ID" \
  -o "$POLICY_BEFORE" \
  "$API/v1/update-policy/beta/windows/x86_64/0.1.2?installer=nsis"

cat "$POLICY_BEFORE"
```

生成 policy 更新请求，保留现有的最低版本设置（当前应为 `null`，不要在这一步提高最低版本）：

```bash
POLICY_BODY="$BASE/policy-body-0.1.3.json"

node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const body = {
  expected_revision: p.policy_revision,
  rollout_release_id: process.argv[2],
  min_supported_version: p.min_supported_version,
  min_supported_effective_at: p.min_supported_effective_at,
  rollout_percent: 100,
  valid_for_seconds: 86400
};
fs.writeFileSync(process.argv[3], JSON.stringify(body));
' "$POLICY_BEFORE" "$RELEASE_ID" "$POLICY_BODY"

cat "$POLICY_BODY"
```

提交：

```bash
POLICY_RESP="$BASE/policy-update-0.1.3.json"

curl -fsS -o "$POLICY_RESP" -X PUT "$API/v1/admin/channels/beta/policy" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary "@$POLICY_BODY" || { cat "$POLICY_RESP" 2>/dev/null; echo "policy update failed"; exit 1; }

test -s "$POLICY_RESP" || { echo "policy update failed; see response above"; exit 1; }
cat "$POLICY_RESP"
```

如果返回 409 `POLICY_REVISION_CONFLICT`，重新执行 10.6 的读取和生成步骤，使用新的
`policy_revision` 重试一次；不要盲目覆盖。

### 10.7 验证 0.1.2 能看到 0.1.3

```bash
POLICY_AFTER="$BASE/policy-after-0.1.3.json"

curl -fsS -H "X-Installation-ID: $INSTALLATION_ID" \
  -o "$POLICY_AFTER" \
  "$API/v1/update-policy/beta/windows/x86_64/0.1.2?installer=nsis"

node -e '
const fs = require("fs");
const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
console.log(JSON.stringify({
  policy_revision: p.policy_revision,
  update_available: p.update_available,
  selected_version: p.selected_release ? p.selected_release.version : null,
  rollout_release_id: p.selected_release ? p.selected_release.release_id : null,
  min_supported_version: p.min_supported_version
}, null, 2));
if (!p.update_available || !p.selected_release || p.selected_release.version !== "0.1.3") {
  process.exit(2);
}
' "$POLICY_AFTER"
```

必须看到 `update_available: true`、`selected_version: "0.1.3"`。命令退出码为 `2` 时不要
继续让用户升级，检查策略/release 状态。

### 10.8 客户端操作

已安装的 0.1.2 客户端配置应为：

```toml
[update]
base_url = "http://8.159.158.144:8787"
channel = "beta"
auto_check = true
auto_download = false
allow_insecure_http = true
```

操作：

1. 打开“更新”页，点击“检查更新”；自动检查间隔默认 3600 秒；
2. 发现 0.1.3 后点击下载；
3. 下载完成并验签后点击安装；
4. 安装器退出应用并重启，版本变为 0.1.3。

`auto_download = false` 时不会自动下载；即使改为 `true`，仍需用户确认安装。当前实现不做
无人值守安装。

### 10.9 失败处理

| 错误 | 处理 |
| --- | --- |
| `ARTIFACT_UNREACHABLE` | 检查服务器能否访问 manifest URL；不能则按 10.3 用本地 artifact |
| `SIGNING_KEY_NOT_CONFIGURED` | 第 6 节配置缺失或服务未重启 |
| `INVALID_ARTIFACT_SIGNATURE` | `.sig`、签名版本或服务端公钥不匹配；停止，不要发布 |
| `RELEASE_VERSION_EXISTS` | 该版本已登记，停止并报告，不要重复创建 |
| `POLICY_REVISION_CONFLICT` | 重新读取 policy revision，重试一次 |
| `/v1/admin/*` 返回 401 | admin token 错误或服务端未加载新配置 |

发布成功后仍然不要立即把 `min_supported_version` 提高到 `0.1.3`；等确认客户端升级完成后再
调整，否则未升级的 0.1.2 会立即被限制新增报单。
