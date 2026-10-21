use crate::config::{load_config, require_connection, LoadedConfig};
use crate::decimal::{validate_contract_step, DecimalValue};
use crate::diagnostics;
use crate::dto::{
    AckCheckpointInput, BootstrapState, CancelOrderInput, CancelOrderResult, CheckUpdateInput,
    ConfigSummary, ConnectionState, DiagnosticExportResult, DiagnosticsSummary,
    DownloadProgressDto, DownloadUpdateResult, ErrorCategory, ExportDiagnosticsInput,
    InstallUpdateInput, InstallUpdateResult, IpcError, ListRequestsResult, OrderLookupResult,
    ParamValue, RequestLookupResult, RequestMethod, RequestRecoveryDto, SessionEvent,
    SubmitOrderInput, SubmitOrderResult, UpdateCheckResult, UpdateStateDto,
};
use crate::error::{state_error, validation_error, AppResult};
use crate::grpc::{self, pb};
use crate::requests::{apply_admission, apply_failure, mark_sending, new_record};
use crate::session::{run_session, SessionShared};
use crate::state::AppState;
use crate::validation::{validate_id, validate_order_ids};
use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

fn current_session(state: &AppState) -> AppResult<Arc<SessionShared>> {
    state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
        .ok_or_else(|| state_error("SESSION_NOT_CONNECTED", "尚未连接业务服务"))
}

/// The session Arc is immutable, but `reload_config`/`connect`/`disconnect`
/// can replace it after a command captured it. Recheck immediately before the
/// network write so an old channel is never used for a new session generation.
fn ensure_session_current(state: &AppState, session: &SessionShared) -> AppResult<()> {
    if state.generation.load(Ordering::SeqCst) != session.generation {
        return Err(state_error(
            "SESSION_GENERATION_CHANGED",
            "业务会话已切换，本次操作未发送",
        ));
    }
    Ok(())
}

fn connection_for(state: &AppState) -> ConnectionState {
    match state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .as_ref()
    {
        Some(session) => session.connection(),
        None => {
            let mut connection =
                ConnectionState::new(state.generation.load(Ordering::SeqCst), "idle");
            connection.detail = Some("尚未连接业务服务".into());
            connection
        }
    }
}

fn sync_diagnostics(
    state: &AppState,
    session: Option<&Arc<SessionShared>>,
) -> crate::dto::DiagnosticsSync {
    let baseline = session.and_then(|session| session.baseline());
    crate::dto::DiagnosticsSync {
        generation: state.generation.load(Ordering::SeqCst),
        journal_epoch: baseline
            .as_ref()
            .map(|value| value.snapshot.journal_epoch.clone()),
        state_cursor: baseline
            .as_ref()
            .map(|value| value.snapshot.state_cursor.clone()),
        durable_cursor: baseline
            .as_ref()
            .map(|value| value.snapshot.durable_cursor.clone()),
        readiness: baseline
            .as_ref()
            .map(|value| value.snapshot.readiness.clone()),
        writable: baseline.as_ref().map(|value| value.snapshot.writable),
        stale: baseline.as_ref().map(|value| value.snapshot.stale),
        active_orders: baseline
            .as_ref()
            .map(|value| value.active_order_ids.len())
            .unwrap_or(0),
        unknown_event_count: session
            .map(|session| session.unknown_event_count.load(Ordering::SeqCst))
            .unwrap_or(0),
        resync_count: session
            .map(|session| session.resync_count.load(Ordering::SeqCst))
            .unwrap_or(0),
    }
}

fn request_recovery(state: &AppState) -> RequestRecoveryDto {
    RequestRecoveryDto {
        ready: state.requests.is_ready(),
        loading: state.requests.is_loading(),
        total: state.requests.count(),
        unknown: state.requests.unknown_count(),
        load_errors: state.requests.load_errors(),
    }
}

