use crate::config::ConnectionSettings;
use crate::dto::{
    AccountViewDto, AdmissionEventDto, AdmissionResponseDto, CommittedViewDto, ControlFactDto,
    ErrorCategory, ExecutionFactDto, InputFactDto, InstrumentInfoDto, IpcError, JournalEventDto,
    OrderViewDto, OutcomeEventDto, PositionViewDto, ProgressEventDto, SnapshotDto,
};
use crate::error::{grpc_error, AppResult};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;
use tonic::metadata::MetadataValue;
use tonic::transport::{Certificate, Channel, ClientTlsConfig, Endpoint};
use tonic::Request;

pub mod pb {
    tonic::include_proto!("orderhub.v1");
}

use pb::order_hub_client::OrderHubClient;
use pb::{
    get_state_request::Query, AdmissionResponse, CancelOrderRequest, GetStateRequest,
    GetStateResponse, JournalEvent, OrderLookup, RequestLookup, SnapshotQuery, SubmitOrderRequest,
    WatchEventsRequest,
};

#[derive(Debug)]
pub struct SnapshotBaseline {
    pub dto: SnapshotDto,
    pub resume_token: String,
}

fn transport_error(message: impl Into<String>, retryable: bool) -> IpcError {
    IpcError::new(ErrorCategory::Transport, "GRPC_TRANSPORT", message).retryable(retryable)
}

fn tls_or_transport(message: String) -> IpcError {
    let lower = message.to_ascii_lowercase();
    if lower.contains("tls")
        || lower.contains("certificate")
        || lower.contains("handshake")
        || lower.contains("invalid dnsname")
    {
        IpcError::new(ErrorCategory::Tls, "TLS_HANDSHAKE_FAILED", message).retryable(false)
    } else {
        transport_error(message, true)
    }
}

pub async fn build_channel(settings: &ConnectionSettings) -> AppResult<Channel> {
    let uri = format!("https://{}", settings.address);
    let tls = ClientTlsConfig::new()
        .ca_certificate(Certificate::from_pem(settings.ca_pem.clone()))
        .domain_name(settings.tls_domain.clone());
    let endpoint = Endpoint::from_shared(uri)
        .map_err(|error| transport_error(format!("服务地址无效：{error}"), false))?
        .tls_config(tls)
        .map_err(|error| tls_or_transport(format!("TLS 配置失败：{error}")))?
        .connect_timeout(settings.connect_timeout)
        .tcp_nodelay(true)
        .http2_keep_alive_interval(Duration::from_secs(20))
        .keep_alive_timeout(Duration::from_secs(10))
        .keep_alive_while_idle(true);
    endpoint
        .connect()
        .await
        .map_err(|error| tls_or_transport(format!("连接失败：{error}")))
}

fn attach_auth<T>(request: &mut Request<T>, settings: &ConnectionSettings) -> AppResult<()> {
    let value = MetadataValue::try_from(settings.token.authorization_header())
        .map_err(|_| transport_error("认证头构造失败", false))?;
    request.metadata_mut().insert("authorization", value);
    Ok(())
}

fn unary_request<T>(message: T, settings: &ConnectionSettings) -> AppResult<Request<T>> {
    let mut request = Request::new(message);
    request.set_timeout(settings.rpc_timeout);
    attach_auth(&mut request, settings)?;
    Ok(request)
}

async fn get_state(
    channel: &Channel,
    settings: &ConnectionSettings,
    query: Query,
) -> AppResult<GetStateResponse> {
    get_state_with_timeout(channel, settings, query, settings.rpc_timeout, None).await
}

async fn get_state_with_timeout(
    channel: &Channel,
    settings: &ConnectionSettings,
    query: Query,
    timeout: Duration,
    cancel: Option<&CancellationToken>,
) -> AppResult<GetStateResponse> {
    let mut client = OrderHubClient::new(channel.clone());
    let mut request = unary_request(GetStateRequest { query: Some(query) }, settings)?;
    // Do not let a single page outlive the whole snapshot budget. The tonic
    // request timeout is the per-attempt cap; the outer deadline is enforced
    // here as well.
    request.set_timeout(timeout.max(Duration::from_millis(1)));
    let call = client.get_state(request);
    let response = match cancel {
        Some(cancel) => tokio::select! {
            _ = cancel.cancelled() => {
                return Err(IpcError::new(
                    ErrorCategory::State,
                    "SNAPSHOT_CANCELLED",
                    "快照等待已取消",
                ));
            }
            result = call => result,
        },
        None => call.await,
    }
    .map_err(|status| grpc_error(&status, "native"))?;
    Ok(response.into_inner())
}

