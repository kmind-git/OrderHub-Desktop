use crate::config::{require_connection, ConnectionSettings, LoadedConfig};
use crate::dto::{ConnectionState, IpcError, OrderViewDto, SessionEvent, SnapshotDto};
use crate::error::{grpc_error, is_auth_failure, requires_resync};
use crate::grpc::{self, pb, SnapshotBaseline};
use rand::Rng;
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;
use tonic::transport::Channel as GrpcChannel;

#[derive(Debug, Clone)]
pub struct Checkpoint {
    pub epoch: String,
    pub seq: String,
    pub token: String,
}

#[derive(Debug, Clone)]
struct PendingToken {
    epoch: String,
    seq: String,
    token: String,
}

#[derive(Clone, Debug)]
pub struct BaselineState {
    pub snapshot: SnapshotDto,
    pub active_order_ids: HashSet<String>,
}

pub struct SessionShared {
    pub generation: u64,
    pub correlation_id: String,
    pub config: LoadedConfig,
    phase: Mutex<ConnectionState>,
    baseline: Mutex<Option<BaselineState>>,
    checkpoint: Mutex<Checkpoint>,
    pending_tokens: Mutex<VecDeque<PendingToken>>,
    channel: Mutex<Option<GrpcChannel>>,
    pub cancel: CancellationToken,
    pub unacked: AtomicUsize,
    pub resync_count: AtomicU64,
    pub unknown_event_count: AtomicU64,
}

impl SessionShared {
    pub fn new(generation: u64, config: LoadedConfig, correlation_id: String) -> Self {
        Self {
            generation,
            correlation_id,
            config,
            phase: Mutex::new(ConnectionState::new(generation, "connecting")),
            baseline: Mutex::new(None),
            checkpoint: Mutex::new(Checkpoint {
                epoch: String::new(),
                seq: String::new(),
                token: String::new(),
            }),
            pending_tokens: Mutex::new(VecDeque::new()),
            channel: Mutex::new(None),
            cancel: CancellationToken::new(),
            unacked: AtomicUsize::new(0),
            resync_count: AtomicU64::new(0),
            unknown_event_count: AtomicU64::new(0),
        }
    }

