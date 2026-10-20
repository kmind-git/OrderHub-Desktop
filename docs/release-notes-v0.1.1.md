# OrderHub Desktop v0.1.1 — 启动性能修复

发布日期：2026-10-20。状态：内部试装 / 预发布，不是生产版本。

## 修复内容

- **启动不再闪控制台窗口**：GUI 进程调用 `icacls` 时使用 `CREATE_NO_WINDOW`；
- **启动不再递归扫描 WebView2 缓存**：移除了对数据根目录的 `icacls /T`，只对
  `requests` 目录做一次 ACL 加固，成功后写 `.acl-hardened` 标记，后续启动跳过；
- 新增深色启动占位页，WebView2 首次渲染前不再出现白屏闪烁；
- 重新构建 release 与 NSIS 安装包。

在测试机上的 warm start 窗口创建时间由数秒级降至约 0.3 秒；首次启动仍需初始化
WebView2 用户数据目录，耗时会明显更长，这是 WebView2 的正常行为。

## 安装

1. 完全退出旧版客户端；
2. 从 GitHub Release 下载 `OrderHub-Desktop_0.1.1_x64-setup.exe`；
3. 运行安装包覆盖安装；
4. 启动前按部署方要求放置 `config/` 或设置 `ORDERHUB_CONFIG_DIR`。

如果安装器报 `NSIS Error: Error writing temporary file`，把安装包复制到较短路径
（例如 `C:\Temp`）并确认 `%TEMP%` 可写后再运行；这是 NSIS 解压临时目录的问题，
与本客户端代码无关。

## 校验

```text
cc000e38ef8d73262d8d02c93ac136253ed1a5c2bae50ee77b01a6fb6bbf38b6  OrderHub-Desktop_0.1.1_x64-setup.exe
```

发布资产同时包含 `.sig`、`SHA256SUMS.txt` 和 `release-manifest.json`。

## 重要声明

- 使用测试 updater 签名密钥，仅用于内部试装；未做 Authenticode 签名。
- 安装包不包含业务地址、CA、Token 或 `config/client.toml`。
- 本版本没有新增真实交易验证；真实报单/撤单仍未执行。
- 更新服务的安装→升级→重启闭环仍需在干净 Windows 环境完成验收。
