# 安全设计与威胁边界

日期：2026-10-19。适用范围：OrderHub Desktop MVP（Windows x64）。

## 1. 信任边界

| 边界 | 信任内容 | 不信任内容 |
| --- | --- | --- |
| config → 原生层 | `client.toml`、CA、Token 文件由部署方提供 | 配置路径不得逃逸 config 根；Token 不进入 UI/日志 |
| WebView → 原生层 | 原生命令白名单、参数二次校验 | 任意 URL、Shell、文件读写、安装器路径 |
| 客户端 → 业务服务 | TLS 证书链 + tls_domain + Bearer Token | 服务端 READY/writable 不豁免逐单校验 |
| 客户端 → 更新服务 | HTTPS 策略响应 + Tauri 包签名 | 更新服务不是业务数据源；policy 不是认证凭证 |
| 发布者 → 更新服务 | 独立高熵管理 Token | 客户端不含发布密钥；发布 Token 与业务 Token 分离 |

## 2. 凭证与本地数据

- `config/tls/client-token.txt` 只在 `config.rs` 中读取，包装为不实现 `Serialize` 的
  `Token`；`Debug` 固定脱敏。gRPC metadata 每次 RPC 注入。
- 配置校验拒绝绝对路径、`..` 逃逸、不可读文件、空白/控制字符 Token、缺失 PEM。
- 数据根目录默认 `%LOCALAPPDATA%\com.orderhub.desktop`（可用 `ORDERHUB_DATA_DIR` 覆盖）；
  WebView2 用户数据固定在其 `webview2` 子目录，起始窗口前由 `main` 创建并设置
  `WEBVIEW2_USER_DATA_FOLDER`，避免隐式目录在部分 Windows 配置上创建失败。
- 请求记录写入 `<数据根>/requests`。每条记录：
  - 内容 JSON 先经 Windows DPAPI（`CryptProtectData` + 固定 entropy）加密；
  - 外层信封只含 schemaVersion、requestId、protection、payload；
  - 通过临时文件 + `MoveFileExW(MOVEFILE_REPLACE_EXISTING | WRITE_THROUGH)` 原子替换；
  - 首次打开 `requests` 目录时用 `icacls` 做 best-effort ACL 加固：在继承 ACL 基础上显式
    授予当前用户完全控制，保留 SYSTEM/Administrators 必要维护访问；不破坏继承，避免已有
    加密文件在下次启动时不可读。加固成功后写入 `.acl-hardened` 标记，后续启动不再扫描；
    子进程使用 `CREATE_NO_WINDOW`，避免 GUI 进程闪出控制台窗口，也不扫描 WebView2 缓存。
- DPAPI 绑定当前 Windows 用户；同一用户会话被完全控制时无法防止恶意程序读取。MVP 不把
  DPAPI 当服务端秘密或跨用户保护。
- 请求记录 schema_version 为 1；升级备份并兼容旧字段，禁止用清空记录解决迁移问题。

## 3. Tauri / WebView

- 单窗口 `main`，capability 只含 `core:default`；未启用 shell、opener、任意文件系统、
  HTTP 插件或 JS updater API。
- 自定义命令显式注册：连接、断开、ack、查询、报单、撤单、请求查询、更新检查/下载/安装、
  诊断导出；原生层重复校验参数。
- CSP：`default-src 'self'`、`script-src 'self'`、`connect-src ipc: http://ipc.localhost`；
  `style-src` 允许内联样式以支持 React 样式属性，未允许内联脚本。
- 更新服务地址只能来自原生 config，WebView 不能提供任意 host/path；业务 Token 永不发送给
  更新域名。
- 前端图片全部本地打包，不加载远程图片；装饰图 `alt=""`，状态由可访问文本表达。

### 3.1 更新服务 HTTP（v0.1.2，仅受信内网）

- 默认仍只接受 HTTPS；HTTP 必须同时满足：
  - 客户端 `[update].allow_insecure_http = true`；
  - 构建配置 `dangerousInsecureTransportProtocol = true`；
  - 服务端 `ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL=1`。
