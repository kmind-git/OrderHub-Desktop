# OrderHub gRPC 接入资料

请先阅读 [OrderHub gRPC 接口文档](OrderHub-gRPC接口文档.md)。

- [协议定义](proto/orderhub.proto)：直接用于生成各语言客户端，保留原始字段和编号。
- [JSON 示例索引](examples/index.json)：请求、响应及流事件示例。
- [版本和离线校验](validation.json)：与当前源码匹配的哈希及校验范围。

服务地址、TLS CA/身份、Bearer Token 和授权策略由部署方另外提供。包内没有真实凭证。
示例中的 epoch、订单 ID、request_id 和签名 token 均须按实际调用替换。
