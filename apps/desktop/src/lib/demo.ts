import type {
  AppInfo,
  BootstrapState,
  ConfigSummary,
  ConnectionState,
  DiagnosticsSummary,
  DownloadProgressDto,
  IpcError,
  JournalEventDto,
  OrderViewDto,
  PolicyGateDto,
  RequestRecordDto,
  SessionEvent,
  SnapshotDto,
  UpdateStateDto,
} from "@orderhub/contracts";
import type { Backend } from "./bridge";

/**
 * Browser-only demo data for layout review and screenshots.
 *
 * It never performs network I/O, never sends an order and never writes files.
 * The UI shows a persistent "开发演示数据" banner whenever this backend is used.
 */

const now = () => new Date().toISOString();

const appInfo: AppInfo = {
  name: "OrderHub Desktop",
  version: "0.1.0",
  tauriVersion: "2.x (demo)",
  os: "windows",
  arch: "x86_64",
  profile: "debug",
  demoMode: true,
};

const config: ConfigSummary = {
  configDir: "D:\\orderhub-workspace\\config",
  exists: true,
  valid: true,
  loadedAt: "2026-10-19T12:10:00Z",
  fingerprint: "demo-env-7f3a91c2",
  connection: {
    address: "orderhub.example.com:50051",
    tlsDomain: "orderhub.test",
    connectTimeoutSecs: 5,
    rpcTimeoutSecs: 10,
    caConfigured: true,
    caPath: "D:\\orderhub-workspace\\config\\tls\\ca.pem",
    tokenConfigured: true,
  },
  watchTimeoutSecs: 15,
  orderDefaults: {
    strategyId: "ORDERHUB-S001",
    instrumentId: "AAPL.GOX",
    side: "BUY",
    quantity: "100",
    price: "153.22",
    timeInForce: "DAY",
  },
  update: {
    configured: true,
    baseUrl: "https://updates.example.com",
    channel: "beta",
    autoCheck: true,
    autoDownload: false,
    enforceMinVersion: true,
    allowInsecureLoopback: false,
    allowInsecureHttp: false,
    checkIntervalSecs: 3600,
  },
  issues: [
    {
      severity: "warning",
      code: "DEMO_MODE",
      message: "当前为开发演示数据，不会连接真实服务或发送订单。",
    },
  ],
};

const orders: OrderViewDto[] = [
  {
    clientOrderId: "O-8123456789012345678-000000000011",
    strategyId: "ORDERHUB-S001",
    instrumentId: "AAPL.GOX",
    side: "BUY",
    quantity: "100",
    price: "153.22",
    status: "PARTIALLY_FILLED",
    filledQuantity: "40",
    remainingQuantity: "60",
    accountId: "GOX-001",
    fees: "1.25",
    version: "7",
  },
  {
    clientOrderId: "O-8123456789012345678-000000000012",
    strategyId: "ORDERHUB-S001",
    instrumentId: "AAPL.GOX",
    side: "SELL",
    quantity: "25",
    price: "153.30",
    status: "SUBMITTED",
    filledQuantity: "0",
    remainingQuantity: "25",
    accountId: "GOX-001",
    fees: "0",
    version: "2",
  },
  {
    clientOrderId: "O-8123456789012345678-000000000013",
    strategyId: "ORDERHUB-S002",
    instrumentId: "AAPL.GOX",
    side: "BUY",
    quantity: "50",
    price: "152.90",
    status: "PENDING_DISPATCH",
    filledQuantity: "0",
    remainingQuantity: "50",
    accountId: "GOX-002",
    fees: "0",
    version: "1",
  },
];

const terminalOrder: OrderViewDto = {
  clientOrderId: "O-8123456789012345678-000000000009",
  strategyId: "ORDERHUB-S001",
  instrumentId: "AAPL.GOX",
  side: "BUY",
  quantity: "20",
  price: "151.10",
  status: "FILLED",
  filledQuantity: "20",
  remainingQuantity: "0",
  accountId: "GOX-001",
  fees: "0.62",
  version: "4",
};