fn build_diagnostics(state: &AppState, session: Option<&Arc<SessionShared>>) -> DiagnosticsSummary {
    let config = state
        .config
        .read()
        .unwrap_or_else(|poison| poison.into_inner());
    let connection = session
        .map(|session| session.connection())
        .unwrap_or_else(|| connection_for(state));
    let update = state.update.current_state();
    let summary = diagnostics::build_summary(
        state.app_info.clone(),
        &config.summary,
        connection,
        sync_diagnostics(state, session),
        update,
        crate::dto::DiagnosticsRuntime {
            data_dir: state.data_dir.to_string_lossy().to_string(),
            installation_id_ref: state.update.installation_id_ref(),
            request_record_count: state.requests.count(),
            unknown_request_count: state.requests.unknown_count(),
        },
        &state.diagnostics,
    );
    summary
}

#[tauri::command]
pub async fn get_bootstrap_state(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    let config = state
        .config
        .read()
        .unwrap_or_else(|poison| poison.into_inner());
    let session = state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone();
    let summary = build_diagnostics(&state, session.as_ref());
    Ok(BootstrapState {
        app: state.app_info.clone(),
        config: config.summary.clone(),
        connection: session
            .as_ref()
            .map(|session| session.connection())
            .unwrap_or_else(|| connection_for(&state)),
        update: state.update.current_state(),
        requests: state.requests.recent(50),
        request_recovery: request_recovery(&state),
        diagnostics: summary,
    })
}

#[tauri::command]
pub async fn get_config_summary(state: State<'_, AppState>) -> AppResult<ConfigSummary> {
    let config = state
        .config
        .read()
        .unwrap_or_else(|poison| poison.into_inner());
    Ok(config.summary.clone())
}

#[tauri::command]
pub async fn reload_config(state: State<'_, AppState>) -> AppResult<ConfigSummary> {
    let loaded = load_config(state.config_dir.clone());
    {
        if let Some(session) = state
            .session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()
        {
            session.cancel.cancel();
        }
    }
    state.generation.fetch_add(1, Ordering::SeqCst);
    let update_settings = loaded.update.clone();
    *state
        .config
        .write()
        .unwrap_or_else(|poison| poison.into_inner()) = loaded;
    // The update manager owns a separate settings snapshot. Without this the
    // UI could report a new base URL/channel while the manager kept using the
    // values loaded at process start.
    state.update.reconfigure(update_settings).await;
    let config = state
        .config
        .read()
        .unwrap_or_else(|poison| poison.into_inner());
    Ok(config.summary.clone())
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    events: Channel<SessionEvent>,
) -> AppResult<ConnectionState> {
    if state.maintenance.load(Ordering::SeqCst) {
        return Err(state_error(
            "MAINTENANCE_MODE",
            "应用正在准备安装更新，暂不接受新连接或写入",
        ));
    }
    let loaded: LoadedConfig = load_config(state.config_dir.clone());
    if require_connection(&loaded).is_err() {
        let message = loaded
            .summary
            .issues
            .iter()
            .find(|issue| issue.severity == "error")
            .map(|issue| issue.message.clone())
            .unwrap_or_else(|| "业务连接配置无效".into());
        return Err(crate::error::config_error("CONFIG_INVALID", message));
    }
    *state
        .config
        .write()
        .unwrap_or_else(|poison| poison.into_inner()) = loaded.clone();

    if let Some(previous) = state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take()
    {
        previous.cancel.cancel();
    }
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let correlation_id = uuid::Uuid::new_v4().to_string();
    let shared = Arc::new(SessionShared::new(generation, loaded, correlation_id));
    *state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner()) = Some(shared.clone());
    let initial = shared.set_phase("connecting", Some("正在建立 TLS 连接".into()), None);
    // Send the initial generation before the task can emit a snapshot. A
    // snapshot that reaches the reducer before any status for its generation
    // is deliberately ignored as stale, so ordering here is part of the
    // generation contract.
    let _ = events.send(SessionEvent::Status {
        state: initial.clone(),
    });
    let events_for_task = events.clone();
    tauri::async_runtime::spawn(async move {
        run_session(shared, events_for_task).await;
    });
    Ok(initial)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> AppResult<ConnectionState> {
    if let Some(session) = state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .take()
    {
        session.cancel.cancel();
    }
    state.generation.fetch_add(1, Ordering::SeqCst);
    let mut connection = ConnectionState::new(state.generation.load(Ordering::SeqCst), "idle");
    connection.detail = Some("已断开业务连接".into());
    Ok(connection)
}

