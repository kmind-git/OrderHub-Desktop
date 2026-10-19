use crate::dto::{
    ConfigIssue, ConfigSummary, ConnectionConfigSummary, OrderDefaultsSummary, UpdateConfigSummary,
};
use crate::error::{config_error, AppResult};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fmt;
use std::path::{Path, PathBuf};
use std::time::Duration;
use url::{Host, Url};

#[derive(Clone)]
pub struct Token(String);

impl Token {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn fingerprint(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.0.as_bytes());
        hex::encode(hasher.finalize())[..16].to_string()
    }

    pub fn authorization_header(&self) -> String {
        format!("Bearer {}", self.0)
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Token(***)")
    }
}

#[derive(Clone, Debug)]
pub struct ConnectionSettings {
    pub address: String,
    pub tls_domain: String,
    pub ca_pem: Vec<u8>,
    pub token: Token,
    pub connect_timeout: Duration,
    pub rpc_timeout: Duration,
}

#[derive(Clone, Debug)]
pub struct OrderDefaults {
    pub strategy_id: String,
    pub instrument_id: String,
    pub side: String,
    pub quantity: String,
    pub price: String,
    pub time_in_force: String,
}

#[derive(Clone, Debug)]
pub struct UpdateSettings {
    pub configured: bool,
    pub base_url: Option<String>,
    pub channel: String,
    pub auto_check: bool,
    pub auto_download: bool,
    pub enforce_min_version: bool,
    pub allow_insecure_loopback: bool,
    pub check_interval_secs: u64,
}

impl UpdateSettings {
    fn unconfigured() -> Self {
        Self {
            configured: false,
            base_url: None,
            channel: "stable".into(),
            auto_check: true,
            auto_download: false,
            enforce_min_version: false,
            allow_insecure_loopback: false,
            check_interval_secs: 3600,
        }
    }
}

#[derive(Clone)]
pub struct LoadedConfig {
    pub config_dir: PathBuf,
    pub summary: ConfigSummary,
    pub connection: Option<ConnectionSettings>,
    pub watch_timeout: Duration,
    pub update: UpdateSettings,
    pub environment_id: String,
    pub credential_ref: String,
}

impl fmt::Debug for LoadedConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LoadedConfig")
            .field("config_dir", &self.config_dir)
            .field("summary", &self.summary)
            .field("connection", &self.connection)
            .field("watch_timeout", &self.watch_timeout)
            .field("update", &self.update)
            .field("environment_id", &self.environment_id)
            .field("credential_ref", &self.credential_ref)
            .finish()
    }
}

#[derive(Debug, Deserialize)]
struct RawConfig {
    connection: RawConnection,
    #[serde(default)]
    order: Option<RawOrder>,
    #[serde(default)]
    watch: Option<RawWatch>,
    #[serde(default)]
    update: Option<RawUpdate>,
}