- HTTP 会明文暴露安装包、更新签名、版本策略和 `X-Installation-ID`；业务 Bearer Token
  不会发送给更新服务。只允许在受控内网和防火墙白名单下使用。
- 公网或不可信网络应恢复 HTTPS，并关闭上述三个开关。

## 4. 更新安全

- Tauri updater 公钥内置于 `tauri.conf.json`；当前仓库内置的是**测试密钥**公钥，对应私钥在
  `test-artifacts/keys`（git-ignored），只用于内部试装。正式发布前必须生成独立生产密钥并
  替换公钥，私钥只存在受控签名环境。
- 签名内容来自服务器返回的完整 `.sig`；客户端通过 `download`/`verify`/`install` 校验签名
  与版本绑定。SHA-256 仅用于内容校验，不替代签名。
- 安装前再次请求 eligibility；`409 POLICY_CHANGED`、`410 RELEASE_PAUSED/REVOKED` 会阻止
  安装。已进入安装器的任务无法依赖后续撤回即时取消。
- 安装前写 restart marker、设置维护状态、取写锁等待在途写入、关闭事件流；不会自动撤销活动
  订单。
- 管理 API 使用 `ORDERHUB_UPDATER_ADMIN_TOKEN` 常量时间比较；未配置时返回 503，不提供默认
  口令。发布、暂停、撤回、策略变更写入 `audit_logs`。
- 客户端读取接口无业务 Token；MVP 部署在受控内网/VPN。扩展到公网私有分发时应增加独立更新
  访问凭证。

## 5. 服务端数据与日志

- SQLite 使用 WAL、外键、busy_timeout、短写事务；首轮单实例，不放在共享网络盘。
- 安装包使用不可变路径；相同 release/目标内容不能覆盖。数据库只保存地址、大小、SHA-256、
  签名和发布元数据。
- 更新事件只保存 installation_id、版本、阶段、错误类别、时间；不包含订单、Token 或业务参数，
  按 installation + IP 限流、按 event_id 幂等，并设置留存上限。
- 日志不记录 Authorization、Token、page/resume token、完整订单参数；诊断导出前再次脱敏
  （地址主机部分、本地用户名、凭证）。
- 管理 API 只在受控网络可达；生产经反向代理终止 HTTPS，Hono 进程以低权限账号运行。

## 6. 威胁与处置

| 威胁 | MVP 措施 | 剩余风险 |
| --- | --- | --- |
| Token 泄露到 UI/日志 | 不跨 IPC、不序列化、诊断脱敏 | 调试器读取进程内存 |
| 配置路径逃逸 | canonicalize + 根目录校验、拒绝绝对路径 | 部署方放错文件 |
| 本地请求记录被读取 | DPAPI + 目录 ACL | 同用户恶意进程 |
| 旧客户端继续交易 | 客户端最低版本门禁 | 现有业务协议无可信版本准入；改包客户端可绕过 |
| 更新包被替换 | Tauri minisign 签名 + 版本绑定 | 私钥泄露；需换钥演练 |
| 更新服务被攻陷 | HTTPS、管理/客户端分离、审计 | 可阻断分发或错误下发策略；policy 未独立签名 |
| 重放旧策略 | 有效期限、revision 一致性 | 无独立 policy 签名/防重放；首轮依赖 HTTPS 服务器 |
| 前端 XSS | 本地打包、严格 CSP、纯文本/Markdown 说明 | React 依赖漏洞需持续更新 |
| 安装中断/回退 | 保留可信安装包人工修复 | MVP 不承诺安装器原子回退 |

## 7. 发布前必须完成

1. 生成生产 Tauri 签名密钥，替换测试公钥，建立离线备份与换钥过渡流程。
2. 接入 Authenticode，先签所有二进制，再生成最终安装包和 updater 签名，之后不再修改字节。
3. 更新服务置于 HTTPS 反向代理后，管理 API 仅内网可达，配置独立发布 Token。
4. 对 SQLite + 安装包做一致性备份与恢复演练。
5. 在干净 Windows 环境验证安装、同用户升级、WebView2 缺失/失败、卸载和重装。
6. 在授权测试环境完成报单/撤单、超时查询、撤单竞争、epoch 变化与灰度策略验收。