#[tauri::command]
pub async fn ack_checkpoint(
    state: State<'_, AppState>,
    input: AckCheckpointInput,
) -> AppResult<bool> {
    let Some(session) = state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone()
    else {
        return Ok(false);
    };
    if session.generation != input.generation {
        return Ok(false);
    }
    Ok(session.ack(&input.journal_epoch, &input.seq))
}

#[tauri::command]
pub async fn lookup_order(
    state: State<'_, AppState>,
    order_ids: Vec<String>,
) -> AppResult<OrderLookupResult> {
    validate_order_ids(&order_ids)
        .map_err(|message| validation_error("ORDER_IDS_INVALID", message))?;
    let session = current_session(&state)?;
    // The channel, credentials and returned views must all belong to the same
    // immutable session. Reading global config here could pair an old gRPC
    // channel with a token loaded by a concurrent reload.
    let connection = require_connection(&session.config)?;
    let channel = session
        .channel()
        .ok_or_else(|| state_error("SESSION_NOT_READY", "业务连接尚未建立"))?;
    ensure_session_current(&state, &session)?;
    let response = grpc::lookup_orders(&channel, &connection, order_ids)
        .await
        .map_err(|mut error| {
            error.correlation_id = session.correlation_id.clone();
            state.diagnostics.record(&error);
            error
        })?;
    Ok(OrderLookupResult {
        generation: session.generation,
        orders: response
            .active_orders
            .iter()
            .map(|order| grpc::map_order(order.clone()))
            .collect(),
        journal_epoch: response.journal_epoch,
        state_cursor: response.state_cursor,
        resume_token_available: !response.resume_token.is_empty(),
        looked_up_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn validate_submit_input(
    input: &SubmitOrderInput,
    snapshot: &crate::dto::SnapshotDto,
) -> AppResult<(String, String)> {
    validate_id(&input.strategy_id, "策略 ID")
        .map_err(|message| validation_error("STRATEGY_ID_INVALID", message))?;
    validate_id(&input.instrument_id, "合约 ID")
        .map_err(|message| validation_error("INSTRUMENT_ID_INVALID", message))?;
    if input.time_in_force != "DAY" {
        return Err(validation_error(
            "TIME_IN_FORCE_UNSUPPORTED",
            "当前通道只支持 DAY；GTC/IOC/FOK 会被服务端拒绝",
        ));
    }
    if input.post_only {
        return Err(validation_error(
            "POST_ONLY_UNSUPPORTED",
            "当前通道 post_only 必须为 false",
        ));
    }
    if input.reduce_only {
        return Err(validation_error(
            "REDUCE_ONLY_UNSUPPORTED",
            "当前通道 reduce_only 必须为 false",
        ));
    }
    let strategy_visible = snapshot
        .accounts
        .iter()
        .any(|account| account.strategy_id == input.strategy_id)
        || snapshot
            .positions
            .iter()
            .any(|position| position.strategy_id == input.strategy_id);
    if !strategy_visible {
        return Err(validation_error(
            "STRATEGY_NOT_AUTHORIZED",
            "该策略不在当前 Snapshot 的授权视图中",
        ));
    }
    let instrument = snapshot
        .instruments
        .iter()
        .find(|instrument| instrument.instrument_id == input.instrument_id)
        .ok_or_else(|| {
            validation_error(
                "INSTRUMENT_NOT_VISIBLE",
                "该合约不在当前 Snapshot 的合约信息中",
            )
        })?;
    let quantity = DecimalValue::parse(&input.quantity, 40)
        .map_err(|message| validation_error("QUANTITY_INVALID", message))?;
    if quantity.is_zero() {
        return Err(validation_error("QUANTITY_INVALID", "数量必须大于 0"));
    }
    if !quantity.is_integer() {
        return Err(validation_error(
            "QUANTITY_NOT_INTEGER",
            "当前通道只支持整股数量",
        ));
    }
    if !quantity.less_than_or_equal_integer(10_000) {
        return Err(validation_error(
            "QUANTITY_LIMIT",
            "当前单笔数量上限为 10000 股",
        ));
    }
    validate_contract_step(&quantity, &instrument.size_increment, "数量")
        .map_err(|message| validation_error("QUANTITY_STEP", message))?;
    let price = DecimalValue::parse(&input.price, 40)
        .map_err(|message| validation_error("PRICE_INVALID", message))?;
    if price.is_zero() {
        return Err(validation_error("PRICE_INVALID", "价格必须大于 0"));
    }
    if price.scale > instrument.price_precision {
        return Err(validation_error(
            "PRICE_PRECISION",
            format!("价格小数位超过合约精度 {}", instrument.price_precision),
        ));
    }
    validate_contract_step(&price, &instrument.price_increment, "价格")
        .map_err(|message| validation_error("PRICE_STEP", message))?;
    Ok((quantity.canonical(), price.canonical()))
}

fn request_id() -> String {
    let suffix: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(12)
        .collect();
    format!("ohd-{}-{suffix}", chrono::Utc::now().timestamp_millis())
}

fn set_correlation(mut error: IpcError, session: &SessionShared) -> IpcError {
    error.correlation_id = session.correlation_id.clone();
    error
}

#[tauri::command]
pub async fn submit_order(
    state: State<'_, AppState>,
    input: SubmitOrderInput,
) -> AppResult<SubmitOrderResult> {
    if state.maintenance.load(Ordering::SeqCst) {
        return Err(state_error(
            "MAINTENANCE_MODE",
            "应用正在准备安装更新，暂不接受新写入",
        ));
    }
    let _write_guard = state.write_gate.read().await;
    if state.maintenance.load(Ordering::SeqCst) {
        return Err(state_error(
            "MAINTENANCE_MODE",
            "应用正在准备安装更新，暂不接受新写入",
        ));
    }
    if !state.requests.is_ready() {
        return Err(state_error(
            "REQUEST_RECOVERY_PENDING",
            "本地请求记录仍在恢复；在完成前不会新增报单，以免把未知请求当成零",
        ));
    }
    let session = current_session(&state)?;
    if session.generation != input.expected_generation {
        return Err(state_error(
            "SESSION_GENERATION_CHANGED",
            "业务会话已重新连接，请基于新快照重新提交",
        ));
    }
    let connection = session.connection();
    if !matches!(connection.phase.as_str(), "synced") {
        return Err(state_error(
            "SESSION_NOT_READY",
            format!("当前连接状态为 {}，不能新增报单", connection.phase),
        ));
    }
    let baseline = session
        .baseline()
        .ok_or_else(|| state_error("SNAPSHOT_MISSING", "尚无完整快照"))?;
    if baseline.snapshot.journal_epoch != input.expected_epoch {
        return Err(state_error(
            "JOURNAL_EPOCH_CHANGED",
            "快照 epoch 已变化，请等待重新同步后确认",
        ));
    }
    if baseline.snapshot.stale || connection.stale.unwrap_or(false) {
        return Err(state_error("STATE_STALE", "服务状态为陈旧，新增报单已关闭"));
    }
    if !baseline.snapshot.writable || connection.writable == Some(false) {
        return Err(state_error(
            "SERVICE_NOT_WRITABLE",
            "服务当前不可写，新增报单已关闭",
        ));
    }
    if baseline.snapshot.readiness != "READY" {
        return Err(state_error(
            "SERVICE_NOT_READY",
            format!(
                "服务 readiness 为 {}，新增报单已关闭",
                baseline.snapshot.readiness
            ),
        ));
    }
    let gate = state.update.policy_gate();
    if !gate.can_trade {
        return Err(IpcError::new(
            ErrorCategory::Policy,
            "TRADING_RESTRICTED",
            gate.reason,
        ));
    }
    let (quantity, price) = validate_submit_input(&input, &baseline.snapshot)?;
    let settings = require_connection(&session.config)?;
    let channel = session
        .channel()
        .ok_or_else(|| state_error("SESSION_NOT_READY", "业务连接尚未建立"))?;
    let epoch = baseline.snapshot.journal_epoch.clone();
    let id = request_id();
    let mut params = BTreeMap::new();
    params.insert(
        "strategyId".into(),
        ParamValue::String(input.strategy_id.clone()),
    );
    params.insert(
        "instrumentId".into(),
        ParamValue::String(input.instrument_id.clone()),
    );
    params.insert(
        "side".into(),
        ParamValue::String(input.side.as_str().into()),
    );
    params.insert(
        "quantity".into(),
        ParamValue::String(input.quantity.clone()),
    );
    params.insert("price".into(), ParamValue::String(input.price.clone()));
    params.insert("timeInForce".into(), ParamValue::String("DAY".into()));
    params.insert("postOnly".into(), ParamValue::Bool(false));
    params.insert("reduceOnly".into(), ParamValue::Bool(false));
    let mut record = new_record(
        id.clone(),
        RequestMethod::SubmitOrder,
        epoch.clone(),
        session.config.environment_id.clone(),
        session.config.credential_ref.clone(),
        params,
    );
    state.requests.create(record.clone()).map_err(|mut error| {
        error.correlation_id = session.correlation_id.clone();
        state.diagnostics.record(&error);
        error
    })?;
    mark_sending(&mut record);
    if let Err(mut error) = state.requests.update(record.clone()) {
        error.correlation_id = session.correlation_id.clone();
        return Err(error);
    }
    if let Err(error) = ensure_session_current(&state, &session) {
        apply_failure(&mut record, error.clone(), true);
        let _ = state.requests.update(record);
        return Err(error);
    }
    let request = pb::SubmitOrderRequest {
        submitter_id: String::new(),
        request_id: id.clone(),
        strategy_id: input.strategy_id.clone(),
        instrument_id: input.instrument_id.clone(),
        side: input.side.as_str().into(),
        quantity,
        price,
        time_in_force: "DAY".into(),
        post_only: false,
        reduce_only: false,
        submit_before_ns: None,
        journal_epoch: epoch,
    };
    match grpc::submit_order(&channel, &settings, request).await {
        Ok(admission) => {
            apply_admission(&mut record, admission.clone());
            let persist_error = state
                .requests
                .update(record.clone())
                .err()
                .map(|mut error| {
                    error.correlation_id = session.correlation_id.clone();
                    error
                });
            if !admission.client_order_id.is_empty() {
                session.add_active_order(&admission.client_order_id);
            }
            if let Some(error) = &persist_error {
                state.diagnostics.record(error);
            }
            Ok(SubmitOrderResult {
                record,
                admission: Some(admission),
                error: persist_error,
            })
        }
        Err(error) => {
            let mut error = set_correlation(error, &session);
            // Validation/auth failures happen before the server admits a
            // request. Everything else may have executed and stays unknown.
            let not_sent = matches!(
                error.category,
                ErrorCategory::Validation | ErrorCategory::Auth
            );
            apply_failure(&mut record, error.clone(), not_sent);
            let persist_error = state.requests.update(record.clone()).err();
            if persist_error.is_some() {
                error.details.get_or_insert_with(BTreeMap::new).insert(
                    "localRecord".into(),
                    "admission outcome could not be persisted".into(),
                );
            }
            state.diagnostics.record(&error);
            Ok(SubmitOrderResult {
                record,
                admission: None,
                error: Some(error),
            })
        }
    }
}

#[tauri::command]
pub async fn cancel_order(
    state: State<'_, AppState>,
    input: CancelOrderInput,
) -> AppResult<CancelOrderResult> {
    if state.maintenance.load(Ordering::SeqCst) {
        return Err(state_error(
            "MAINTENANCE_MODE",
            "应用正在准备安装更新，暂不接受新写入",
        ));
    }
    let _write_guard = state.write_gate.read().await;
    if state.maintenance.load(Ordering::SeqCst) {
        return Err(state_error(
            "MAINTENANCE_MODE",
            "应用正在准备安装更新，暂不接受新写入",
        ));
    }
    validate_id(&input.client_order_id, "订单 ID")
        .map_err(|message| validation_error("ORDER_ID_INVALID", message))?;
    if !state.requests.is_ready() {
        return Err(state_error(
            "REQUEST_RECOVERY_PENDING",
            "本地请求记录仍在恢复；在完成前不会新增撤单",
        ));
    }
    let session = current_session(&state)?;
    if session.generation != input.expected_generation {
        return Err(state_error(
            "SESSION_GENERATION_CHANGED",
            "业务会话已重新连接，请基于新快照重新提交撤单",
        ));
    }
    let connection = session.connection();
    if !matches!(connection.phase.as_str(), "synced" | "stale") {
        return Err(state_error(
            "SESSION_NOT_READY",
            format!("当前连接状态为 {}，不能提交撤单", connection.phase),
        ));
    }
    let baseline = session
        .baseline()
        .ok_or_else(|| state_error("SNAPSHOT_MISSING", "尚无完整快照"))?;
    if baseline.snapshot.journal_epoch != input.expected_epoch {
        return Err(state_error(
            "JOURNAL_EPOCH_CHANGED",
            "快照 epoch 已变化，请等待重新同步后确认",
        ));
    }
    if !session.is_active_order(&input.client_order_id) {
        return Err(validation_error(
            "ORDER_NOT_ACTIVE",
            "该订单不在当前活动订单中，可能已终态；请先查询订单状态",
        ));
    }
    let settings = require_connection(&session.config)?;
    let channel = session
        .channel()
        .ok_or_else(|| state_error("SESSION_NOT_READY", "业务连接尚未建立"))?;
    let epoch = baseline.snapshot.journal_epoch.clone();
    let id = request_id();
    let mut params = BTreeMap::new();
    params.insert(
        "clientOrderId".into(),
        ParamValue::String(input.client_order_id.clone()),
    );
    let mut record = new_record(
        id.clone(),
        RequestMethod::CancelOrder,
        epoch.clone(),
        session.config.environment_id.clone(),
        session.config.credential_ref.clone(),
        params,
    );
    state.requests.create(record.clone()).map_err(|mut error| {
        error.correlation_id = session.correlation_id.clone();
        state.diagnostics.record(&error);
        error
    })?;
    mark_sending(&mut record);
    if let Err(mut error) = state.requests.update(record.clone()) {
        error.correlation_id = session.correlation_id.clone();
        return Err(error);
    }
    if let Err(error) = ensure_session_current(&state, &session) {
        apply_failure(&mut record, error.clone(), true);
        let _ = state.requests.update(record);
        return Err(error);
    }
    let request = pb::CancelOrderRequest {
        submitter_id: String::new(),
        request_id: id.clone(),
        client_order_id: input.client_order_id.clone(),
        journal_epoch: epoch,
    };
    match grpc::cancel_order(&channel, &settings, request).await {
        Ok(admission) => {
            apply_admission(&mut record, admission.clone());
            let persist_error = state
                .requests
                .update(record.clone())
                .err()
                .map(|mut error| {
                    error.correlation_id = session.correlation_id.clone();
                    error
                });
            Ok(CancelOrderResult {
                record,
                admission: Some(admission),
                error: persist_error,
            })
        }
        Err(error) => {
            let mut error = set_correlation(error, &session);
            // Validation/auth failures happen before the server admits a
            // request. Everything else may have executed and stays unknown.
            let not_sent = matches!(
                error.category,
                ErrorCategory::Validation | ErrorCategory::Auth
            );
            apply_failure(&mut record, error.clone(), not_sent);
            let persist_error = state.requests.update(record.clone()).err();
            if persist_error.is_some() {
                error.details.get_or_insert_with(BTreeMap::new).insert(
                    "localRecord".into(),
                    "admission outcome could not be persisted".into(),
                );
            }
            state.diagnostics.record(&error);
            Ok(CancelOrderResult {
                record,
                admission: None,
                error: Some(error),
            })
        }
    }
}

#[tauri::command]
pub async fn lookup_session_request(
    state: State<'_, AppState>,
    request_id: String,
) -> AppResult<RequestLookupResult> {
    validate_id(&request_id, "request_id")
        .map_err(|message| validation_error("REQUEST_ID_INVALID", message))?;
    if !state.requests.is_ready() {
        return Err(state_error(
            "REQUEST_RECOVERY_PENDING",
            "本地请求记录仍在恢复，暂不能查询原请求",
        ));
    }
    let mut record = state
        .requests
        .get(&request_id)
        .ok_or_else(|| state_error("REQUEST_NOT_FOUND_LOCAL", "本地没有该请求记录"))?;
    let config = state
        .config
        .read()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone();
    let settings = require_connection(&config)?;
    if record.environment_id != config.environment_id
        || record.credential_ref != config.credential_ref
    {
        return Err(IpcError::new(
            ErrorCategory::Auth,
            "AUTHORIZATION_CONTEXT_CHANGED",
            "当前环境或凭证与提交该请求时不同；不会自动使用新凭证查询或补单",
        ));
    }
    let channel = grpc::build_channel(&settings).await.map_err(|error| {
        state.diagnostics.record(&error);
        error
    })?;
    let lookup = grpc::lookup_request(
        &channel,
        &settings,
        record.rpc_method.as_str(),
        &record.request_id,
        &record.epoch,
    )
    .await;
    record.lookup_attempts = record.lookup_attempts.saturating_add(1);
    record.last_lookup_at = Some(chrono::Utc::now().to_rfc3339());
    let looked_up_at = chrono::Utc::now().to_rfc3339();

    let save_lookup = |record: &crate::dto::RequestRecordDto| {
        state
            .requests
            .update(record.clone())
            .err()
            .map(|mut error| {
                error.message = format!(
                    "服务端结果已取得，但本地请求记录保存失败：{}",
                    error.message
                );
                state.diagnostics.record(&error);
                error
            })
    };
    let current_record = |fallback: crate::dto::RequestRecordDto| {
        state.requests.get(&fallback.request_id).unwrap_or(fallback)
    };

    match lookup {
        Ok(response) => {
            if let Some(result) = response.request_result {
                let admission = grpc::map_admission_response(result);
                apply_admission(&mut record, admission.clone());
                let persist_error = save_lookup(&record);
                // If persistence failed, still return the result we just
                // learned; the UI must not present an older Unknown view.
                let record = if persist_error.is_some() {
                    record
                } else {
                    current_record(record)
                };
                Ok(RequestLookupResult {
                    record,
                    found: true,
                    admission: Some(admission),
                    state_cursor: Some(response.state_cursor),
                    looked_up_at,
                    error: persist_error,
                })
            } else {
                let error = IpcError::new(
                    ErrorCategory::Protocol,
                    "REQUEST_LOOKUP_EMPTY",
                    "RequestLookup 没有返回 request_result，不能据此判断请求已执行",
                );
                // A lookup that produced no result leaves the request
                // unresolved; it may not keep claiming "sending".
                if record.admission.is_none() {
                    record.status = crate::dto::RequestStatus::Unknown;
                }
                record.error = Some(error.clone());
                let persist_error = save_lookup(&record);
                let record = if persist_error.is_some() {
                    record
                } else {
                    current_record(record)
                };
                Ok(RequestLookupResult {
                    record,
                    found: false,
                    admission: None,
                    state_cursor: Some(response.state_cursor),
                    looked_up_at,
                    error: Some(persist_error.unwrap_or(error)),
                })
            }
        }
        Err(mut error) => {
            error.correlation_id = uuid::Uuid::new_v4().to_string();
            let not_found = error.code == "GRPC_NOT_FOUND";
            if not_found {
                error = IpcError::new(
                    ErrorCategory::Protocol,
                    "REQUEST_NOT_FOUND",
                    "查询时尚无可见结果；这不能证明请求没有被执行，请勿换新 ID 自动补单",
                )
                .retryable(true);
            } else if error.code == "GRPC_FAILED_PRECONDITION" {
                error = IpcError::new(
                    ErrorCategory::State,
                    "EPOCH_CHANGED",
                    "原请求 epoch 已不匹配；旧意图已保留，需要人工核对，不能自动变成新代订单",
                )
                .retryable(false);
            }
            state.diagnostics.record(&error);
            if record.admission.is_none() {
                record.status = crate::dto::RequestStatus::Unknown;
            }
            record.error = Some(error.clone());
            let persist_error = save_lookup(&record);
            let record = if persist_error.is_some() {
                record
            } else {
                current_record(record)
            };
            Ok(RequestLookupResult {
                record,
                found: false,
                admission: None,
                state_cursor: None,
                looked_up_at,
                error: Some(persist_error.unwrap_or(error)),
            })
        }
    }
}

#[tauri::command]
pub async fn list_requests(state: State<'_, AppState>) -> AppResult<ListRequestsResult> {
    Ok(ListRequestsResult {
        records: state.requests.list(),
        recovery: request_recovery(&state),
    })
}

#[tauri::command]
pub async fn get_request_recovery(state: State<'_, AppState>) -> AppResult<RequestRecoveryDto> {
    Ok(request_recovery(&state))
}

#[tauri::command]
pub async fn check_update_policy(state: State<'_, AppState>) -> AppResult<UpdateStateDto> {
    let result = state.update.refresh_policy().await?;
    Ok(result)
}

#[tauri::command]
pub async fn check_update(
    state: State<'_, AppState>,
    app: AppHandle,
    input: CheckUpdateInput,
) -> AppResult<UpdateCheckResult> {
    let result = state.update.check_update(&app, input.manual).await;
    if let Err(error) = &result {
        state.diagnostics.record(error);
    }
    Ok(UpdateCheckResult { state: result? })
}

#[tauri::command]
pub async fn download_update(
    state: State<'_, AppState>,
    app: AppHandle,
    progress: Channel<DownloadProgressDto>,
) -> AppResult<DownloadUpdateResult> {
    let result = state.update.download_update(&app, progress).await;
    if let Err(error) = &result {
        state.diagnostics.record(error);
    }
    result
}

#[tauri::command]
pub async fn install_update(
    state: State<'_, AppState>,
    app: AppHandle,
    input: InstallUpdateInput,
) -> AppResult<InstallUpdateResult> {
    // Enter maintenance before looking at the unknown set. Waiting for the
    // write gate after counting allowed a request that had already passed its
    // pre-check to finish and become Unknown while installation proceeded.
    if state
        .maintenance
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(state_error("MAINTENANCE_MODE", "已进入安装维护状态"));
    }
    let outcome = async {
        // Admitted writes finish first; new ones observe maintenance and fail
        // their post-guard check.
        let _write_guard = state.write_gate.write().await;
        if !state.requests.is_ready() {
            return Err(state_error(
                "REQUEST_RECOVERY_PENDING",
                "本地请求记录仍在恢复，暂不能确认未知请求并安装更新",
            ));
        }
        let unknown = state.requests.unknown_count();
        if unknown > 0 && !input.confirm_unknown_requests {
            return Err(IpcError::new(
                ErrorCategory::Policy,
                "UNKNOWN_REQUESTS_PENDING",
                format!(
                    "还有 {unknown} 条等待受理或结果未知的请求；请先查询原请求，或明确确认后再安装。"
                ),
            ));
        }
        let (update, bytes) = state
            .update
            .prepare_install(&app, input.confirm_unknown_requests, unknown)
            .await?;
        if let Some(session) = state
            .session
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .take()
        {
            session.cancel.cancel();
        }
        state.update.install(&app, update, bytes).await
    }
    .await;
    if let Err(error) = &outcome {
        state.maintenance.store(false, Ordering::SeqCst);
        state.diagnostics.record(error);
    }
    outcome
}

#[tauri::command]
pub async fn get_update_state(state: State<'_, AppState>) -> AppResult<UpdateStateDto> {
    Ok(state.update.current_state())
}

#[tauri::command]
pub async fn confirm_startup(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.update.confirm_startup().await)
}

#[tauri::command]
pub async fn get_diagnostics(state: State<'_, AppState>) -> AppResult<DiagnosticsSummary> {
    let session = state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone();
    Ok(build_diagnostics(&state, session.as_ref()))
}

#[tauri::command]
pub async fn export_diagnostics(
    state: State<'_, AppState>,
    app: AppHandle,
    input: ExportDiagnosticsInput,
) -> AppResult<DiagnosticExportResult> {
    if !input.confirmed {
        return Err(validation_error(
            "CONFIRMATION_REQUIRED",
            "请先确认诊断文件内容已脱敏并同意导出",
        ));
    }
    let session = state
        .session
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .clone();
    let summary = build_diagnostics(&state, session.as_ref());
    let download_dir = app.path().download_dir().ok();
    diagnostics::export(&summary, download_dir, &state.data_dir).map_err(|message| {
        IpcError::new(ErrorCategory::Storage, "DIAGNOSTICS_EXPORT_FAILED", message)
    })
}

#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> AppResult<crate::dto::AppInfo> {
    Ok(state.app_info.clone())
}