#[derive(Debug, Deserialize)]
struct RawConnection {
    address: String,
    tls_domain: String,
    ca_file: String,
    token_file: String,
    #[serde(default = "default_connect_timeout")]
    connect_timeout_secs: u64,
    #[serde(default = "default_rpc_timeout")]
    rpc_timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
struct RawOrder {
    strategy_id: String,
    instrument_id: String,
    side: String,
    quantity: String,
    price: String,
    time_in_force: String,
}

#[derive(Debug, Deserialize)]
struct RawWatch {
    #[serde(default = "default_watch_timeout")]
    timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
struct RawUpdate {
    base_url: Option<String>,
    #[serde(default = "default_channel")]
    channel: String,
    #[serde(default = "default_true")]
    auto_check: bool,
    #[serde(default)]
    auto_download: bool,
    #[serde(default = "default_true")]
    enforce_min_version: bool,
    #[serde(default)]
    allow_insecure_loopback: bool,
    #[serde(default = "default_check_interval")]
    check_interval_secs: u64,
}

fn default_connect_timeout() -> u64 {
    5
}
fn default_rpc_timeout() -> u64 {
    10
}
fn default_watch_timeout() -> u64 {
    15
}
fn default_channel() -> String {
    "stable".into()
}
fn default_true() -> bool {
    true
}
fn default_check_interval() -> u64 {
    3600
}

pub fn locate_config_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("ORDERHUB_CONFIG_DIR") {
        let path = PathBuf::from(explicit);
        if !path.is_absolute() {
            if let Ok(cwd) = std::env::current_dir() {
                return cwd.join(path);
            }
        }
        return path;
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("config"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for suffix in ["config", "../config", "../../config", "../../../config"] {
            candidates.push(cwd.join(suffix));
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join("config"),
    );
    candidates
        .iter()
        .find(|candidate| candidate.join("client.toml").is_file())
        .cloned()
        .unwrap_or_else(|| {
            candidates
                .first()
                .cloned()
                .unwrap_or_else(|| PathBuf::from("config"))
        })
}

fn resolve_under(
    root: &Path,
    relative: &str,
    field: &str,
    issues: &mut Vec<ConfigIssue>,
) -> Option<PathBuf> {
    let path = PathBuf::from(relative);
    if path.is_absolute() {
        issues.push(ConfigIssue::error(
            "CONFIG_ABSOLUTE_PATH",
            format!("{field} 必须相对于 config 目录，不能使用绝对路径"),
            Some(field),
        ));
        return None;
    }
    let root_canonical = std::fs::canonicalize(root).ok()?;
    let joined = root.join(&path);
    let canonical = match std::fs::canonicalize(&joined) {
        Ok(value) => value,
        Err(error) => {
            issues.push(ConfigIssue::error(
                "CONFIG_FILE_MISSING",
                format!("{field} 指向的文件不可读：{error}"),
                Some(field),
            ));
            return None;
        }
    };
    if !canonical.starts_with(&root_canonical) {
        issues.push(ConfigIssue::error(
            "CONFIG_PATH_ESCAPE",
            format!("{field} 不能指向 config 目录之外"),
            Some(field),
        ));
        return None;
    }
    Some(canonical)
}

fn read_token(path: &Path, issues: &mut Vec<ConfigIssue>) -> Option<Token> {
    let raw = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) => {
            issues.push(ConfigIssue::error(
                "TOKEN_UNREADABLE",
                format!("Token 文件不可读：{error}"),
                Some("connection.token_file"),
            ));
            return None;
        }
    };
    let token = raw.trim();
    if token.is_empty() {
        issues.push(ConfigIssue::error(
            "TOKEN_EMPTY",
            "Token 文件为空",
            Some("connection.token_file"),
        ));
        return None;
    }
    if token.len() > 4096 {
        issues.push(ConfigIssue::error(
            "TOKEN_TOO_LONG",
            "Token 超过 4096 字节",
            Some("connection.token_file"),
        ));
        return None;
    }
    if token
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        issues.push(ConfigIssue::error(
            "TOKEN_INVALID_CHARACTER",
            "Token 不应包含空白或控制字符",
            Some("connection.token_file"),
        ));
        return None;
    }
    Some(Token::new(token.to_string()))
}

fn validate_address(address: &str) -> Result<(), String> {
    if address.is_empty() || address.len() > 255 {
        return Err("服务地址长度无效".into());
    }
    if address.contains("://") {
        return Err("服务地址不能包含 scheme，请使用 host:port".into());
    }
    if address
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("服务地址不能包含空白或控制字符".into());
    }
    let parsed = Url::parse(&format!("https://{address}"))
        .map_err(|_| "服务地址不是有效的 host:port".to_string())?;
    if parsed.host_str().is_none() {
        return Err("服务地址缺少主机名".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("服务地址不能包含用户信息".into());
    }
    if parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("服务地址不能包含路径、查询或片段".into());
    }
    Ok(())
}

fn validate_tls_domain(domain: &str) -> Result<(), String> {
    if domain.is_empty() || domain.len() > 253 {
        return Err("TLS 服务名称长度无效".into());
    }
    if domain
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("TLS 服务名称不能包含空白或控制字符".into());
    }
    Host::parse(domain).map_err(|_| "TLS 服务名称不是有效的 DNS 名称或 IP 地址".to_string())?;
    Ok(())
}