pub async fn fetch_snapshot(
    channel: &Channel,
    settings: &ConnectionSettings,
    generation: u64,
    cancel: Option<&CancellationToken>,
) -> AppResult<SnapshotBaseline> {
    let budget = Duration::from_secs(55);
    let deadline = Instant::now() + budget;
    let mut last_error: Option<IpcError> = None;
    for attempt in 0..3 {
        match fetch_snapshot_once(channel, settings, generation, deadline, cancel).await {
            Ok(snapshot) => return Ok(snapshot),
            Err(error) => {
                if crate::error::is_auth_failure(&error) {
                    return Err(error);
                }
                let retryable = error.retryable;
                last_error = Some(error);
                if !retryable || attempt == 2 {
                    break;
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let delay = Duration::from_millis(250 * (attempt + 1) as u64).min(remaining);
                sleep_or_cancel(delay, cancel).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| transport_error("快照获取失败", true)))
}

async fn sleep_or_cancel(duration: Duration, cancel: Option<&CancellationToken>) {
    match cancel {
        Some(cancel) => {
            tokio::select! {
                _ = cancel.cancelled() => {}
                _ = tokio::time::sleep(duration) => {}
            }
        }
        None => tokio::time::sleep(duration).await,
    }
}

async fn fetch_snapshot_once(
    channel: &Channel,
    settings: &ConnectionSettings,
    generation: u64,
    deadline: Instant,
    cancel: Option<&CancellationToken>,
) -> AppResult<SnapshotBaseline> {
    let mut page_token = String::new();
    let mut orders: Vec<OrderViewDto> = Vec::new();
    let mut order_index: HashMap<String, usize> = HashMap::new();
    let mut epoch: Option<String> = None;
    let mut state_cursor: Option<String> = None;
    let mut snapshot_id = String::new();
    let mut instruments: Vec<InstrumentInfoDto> = Vec::new();
    let mut positions: Vec<PositionViewDto> = Vec::new();
    let mut accounts: Vec<AccountViewDto> = Vec::new();
    let mut inputs: Vec<InputFactDto> = Vec::new();
    let mut committed_health: Option<ControlFactDto> = None;
    let mut last_page: Option<GetStateResponse> = None;

    for page in 0..12 {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(IpcError::new(
                ErrorCategory::State,
                "SNAPSHOT_LEASE_EXPIRED",
                "快照分页超过 55 秒预算，需要整份重取",
            )
            .retryable(true));
        }
        let per_page = remaining.min(settings.rpc_timeout);
        let response = get_state_with_timeout(
            channel,
            settings,
            Query::Snapshot(SnapshotQuery {
                page_size: 1000,
                page_token: page_token.clone(),
            }),
            per_page,
            cancel,
        )
        .await?;
        if Instant::now() >= deadline {
            return Err(IpcError::new(
                ErrorCategory::State,
                "SNAPSHOT_LEASE_EXPIRED",
                "快照在返回分页结果时已超过 55 秒预算，需要整份重取",
            )
            .retryable(true));
        }

        if page == 0 {
            epoch = Some(response.journal_epoch.clone());
            state_cursor = Some(response.state_cursor.clone());
            snapshot_id = response.snapshot_id.clone();
            instruments = response
                .instruments
                .iter()
                .map(|item| map_instrument(item.clone()))
                .collect();
            positions = response
                .positions
                .iter()
                .map(|item| map_position(item.clone()))
                .collect();
            accounts = response
                .accounts
                .iter()
                .map(|item| map_account(item.clone()))
                .collect();
            inputs = response
                .inputs
                .iter()
                .map(|item| map_input(item.clone()))
                .collect();
            committed_health = response.committed_health.clone().map(map_control);
        } else {
            if epoch.as_deref() != Some(response.journal_epoch.as_str())
                || state_cursor.as_deref() != Some(response.state_cursor.as_str())
            {
                return Err(IpcError::new(
                    ErrorCategory::State,
                    "SNAPSHOT_INCONSISTENT",
                    "分页快照的 journal_epoch 或 state_cursor 不一致，已丢弃并重取",
                )
                .retryable(true));
            }
        }
        for order in &response.active_orders {
            let mapped = map_order(order.clone());
            if let Some(index) = order_index.get(&mapped.client_order_id) {
                orders[*index] = mapped;
            } else {
                order_index.insert(mapped.client_order_id.clone(), orders.len());
                orders.push(mapped);
            }
        }
        let next = response.next_page_token.clone();
        last_page = Some(response);
        if next.is_empty() {
            break;
        }
        page_token = next;
        if page == 11 {
            return Err(IpcError::new(
                ErrorCategory::State,
                "SNAPSHOT_TOO_MANY_PAGES",
                "快照分页数量超过协议上限",
            ));
        }
    }

    let last = last_page.ok_or_else(|| {
        IpcError::new(
            ErrorCategory::Protocol,
            "SNAPSHOT_EMPTY",
            "快照没有返回任何页面",
        )
    })?;
    let resume_token = last.resume_token.clone();
    if resume_token.is_empty() {
        return Err(IpcError::new(
            ErrorCategory::Protocol,
            "SNAPSHOT_RESUME_TOKEN_MISSING",
            "快照未返回 resume_token，不能建立事件续传基线",
        ));
    }
    let journal_epoch = epoch.unwrap_or_default();
    let state_cursor = state_cursor.unwrap_or_default();
    let dto = SnapshotDto {
        generation,
        journal_epoch,
        state_cursor,
        durable_cursor: last.durable_cursor.clone(),
        writable: last.writable,
        readiness: last.readiness.clone(),
        stale: last.stale,
        persistence_mode: last.persistence_mode.clone(),
        snapshot_id,
        active_orders: orders,
        instruments,
        positions,
        accounts,
        inputs,
        committed_health,
        captured_at: chrono::Utc::now().to_rfc3339(),
    };
    Ok(SnapshotBaseline { dto, resume_token })
}

pub async fn open_watch(
    channel: &Channel,
    settings: &ConnectionSettings,
    after: &str,
    epoch: &str,
    resume_token: &str,
) -> AppResult<tonic::Streaming<JournalEvent>> {
    let mut client = OrderHubClient::new(channel.clone());
    let mut request = Request::new(WatchEventsRequest {
        after: after.to_string(),
        journal_epoch: epoch.to_string(),
        resume_token: resume_token.to_string(),
    });
    attach_auth(&mut request, settings)?;
    let response = client
        .watch_events(request)
        .await
        .map_err(|status| grpc_error(&status, "native"))?;
    Ok(response.into_inner())
}

pub async fn lookup_orders(
    channel: &Channel,
    settings: &ConnectionSettings,
    client_order_ids: Vec<String>,
) -> AppResult<GetStateResponse> {
    get_state(
        channel,
        settings,
        Query::OrderLookup(OrderLookup { client_order_ids }),
    )
    .await
}

pub async fn lookup_request(
    channel: &Channel,
    settings: &ConnectionSettings,
    rpc_method: &str,
    request_id: &str,
    epoch: &str,
) -> AppResult<GetStateResponse> {
    get_state(
        channel,
        settings,
        Query::RequestLookup(RequestLookup {
            rpc_method: rpc_method.to_string(),
            request_id: request_id.to_string(),
            journal_epoch: epoch.to_string(),
        }),
    )
    .await
}

pub async fn submit_order(
    channel: &Channel,
    settings: &ConnectionSettings,
    request: SubmitOrderRequest,
) -> AppResult<AdmissionResponseDto> {
    let mut client = OrderHubClient::new(channel.clone());
    let response = client
        .submit_order(unary_request(request, settings)?)
        .await
        .map_err(|status| grpc_error(&status, "native"))?;
    Ok(map_admission_response(response.into_inner()))
}

pub async fn cancel_order(
    channel: &Channel,
    settings: &ConnectionSettings,
    request: CancelOrderRequest,
) -> AppResult<AdmissionResponseDto> {
    let mut client = OrderHubClient::new(channel.clone());
    let response = client
        .cancel_order(unary_request(request, settings)?)
        .await
        .map_err(|status| grpc_error(&status, "native"))?;
    Ok(map_admission_response(response.into_inner()))
}

pub fn map_journal_event(event: JournalEvent, generation: u64) -> JournalEventDto {
    let mut dto = JournalEventDto {
        generation,
        seq: event.seq.clone(),
        journal_epoch: event.journal_epoch.clone(),
        event_id: event.event_id.clone(),
        kind: "unknown".into(),
        received_at: chrono::Utc::now().to_rfc3339(),
        admission: None,
        outcome: None,
        progress: None,
        execution: None,
        input: None,
        control: None,
        view: event.view.clone().map(map_view),
        unknown_note: None,
    };
    match event.kind {
        Some(pb::journal_event::Kind::Admission(item)) => {
            dto.kind = "admission".into();
            dto.admission = Some(AdmissionEventDto {
                submitter_id: item.submitter_id,
                request_id: item.request_id,
                strategy_id: item.strategy_id,
                instrument_id: item.instrument_id,
                request_kind: item.request_kind,
            });
        }
        Some(pb::journal_event::Kind::Outcome(item)) => {
            dto.kind = "outcome".into();
            dto.outcome = Some(OutcomeEventDto {
                origin_seq: item.origin_seq,
                client_order_id: item.client_order_id,
                outcome: item.outcome,
                reason: item.reason,
            });
        }
        Some(pb::journal_event::Kind::Progress(item)) => {
            dto.kind = "progress".into();
            dto.progress = Some(ProgressEventDto {
                state_cursor: item.state_cursor,
            });
        }
        Some(pb::journal_event::Kind::Execution(item)) => {
            dto.kind = "execution".into();
            dto.execution = Some(ExecutionFactDto {
                event_id: item.event_id,
                trade_id: item.trade_id,
                client_order_id: item.client_order_id,
                strategy_id: item.strategy_id,
                account_id: item.account_id,
                instrument_id: item.instrument_id,
                kind: item.kind,
                quantity: item.quantity,
                price: item.price,
                fee: item.fee,
                currency: item.currency,
                event_time_ns: item.event_time_ns,
            });
        }
        Some(pb::journal_event::Kind::Input(item)) => {
            dto.kind = "input".into();
            dto.input = Some(InputFactDto { json: item.json });
        }
        Some(pb::journal_event::Kind::Control(item)) => {
            dto.kind = "control".into();
            dto.control = Some(map_control(item));
        }
        None => {
            dto.unknown_note =
                Some("未识别的 JournalEvent kind；已停止新增报单并请求重新同步".into());
        }
    }
    dto
}

pub fn map_admission_response(response: AdmissionResponse) -> AdmissionResponseDto {
    AdmissionResponseDto {
        journal_epoch: response.journal_epoch,
        seq: response.seq,
        client_order_id: response.client_order_id,
        already_admitted: response.already_admitted,
        result: response.result,
        reason: response.reason,
    }
}

pub fn map_order(order: pb::OrderView) -> OrderViewDto {
    OrderViewDto {
        client_order_id: order.client_order_id,
        strategy_id: order.strategy_id,
        instrument_id: order.instrument_id,
        side: order.side,
        quantity: order.quantity,
        price: order.price,
        status: order.status,
        filled_quantity: order.filled_quantity,
        remaining_quantity: order.remaining_quantity,
        account_id: order.account_id,
        fees: order.fees,
        version: order.version,
    }
}

fn map_instrument(instrument: pb::InstrumentInfo) -> InstrumentInfoDto {
    InstrumentInfoDto {
        instrument_id: instrument.instrument_id,
        price_increment: instrument.price_increment,
        size_increment: instrument.size_increment,
        price_precision: instrument.price_precision,
    }
}

fn map_position(position: pb::PositionView) -> PositionViewDto {
    PositionViewDto {
        strategy_id: position.strategy_id,
        instrument_id: position.instrument_id,
        quantity: position.quantity,
        cost: position.cost,
        reserved_quantity: position.reserved_quantity,
    }
}

fn map_account(account: pb::AccountView) -> AccountViewDto {
    AccountViewDto {
        account_id: account.account_id,
        reserved_cash: account.reserved_cash,
        spent_cash: account.spent_cash,
        strategy_id: account.strategy_id,
    }
}

fn map_input(input: pb::InputFact) -> InputFactDto {
    InputFactDto { json: input.json }
}

fn map_control(control: pb::ControlFact) -> ControlFactDto {
    ControlFactDto {
        readiness: control.readiness,
        writable: control.writable,
        connected: control.connected,
        reason: control.reason,
    }
}

fn map_view(view: pb::CommittedView) -> CommittedViewDto {
    CommittedViewDto {
        order: view.order.map(map_order),
        position: view.position.map(map_position),
        account: view.account.map(map_account),
    }
}

#[cfg(test)]
mod mock_tests {
    use super::*;
    use crate::config::Token;
    use futures_util::Stream;
    use pb::order_hub_server::{OrderHub, OrderHubServer};
    use std::collections::VecDeque;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tonic::{Request, Response, Status};

    #[derive(Clone)]
    struct MockOrderHub {
        pages: Arc<Mutex<VecDeque<GetStateResponse>>>,
    }

    fn order(id: &str, version: &str) -> pb::OrderView {
        pb::OrderView {
            client_order_id: id.into(),
            strategy_id: "S-1".into(),
            instrument_id: "AAPL.GOX".into(),
            side: "BUY".into(),
            quantity: "10".into(),
            price: "153.22".into(),
            status: "SUBMITTED".into(),
            filled_quantity: "0".into(),
            remaining_quantity: "10".into(),
            account_id: "A-1".into(),
            fees: "0".into(),
            version: version.into(),
        }
    }

    fn first_page() -> GetStateResponse {
        GetStateResponse {
            journal_epoch: "8123".into(),
            state_cursor: "10".into(),
            writable: true,
            active_orders: vec![order("O-1", "1")],
            instruments: vec![pb::InstrumentInfo {
                instrument_id: "AAPL.GOX".into(),
                price_increment: "0.01".into(),
                size_increment: "1".into(),
                price_precision: 2,
            }],
            readiness: "READY".into(),
            snapshot_id: "s-1".into(),
            next_page_token: "page-2".into(),
            resume_token: "token-1".into(),
            positions: vec![pb::PositionView {
                strategy_id: "S-1".into(),
                instrument_id: "AAPL.GOX".into(),
                quantity: "10".into(),
                cost: "1532.20".into(),
                reserved_quantity: "0".into(),
            }],
            accounts: vec![pb::AccountView {
                account_id: "A-1".into(),
                reserved_cash: "0".into(),
                spent_cash: "1532.20".into(),
                strategy_id: "S-1".into(),
            }],
            persistence_mode: "async".into(),
            durable_cursor: "9".into(),
            ..Default::default()
        }
    }

    fn second_page() -> GetStateResponse {
        GetStateResponse {
            journal_epoch: "8123".into(),
            state_cursor: "10".into(),
            writable: true,
            active_orders: vec![order("O-2", "1"), order("O-1", "2")],
            positions: vec![pb::PositionView {
                strategy_id: "S-1".into(),
                instrument_id: "AAPL.GOX".into(),
                quantity: "999".into(),
                cost: "999".into(),
                reserved_quantity: "999".into(),
            }],
            readiness: "READY".into(),
            snapshot_id: "s-1".into(),
            next_page_token: String::new(),
            resume_token: "token-2".into(),
            persistence_mode: "async".into(),
            durable_cursor: "9".into(),
            ..Default::default()
        }
    }

    #[tonic::async_trait]
    impl OrderHub for MockOrderHub {
        async fn submit_order(
            &self,
            _request: Request<SubmitOrderRequest>,
        ) -> Result<Response<AdmissionResponse>, Status> {
            Err(Status::unimplemented("not used"))
        }

        async fn cancel_order(
            &self,
            _request: Request<CancelOrderRequest>,
        ) -> Result<Response<AdmissionResponse>, Status> {
            Err(Status::unimplemented("not used"))
        }

        async fn get_state(
            &self,
            request: Request<GetStateRequest>,
        ) -> Result<Response<GetStateResponse>, Status> {
            let query = request.into_inner().query;
            let token = match query {
                Some(Query::Snapshot(snapshot)) => snapshot.page_token,
                _ => String::new(),
            };
            let mut pages = self
                .pages
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            if token.is_empty() {
                Ok(Response::new(pages.pop_front().expect("first page")))
            } else {
                assert_eq!(token, "page-2");
                Ok(Response::new(pages.pop_front().expect("second page")))
            }
        }

        type WatchEventsStream =
            Pin<Box<dyn Stream<Item = Result<JournalEvent, Status>> + Send + 'static>>;

        async fn watch_events(
            &self,
            _request: Request<WatchEventsRequest>,
        ) -> Result<Response<Self::WatchEventsStream>, Status> {
            Ok(Response::new(Box::pin(futures_util::stream::empty())))
        }
    }

    #[tokio::test]
    async fn paginated_snapshot_accumulates_only_orders() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mock = MockOrderHub {
            pages: Arc::new(Mutex::new(VecDeque::from([first_page(), second_page()]))),
        };
        let incoming = futures_util::stream::unfold(listener, |listener| async move {
            match listener.accept().await {
                Ok((stream, _)) => Some((Ok::<_, std::io::Error>(stream), listener)),
                Err(error) => {
                    eprintln!("mock listener stopped: {error}");
                    None
                }
            }
        });
        let server = tonic::transport::Server::builder()
            .add_service(OrderHubServer::new(mock))
            .serve_with_incoming(incoming);
        let server_task = tokio::spawn(server);

        let channel = Endpoint::from_shared(format!("http://{address}"))
            .unwrap()
            .connect()
            .await
            .unwrap();
        let settings = ConnectionSettings {
            address: address.to_string(),
            tls_domain: "localhost".into(),
            ca_pem: Vec::new(),
            token: Token::new("test-token".into()),
            connect_timeout: Duration::from_secs(2),
            rpc_timeout: Duration::from_secs(2),
        };
        let snapshot = fetch_snapshot(&channel, &settings, 7, None).await.unwrap();
        assert_eq!(snapshot.resume_token, "token-2");
        assert_eq!(snapshot.dto.generation, 7);
        assert_eq!(snapshot.dto.active_orders.len(), 2);
        assert_eq!(
            snapshot
                .dto
                .active_orders
                .iter()
                .find(|item| item.client_order_id == "O-1")
                .unwrap()
                .version,
            "2"
        );
        assert_eq!(snapshot.dto.positions.len(), 1);
        assert_eq!(snapshot.dto.positions[0].quantity, "10");
        assert_eq!(snapshot.dto.accounts.len(), 1);
        assert_eq!(snapshot.dto.instruments.len(), 1);
        server_task.abort();
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use crate::config::{load_config, locate_config_dir, require_connection};

    /// Read-only live probe against the deployment in the local config.
    ///
    /// It never submits or cancels an order. Run explicitly:
    /// `ORDERHUB_LIVE_PROBE=1 cargo test live_snapshot_smoke -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "performs a real read-only GetState Snapshot against the configured deployment"]
    async fn live_snapshot_smoke() {
        if std::env::var("ORDERHUB_LIVE_PROBE").ok().as_deref() != Some("1") {
            eprintln!("ORDERHUB_LIVE_PROBE is not 1; skipping live snapshot probe");
            return;
        }
        let config = load_config(locate_config_dir());
        let settings = require_connection(&config).expect("business config must be valid");
        let channel = build_channel(&settings)
            .await
            .expect("TLS connection must succeed");
        let snapshot = fetch_snapshot(&channel, &settings, 1, None)
            .await
            .expect("read-only Snapshot must succeed");
        assert!(!snapshot.dto.journal_epoch.is_empty());
        assert!(!snapshot.resume_token.is_empty());
        eprintln!(
            "live snapshot ok: epoch={} cursor={} durable={} readiness={} writable={} active_orders={} instruments={}",
            snapshot.dto.journal_epoch,
            snapshot.dto.state_cursor,
            snapshot.dto.durable_cursor,
            snapshot.dto.readiness,
            snapshot.dto.writable,
            snapshot.dto.active_orders.len(),
            snapshot.dto.instruments.len()
        );

        let mut stream = open_watch(
            &channel,
            &settings,
            &snapshot.dto.state_cursor,
            &snapshot.dto.journal_epoch,
            &snapshot.resume_token,
        )
        .await
        .expect("read-only WatchEvents must open from the snapshot checkpoint");
        let event = tokio::time::timeout(Duration::from_secs(5), stream.message())
            .await
            .expect("WatchEvents should emit Progress within 5 seconds")
            .expect("WatchEvents stream should not fail")
            .expect("WatchEvents stream should yield an event");
        assert_eq!(event.journal_epoch, snapshot.dto.journal_epoch);
        let kind = match &event.kind {
            Some(pb::journal_event::Kind::Progress(_)) => "progress",
            Some(_) => "business",
            None => "unknown",
        };
        eprintln!(
            "live watch ok: seq={} kind={} event_id={}",
            event.seq, kind, event.event_id
        );
    }
}
