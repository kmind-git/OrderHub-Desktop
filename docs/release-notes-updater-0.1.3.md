# OrderHub Update Service v0.1.3 — CentOS Stream

仅面向 CentOS Stream 9/10 x86_64 的独立部署包。Windows 包已移除。

## 包内容

```text
OrderHub-Updater-0.1.3-centos-stream.tar.gz
  dist/server.js                自包含 Hono + SQLite 服务（无需 node_modules）
  migrations/001_init.sql
  .env.example
  start.sh                      Linux 前台启动
  orderhub-updater.service      systemd unit
  README.md
```

要求 Node.js **22.13+**（`node:sqlite`）。CentOS Stream 默认 Node 版本通常过旧，使用
NodeSource 22.x 安装。

## 快速安装

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf install -y nodejs tar

useradd --system --home-dir /var/lib/orderhub-updater --shell /sbin/nologin orderhub
install -d -o orderhub -g orderhub /opt/orderhub-updater /var/lib/orderhub-updater

tar -xzf OrderHub-Updater-0.1.3-centos-stream.tar.gz -C /opt/orderhub-updater
chown -R orderhub:orderhub /opt/orderhub-updater

cp /opt/orderhub-updater/.env.example /etc/orderhub-updater.env
vi /etc/orderhub-updater.env
chmod 600 /etc/orderhub-updater.env

cp /opt/orderhub-updater/orderhub-updater.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now orderhub-updater
```

至少设置 `ORDERHUB_UPDATER_ADMIN_TOKEN`；`PUBLIC_BASE_URL` 默认是
`http://8.159.158.144:8787/artifacts`。

防火墙：

```bash
firewall-cmd --permanent --add-port=8787/tcp
firewall-cmd --reload
```

验证：

```bash
curl -fsS http://127.0.0.1:8787/readyz
```

## 校验

```text
dd5be2a2b3639bea965c208ef41804491b982bf758b556568dfeadc01eb97eaf  OrderHub-Updater-0.1.3-centos-stream.tar.gz
```

包已在独立目录中解压并启动验证，`/readyz` 返回 200。

## 安全

HTTP 只允许在受信内网、防火墙白名单下使用；管理 API 仅发布机/VPN 可访问。业务 Bearer
Token 不会发送到更新服务。生产建议恢复 HTTPS。
