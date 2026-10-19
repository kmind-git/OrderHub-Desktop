# OrderHub Desktop v0.1.0 — MVP test build

发布日期：2026-10-19。状态：内部试装 / 预发布，不是生产版本。

## 发布内容

- Windows x64 NSIS 安装包；
- Tauri updater 签名文件 `.sig`；
- `SHA256SUMS.txt`；
- `release-manifest.json`（可交给 `tools/release register --manifest` 注册到更新服务）。

## 本版本能力

- Tauri 2 + React 桌面客户端，原生 gRPC/TLS/Bearer 认证；
- Snapshot 分页 + WatchEvents 检查点续传、重同步和断线恢复；
- 受限报单、撤单、DPAPI 加密请求记录、未知结果原键查询；
- 更新策略、最低版本、stable/beta、灰度、暂停/撤回、安装前资格复核；
- 连接、工作台、报单、订单详情、请求记录、更新/关于、诊断及查询预留页。

## 安装与配置

要求 Windows 10/11 x64、WebView2 Runtime。安装范围：当前用户。

安装包**不包含**业务地址、CA、Token 或 `config/client.toml`。运行前需要把部署方提供的
`config/` 放到可解析位置，或设置 `ORDERHUB_CONFIG_DIR`。当前构建没有配置更新服务地址；
最低版本策略在开发构建中不启用。

## 重要声明

- 使用**测试 updater 签名密钥**生成，只用于内部试装；正式发布前必须替换生产密钥。
- 未进行 Authenticode 代码签名。
- 本版本只完成真实部署的只读 TLS Snapshot + WatchEvents 验证；**没有发送真实报单或撤单**。
- 更新服务的 NSIS 安装/升级/重启闭环仍需在干净 Windows 环境完成验收。

## 校验

安装包 SHA-256 记录在 `SHA256SUMS.txt` 和 `release-manifest.json` 中。发布资产是完整安装包，
不是差分包；更新时由 Tauri updater 校验 `.sig`。