    pub fn connection(&self) -> ConnectionState {
        self.phase
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    pub fn set_phase(
        &self,
        phase: &str,
        detail: Option<String>,
        error: Option<IpcError>,
    ) -> ConnectionState {
        let mut state = ConnectionState::new(self.generation, phase);
        state.detail = detail;
        state.error = error;
        if let Some(baseline) = self
            .baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_ref()
        {
            state.readiness = Some(baseline.snapshot.readiness.clone());
            state.writable = Some(baseline.snapshot.writable);
            state.stale = Some(baseline.snapshot.stale);
            state.persistence_mode = Some(baseline.snapshot.persistence_mode.clone());
        }
        *self
            .phase
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = state.clone();
        state
    }

    pub fn set_baseline(&self, baseline: SnapshotBaseline) {
        let checkpoint = Checkpoint {
            epoch: baseline.dto.journal_epoch.clone(),
            seq: baseline.dto.state_cursor.clone(),
            token: baseline.resume_token.clone(),
        };
        let active_order_ids = baseline
            .dto
            .active_orders
            .iter()
            .map(|order| order.client_order_id.clone())
            .collect();
        *self
            .baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(BaselineState {
            snapshot: baseline.dto,
            active_order_ids,
        });
        *self
            .checkpoint
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = checkpoint;
        self.pending_tokens
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clear();
        self.unacked.store(0, Ordering::SeqCst);
    }

    pub fn snapshot(&self) -> Option<SnapshotDto> {
        self.baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_ref()
            .map(|baseline| baseline.snapshot.clone())
    }

    pub fn baseline(&self) -> Option<BaselineState> {
        self.baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    pub fn checkpoint(&self) -> Checkpoint {
        self.checkpoint
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    pub fn set_channel(&self, channel: GrpcChannel) {
        *self
            .channel
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Some(channel);
    }

    pub fn channel(&self) -> Option<GrpcChannel> {
        self.channel
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clone()
    }

    pub fn is_active_order(&self, client_order_id: &str) -> bool {
        self.baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_ref()
            .map(|baseline| baseline.active_order_ids.contains(client_order_id))
            .unwrap_or(false)
    }

    pub fn add_active_order(&self, client_order_id: &str) {
        if client_order_id.is_empty() {
            return;
        }
        if let Some(baseline) = self
            .baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_mut()
        {
            baseline
                .active_order_ids
                .insert(client_order_id.to_string());
        }
    }

    pub fn apply_order_view(&self, order: &OrderViewDto) {
        let terminal = matches!(
            order.status.as_str(),
            "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED"
        );
        if let Some(baseline) = self
            .baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_mut()
        {
            if terminal {
                baseline.active_order_ids.remove(&order.client_order_id);
            } else {
                baseline
                    .active_order_ids
                    .insert(order.client_order_id.clone());
            }
        }
    }

    pub fn apply_control(&self, readiness: &str, writable: bool) {
        if let Some(baseline) = self
            .baseline
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .as_mut()
        {
            baseline.snapshot.readiness = readiness.to_string();
            baseline.snapshot.writable = writable;
        }
    }

    pub fn record_pending_token(&self, epoch: &str, seq: &str, token: &str) {
        let token = if token.is_empty() {
            self.checkpoint().token
        } else {
            token.to_string()
        };
        let mut pending = self
            .pending_tokens
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        pending.push_back(PendingToken {
            epoch: epoch.to_string(),
            seq: seq.to_string(),
            token,
        });
        while pending.len() > 4096 {
            pending.pop_front();
        }
        self.unacked.fetch_add(1, Ordering::SeqCst);
    }

    pub fn ack(&self, epoch: &str, seq: &str) -> bool {
        let mut pending = self
            .pending_tokens
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let index = pending
            .iter()
            .rposition(|entry| entry.epoch == epoch && entry.seq == seq);
        let Some(index) = index else {
            return false;
        };
        let token = pending[index].token.clone();
        for _ in 0..=index {
            pending.pop_front();
        }
        *self
            .checkpoint
            .lock()
            .unwrap_or_else(|poison| poison.into_inner()) = Checkpoint {
            epoch: epoch.to_string(),
            seq: seq.to_string(),
            token,
        };
        self.unacked.store(0, Ordering::SeqCst);
        true
    }

    pub fn clear_pending(&self) {
        self.pending_tokens
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .clear();
        self.unacked.store(0, Ordering::SeqCst);
    }
}

struct Backoff {
    attempt: u32,
}

impl Backoff {
    fn new() -> Self {
        Self { attempt: 0 }
    }

    fn reset(&mut self) {
        self.attempt = 0;
    }

    fn delay(&mut self) -> Duration {
        let base = 500_u64.saturating_mul(1_u64 << self.attempt.min(6));
        let capped = base.min(30_000);
        self.attempt = self.attempt.saturating_add(1);
        let jitter = rand::rng().random_range(0.8_f64..=1.2_f64);
        Duration::from_millis((capped as f64 * jitter) as u64)
    }
}

fn send_event(events: &Channel<SessionEvent>, event: SessionEvent) -> bool {
    events.send(event).is_ok()
}

fn emit_status(
    shared: &SessionShared,
    events: &Channel<SessionEvent>,
    phase: &str,
    detail: Option<String>,
    error: Option<IpcError>,
) -> bool {
    let state = shared.set_phase(phase, detail, error);
    send_event(events, SessionEvent::Status { state })
}

async fn sleep_or_cancel(cancel: &CancellationToken, duration: Duration) {
    tokio::select! {
        _ = cancel.cancelled() => {}
        _ = tokio::time::sleep(duration) => {}
    }
}

pub async fn run_session(shared: Arc<SessionShared>, events: Channel<SessionEvent>) {
    let settings: ConnectionSettings = match require_connection(&shared.config) {
        Ok(settings) => settings,
        Err(error) => {
            let _ = emit_status(
                &shared,
                &events,
                "error",
                Some("配置无效，无法建立业务连接".into()),
                Some(error),
            );
            return;
        }
    };
    let mut backoff = Backoff::new();
    let mut channel: Option<GrpcChannel> = None;
    let mut need_snapshot = true;
    // Only the opening handshake is bounded. The long-lived stream keeps its
    // own stall timeout after it has been established.
    let watch_open_timeout = settings.connect_timeout.max(Duration::from_secs(15));

    loop {
        if shared.cancel.is_cancelled() {
            break;
        }

        if channel.is_none() {
            let _ = emit_status(
                &shared,
                &events,
                "connecting",
                Some("正在建立 TLS 连接".into()),
                None,
            );
            match grpc::build_channel(&settings).await {
                Ok(grpc_channel) => {
                    shared.set_channel(grpc_channel.clone());
                    channel = Some(grpc_channel);
                    backoff.reset();
                }
                Err(error) => {
                    let retryable = error.retryable;
                    let _ = emit_status(
                        &shared,
                        &events,
                        if retryable { "reconnecting" } else { "error" },
                        Some("业务服务连接失败".into()),
                        Some(error),
                    );
                    if !retryable {
                        return;
                    }
                    sleep_or_cancel(&shared.cancel, backoff.delay()).await;
                    continue;
                }
            }
        }
        let grpc_channel = channel.clone().expect("channel checked above");

        if need_snapshot {
            let _ = emit_status(
                &shared,
                &events,
                "syncing",
                Some("正在获取完整快照（含活动订单分页）".into()),
                None,
            );
            match grpc::fetch_snapshot(
                &grpc_channel,
                &settings,
                shared.generation,
                Some(&shared.cancel),
            )
            .await
            {
                Ok(baseline) => {
                    if shared.cancel.is_cancelled() {
                        return;
                    }
                    let readiness = baseline.dto.readiness.clone();
                    let writable = baseline.dto.writable;
                    shared.set_baseline(baseline);
                    let snapshot = shared.snapshot().expect("baseline stored");
                    if !send_event(&events, SessionEvent::Snapshot { snapshot }) {
                        shared.cancel.cancel();
                        return;
                    }
                    // A snapshot alone is not business readiness: WatchEvents
                    // must be established before the session may accept new
                    // orders, otherwise the client can act while every later
                    // event is missing. Keep the session in `syncing` until the
                    // stream response headers arrive.
                    let _ = emit_status(
                        &shared,
                        &events,
                        "syncing",
                        Some(format!(
                            "快照已建立（readiness={readiness}，writable={writable}），正在建立事件流"
                        )),
                        None,
                    );
                    need_snapshot = false;
                    backoff.reset();
                }
                Err(error) => {
                    if is_auth_failure(&error) {
                        let _ = emit_status(
                            &shared,
                            &events,
                            "reauth_required",
                            Some("认证或权限失败，请检查 Token 后显式重新连接".into()),
                            Some(error),
                        );
                        return;
                    }
                    let _ = emit_status(
                        &shared,
                        &events,
                        "reconnecting",
                        Some("快照获取失败，稍后重试".into()),
                        Some(error),
                    );
                    sleep_or_cancel(&shared.cancel, backoff.delay()).await;
                    continue;
                }
            }
        }

        let checkpoint = shared.checkpoint();
        let opened = tokio::select! {
            _ = shared.cancel.cancelled() => return,
            result = tokio::time::timeout(
                watch_open_timeout,
                grpc::open_watch(
                    &grpc_channel,
                    &settings,
                    &checkpoint.seq,
                    &checkpoint.epoch,
                    &checkpoint.token,
                ),
            ) => result,
        };
        let stream = match opened {
            Ok(Ok(stream)) => stream,
            Ok(Err(error)) => {
                if is_auth_failure(&error) {
                    let _ = emit_status(
                        &shared,
                        &events,
                        "reauth_required",
                        Some("事件流认证失败，请检查 Token".into()),
                        Some(error),
                    );
                    return;
                }
                if requires_resync(&error) {
                    shared.resync_count.fetch_add(1, Ordering::SeqCst);
                    shared.clear_pending();
                    let _ = send_event(
                        &events,
                        SessionEvent::Resync {
                            generation: shared.generation,
                            reason: "WATCH_OPEN_REQUIRES_RESYNC".into(),
                            message: "事件流要求重新建立快照基线".into(),
                        },
                    );
                    need_snapshot = true;
                    continue;
                }
                let _ = emit_status(
                    &shared,
                    &events,
                    "reconnecting",
                    Some("事件流连接失败".into()),
                    Some(error),
                );
                sleep_or_cancel(&shared.cancel, backoff.delay()).await;
                continue;
            }
            Err(_) => {
                let error = IpcError::new(
                    crate::dto::ErrorCategory::Transport,
                    "WATCH_OPEN_TIMEOUT",
                    format!(
                        "事件流在 {} 秒内没有返回响应头，已取消并准备重试",
                        watch_open_timeout.as_secs()
                    ),
                )
                .retryable(true);
                let _ = emit_status(
                    &shared,
                    &events,
                    "reconnecting",
                    Some("事件流建立超时".into()),
                    Some(error),
                );
                sleep_or_cancel(&shared.cancel, backoff.delay()).await;
                continue;
            }
        };

        if shared.cancel.is_cancelled() {
            return;
        }
        let phase = shared
            .baseline()
            .map(|baseline| {
                if baseline.snapshot.stale {
                    "stale"
                } else {
                    "synced"
                }
            })
            .unwrap_or("synced");
        let detail = shared
            .baseline()
            .map(|baseline| {
                format!(
                    "事件流已连接，readiness={}，writable={}",
                    baseline.snapshot.readiness, baseline.snapshot.writable
                )
            })
            .unwrap_or_else(|| "事件流已连接".into());
        let _ = emit_status(&shared, &events, phase, Some(detail), None);
        backoff.reset();

        let outcome = consume_watch(&shared, &events, stream).await;
        match outcome {
            WatchOutcome::Cancelled => return,
            WatchOutcome::Auth(error) => {
                let _ = emit_status(
                    &shared,
                    &events,
                    "reauth_required",
                    Some("事件流认证或权限失败，写入已关闭".into()),
                    Some(error),
                );
                return;
            }
            WatchOutcome::Resync { reason, message } => {
                shared.resync_count.fetch_add(1, Ordering::SeqCst);
                shared.clear_pending();
                let _ = send_event(
                    &events,
                    SessionEvent::Resync {
                        generation: shared.generation,
                        reason,
                        message: message.clone(),
                    },
                );
                let _ = emit_status(&shared, &events, "syncing", Some(message), None);
                need_snapshot = true;
                continue;
            }
            WatchOutcome::Reconnect(error) => {
                let _ = emit_status(
                    &shared,
                    &events,
                    "reconnecting",
                    Some("事件流中断，准备从最后已应用检查点续传".into()),
                    Some(error),
                );
                sleep_or_cancel(&shared.cancel, backoff.delay()).await;
                continue;
            }
        }
    }
}

enum WatchOutcome {
    Cancelled,
    Auth(IpcError),
    Resync { reason: String, message: String },
    Reconnect(IpcError),
}

async fn consume_watch(
    shared: &Arc<SessionShared>,
    events: &Channel<SessionEvent>,
    mut stream: tonic::Streaming<pb::JournalEvent>,
) -> WatchOutcome {
    let timeout = shared.config.watch_timeout;
    loop {
        if shared.cancel.is_cancelled() {
            return WatchOutcome::Cancelled;
        }
        let result = tokio::select! {
            _ = shared.cancel.cancelled() => return WatchOutcome::Cancelled,
            result = tokio::time::timeout(timeout, stream.message()) => result,
        };
        match result {
            Err(_) => {
                return WatchOutcome::Reconnect(
                    IpcError::new(
                        crate::dto::ErrorCategory::Transport,
                        "WATCH_STALLED",
                        "事件流在配置的停滞时间内没有收到任何消息，准备续传",
                    )
                    .retryable(true),
                );
            }
            Ok(Err(status)) => {
                let error = grpc_error(&status, &shared.correlation_id);
                if is_auth_failure(&error) {
                    return WatchOutcome::Auth(error);
                }
                if requires_resync(&error) {
                    return WatchOutcome::Resync {
                        reason: "WATCH_STREAM_REQUIRES_RESYNC".into(),
                        message: error.message.clone(),
                    };
                }
                return WatchOutcome::Reconnect(error);
            }
            Ok(Ok(None)) => {
                return WatchOutcome::Reconnect(
                    IpcError::new(
                        crate::dto::ErrorCategory::Transport,
                        "WATCH_STREAM_ENDED",
                        "事件流已结束，准备从最后检查点续传",
                    )
                    .retryable(true),
                );
            }
            Ok(Ok(Some(event))) => {
                let epoch = event.journal_epoch.clone();
                let seq = event.seq.clone();
                let resume_token = event.resume_token.clone();
                let baseline_epoch = shared
                    .baseline()
                    .map(|baseline| baseline.snapshot.journal_epoch)
                    .unwrap_or_default();
                if epoch != baseline_epoch {
                    return WatchOutcome::Resync {
                        reason: "JOURNAL_EPOCH_CHANGED".into(),
                        message: "事件流的 journal_epoch 已变化，必须重新建立快照基线".into(),
                    };
                }
                let mapped = grpc::map_journal_event(event, shared.generation);
                let unknown = mapped.kind == "unknown";
                shared.record_pending_token(&epoch, &seq, &resume_token);
                if let Some(control) = &mapped.control {
                    shared.apply_control(&control.readiness, control.writable);
                }
                if let Some(view) = &mapped.view {
                    if let Some(order) = &view.order {
                        shared.apply_order_view(order);
                    }
                }
                let is_progress = mapped.kind == "progress";
                if !send_event(events, SessionEvent::Journal { event: mapped }) {
                    shared.cancel.cancel();
                    return WatchOutcome::Cancelled;
                }
                if unknown {
                    shared.unknown_event_count.fetch_add(1, Ordering::SeqCst);
                    return WatchOutcome::Resync {
                        reason: "UNKNOWN_EVENT_KIND".into(),
                        message: "收到无法识别的事件类型，已停止新增报单并请求全量重同步".into(),
                    };
                }
                if !is_progress {
                    let state = shared.set_phase(
                        &shared.connection().phase,
                        Some("已应用业务事件".into()),
                        None,
                    );
                    let _ = send_event(events, SessionEvent::Status { state });
                }
                if shared.unacked.load(Ordering::SeqCst) > 256 {
                    return WatchOutcome::Resync {
                        reason: "SLOW_FRONTEND_CONSUMER".into(),
                        message: "界面消费事件过慢，已请求重新同步以避免丢失业务事件".into(),
                    };
                }
            }
        }
    }
}
