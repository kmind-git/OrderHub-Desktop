# OrderHub Desktop 配置目录

本目录由部署方维护。当前开发/联调配置沿用既有 `client.toml`、`tls/ca.pem` 和
`tls/client-token.txt`；源码、日志、诊断导出和通用安装包都不得包含这些真实值。

| 文件 | 说明 |
| --- | --- |
| `client.toml` | 业务连接配置；`ca_file`、`token_file` 相对于本目录解析 |
| `client.toml.example` | 无凭证示例，包含可选的 `[update]` 配置区 |
| `tls/ca.pem` | 业务服务 CA 公钥证书 |
| `tls/client-token.txt` | 部署方发放的 Bearer Token，仅原生层读取 |
| `tls/README.md` | TLS 文件使用说明 |

## 配置根目录如何确定

原生层按以下顺序查找 `client.toml`：

1. `ORDERHUB_CONFIG_DIR` 环境变量（相对路径按当前工作目录解析）。
2. 可执行文件旁的 `config/`。
3. 当前工作目录及其上两级/三级的 `config/`（便于 `pnpm dev:tauri`）。
4. 编译期源码树中的 `config/`。

安装版优先读取 exe 同级的 `config/`；生产环境更推荐由启动入口设置
`ORDERHUB_CONFIG_DIR` 指向受保护目录。真实配置和 Token 不得提交到源码仓库。

## 更新服务

补齐 `[update].base_url` 后，更新检查、最低版本策略与安装前资格复核才会启用。
更新服务访问凭证与业务 Bearer Token 分离；不要在 `[update]` 中复用业务 Token。

默认只允许 HTTPS。受信内网使用纯 HTTP 时必须显式设置
`allow_insecure_http = true`，并且 release 构建已开启 updater 的
`dangerousInsecureTransportProtocol`。这会让安装包和安装请求以明文传输，仅用于受控内网。

## 安全边界

- Token 缺失、含空白/控制字符或不可读时，客户端保持在未连接状态并显示配置错误。
- CA 文件必须包含 PEM 证书；校验失败不会提供关闭证书验证的正式开关。
- 本地请求记录保存在 Tauri 用户数据目录，使用 Windows DPAPI 加密；升级不会清空。
- 地址或 Token 变更后需显式重新连接；旧未知请求仍按原授权上下文核对，不会自动补单。
