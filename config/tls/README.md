# 客户端 TLS 文件

此处放 CA 公钥证书 ca.pem。程序始终校验服务器证书和 tls_domain。
客户端采用服务端 TLS 认证及 Bearer Token，不需要私钥。
禁止复制 ca-key.pem、server-key.pem 或 CA 私钥密码到此处。