const snapshot: SnapshotDto = {
  generation: 1,
  journalEpoch: "8123456789012345678",
  stateCursor: "4820",
  durableCursor: "4817",
  writable: true,
  readiness: "READY",
  stale: false,
  persistenceMode: "async",
  snapshotId: "snap-demo-01",
  activeOrders: orders,
  instruments: [
    {
      instrumentId: "AAPL.GOX",
      priceIncrement: "0.01",
      sizeIncrement: "1",
      pricePrecision: 2,
    },
  ],
  positions: [
    {
      strategyId: "ORDERHUB-S001",
      instrumentId: "AAPL.GOX",
      quantity: "101",
      cost: "15311.42",
      reservedQuantity: "25",
    },
    {
      strategyId: "ORDERHUB-S002",
      instrumentId: "AAPL.GOX",
      quantity: "20",
      cost: "3050.00",
      reservedQuantity: "0",
    },
  ],
  accounts: [
    {
      accountId: "GOX-001",
      reservedCash: "3850.50",
      spentCash: "142101.20",
      strategyId: "ORDERHUB-S001",
    },
    {
      accountId: "GOX-002",
      reservedCash: "7654.75",
      spentCash: "6120.00",
      strategyId: "ORDERHUB-S002",
    },
  ],
  inputs: [
    { json: '{"kind":"instrument_input","state":"TRADABLE","source":"demo"}' },
    { json: '{"kind":"strategy_owned_input","strategy_id":"ORDERHUB-S001","state":"TRADABLE"}' },
  ],
  committedHealth: {
    readiness: "READY",
    writable: true,
    connected: true,
    reason: "",
  },
  capturedAt: "2026-10-19T12:10:02Z",
};

const policyGate: PolicyGateDto = {
  status: "valid",
  canTrade: true,
  minSupportedVersion: "0.1.0",
  effectiveAt: "2026-10-01T00:00:00Z",
  revision: 7,
  validUntil: "2026-10-21T00:00:00Z",
  reason: "演示策略：最低支持版本 0.1.0（revision 7）。",
};

let updateState: UpdateStateDto = {
  configured: true,
  channel: "beta",
  currentVersion: "0.1.0",
  phase: "available",
  metadata: {
    version: "0.2.0",
    pubDate: "2026-10-19T08:00:00Z",
    notes: "修复断线后的请求结果恢复，改进报单确认与请求记录展示。",
    releaseId: "rel_demo_0_2_0",
    policyRevision: 7,
    mandatory: false,
    sizeBytes: "87654321",
  },
  download: null,
  policyGate,
  lastCheckedAt: "2026-10-19T12:10:05Z",
  error: null,
  message: "演示数据：发现可用更新。",
};

let connection: ConnectionState = {
  generation: 1,
  phase: "idle",
  changedAt: now(),
  detail: "开发演示数据",
  readiness: "READY",
  writable: true,
  stale: false,
  persistenceMode: "async",
};

let requests: RequestRecordDto[] = [
  {
    schemaVersion: 1,
    requestId: "ohd-demo-1760861200000-a1b2c3d4e5f6",
    rpcMethod: "SubmitOrder",
    status: "admitted",
    epoch: "8123456789012345678",
    environmentId: "demo-env-7f3a91c2",
    credentialRef: "3f9c1d8a2b7e4f60",
    params: {
      strategyId: "ORDERHUB-S001",
      instrumentId: "AAPL.GOX",
      side: "BUY",
      quantity: "40",
      price: "153.22",
      timeInForce: "DAY",
      postOnly: false,
      reduceOnly: false,
    },
    admission: {
      journalEpoch: "8123456789012345678",
      seq: "4820",
      clientOrderId: "O-8123456789012345678-000000000011",
      alreadyAdmitted: false,
      result: "ADMITTED",
      reason: "",
    },
    error: null,
    createdAt: "2026-10-19T12:04:11Z",
    updatedAt: "2026-10-19T12:04:12Z",
    lastLookupAt: null,
    lookupAttempts: 0,
    clientOrderId: "O-8123456789012345678-000000000011",
  },
  {
    schemaVersion: 1,
    requestId: "ohd-demo-1760861280000-0f1e2d3c4b5a",
    rpcMethod: "CancelOrder",
    status: "unknown",
    epoch: "8123456789012345678",
    environmentId: "demo-env-7f3a91c2",
    credentialRef: "3f9c1d8a2b7e4f60",
    params: { clientOrderId: "O-8123456789012345678-000000000012" },
    admission: null,
    error: {
      category: "transport",
      code: "GRPC_DEADLINE_EXCEEDED",
      message: "等待撤单受理响应超时；订单仍可能成交，必须查询原请求结果",
      retryable: true,
      correlationId: "demo-correlation-1",
    },
    createdAt: "2026-10-19T12:06:40Z",
    updatedAt: "2026-10-19T12:06:50Z",
    lastLookupAt: null,
    lookupAttempts: 0,
    clientOrderId: "O-8123456789012345678-000000000012",
  },
  {
    schemaVersion: 1,
    requestId: "ohd-demo-1760861300000-9a8b7c6d5e4f",
    rpcMethod: "SubmitOrder",
    status: "rejected",
    epoch: "8123456789012345678",
    environmentId: "demo-env-7f3a91c2",
    credentialRef: "3f9c1d8a2b7e4f60",
    params: {
      strategyId: "ORDERHUB-S001",
      instrumentId: "AAPL.GOX",
      side: "SELL",
      quantity: "25",
      price: "153.30",
      timeInForce: "DAY",
      postOnly: false,
      reduceOnly: false,
    },
    admission: {
      journalEpoch: "8123456789012345678",
      seq: "4818",
      clientOrderId: "",
      alreadyAdmitted: false,
      result: "REJECTED",
      reason: "SELLABLE_QUANTITY",
    },
    error: null,
    createdAt: "2026-10-19T12:08:03Z",
    updatedAt: "2026-10-19T12:08:03Z",
    lastLookupAt: null,
    lookupAttempts: 0,
    clientOrderId: null,
  },
];

