# 来源与冻结记录

| 项目 | 值 |
| --- | --- |
| 来源资料包 | `D:\projects\codexworkspace\OrderHub\grpc-integration` |
| 来源 README 记录的源码 revision | `6829a346a8fd44f0c825fbd9476d39c72fa78ec1` |
| proto package / service | `orderhub.v1` / `orderhub.v1.OrderHub` |
| proto SHA-256 | `1011db4a1d944e6203225b4637669923f062659577782c11f32b4338fb2f94b4` |
| validation.json 记录哈希 | 同上 |
| 冻结日期 | 2026-10-19 |
| 冻结范围 | `orderhub.proto`、`validation.json`、上游 README |

校验：

```powershell
(Get-FileHash contracts/orderhub/orderhub.proto -Algorithm SHA256).Hash.ToLower()
# 1011db4a1d944e6203225b4637669923f062659577782c11f32b4338fb2f94b4
```

上游资料包明确说明其校验过程未连接远端、未发送报撤单；本仓库的只读 Live Snapshot 探针是
部署配置上的独立验证，不把历史源码审计结论当作当前服务状态。
