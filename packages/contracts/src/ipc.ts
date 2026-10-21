/**
 * Typed IPC contract between the React UI and the Tauri/Rust native layer.
 *
 * Rules that every type in this file must preserve:
 * - 64-bit cursors, sequence numbers, nanosecond timestamps, versions, prices,
 *   quantities, amounts and byte counts cross the IPC boundary as strings.
 * - Field names are camelCase; Rust DTOs use `#[serde(rename_all = "camelCase")]`.
 * - `resume_token` and `page_token` never cross the IPC boundary. The native
 *   layer owns them and only reports whether a checkpoint is available.
 * - The WebView never receives the Bearer token or any request header value.
 */

export type ServerSide = "OrderHub" | "UpdateService" | "Local";
export type ErrorCategory =
  | "config"
  | "validation"
  | "state"
  | "policy"
  | "tls"
  | "auth"
  | "transport"
  | "protocol"
  | "storage"
  | "update"
  | "internal";

export interface IpcError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, string>;
}

export interface ConfigIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  field?: string;
}

export interface ConnectionConfigSummary {
  address: string;
  tlsDomain: string;
  connectTimeoutSecs: number;
  rpcTimeoutSecs: number;
  caConfigured: boolean;
  caPath: string;
  tokenConfigured: boolean;
}

export interface OrderDefaultsSummary {
  strategyId: string;
  instrumentId: string;
  side: string;
  quantity: string;
  price: string;
  timeInForce: string;
}

export interface UpdateConfigSummary {
  configured: boolean;
  baseUrl: string | null;
  channel: string;
  autoCheck: boolean;
  autoDownload: boolean;
  enforceMinVersion: boolean;
  allowInsecureLoopback: boolean;
  allowInsecureHttp: boolean;
  checkIntervalSecs: number;
}

export interface ConfigSummary {
  configDir: string;
  exists: boolean;
  valid: boolean;
  loadedAt: string;
  fingerprint: string;
  connection: ConnectionConfigSummary | null;
  watchTimeoutSecs: number;
  orderDefaults: OrderDefaultsSummary | null;
  update: UpdateConfigSummary;
  issues: ConfigIssue[];
}

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "authenticating"
  | "syncing"
  | "synced"
  | "reconnecting"
  | "stale"
  | "reauth_required"
  | "error";

export interface ConnectionState {
  generation: number;
  phase: ConnectionPhase;
  changedAt: string;
  detail?: string;
  error?: IpcError;
  readiness?: string;
  writable?: boolean;
  stale?: boolean;
  persistenceMode?: string;
}

export interface InstrumentInfoDto {
  instrumentId: string;
  priceIncrement: string;
  sizeIncrement: string;
  pricePrecision: number;
}

export interface OrderViewDto {
  clientOrderId: string;
  strategyId: string;
  instrumentId: string;
  side: string;
  quantity: string;
  price: string;
  status: string;
  filledQuantity: string;
  remainingQuantity: string;
  accountId: string;
  fees: string;
  version: string;
}

export interface PositionViewDto {
  strategyId: string;
  instrumentId: string;
  quantity: string;
  cost: string;
  reservedQuantity: string;
}

export interface AccountViewDto {
  accountId: string;
  reservedCash: string;
  spentCash: string;
  strategyId: string;
}

export interface InputFactDto {
  json: string;
}

export interface ControlFactDto {
  readiness: string;
  writable: boolean;
  connected?: boolean;
  reason: string;
}

export interface CommittedViewDto {
  order?: OrderViewDto;
  position?: PositionViewDto;
  account?: AccountViewDto;
}

export interface SnapshotDto {
  generation: number;
  journalEpoch: string;
  stateCursor: string;
  durableCursor: string;
  writable: boolean;
  readiness: string;
  stale: boolean;
  persistenceMode: string;
  snapshotId: string;
  activeOrders: OrderViewDto[];
  instruments: InstrumentInfoDto[];
  positions: PositionViewDto[];
  accounts: AccountViewDto[];
  inputs: InputFactDto[];
  committedHealth: ControlFactDto | null;
  capturedAt: string;
}

export interface AdmissionEventDto {
  submitterId: string;
  requestId: string;
  strategyId: string;
  instrumentId: string;
  requestKind: string;
}

export interface OutcomeEventDto {
  originSeq: string;
  clientOrderId: string;
  outcome: string;
  reason: string;
}

export interface ProgressEventDto {
  stateCursor: string;
}

export interface ExecutionFactDto {
  eventId: string;
  tradeId: string;
  clientOrderId: string;
  strategyId: string;
  accountId: string;
  instrumentId: string;
  kind: string;
  quantity: string;
  price: string;
  fee: string;
  currency: string;
  eventTimeNs: string;
}

export type JournalEventKind =
  | "admission"
  | "outcome"
  | "progress"
  | "execution"
  | "input"
  | "control"
  | "unknown";

export interface JournalEventDto {
  generation: number;
  seq: string;
  journalEpoch: string;
  eventId: string;
  kind: JournalEventKind;
  receivedAt: string;
  admission?: AdmissionEventDto;
  outcome?: OutcomeEventDto;
  progress?: ProgressEventDto;
  execution?: ExecutionFactDto;
  input?: InputFactDto;
  control?: ControlFactDto;
  view?: CommittedViewDto;
  unknownNote?: string;
}

export interface AdmissionResponseDto {
  journalEpoch: string;
  seq: string;
  clientOrderId: string;
  alreadyAdmitted: boolean;
  result: string;
  reason: string;
}