function syncedState(): ConnectionState {
  return {
    generation: 1,
    phase: "synced",
    changedAt: now(),
    detail: "演示快照已建立，事件流已连接",
    readiness: "READY",
    writable: true,
    stale: false,
    persistenceMode: "async",
  };
}

function makeDiagnostics(): DiagnosticsSummary {
  return {
    app: appInfo,
    generatedAt: now(),
    config: {
      configDir: config.configDir,
      address: "***.***.example.com:50051",
      tlsDomain: "orderhub.test",
      caConfigured: true,
      tokenConfigured: true,
      fingerprint: config.fingerprint,
      issues: config.issues,
    },
    connection,
    sync: {
      generation: 1,
      journalEpoch: snapshot.journalEpoch,
      stateCursor: snapshot.stateCursor,
      durableCursor: snapshot.durableCursor,
      readiness: "READY",
      writable: true,
      stale: false,
      activeOrders: orders.length,
      unknownEventCount: 0,
      resyncCount: 0,
    },
    update: updateState,
    runtime: {
      dataDir: "C:\\Users\\<user>\\AppData\\Local\\com.orderhub.desktop",
      installationIdRef: "a1b2c3d4",
      requestRecordCount: requests.length,
      unknownRequestCount: 1,
    },
    recentErrors: [
      {
        at: "2026-10-19T12:06:50Z",
        category: "transport",
        code: "GRPC_DEADLINE_EXCEEDED",
        correlationId: "demo-correlation-1",
        message: "等待撤单受理响应超时；订单仍可能成交，必须查询原请求结果",
      },
    ],
  };
}