fn validate_update_url(value: &str, allow_insecure_loopback: bool) -> Result<Url, String> {
    let parsed = Url::parse(value).map_err(|_| "更新服务地址不是有效 URL".to_string())?;
    let loopback = parsed
        .host_str()
        .map(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"))
        .unwrap_or(false);
    if parsed.scheme() != "https" {
        if !(allow_insecure_loopback && loopback && parsed.scheme() == "http") {
            return Err("更新服务地址必须使用 HTTPS（回环开发地址需显式允许）".into());
        }
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("更新服务地址不能包含查询参数或片段".into());
    }
    Ok(parsed)
}

fn hash_environment(address: &str, tls_domain: &str, ca_pem: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(address.as_bytes());
    hasher.update([0]);
    hasher.update(tls_domain.as_bytes());
    hasher.update([0]);
    hasher.update(ca_pem);
    hex::encode(hasher.finalize())[..16].to_string()
}

pub fn load_config(config_dir: PathBuf) -> LoadedConfig {
    let loaded_at = chrono::Utc::now().to_rfc3339();
    let file = config_dir.join("client.toml");
    let mut issues = Vec::new();
    let exists = file.is_file();
    let mut update = UpdateSettings::unconfigured();
    let mut update_config_summary = update_summary(&update);
    let mut order_defaults = None;
    let mut watch_timeout = Duration::from_secs(default_watch_timeout());
    let mut connection_summary: Option<ConnectionConfigSummary> = None;
    let mut connection: Option<ConnectionSettings> = None;
    let mut environment_id = String::new();
    let mut credential_ref = String::new();

    if !exists {
        issues.push(ConfigIssue::error(
            "CONFIG_MISSING",
            format!("未找到配置文件 {}", file.display()),
            Some("client.toml"),
        ));
    } else {
        match std::fs::read_to_string(&file) {
            Err(error) => issues.push(ConfigIssue::error(
                "CONFIG_UNREADABLE",
                format!("配置文件不可读：{error}"),
                Some("client.toml"),
            )),
            Ok(text) => match toml::from_str::<RawConfig>(&text) {
                Err(error) => issues.push(ConfigIssue::error(
                    "CONFIG_PARSE",
                    format!("配置文件格式无效：{error}"),
                    Some("client.toml"),
                )),
                Ok(raw) => {
                    watch_timeout = Duration::from_secs(
                        raw.watch
                            .as_ref()
                            .map(|w| w.timeout_secs)
                            .unwrap_or(15)
                            .clamp(3, 300),
                    );
                    if let Some(order) = &raw.order {
                        order_defaults = Some(OrderDefaults {
                            strategy_id: order.strategy_id.clone(),
                            instrument_id: order.instrument_id.clone(),
                            side: order.side.clone(),
                            quantity: order.quantity.clone(),
                            price: order.price.clone(),
                            time_in_force: order.time_in_force.clone(),
                        });
                    }

                    let ca_path = resolve_under(
                        &config_dir,
                        &raw.connection.ca_file,
                        "connection.ca_file",
                        &mut issues,
                    );
                    let token_path = resolve_under(
                        &config_dir,
                        &raw.connection.token_file,
                        "connection.token_file",
                        &mut issues,
                    );
                    let ca_pem = ca_path.as_ref().and_then(|path| match std::fs::read(path) {
                        Ok(bytes) if !bytes.is_empty() => {
                            let text = String::from_utf8_lossy(&bytes);
                            if text.contains("-----BEGIN CERTIFICATE-----") {
                                Some(bytes)
                            } else {
                                issues.push(ConfigIssue::error(
                                    "CA_INVALID",
                                    "CA 文件未包含 PEM 证书",
                                    Some("connection.ca_file"),
                                ));
                                None
                            }
                        }
                        Ok(_) => {
                            issues.push(ConfigIssue::error(
                                "CA_EMPTY",
                                "CA 文件为空",
                                Some("connection.ca_file"),
                            ));
                            None
                        }
                        Err(error) => {
                            issues.push(ConfigIssue::error(
                                "CA_UNREADABLE",
                                format!("CA 文件不可读：{error}"),
                                Some("connection.ca_file"),
                            ));
                            None
                        }
                    });
                    let token = token_path
                        .as_ref()
                        .and_then(|path| read_token(path, &mut issues));
                    let token_configured = token.is_some();

                    if let Err(message) = validate_address(&raw.connection.address) {
                        issues.push(ConfigIssue::error(
                            "ADDRESS_INVALID",
                            message,
                            Some("connection.address"),
                        ));
                    }
                    if let Err(message) = validate_tls_domain(&raw.connection.tls_domain) {
                        issues.push(ConfigIssue::error(
                            "TLS_DOMAIN_INVALID",
                            message,
                            Some("connection.tls_domain"),
                        ));
                    }
                    if !(1..=120).contains(&raw.connection.connect_timeout_secs) {
                        issues.push(ConfigIssue::error(
                            "CONNECT_TIMEOUT_INVALID",
                            "connect_timeout_secs 必须在 1..120 之间",
                            Some("connection.connect_timeout_secs"),
                        ));
                    }
                    if !(1..=300).contains(&raw.connection.rpc_timeout_secs) {
                        issues.push(ConfigIssue::error(
                            "RPC_TIMEOUT_INVALID",
                            "rpc_timeout_secs 必须在 1..300 之间",
                            Some("connection.rpc_timeout_secs"),
                        ));
                    }

                    let has_business_errors = issues.iter().any(|issue| issue.severity == "error");
                    if let (Some(ca_pem), Some(token)) = (ca_pem, token) {
                        if !has_business_errors {
                            environment_id = hash_environment(
                                &raw.connection.address,
                                &raw.connection.tls_domain,
                                &ca_pem,
                            );
                            credential_ref = token.fingerprint();
                            connection = Some(ConnectionSettings {
                                address: raw.connection.address.clone(),
                                tls_domain: raw.connection.tls_domain.clone(),
                                ca_pem,
                                token,
                                connect_timeout: Duration::from_secs(
                                    raw.connection.connect_timeout_secs,
                                ),
                                rpc_timeout: Duration::from_secs(raw.connection.rpc_timeout_secs),
                            });
                        }
                    }
                    connection_summary = Some(ConnectionConfigSummary {
                        address: raw.connection.address.clone(),
                        tls_domain: raw.connection.tls_domain.clone(),
                        connect_timeout_secs: raw.connection.connect_timeout_secs,
                        rpc_timeout_secs: raw.connection.rpc_timeout_secs,
                        ca_configured: ca_path.is_some(),
                        ca_path: ca_path
                            .as_ref()
                            .map(|path| path.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        token_configured,
                    });

                    if let Some(raw_update) = &raw.update {
                        update.allow_insecure_loopback = raw_update.allow_insecure_loopback;
                        update.channel = raw_update.channel.clone();
                        update.auto_check = raw_update.auto_check;
                        update.auto_download = raw_update.auto_download;
                        update.enforce_min_version = raw_update.enforce_min_version;
                        update.check_interval_secs =
                            raw_update.check_interval_secs.clamp(60, 7 * 24 * 3600);
                        if !matches!(update.channel.as_str(), "stable" | "beta") {
                            issues.push(ConfigIssue::error(
                                "UPDATE_CHANNEL_INVALID",
                                "update.channel 必须是 stable 或 beta",
                                Some("update.channel"),
                            ));
                        }
                        match raw_update
                            .base_url
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                        {
                            None => {
                                issues.push(ConfigIssue::warning(
                                    "UPDATE_NOT_CONFIGURED",
                                    "未配置更新服务地址，最低版本策略不会启用（开发模式）",
                                    Some("update.base_url"),
                                ));
                            }
                            Some(base_url) => match validate_update_url(
                                base_url,
                                raw_update.allow_insecure_loopback,
                            ) {
                                Ok(url) => {
                                    update.base_url =
                                        Some(url.to_string().trim_end_matches('/').to_string());
                                    update.configured = true;
                                }
                                Err(message) => issues.push(ConfigIssue::error(
                                    "UPDATE_URL_INVALID",
                                    message,
                                    Some("update.base_url"),
                                )),
                            },
                        }
                    }
                    update_config_summary = update_summary(&update);
                }
            },
        }
    }

    if order_defaults.is_none() {
        issues.push(ConfigIssue::warning(
            "ORDER_DEFAULTS_MISSING",
            "未配置 [order] 默认值，报单面板将使用 Snapshot 提供的合约",
            Some("order"),
        ));
    }

    // Update-service problems are reported separately and do not make the
    // business connection invalid. `connection` is only built when all
    // business connection checks passed.
    let valid = connection.is_some();
    if environment_id.is_empty() {
        environment_id = hash_environment("", "", b"");
    }
    if credential_ref.is_empty() {
        credential_ref = "none".into();
    }

    let summary = ConfigSummary {
        config_dir: config_dir.to_string_lossy().to_string(),
        exists,
        valid,
        loaded_at,
        fingerprint: environment_id.clone(),
        connection: connection_summary,
        watch_timeout_secs: watch_timeout.as_secs(),
        order_defaults: order_defaults
            .as_ref()
            .map(|defaults| OrderDefaultsSummary {
                strategy_id: defaults.strategy_id.clone(),
                instrument_id: defaults.instrument_id.clone(),
                side: defaults.side.clone(),
                quantity: defaults.quantity.clone(),
                price: defaults.price.clone(),
                time_in_force: defaults.time_in_force.clone(),
            }),
        update: update_config_summary,
        issues,
    };

    LoadedConfig {
        config_dir,
        summary,
        connection,
        watch_timeout,
        update,
        environment_id,
        credential_ref,
    }
}

fn update_summary(update: &UpdateSettings) -> UpdateConfigSummary {
    UpdateConfigSummary {
        configured: update.configured,
        base_url: update.base_url.clone(),
        channel: update.channel.clone(),
        auto_check: update.auto_check,
        auto_download: update.auto_download,
        enforce_min_version: update.enforce_min_version,
        allow_insecure_loopback: update.allow_insecure_loopback,
        check_interval_secs: update.check_interval_secs,
    }
}

pub fn require_connection(config: &LoadedConfig) -> AppResult<ConnectionSettings> {
    config.connection.clone().ok_or_else(|| {
        let message = config
            .summary
            .issues
            .iter()
            .find(|issue| issue.severity == "error")
            .map(|issue| issue.message.clone())
            .unwrap_or_else(|| "业务连接配置无效".to_string());
        config_error("CONFIG_INVALID", message)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_config(root: &Path, ca_relative: &str, token: &str, update: &str) {
        fs::create_dir_all(root.join("tls")).unwrap();
        fs::write(
            root.join("tls/ca.pem"),
            "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
        )
        .unwrap();
        fs::write(root.join("tls/client-token.txt"), token).unwrap();
        let text = format!(
            r#"[connection]
address = "orderhub.example.com:50051"
tls_domain = "orderhub.example.com"
ca_file = "{ca_relative}"
token_file = "tls/client-token.txt"
connect_timeout_secs = 5
rpc_timeout_secs = 10

[watch]
timeout_secs = 15

{update}
"#
        );
        fs::write(root.join("client.toml"), text).unwrap();
    }

    #[test]
    fn loads_valid_config_without_exposing_token() {
        let dir = tempfile::tempdir().unwrap();
        write_config(
            dir.path(),
            "tls/ca.pem",
            "test-token-123",
            "[update]\nbase_url = \"https://updates.example.com\"\nchannel = \"beta\"\n",
        );
        let config = load_config(dir.path().to_path_buf());
        assert!(config.summary.valid);
        assert!(config.summary.connection.as_ref().unwrap().token_configured);
        assert_eq!(config.update.channel, "beta");
        assert!(config.update.configured);
        let debug = format!("{:?}", config.connection.as_ref().unwrap());
        assert!(!debug.contains("test-token-123"));
        assert!(debug.contains("Token(***)"));
        assert_eq!(config.credential_ref.len(), 16);
        assert_eq!(config.environment_id.len(), 16);
    }

    #[test]
    fn rejects_path_escape_and_missing_token() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.pem");
        fs::write(
            &outside,
            "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
        )
        .unwrap();
        let nested = dir.path().join("config");
        write_config(&nested, "../outside.pem", "token", "");
        let escaped = load_config(nested.clone());
        assert!(!escaped.summary.valid);
        assert!(escaped
            .summary
            .issues
            .iter()
            .any(|issue| issue.code == "CONFIG_PATH_ESCAPE"));

        write_config(&nested, "tls/ca.pem", "", "");
        let missing = load_config(nested);
        assert!(!missing.summary.valid);
        assert!(missing
            .summary
            .issues
            .iter()
            .any(|issue| issue.code == "TOKEN_EMPTY"));
    }
}
