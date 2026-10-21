//! Serialized DTOs shared with the React UI.
//!
//! 64-bit values, timestamps, prices, quantities and byte counts stay strings.
//! `resume_token` and `page_token` are deliberately absent from every type in
//! this module; they never cross the IPC boundary.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCategory {
    Config,
    Validation,
    State,
    Policy,
    Tls,
    Auth,
    Transport,
    Protocol,
    Storage,
    Update,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub category: ErrorCategory,
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub correlation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<BTreeMap<String, String>>,
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for IpcError {}

impl IpcError {
    pub fn new(
        category: ErrorCategory,
        code: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            category,
            code: code.into(),
            message: message.into(),
            retryable: false,
            correlation_id: uuid::Uuid::new_v4().to_string(),
            details: None,
        }
    }

    pub fn retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.details
            .get_or_insert_with(BTreeMap::new)
            .insert(key.into(), value.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigIssue {
    pub severity: String,
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

impl ConfigIssue {
    pub fn error(code: impl Into<String>, message: impl Into<String>, field: Option<&str>) -> Self {
        Self {
            severity: "error".into(),
            code: code.into(),
            message: message.into(),
            field: field.map(str::to_string),
        }
    }

    pub fn warning(
        code: impl Into<String>,
        message: impl Into<String>,
        field: Option<&str>,
    ) -> Self {
        Self {
            severity: "warning".into(),
            code: code.into(),
            message: message.into(),
            field: field.map(str::to_string),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfigSummary {
    pub address: String,
    pub tls_domain: String,
    pub connect_timeout_secs: u64,
    pub rpc_timeout_secs: u64,
    pub ca_configured: bool,
    pub ca_path: String,
    pub token_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderDefaultsSummary {
    pub strategy_id: String,
    pub instrument_id: String,
    pub side: String,
    pub quantity: String,
    pub price: String,
    pub time_in_force: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfigSummary {
    pub configured: bool,
    pub base_url: Option<String>,
    pub channel: String,
    pub auto_check: bool,
    pub auto_download: bool,
    pub enforce_min_version: bool,
    pub allow_insecure_loopback: bool,
    pub allow_insecure_http: bool,
    pub check_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    pub config_dir: String,
    pub exists: bool,
    pub valid: bool,
    pub loaded_at: String,
    pub fingerprint: String,
    pub connection: Option<ConnectionConfigSummary>,
    pub watch_timeout_secs: u64,
    pub order_defaults: Option<OrderDefaultsSummary>,
    pub update: UpdateConfigSummary,
    pub issues: Vec<ConfigIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionState {
    pub generation: u64,
    pub phase: String,
    pub changed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<IpcError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub readiness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub writable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub persistence_mode: Option<String>,
}

impl ConnectionState {
    pub fn new(generation: u64, phase: &str) -> Self {
        Self {
            generation,
            phase: phase.to_string(),
            changed_at: chrono::Utc::now().to_rfc3339(),
            detail: None,
            error: None,
            readiness: None,
            writable: None,
            stale: None,
            persistence_mode: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentInfoDto {
    pub instrument_id: String,
    pub price_increment: String,
    pub size_increment: String,
    pub price_precision: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderViewDto {
    pub client_order_id: String,
    pub strategy_id: String,
    pub instrument_id: String,
    pub side: String,
    pub quantity: String,
    pub price: String,
    pub status: String,
    pub filled_quantity: String,
    pub remaining_quantity: String,
    pub account_id: String,
    pub fees: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionViewDto {
    pub strategy_id: String,
    pub instrument_id: String,
    pub quantity: String,
    pub cost: String,
    pub reserved_quantity: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountViewDto {
    pub account_id: String,
    pub reserved_cash: String,
    pub spent_cash: String,
    pub strategy_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputFactDto {
    pub json: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlFactDto {
    pub readiness: String,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected: Option<bool>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommittedViewDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<OrderViewDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<PositionViewDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<AccountViewDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub generation: u64,
    pub journal_epoch: String,
    pub state_cursor: String,
    pub durable_cursor: String,
    pub writable: bool,
    pub readiness: String,
    pub stale: bool,
    pub persistence_mode: String,
    pub snapshot_id: String,
    pub active_orders: Vec<OrderViewDto>,
    pub instruments: Vec<InstrumentInfoDto>,
    pub positions: Vec<PositionViewDto>,
    pub accounts: Vec<AccountViewDto>,
    pub inputs: Vec<InputFactDto>,
    pub committed_health: Option<ControlFactDto>,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionEventDto {
    pub submitter_id: String,
    pub request_id: String,
    pub strategy_id: String,
    pub instrument_id: String,
    pub request_kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeEventDto {
    pub origin_seq: String,
    pub client_order_id: String,
    pub outcome: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEventDto {
    pub state_cursor: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionFactDto {
    pub event_id: String,
    pub trade_id: String,
    pub client_order_id: String,
    pub strategy_id: String,
    pub account_id: String,
    pub instrument_id: String,
    pub kind: String,
    pub quantity: String,
    pub price: String,
    pub fee: String,
    pub currency: String,
    pub event_time_ns: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEventDto {
    pub generation: u64,
    pub seq: String,
    pub journal_epoch: String,
    pub event_id: String,
    pub kind: String,
    pub received_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admission: Option<AdmissionEventDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<OutcomeEventDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<ProgressEventDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution: Option<ExecutionFactDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<InputFactDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control: Option<ControlFactDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<CommittedViewDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unknown_note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SessionEvent {
    Status {
        state: ConnectionState,
    },
    Snapshot {
        snapshot: SnapshotDto,
    },
    Journal {
        event: JournalEventDto,
    },
    #[allow(dead_code)]
    Checkpoint {
        generation: u64,
        journal_epoch: String,
        seq: String,
    },
    Resync {
        generation: u64,
        reason: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionResponseDto {
    pub journal_epoch: String,
    pub seq: String,
    pub client_order_id: String,
    pub already_admitted: bool,
    pub result: String,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
    #[serde(rename = "BUY")]
    Buy,
    #[serde(rename = "SELL")]
    Sell,
}

impl Side {
    pub fn as_str(self) -> &'static str {
        match self {
            Side::Buy => "BUY",
            Side::Sell => "SELL",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitOrderInput {
    pub expected_generation: u64,
    pub expected_epoch: String,
    pub strategy_id: String,
    pub instrument_id: String,
    pub side: Side,
    pub quantity: String,
    pub price: String,
    pub time_in_force: String,
    pub post_only: bool,
    pub reduce_only: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOrderInput {
    pub expected_generation: u64,
    pub expected_epoch: String,
    pub client_order_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateInput {
    #[serde(default)]
    pub manual: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateInput {
    #[serde(default)]
    pub confirm_unknown_requests: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticsInput {
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckCheckpointInput {
    pub generation: u64,
    pub journal_epoch: String,
    pub seq: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RequestMethod {
    SubmitOrder,
    CancelOrder,
}

impl RequestMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestMethod::SubmitOrder => "SubmitOrder",
            RequestMethod::CancelOrder => "CancelOrder",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestStatus {
    Prepared,
    Sending,
    Admitted,
    Rejected,
    Unknown,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    Bool(bool),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecordDto {
    pub schema_version: u32,
    pub request_id: String,
    pub rpc_method: RequestMethod,
    pub status: RequestStatus,
    pub epoch: String,
    pub environment_id: String,
    pub credential_ref: String,
    pub params: BTreeMap<String, ParamValue>,
    pub admission: Option<AdmissionResponseDto>,
    pub error: Option<IpcError>,
    pub created_at: String,
    pub updated_at: String,
    pub last_lookup_at: Option<String>,
    pub lookup_attempts: u32,
    pub client_order_id: Option<String>,
    /// Local monotonic merge revision. Added after schema v1; older records
    /// deserialize as 0 and are upgraded on their next write.
    #[serde(default)]
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitOrderResult {
    pub record: RequestRecordDto,
    pub admission: Option<AdmissionResponseDto>,
    pub error: Option<IpcError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOrderResult {
    pub record: RequestRecordDto,
    pub admission: Option<AdmissionResponseDto>,
    pub error: Option<IpcError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderLookupResult {
    pub generation: u64,
    pub orders: Vec<OrderViewDto>,
    pub journal_epoch: String,
    pub state_cursor: String,
    pub resume_token_available: bool,
    pub looked_up_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLookupResult {
    pub record: RequestRecordDto,
    pub found: bool,
    pub admission: Option<AdmissionResponseDto>,
    pub state_cursor: Option<String>,
    pub looked_up_at: String,
    pub error: Option<IpcError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub profile: String,
    pub demo_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyGateDto {
    pub status: String,
    pub can_trade: bool,
    pub min_supported_version: Option<String>,
    pub effective_at: Option<String>,
    pub revision: Option<u64>,
    pub valid_until: Option<String>,
    pub reason: String,
}

impl PolicyGateDto {
    pub fn not_configured(development_build: bool) -> Self {
        Self {
            status: "not_configured".into(),
            can_trade: development_build,
            min_supported_version: None,
            effective_at: None,
            revision: None,
            valid_until: None,
            reason: if development_build {
                "更新服务未配置；当前是开发构建，最低版本策略未启用。".into()
            } else {
                "更新服务未配置或配置无效；正式构建在取得有效策略前关闭新增报单。查询、诊断和服务端允许的撤单仍可用。"
                    .into()
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadataDto {
    pub version: String,
    pub pub_date: String,
    pub notes: String,
    pub release_id: String,
    pub policy_revision: u64,
    pub mandatory: bool,
    pub size_bytes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressDto {
    pub received_bytes: String,
    pub total_bytes: Option<String>,
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStateDto {
    pub configured: bool,
    pub channel: String,
    pub current_version: String,
    pub phase: String,
    pub metadata: Option<UpdateMetadataDto>,
    pub download: Option<DownloadProgressDto>,
    pub policy_gate: PolicyGateDto,
    pub last_checked_at: Option<String>,
    pub error: Option<IpcError>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub state: UpdateStateDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadUpdateResult {
    pub state: UpdateStateDto,
    pub downloaded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateResult {
    pub state: UpdateStateDto,
    pub installing: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticExportResult {
    pub path: String,
    pub created_at: String,
    pub bytes: u64,
    pub redactions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsConfig {
    pub config_dir: String,
    pub address: String,
    pub tls_domain: String,
    pub ca_configured: bool,
    pub token_configured: bool,
    pub fingerprint: String,
    pub issues: Vec<ConfigIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSync {
    pub generation: u64,
    pub journal_epoch: Option<String>,
    pub state_cursor: Option<String>,
    pub durable_cursor: Option<String>,
    pub readiness: Option<String>,
    pub writable: Option<bool>,
    pub stale: Option<bool>,
    pub active_orders: usize,
    pub unknown_event_count: u64,
    pub resync_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsRuntime {
    pub data_dir: String,
    pub installation_id_ref: String,
    pub request_record_count: usize,
    pub unknown_request_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticErrorEntry {
    pub at: String,
    pub category: String,
    pub code: String,
    pub correlation_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    pub app: AppInfo,
    pub generated_at: String,
    pub config: DiagnosticsConfig,
    pub connection: ConnectionState,
    pub sync: DiagnosticsSync,
    pub update: UpdateStateDto,
    pub runtime: DiagnosticsRuntime,
    pub recent_errors: Vec<DiagnosticErrorEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRecoveryDto {
    pub ready: bool,
    pub loading: bool,
    pub total: usize,
    pub unknown: usize,
    pub load_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub app: AppInfo,
    pub config: ConfigSummary,
    pub connection: ConnectionState,
    pub update: UpdateStateDto,
    /// Only a bounded recent window. The requests page loads the full list
    /// on demand via `list_requests`.
    pub requests: Vec<RequestRecordDto>,
    pub request_recovery: RequestRecoveryDto,
    pub diagnostics: DiagnosticsSummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequestsResult {
    pub records: Vec<RequestRecordDto>,
    pub recovery: RequestRecoveryDto,
}