export type SessionEvent =
  | { type: "status"; state: ConnectionState }
  | { type: "snapshot"; snapshot: SnapshotDto }
  | { type: "journal"; event: JournalEventDto }
  | { type: "checkpoint"; generation: number; journalEpoch: string; seq: string }
  | { type: "resync"; generation: number; reason: string; message: string };

export type Side = "BUY" | "SELL";
export type TimeInForce = "DAY";

export interface SubmitOrderInput {
  expectedGeneration: number;
  expectedEpoch: string;
  strategyId: string;
  instrumentId: string;
  side: Side;
  quantity: string;
  price: string;
  timeInForce: TimeInForce;
  postOnly: false;
  reduceOnly: false;
}

export interface CancelOrderInput {
  expectedGeneration: number;
  expectedEpoch: string;
  clientOrderId: string;
}

export type RequestMethod = "SubmitOrder" | "CancelOrder";
export type RequestStatus =
  | "prepared"
  | "sending"
  | "admitted"
  | "rejected"
  | "unknown"
  | "failed";

export interface RequestRecordDto {
  schemaVersion: number;
  requestId: string;
  rpcMethod: RequestMethod;
  status: RequestStatus;
  epoch: string;
  environmentId: string;
  credentialRef: string;
  params: Record<string, string | boolean>;
  admission: AdmissionResponseDto | null;
  error: IpcError | null;
  createdAt: string;
  updatedAt: string;
  lastLookupAt: string | null;
  lookupAttempts: number;
  clientOrderId: string | null;
  /** Local merge revision; increases each time the native store persists. */
  revision: number;
}

export interface SubmitOrderResult {
  record: RequestRecordDto;
  admission: AdmissionResponseDto | null;
  error: IpcError | null;
}

export interface CancelOrderResult {
  record: RequestRecordDto;
  admission: AdmissionResponseDto | null;
  error: IpcError | null;
}

export interface OrderLookupResult {
  generation: number;
  orders: OrderViewDto[];
  journalEpoch: string;
  stateCursor: string;
  resumeTokenAvailable: boolean;
  lookedUpAt: string;
}

export interface RequestLookupResult {
  record: RequestRecordDto;
  found: boolean;
  admission: AdmissionResponseDto | null;
  stateCursor: string | null;
  lookedUpAt: string;
  error: IpcError | null;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  os: string;
  arch: string;
  profile: string;
  demoMode: boolean;
}

export type PolicyGateStatus =
  | "not_configured"
  | "loading"
  | "valid"
  | "expired"
  | "missing"
  | "error";

export interface PolicyGateDto {
  status: PolicyGateStatus;
  canTrade: boolean;
  minSupportedVersion: string | null;
  effectiveAt: string | null;
  revision: number | null;
  validUntil: string | null;
  reason: string;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "failed"
  | "up_to_date"
  | "not_configured"
  | "restart_pending";

export interface UpdateMetadataDto {
  version: string;
  pubDate: string;
  notes: string;
  releaseId: string;
  policyRevision: number;
  mandatory: boolean;
  sizeBytes: string | null;
}

export interface DownloadProgressDto {
  receivedBytes: string;
  totalBytes: string | null;
  percent: number | null;
}

export interface UpdateStateDto {
  configured: boolean;
  channel: string;
  currentVersion: string;
  phase: UpdatePhase;
  metadata: UpdateMetadataDto | null;
  download: DownloadProgressDto | null;
  policyGate: PolicyGateDto;
  lastCheckedAt: string | null;
  error: IpcError | null;
  message: string | null;
}

export interface UpdateCheckResult {
  state: UpdateStateDto;
}

export interface DownloadUpdateResult {
  state: UpdateStateDto;
  downloaded: boolean;
}

export interface InstallUpdateResult {
  state: UpdateStateDto;
  installing: boolean;
  message: string;
}

export interface DiagnosticExportResult {
  path: string;
  createdAt: string;
  bytes: number;
  redactions: string[];
}

export interface DiagnosticsSummary {
  app: AppInfo;
  generatedAt: string;
  config: {
    configDir: string;
    address: string;
    tlsDomain: string;
    caConfigured: boolean;
    tokenConfigured: boolean;
    fingerprint: string;
    issues: ConfigIssue[];
  };
  connection: ConnectionState;
  sync: {
    generation: number;
    journalEpoch: string | null;
    stateCursor: string | null;
    durableCursor: string | null;
    readiness: string | null;
    writable: boolean | null;
    stale: boolean | null;
    activeOrders: number;
    unknownEventCount: number;
    resyncCount: number;
  };
  update: UpdateStateDto;
  runtime: {
    dataDir: string;
    installationIdRef: string;
    requestRecordCount: number;
    unknownRequestCount: number;
  };
  recentErrors: Array<{ at: string; category: string; code: string; correlationId: string; message: string }>;
}

export interface RequestRecoveryDto {
  ready: boolean;
  loading: boolean;
  total: number;
  unknown: number;
  loadErrors: string[];
}

export interface BootstrapState {
  app: AppInfo;
  config: ConfigSummary;
  connection: ConnectionState;
  update: UpdateStateDto;
  /** Recent window only; the requests page loads the full list on demand. */
  requests: RequestRecordDto[];
  requestRecovery: RequestRecoveryDto;
  diagnostics: DiagnosticsSummary;
}

export interface AckCheckpointInput {
  generation: number;
  journalEpoch: string;
  seq: string;
}

export interface LookupSessionRequestInput {
  requestId: string;
}

export interface ExportDiagnosticsInput {
  confirmed: boolean;
}

export interface CheckUpdateInput {
  manual: boolean;
}

export interface ListRequestsResult {
  records: RequestRecordDto[];
  recovery: RequestRecoveryDto;
}
