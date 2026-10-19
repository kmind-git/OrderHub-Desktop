# 测试产物目录

本目录用于本地联调、签名包和脱敏验证输出，不提交真实凭证或旧测试数据。

| 路径 | 用途 | 是否忽略 |
| --- | --- | --- |
| `keys/` | 本地测试签名私钥与公钥；当前仓库配置的是测试公钥 | 是 |
| `artifacts/` | 本地 update service 的不可变安装包 staging | 是 |
| `runtime/` | Tauri 开发数据目录、SQLite、日志 | 是 |
| `*.json` | 发布 manifest、脱敏结果 | 建议归档时人工选择 |

测试签名密钥仅用于内部试装。正式发布前生成独立生产密钥、替换
`apps/desktop/src-tauri/tauri.conf.json` 中的 updater 公钥，并把私钥保存在受控签名环境。
