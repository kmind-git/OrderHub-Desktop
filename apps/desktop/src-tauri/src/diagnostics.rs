use crate::dto::{
    AppInfo, ConfigSummary, ConnectionState, DiagnosticErrorEntry, DiagnosticExportResult,
    DiagnosticsConfig, DiagnosticsRuntime, DiagnosticsSummary, DiagnosticsSync, IpcError,
    UpdateStateDto,
};
use crate::storage::atomic_write;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct DiagnosticStore {
    errors: Mutex<VecDeque<DiagnosticErrorEntry>>,
}

impl DiagnosticStore {
    pub fn new() -> Self {
        Self {
            errors: Mutex::new(VecDeque::new()),
        }
    }

    pub fn record(&self, error: &IpcError) {
        let entry = DiagnosticErrorEntry {
            at: chrono::Utc::now().to_rfc3339(),
            category: format!("{:?}", error.category).to_lowercase(),
            code: error.code.clone(),
            correlation_id: error.correlation_id.clone(),
            message: crate::error::sanitize_grpc_message(&error.message),
        };
        let mut errors = self
            .errors
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        errors.push_back(entry);
        while errors.len() > 100 {
            errors.pop_front();
        }
    }

    pub fn recent(&self) -> Vec<DiagnosticErrorEntry> {
        self.errors
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .iter()
            .cloned()
            .collect()
    }
}

pub fn mask_host_port(value: &str) -> String {
    let (host, port) = match value.rsplit_once(':') {
        Some((host, port)) if port.chars().all(|character| character.is_ascii_digit()) => {
            (host, Some(port))
        }
        _ => (value, None),
    };
    let masked = if host.split('.').count() == 4 {
        let parts: Vec<&str> = host.split('.').collect();
        format!("***.***.***.{}", parts.last().copied().unwrap_or("***"))
    } else if let Some((first, rest)) = host.split_once('.') {
        format!("{}***.{}", &first.chars().take(2).collect::<String>(), rest)
    } else {
        "***".into()
    };
    match port {
        Some(port) => format!("{masked}:{port}"),
        None => masked,
    }
}

#[allow(dead_code)]
pub fn mask_url(value: &str) -> String {
    match url::Url::parse(value) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("***");
            format!(
                "{}://{}{}",
                parsed.scheme(),
                mask_host_port(host),
                parsed.path()
            )
        }
        Err(_) => "***".into(),
    }
}

fn redact_path(value: &str) -> String {
    let mut output = value.to_string();
    if let Ok(home) = std::env::var("USERPROFILE") {
        output = output.replace(&home, "%USERPROFILE%");
    }
    if let Ok(username) = std::env::var("USERNAME") {
        if !username.is_empty() {
            output = output.replace(&username, "<user>");
        }
    }
    output
}

fn update_for_diagnostics(update: &UpdateStateDto) -> UpdateStateDto {
    let mut clone = update.clone();
    if let Some(error) = clone.error.as_mut() {
        error.message = crate::error::sanitize_grpc_message(&error.message);
    }
    clone
}

pub fn build_summary(
    app: AppInfo,
    config: &ConfigSummary,
    connection: ConnectionState,
    sync: DiagnosticsSync,
    update: UpdateStateDto,
    runtime: DiagnosticsRuntime,
    diagnostics: &DiagnosticStore,
) -> DiagnosticsSummary {
    DiagnosticsSummary {
        app,
        generated_at: chrono::Utc::now().to_rfc3339(),
        config: DiagnosticsConfig {
            config_dir: redact_path(&config.config_dir),
            address: config
                .connection
                .as_ref()
                .map(|connection| mask_host_port(&connection.address))
                .unwrap_or_default(),
            tls_domain: config
                .connection
                .as_ref()
                .map(|connection| mask_host_port(&connection.tls_domain))
                .unwrap_or_default(),
            ca_configured: config
                .connection
                .as_ref()
                .map(|connection| connection.ca_configured)
                .unwrap_or(false),
            token_configured: config
                .connection
                .as_ref()
                .map(|connection| connection.token_configured)
                .unwrap_or(false),
            fingerprint: config.fingerprint.clone(),
            issues: config.issues.clone(),
        },
        connection,
        sync,
        update: update_for_diagnostics(&update),
        runtime: DiagnosticsRuntime {
            data_dir: redact_path(&runtime.data_dir),
            installation_id_ref: runtime.installation_id_ref,
            request_record_count: runtime.request_record_count,
            unknown_request_count: runtime.unknown_request_count,
        },
        recent_errors: diagnostics.recent(),
    }
}

pub fn export(
    summary: &DiagnosticsSummary,
    download_dir: Option<PathBuf>,
    fallback_dir: &Path,
) -> Result<DiagnosticExportResult, String> {
    let created_at = chrono::Utc::now();
    let directory = match download_dir {
        Some(dir) if dir.is_dir() => dir,
        _ => fallback_dir.join("exports"),
    };
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("创建诊断导出目录失败：{error}"))?;
    let filename = format!(
        "OrderHub-diagnostics-{}.json",
        created_at.format("%Y%m%d-%H%M%S")
    );
    let path = directory.join(filename);
    let mut summary_clone = summary.clone();
    summary_clone.generated_at = created_at.to_rfc3339();
    let body = serde_json::json!({
        "schemaVersion": 1,
        "notice": "Redacted OrderHub Desktop diagnostic export. It intentionally omits the Bearer token, request headers, page/resume tokens, and full business request parameters.",
        "redactions": [
            "Bearer token and Authorization header",
            "page_token / resume_token / cursors",
            "full request parameters",
            "local user name in paths",
            "host part of service addresses"
        ],
        "diagnostics": summary_clone,
    });
    let bytes =
        serde_json::to_vec_pretty(&body).map_err(|error| format!("诊断数据序列化失败：{error}"))?;
    atomic_write(&path, &bytes)?;
    Ok(DiagnosticExportResult {
        path: path.to_string_lossy().to_string(),
        created_at: created_at.to_rfc3339(),
        bytes: bytes.len() as u64,
        redactions: vec![
            "Bearer token".into(),
            "Authorization header".into(),
            "page_token / resume_token".into(),
            "request parameters".into(),
            "local user name".into(),
            "host part of addresses".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_addresses() {
        assert_eq!(mask_host_port("203.0.113.10:50051"), "***.***.***.10:50051");
        assert_eq!(
            mask_host_port("orderhub.example.com:443"),
            "or***.example.com:443"
        );
        assert_eq!(
            mask_url("https://updates.example.com/artifacts"),
            "https://up***.example.com/artifacts"
        );
    }
}
