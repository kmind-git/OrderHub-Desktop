# 冻结的 OrderHub 业务契约

本目录是桌面客户端生成 Rust gRPC 客户端所用的业务协议冻结副本。不要在此直接修改字段编号或
语义；业务服务升级时先更新来源资料、记录 revision/hash，再重新生成客户端并跑契约回归。

| 文件 | 用途 |
| --- | --- |
| `orderhub.proto` | `orderhub.v1` 四个 RPC 与消息定义；Rust `tonic-build` 输入 |
| `validation.json` | 上游资料包记录的 revision、哈希、示例校验结果 |
| `UPSTREAM-README.md` | 上游资料包原始 README（保留） |
| `SOURCE.md` | 来源 revision、proto SHA-256、冻结日期与校验命令 |

- 源 revision：`6829a346a8fd44f0c825fbd9476d39c72fa78ec1`
- proto SHA-256：`1011db4a1d944e6203225b4637669923f062659577782c11f32b4338fb2f94b4`
- 本地校验：SHA-256 与 `validation.json` 的 `proto_source_sha256` 一致。
- 生成入口：[`apps/desktop/src-tauri/build.rs`](../../apps/desktop/src-tauri/build.rs) 使用
  `protoc-bin-vendored`，从本目录读取 proto 并生成客户端与服务端（仅测试 mock 使用服务端）。
- 文档差异保留：proto 的 `time_in_force` 注释列举 `GTC | IOC | FOK`，但当前业务文档要求
  `DAY`；客户端只暴露 `DAY`，并把其他类型的拒绝纳入联调验证。
- 桌面应用版本号不是业务协议版本号；更新 HTTP API、IPC DTO 与业务 proto 分开版本化。
