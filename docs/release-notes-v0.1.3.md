# OrderHub Desktop v0.1.3 — 评审缺陷修复

发布日期：2026-10-21。状态：内部试装 / 预发布，不是生产版本。

## 变更

本版本落实 2026-10-20 代码评审的 P1/P2 与启动专项修复：

- 工作台持仓/资金使用实时投影，不再停留在初始快照；
- 旧 generation 的状态、快照和迟到订单查询不会回退当前会话；
- 报单/撤单/查询统一使用同一不可变会话的配置、凭证和 Channel；
- 请求记录按 `request_id` 合并，已保存的 admission 不会被查询失败覆盖；
- 损坏的本地请求记录作为“结果未知”可见并计入待核对数量；
- 发布前校验安装包大小、SHA-256、minisign 签名和签名版本；
- 非回环 HTTP 包地址与启动配置使用同一显式开关；
- release 构建缺少有效更新配置时关闭新增报单；
- 更新配置热重载、已下载包复用、下载失败状态、策略缓存来源绑定；
- 安装前先进入维护模式，再等待在途写入并重新统计未知请求；
- 请求恢复移到后台线程，bootstrap 限制返回条数；
- Watch 建立成功后才宣告同步完成，快照和建流增加时间预算/取消处理；
- ACL 加固后台化并设置子进程超时。

完整说明见 [review-fixes-2026-10-21.md](review-fixes-2026-10-21.md)。

## 安装包

- 安装包：`OrderHub-Desktop_0.1.3_x64-setup.exe`
- 更新签名：Tauri/minisign 测试密钥，未做 Authenticode 签名
- 频道：`beta`
- SHA-256：`3a05fe398a6b0c23242dfe7e8e93b90659582b19b284b7dcd2a3552d145b6f23`

安装包内 `version` 和签名 trusted comment 的 `version:0.1.3` 已核对。升级前请确认
`[update].base_url` 指向可用的更新服务；如果更新服务尚未部署，可先人工安装本包。

## 更新服务

修复后的更新服务部署包仍是独立 Release：

[OrderHub Update Service v0.1.3](https://github.com/kmind-git/OrderHub-Desktop/releases/tag/updater-v0.1.3)

`VERIFY_ARTIFACT_URL=1` 时必须配置 `ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY`，否则发布会被拒绝。