function bootstrap(): BootstrapState {
  return {
    app: appInfo,
    config,
    connection,
    update: updateState,
    requests: [...requests],
    diagnostics: makeDiagnostics(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function demoError(code: string, message: string): IpcError {
  return {
    category: "policy",
    code,
    message,
    retryable: false,
    correlationId: "demo",
  };
}

export const demoBackend: Backend = {
  kind: "demo",
  async getBootstrapState() {
    return bootstrap();
  },
  async getConfigSummary() {
    return config;
  },
  async reloadConfig() {
    return config;
  },
  async connect(onEvent) {
    const connecting: ConnectionState = {
      ...connection,
      phase: "connecting",
      changedAt: now(),
      detail: "演示：建立 TLS 连接",
    };
    connection = connecting;
    onEvent({ type: "status", state: connecting });
    await sleep(90);
    const syncing: ConnectionState = {
      ...connecting,
      phase: "syncing",
      changedAt: now(),
      detail: "演示：获取完整快照",
    };
    connection = syncing;
    onEvent({ type: "status", state: syncing });
    await sleep(120);
    onEvent({ type: "snapshot", snapshot });
    connection = syncedState();
    onEvent({ type: "status", state: connection });
    window.setTimeout(() => {
      const progress: JournalEventDto = {
        generation: 1,
        seq: "4821",
        journalEpoch: snapshot.journalEpoch,
        eventId: "",
        kind: "progress",
        receivedAt: now(),
        progress: { stateCursor: "4821" },
      };
      onEvent({ type: "journal", event: progress });
    }, 500);
    window.setTimeout(() => {
      const event: JournalEventDto = {
        generation: 1,
        seq: "4822",
        journalEpoch: snapshot.journalEpoch,
        eventId: "8123456789012345678:4822",
        kind: "execution",
        receivedAt: now(),
        execution: {
          eventId: "EXEC-DEMO-4822",
          tradeId: "T-DEMO-4822",
          clientOrderId: orders[0]!.clientOrderId,
          strategyId: "ORDERHUB-S001",
          accountId: "GOX-001",
          instrumentId: "AAPL.GOX",
          kind: "FILL",
          quantity: "10",
          price: "153.22",
          fee: "0.31",
          currency: "USD",
          eventTimeNs: "1792397460000000000",
        },
        view: {
          order: {
            ...orders[0]!,
            filledQuantity: "50",
            remainingQuantity: "50",
            fees: "1.56",
            version: "8",
          },
        },
      };
      onEvent({ type: "journal", event });
    }, 2200);
    return connection;
  },
  async disconnect() {
    connection = {
      generation: connection.generation + 1,
      phase: "idle",
      changedAt: now(),
      detail: "演示：已断开",
    };
    return connection;
  },
  async ackCheckpoint() {
    return true;
  },
  async lookupOrder(orderIds) {
    const all = [...orders, terminalOrder];
    return {
      orders: all.filter((order) => orderIds.includes(order.clientOrderId)),
      journalEpoch: snapshot.journalEpoch,
      stateCursor: "4824",
      resumeTokenAvailable: true,
      lookedUpAt: now(),
    };
  },
  async submitOrder() {
    throw demoError(
      "DEMO_MODE_READ_ONLY",
      "开发演示数据不会提交真实订单；请在 Tauri 客户端中使用已授权的测试环境。",
    );
  },
  async cancelOrder() {
    throw demoError(
      "DEMO_MODE_READ_ONLY",
      "开发演示数据不会提交真实撤单；请在 Tauri 客户端中使用已授权的测试环境。",
    );
  },
  async lookupSessionRequest(requestId) {
    const record = requests.find((item) => item.requestId === requestId);
    if (!record) {
      throw demoError("REQUEST_NOT_FOUND_LOCAL", "演示数据中没有该请求");
    }
    record.lookupAttempts += 1;
    record.lastLookupAt = now();
    if (record.status === "unknown") {
      return {
        record,
        found: false,
        admission: null,
        stateCursor: null,
        lookedUpAt: now(),
        error: {
          category: "protocol",
          code: "REQUEST_NOT_FOUND",
          message: "演示：查询时尚无可见结果；不能证明请求未执行，请勿换新 ID 自动补单。",
          retryable: true,
          correlationId: "demo",
        },
      };
    }
    return {
      record,
      found: true,
      admission: record.admission,
      stateCursor: "4824",
      lookedUpAt: now(),
      error: null,
    };
  },
  async listRequests() {
    return [...requests];
  },
  async checkUpdate() {
    updateState = {
      ...updateState,
      phase: "available",
      lastCheckedAt: now(),
      error: null,
      message: "演示数据：更新检查完成，发现 0.2.0。",
    };
    return { state: updateState };
  },
  async downloadUpdate(onProgress: (progress: DownloadProgressDto) => void) {
    updateState = {
      ...updateState,
      phase: "downloading",
      download: { receivedBytes: "0", totalBytes: "87654321", percent: 0 },
      message: "演示：正在模拟下载进度。",
    };
    for (let index = 1; index <= 10; index += 1) {
      await sleep(70);
      const percent = index * 10;
      const received = String(Math.floor((87654321 * percent) / 100));
      const progress = {
        receivedBytes: received,
        totalBytes: "87654321",
        percent,
      };
      updateState = { ...updateState, download: progress };
      onProgress(progress);
    }
    updateState = {
      ...updateState,
      phase: "ready",
      download: { receivedBytes: "87654321", totalBytes: "87654321", percent: 100 },
      message: "演示：安装包已下载并验签（未写入磁盘）。",
    };
    return { state: updateState, downloaded: true };
  },
  async installUpdate() {
    throw demoError(
      "DEMO_MODE_NO_INSTALL",
      "开发演示数据不会启动安装器；请使用已签名安装包在测试机验证。",
    );
  },
  async getUpdateState() {
    return updateState;
  },
  async confirmStartup() {
    return false;
  },
  async getDiagnostics() {
    return makeDiagnostics();
  },
  async exportDiagnostics() {
    throw demoError(
      "DEMO_MODE_NO_EXPORT",
      "开发演示数据不会写入诊断文件；请在 Tauri 客户端中导出。",
    );
  },
};

export type { SessionEvent };
