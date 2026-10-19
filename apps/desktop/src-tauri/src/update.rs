use crate::config::UpdateSettings;
use crate::dto::{
    DownloadProgressDto, DownloadUpdateResult, ErrorCategory, InstallUpdateResult, IpcError,
    PolicyGateDto, UpdateMetadataDto, UpdateStateDto,
};
use crate::error::{update_error, AppResult};
use crate::storage::{atomic_write_json, read_json};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SelectedRelease {
    pub release_id: String,
    pub version: String,
    pub notes: String,
    pub pub_date: String,
    pub download_url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UpdatePolicyResponse {
    pub policy_revision: u64,
    pub channel: String,
    pub target: String,
    pub arch: String,
    pub installer: String,
    pub current_version: String,
    pub min_supported_version: Option<String>,
    pub min_supported_effective_at: Option<String>,
    pub valid_until: String,
    pub forced: bool,
    pub update_available: bool,
    pub selected_release: Option<SelectedRelease>,
    pub manual_install_required: bool,
    pub manual_install_url: Option<String>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct PolicyCache {
    schema_version: u32,
    fetched_at: String,
    policy: UpdatePolicyResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct InstallMarker {
    schema_version: u32,
    version: String,
    release_id: String,
    started_at: String,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    code: String,
    message: String,
    #[serde(default)]
    correlation_id: Option<String>,
    #[serde(default)]
    details: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
struct EligibilityBody {
    eligible: bool,
    release_id: String,
    version: String,
}

#[derive(Debug, Clone)]
struct PendingUpdate {
    release_id: String,
    policy_revision: u64,
    version: String,
    notes: String,
    pub_date: String,
    size: Option<u64>,
    mandatory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct UpdateEventBody {
    event_id: String,
    installation_id: String,
    app_version: String,
    channel: String,
    target: String,
    arch: String,
    installer: String,
    stage: String,
    error_category: Option<String>,
    occurred_at: String,
}

struct CachedPolicy {
    policy: UpdatePolicyResponse,
}

pub struct UpdateManager {
    data_dir: PathBuf,
    installation_id: String,
    current_version: String,
    config: UpdateSettings,
    http: reqwest::Client,
    state: Arc<Mutex<UpdateStateDto>>,
    cached_policy: Mutex<Option<CachedPolicy>>,
    pending: Mutex<Option<PendingUpdate>>,
    downloaded: Mutex<Option<Arc<Vec<u8>>>>,
    forced_block: Mutex<Option<String>>,
    startup_marker: Mutex<Option<InstallMarker>>,
    operation: tokio::sync::Mutex<()>,
}

const TARGET: &str = "windows";
const ARCH: &str = "x86_64";
const INSTALLER: &str = "nsis";

impl UpdateManager {
    pub fn new(
        data_dir: PathBuf,
        installation_id: String,
        current_version: String,
        config: UpdateSettings,
    ) -> Self {
        let mut startup_message = None;
        let marker_path = data_dir.join("pending-install.json");
        let startup_marker = match read_json::<InstallMarker>(&marker_path) {
            Ok(marker) if marker.schema_version == 1 => {
                if marker.version == current_version {
                    startup_message = Some(format!(
                        "当前版本 {} 已启动；等待上报安装确认。",
                        current_version
                    ));
                } else {
                    startup_message = Some(format!(
                        "检测到未完成安装：目标版本 {}，当前仍为 {}。可使用可信安装包人工修复。",
                        marker.version, current_version
                    ));
                }
                Some(marker)
            }
            Ok(_) => None,
            Err(_) => None,
        };
        let cached = read_json::<PolicyCache>(&data_dir.join("update-policy.json"))
            .ok()
            .filter(|cache| cache.schema_version == 1)
            .map(|cache| CachedPolicy {
                policy: cache.policy,
            });
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(format!("OrderHub-Desktop/{current_version}"))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let manager = Self {
            data_dir,
            installation_id,
            current_version: current_version.clone(),
            config,
            http: client,
            state: Arc::new(Mutex::new(UpdateStateDto {
                configured: false,
                channel: "stable".into(),
                current_version,
                phase: "idle".into(),
                metadata: None,
                download: None,
                policy_gate: PolicyGateDto::not_configured(),
                last_checked_at: None,
                error: None,
                message: startup_message.clone(),
            })),
            cached_policy: Mutex::new(cached),
            pending: Mutex::new(None),
            downloaded: Mutex::new(None),
            forced_block: Mutex::new(None),
            startup_marker: Mutex::new(startup_marker),
            operation: tokio::sync::Mutex::new(()),
        };
        let gate = manager.policy_gate();
        manager.with_state(|state| {
            state.configured = manager.config.configured;
            state.channel = manager.config.channel.clone();
            state.current_version = manager.current_version.clone();
            state.phase = if manager.config.configured {
                "idle".into()
            } else {
                "not_configured".into()
            };
            state.policy_gate = gate;
            if !manager.config.configured {
                state.message = Some("未配置更新服务地址；开发构建中最低版本策略未启用。".into());
            }
        });
        manager
    }

    fn with_state<R>(&self, update: impl FnOnce(&mut UpdateStateDto) -> R) -> R {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let result = update(&mut state);
        state.policy_gate = self.policy_gate();
        result
    }

    pub fn current_state(&self) -> UpdateStateDto {
        self.with_state(|state| state.clone())
    }

    pub fn policy_gate(&self) -> PolicyGateDto {
        if !self.config.configured {
            return PolicyGateDto::not_configured();
        }
        if let Some(reason) = self
            .forced_block
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
        {
            return PolicyGateDto {
                status: "valid".into(),
                can_trade: false,
                min_supported_version: None,
                effective_at: None,
                revision: None,
                valid_until: None,
                reason,
            };
        }
        if !self.config.enforce_min_version {
            return PolicyGateDto {
                status: "valid".into(),
                can_trade: true,
                min_supported_version: None,
                effective_at: None,
                revision: None,
                valid_until: None,
                reason: "配置已关闭最低版本策略。".into(),
            };
        }
        let cached = self
            .cached_policy
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let Some(cached) = cached.as_ref() else {
            return PolicyGateDto {
                status: "missing".into(),
                can_trade: false,
                min_supported_version: None,
                effective_at: None,
                revision: None,
                valid_until: None,
                reason:
                    "尚无有效的更新策略，写入已进入受限模式；查询、诊断和服务端允许的撤单仍可用。"
                        .into(),
            };
        };
        let policy = &cached.policy;
        let valid_until = chrono::DateTime::parse_from_rfc3339(&policy.valid_until)
            .ok()
            .map(|value| value.with_timezone(&chrono::Utc));
        let expired = match valid_until {
            Some(value) => chrono::Utc::now() > value,
            None => true,
        };
        if expired {
            return PolicyGateDto {
                status: "expired".into(),
                can_trade: false,
                min_supported_version: policy.min_supported_version.clone(),
                effective_at: policy.min_supported_effective_at.clone(),
                revision: Some(policy.policy_revision),
                valid_until: Some(policy.valid_until.clone()),
                reason: "更新策略已超过有效期，写入进入受限模式；请检查更新服务。".into(),
            };
        }
        let min = policy.min_supported_version.as_deref();
        let effective = policy
            .min_supported_effective_at
            .as_deref()
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.with_timezone(&chrono::Utc));
        let min_active = min.is_some()
            && effective
                .map(|value| chrono::Utc::now() >= value)
                .unwrap_or(true);
        if min_active {
            if let (Ok(current), Some(minimum)) = (
                Version::parse(&self.current_version),
                min.and_then(|value| Version::parse(value).ok()),
            ) {
                if current < minimum {
                    return PolicyGateDto {
                        status: "valid".into(),
                        can_trade: false,
                        min_supported_version: min.map(str::to_string),
                        effective_at: policy.min_supported_effective_at.clone(),
                        revision: Some(policy.policy_revision),
                        valid_until: Some(policy.valid_until.clone()),
                        reason: format!(
                            "当前版本 {} 低于最低支持版本 {}；新增报单已关闭，请安装更新。查询、诊断及服务允许的撤单仍可用。",
                            self.current_version, minimum
                        ),
                    };
                }
            } else {
                return PolicyGateDto {
                    status: "valid".into(),
                    can_trade: false,
                    min_supported_version: min.map(str::to_string),
                    effective_at: policy.min_supported_effective_at.clone(),
                    revision: Some(policy.policy_revision),
                    valid_until: Some(policy.valid_until.clone()),
                    reason: "无法解析最低支持版本，写入已保守关闭。".into(),
                };
            }
        }
        PolicyGateDto {
            status: "valid".into(),
            can_trade: true,
            min_supported_version: policy.min_supported_version.clone(),
            effective_at: policy.min_supported_effective_at.clone(),
            revision: Some(policy.policy_revision),
            valid_until: Some(policy.valid_until.clone()),
            reason: format!("更新策略有效（revision {}）。", policy.policy_revision),
        }
    }

    fn headers(&self, correlation_id: &str) -> AppResult<HeaderMap> {
        let mut headers = HeaderMap::new();
        let installation = HeaderValue::from_str(&self.installation_id).map_err(|_| {
            update_error("INSTALLATION_ID_INVALID", "installation_id 不是合法请求头")
        })?;
        headers.insert(HeaderName::from_static("x-installation-id"), installation);
        headers.insert(
            HeaderName::from_static("x-installation-type"),
            HeaderValue::from_static(INSTALLER),
        );
        if let Ok(value) = HeaderValue::from_str(correlation_id) {
            headers.insert(HeaderName::from_static("x-correlation-id"), value);
        }
        Ok(headers)
    }

    async fn fetch_policy(&self, correlation_id: &str) -> Result<UpdatePolicyResponse, IpcError> {
        let base = self
            .config
            .base_url
            .as_deref()
            .ok_or_else(|| update_error("UPDATE_NOT_CONFIGURED", "未配置更新服务地址"))?;
        let url = format!(
            "{base}/v1/update-policy/{}/{}/{}/{}?installer={}",
            self.config.channel, TARGET, ARCH, self.current_version, INSTALLER
        );
        let response = self
            .http
            .get(&url)
            .headers(self.headers(correlation_id)?)
            .send()
            .await
            .map_err(|error| {
                update_error(
                    "UPDATE_POLICY_UNREACHABLE",
                    format!("获取更新策略失败：{error}"),
                )
                .retryable(true)
            })?;
        let status = response.status();
        if !status.is_success() {
            return Err(self.api_error(response).await);
        }
        response
            .json::<UpdatePolicyResponse>()
            .await
            .map_err(|error| {
                update_error(
                    "UPDATE_POLICY_INVALID",
                    format!("更新策略响应无效：{error}"),
                )
            })
    }

    async fn api_error(&self, response: reqwest::Response) -> IpcError {
        let status = response.status();
        let body = response.json::<ApiErrorBody>().await.ok();
        let code = body
            .as_ref()
            .map(|body| body.code.clone())
            .unwrap_or_else(|| format!("HTTP_{}", status.as_u16()));
        let message = body
            .as_ref()
            .map(|body| body.message.clone())
            .unwrap_or_else(|| format!("更新服务返回 HTTP {}", status.as_u16()));
        let category = if status.as_u16() == 409 || status.as_u16() == 410 || status.as_u16() == 503
        {
            ErrorCategory::Policy
        } else {
            ErrorCategory::Update
        };
        let mut error = IpcError::new(category, code, message)
            .retryable(status.is_server_error() && status.as_u16() != 503);
        if let Some(body) = body {
            if let Some(correlation) = body.correlation_id {
                error.correlation_id = correlation;
            }
            if let Some(details) = body.details {
                error.details = Some(details);
            }
        }
        error
    }

    fn cache_policy(&self, policy: &UpdatePolicyResponse) {
        let fetched_at = chrono::Utc::now().to_rfc3339();
        let cache = PolicyCache {
            schema_version: 1,
            fetched_at: fetched_at.clone(),
            policy: policy.clone(),
        };
        if let Err(error) = atomic_write_json(&self.data_dir.join("update-policy.json"), &cache) {
            self.with_state(|state| {
                state.message = Some(format!("更新策略已获取，但本地缓存失败：{error}"));
            });
        }
        *self
            .cached_policy
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(CachedPolicy {
            policy: policy.clone(),
        });
    }

    fn metadata_from_policy(policy: &UpdatePolicyResponse) -> Option<UpdateMetadataDto> {
        policy
            .selected_release
            .as_ref()
            .map(|release| UpdateMetadataDto {
                version: release.version.clone(),
                pub_date: release.pub_date.clone(),
                notes: release.notes.clone(),
                release_id: release.release_id.clone(),
                policy_revision: policy.policy_revision,
                mandatory: policy.forced,
                size_bytes: Some(release.size.to_string()),
            })
    }

    async fn updater_check(
        &self,
        app: &AppHandle,
        release_id: &str,
        revision: u64,
        expected_version: &str,
        correlation_id: &str,
    ) -> Result<Update, IpcError> {
        let base = self
            .config
            .base_url
            .as_deref()
            .ok_or_else(|| update_error("UPDATE_NOT_CONFIGURED", "未配置更新服务地址"))?;
        let endpoint = format!(
            "{base}/v1/updates/{}/{}/{}/{}?installer={}&release_id={}&policy_revision={}",
            self.config.channel,
            TARGET,
            ARCH,
            self.current_version,
            INSTALLER,
            urlencoding(release_id),
            revision
        );
        let endpoint = Url::parse(&endpoint).map_err(|error| {
            update_error("UPDATE_ENDPOINT_INVALID", format!("更新地址无效：{error}"))
        })?;
        let headers = self.headers(correlation_id)?;
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|error| {
                update_error(
                    "UPDATER_ENDPOINT_FAILED",
                    format!("更新端点配置失败：{error}"),
                )
            })?
            .headers(headers)
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| {
                update_error("UPDATER_CONFIG_FAILED", format!("更新器配置失败：{error}"))
            })?;
        let update = updater
            .check()
            .await
            .map_err(|error| update_error("UPDATE_CHECK_FAILED", format!("检查更新失败：{error}")))?
            .ok_or_else(|| {
                update_error(
                    "UPDATE_NOT_AVAILABLE",
                    "策略选中了版本，但更新端点没有返回对应更新",
                )
            })?;
        if update.version != expected_version {
            return Err(update_error(
                "UPDATE_VERSION_MISMATCH",
                format!(
                    "更新端点返回 {}，但策略固定的是 {}",
                    update.version, expected_version
                ),
            ));
        }
        Ok(update)
    }

    async fn fetch_eligibility(
        &self,
        release_id: &str,
        revision: u64,
        correlation_id: &str,
    ) -> Result<EligibilityBody, IpcError> {
        let base = self
            .config
            .base_url
            .as_deref()
            .ok_or_else(|| update_error("UPDATE_NOT_CONFIGURED", "未配置更新服务地址"))?;
        let url = format!(
            "{base}/v1/releases/{}/eligibility?channel={}&target={}&arch={}&current_version={}&installer={}&policy_revision={}",
            urlencoding(release_id),
            self.config.channel,
            TARGET,
            ARCH,
            self.current_version,
            INSTALLER,
            revision
        );
        let response = self
            .http
            .get(&url)
            .headers(self.headers(correlation_id)?)
            .send()
            .await
            .map_err(|error| {
                update_error(
                    "UPDATE_ELIGIBILITY_UNREACHABLE",
                    format!("安装前资格复核失败：{error}"),
                )
                .retryable(true)
            })?;
        if !response.status().is_success() {
            return Err(self.api_error(response).await);
        }
        response.json::<EligibilityBody>().await.map_err(|error| {
            update_error(
                "UPDATE_ELIGIBILITY_INVALID",
                format!("资格响应无效：{error}"),
            )
        })
    }

    pub async fn check_update(&self, app: &AppHandle, _manual: bool) -> AppResult<UpdateStateDto> {
        if !self.config.configured {
            self.with_state(|state| {
                state.phase = "not_configured".into();
                state.message = Some("未配置更新服务地址。".into());
                state.error = None;
            });
            return Ok(self.current_state());
        }
        let _guard = self.operation.lock().await;
        self.with_state(|state| {
            state.phase = "checking".into();
            state.error = None;
            state.message = Some("正在检查更新策略与版本。".into());
        });
        let correlation = uuid::Uuid::new_v4().to_string();
        let policy = match self.fetch_policy(&correlation).await {
            Ok(policy) => policy,
            Err(error) => {
                let is_forced_unavailable = error.code == "FORCED_UPDATE_UNAVAILABLE";
                if is_forced_unavailable {
                    *self
                        .forced_block
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner()) = Some(error.message.clone());
                }
                self.with_state(|state| {
                    state.phase = "failed".into();
                    state.error = Some(error.clone());
                    state.message = Some("更新检查失败。".into());
                    if is_forced_unavailable {
                        state.message = Some(
                            "当前版本低于最低支持版本且没有可用升级包；请人工安装可信安装包。"
                                .into(),
                        );
                    }
                });
                self.report_event("failure", Some(error.code.clone()));
                return Ok(self.current_state());
            }
        };
        self.cache_policy(&policy);
        *self
            .forced_block
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = None;
        let published = policy.selected_release.clone();
        let metadata = Self::metadata_from_policy(&policy);
        if let (true, Some(release), Some(metadata)) =
            (policy.update_available, published, metadata)
        {
            if let Err(error) = self
                .updater_check(
                    app,
                    &release.release_id,
                    policy.policy_revision,
                    &release.version,
                    &correlation,
                )
                .await
            {
                self.with_state(|state| {
                    state.phase = "failed".into();
                    state.error = Some(error.clone());
                    state.message = Some("更新策略可用，但更新器检查失败。".into());
                });
                self.report_event("failure", Some(error.code.clone()));
                return Ok(self.current_state());
            }
            *self
                .pending
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) = Some(PendingUpdate {
                release_id: release.release_id.clone(),
                policy_revision: policy.policy_revision,
                version: release.version.clone(),
                notes: release.notes.clone(),
                pub_date: release.pub_date.clone(),
                size: Some(release.size),
                mandatory: policy.forced,
            });
            *self
                .downloaded
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) = None;
            self.with_state(|state| {
                state.phase = "available".into();
                state.metadata = Some(metadata);
                state.download = None;
                state.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
                state.message = Some(if policy.forced {
                    "存在必须安装的更新。".into()
                } else {
                    "发现可用更新。".into()
                });
                state.error = None;
            });
        } else {
            *self
                .pending
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) = None;
            *self
                .downloaded
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) = None;
            self.with_state(|state| {
                state.phase = "up_to_date".into();
                state.metadata = None;
                state.download = None;
                state.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
                state.message = Some("当前版本符合更新策略，没有可用更新。".into());
                state.error = None;
            });
        }
        self.report_event("check", None);
        Ok(self.current_state())
    }

    pub async fn download_update(
        &self,
        app: &AppHandle,
        progress: Channel<DownloadProgressDto>,
    ) -> AppResult<DownloadUpdateResult> {
        let _guard = self.operation.lock().await;
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
            .ok_or_else(|| update_error("UPDATE_NOT_READY", "没有可下载的更新，请先检查更新"))?;
        let correlation = uuid::Uuid::new_v4().to_string();
        self.with_state(|state| {
            state.phase = "downloading".into();
            state.error = None;
            state.message = Some(format!("正在下载 {}。", pending.version));
            state.download = Some(DownloadProgressDto {
                received_bytes: "0".into(),
                total_bytes: pending.size.map(|size| size.to_string()),
                percent: Some(0.0),
            });
        });
        self.report_event("download_started", None);
        let update = self
            .updater_check(
                app,
                &pending.release_id,
                pending.policy_revision,
                &pending.version,
                &correlation,
            )
            .await?;
        let state = self.state.clone();
        let channel = progress.clone();
        let total = pending.size;
        let mut received = 0_u64;
        let bytes = update
            .download(
                move |chunk: usize, content_length: Option<u64>| {
                    received += chunk as u64;
                    let total = content_length.or(total);
                    let percent = total
                        .filter(|total| *total > 0)
                        .map(|total| (received as f64 / total as f64 * 100.0).min(100.0));
                    let progress = DownloadProgressDto {
                        received_bytes: received.to_string(),
                        total_bytes: total.map(|value| value.to_string()),
                        percent,
                    };
                    {
                        let mut state = state.lock().unwrap_or_else(|poison| poison.into_inner());
                        state.download = Some(progress.clone());
                    }
                    let _ = channel.send(progress);
                },
                || {},
            )
            .await
            .map_err(|error| {
                let mapped =
                    update_error("UPDATE_DOWNLOAD_FAILED", format!("下载或验签失败：{error}"))
                        .retryable(true);
                self.with_state(|state| {
                    state.phase = "failed".into();
                    state.error = Some(mapped.clone());
                    state.message = Some("更新下载失败，可重试。".into());
                });
                self.report_event("failure", Some(mapped.code.clone()));
                mapped
            })?;
        update.verify(&bytes).map_err(|error| {
            update_error("UPDATE_VERIFY_FAILED", format!("更新包验签失败：{error}"))
        })?;
        if let Some(expected) = pending.size {
            if bytes.len() as u64 != expected {
                let error = update_error(
                    "UPDATE_SIZE_MISMATCH",
                    format!("更新包大小 {} 与策略记录 {} 不一致", bytes.len(), expected),
                );
                self.with_state(|state| {
                    state.phase = "failed".into();
                    state.error = Some(error.clone());
                });
                return Err(error);
            }
        }
        let downloaded_len = bytes.len() as u64;
        *self
            .downloaded
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(Arc::new(bytes));
        self.with_state(|state| {
            state.phase = "ready".into();
            state.error = None;
            state.message = Some("安装包已下载并通过 Tauri 签名校验，等待安装。".into());
            state.download = Some(DownloadProgressDto {
                received_bytes: downloaded_len.to_string(),
                total_bytes: pending.size.map(|size| size.to_string()),
                percent: Some(100.0),
            });
            state.metadata = Some(UpdateMetadataDto {
                version: pending.version.clone(),
                pub_date: pending.pub_date.clone(),
                notes: pending.notes.clone(),
                release_id: pending.release_id.clone(),
                policy_revision: pending.policy_revision,
                mandatory: pending.mandatory,
                size_bytes: pending.size.map(|size| size.to_string()),
            });
        });
        self.report_event("download_completed", None);
        Ok(DownloadUpdateResult {
            state: self.current_state(),
            downloaded: true,
        })
    }

    pub async fn prepare_install(
        &self,
        app: &AppHandle,
        confirm_unknown_requests: bool,
        unknown_requests: usize,
    ) -> AppResult<(Update, Arc<Vec<u8>>)> {
        let _guard = self.operation.lock().await;
        if unknown_requests > 0 && !confirm_unknown_requests {
            return Err(update_error(
                "UNKNOWN_REQUESTS_PENDING",
                format!(
                    "还有 {unknown_requests} 条结果未知的请求；请先查询原请求，或明确确认后再安装。"
                ),
            )
            .retryable(false));
        }
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
            .ok_or_else(|| update_error("UPDATE_NOT_READY", "没有待安装的更新"))?;
        let bytes = self
            .downloaded
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
            .ok_or_else(|| update_error("UPDATE_NOT_READY", "更新包尚未下载完成"))?;
        let correlation = uuid::Uuid::new_v4().to_string();
        let eligibility = self
            .fetch_eligibility(&pending.release_id, pending.policy_revision, &correlation)
            .await?;
        if !eligibility.eligible
            || eligibility.release_id != pending.release_id
            || eligibility.version != pending.version
        {
            let error = update_error(
                "UPDATE_ELIGIBILITY_CHANGED",
                "安装前复核发现发布资格已变化，已取消安装。",
            );
            *self
                .downloaded
                .lock()
                .unwrap_or_else(|poison| poison.into_inner()) = None;
            self.with_state(|state| {
                state.phase = "failed".into();
                state.error = Some(error.clone());
            });
            return Err(error);
        }
        let update = self
            .updater_check(
                app,
                &pending.release_id,
                pending.policy_revision,
                &pending.version,
                &correlation,
            )
            .await?;
        update.verify(&bytes).map_err(|error| {
            update_error("UPDATE_VERIFY_FAILED", format!("安装前验签失败：{error}"))
        })?;
        Ok((update, bytes))
    }

    pub async fn install(
        &self,
        _app: &AppHandle,
        update: Update,
        bytes: Arc<Vec<u8>>,
    ) -> AppResult<InstallUpdateResult> {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
            .ok_or_else(|| update_error("UPDATE_NOT_READY", "没有待安装的更新"))?;
        let marker = InstallMarker {
            schema_version: 1,
            version: pending.version.clone(),
            release_id: pending.release_id.clone(),
            started_at: chrono::Utc::now().to_rfc3339(),
        };
        atomic_write_json(&self.data_dir.join("pending-install.json"), &marker).map_err(
            |error| {
                update_error(
                    "INSTALL_MARKER_FAILED",
                    format!("写入安装标记失败：{error}"),
                )
            },
        )?;
        self.with_state(|state| {
            state.phase = "installing".into();
            state.error = None;
            state.message = Some("正在启动安装器；应用将退出并重启。".into());
        });
        self.report_event("install_started", None);
        update
            .install(bytes.as_ref())
            .map_err(|error| update_error("INSTALL_FAILED", format!("启动安装器失败：{error}")))?;
        Ok(InstallUpdateResult {
            state: self.current_state(),
            installing: true,
            message: "安装器已启动；Windows 上应用将退出。".into(),
        })
    }

    pub async fn confirm_startup(&self) -> bool {
        let marker = self
            .startup_marker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone();
        let Some(marker) = marker else {
            return false;
        };
        if marker.version != self.current_version {
            self.with_state(|state| {
                state.message = Some(format!(
                    "上次安装目标为 {}，当前仍运行 {}；不会上报启动成功。",
                    marker.version, self.current_version
                ));
            });
            return false;
        }
        let marker_path = self.data_dir.join("pending-install.json");
        let _ = std::fs::remove_file(&marker_path);
        *self
            .startup_marker
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = None;
        self.report_event("start_confirmed", None);
        self.with_state(|state| {
            state.message = Some(format!("新版本 {} 已启动并确认。", self.current_version));
        });
        true
    }

    pub fn installation_id_ref(&self) -> String {
        let chars: Vec<char> = self.installation_id.chars().collect();
        let start = chars.len().saturating_sub(8);
        chars[start..].iter().collect()
    }

    fn report_event(&self, stage: &str, error_category: Option<String>) {
        if !self.config.configured {
            return;
        }
        let base = match self.config.base_url.clone() {
            Some(base) => base,
            None => return,
        };
        let body = UpdateEventBody {
            event_id: uuid::Uuid::new_v4().to_string(),
            installation_id: self.installation_id.clone(),
            app_version: self.current_version.clone(),
            channel: self.config.channel.clone(),
            target: TARGET.into(),
            arch: ARCH.into(),
            installer: INSTALLER.into(),
            stage: stage.into(),
            error_category,
            occurred_at: chrono::Utc::now().to_rfc3339(),
        };
        let client = self.http.clone();
        let url = format!("{base}/v1/update-events");
        tokio::spawn(async move {
            let _ = client.post(url).json(&body).send().await;
        });
    }
}

fn urlencoding(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}
