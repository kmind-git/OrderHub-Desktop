import type {
  AccountViewDto,
  BootstrapState,
  ConfigSummary,
  ConnectionState,
  DiagnosticsSummary,
  ExecutionFactDto,
  InputFactDto,
  InstrumentInfoDto,
  IpcError,
  JournalEventDto,
  OrderViewDto,
  PositionViewDto,
  RequestRecordDto,
  SnapshotDto,
  UpdateStateDto,
} from "@orderhub/contracts";
import { isTerminalStatus } from "./format";

export interface SyncState {
  journalEpoch: string | null;
  stateCursor: string | null;
  durableCursor: string | null;
  lastBusinessSeq: string | null;
  lastProgressCursor: string | null;
  appliedEvents: number;
  progressEvents: number;
  unknownEvents: number;
  resyncs: number;
  inconsistent: boolean;
  lastEventAt: string | null;
}

export interface ToastItem {
  tone: "ok" | "warn" | "danger" | "info";
  title: string;
  message?: string;
  error?: IpcError;
}

export interface UiState {
  bootstrap: BootstrapState | null;
  config: ConfigSummary | null;
  connection: ConnectionState;
  snapshot: SnapshotDto | null;
  orders: Record<string, OrderViewDto>;
  positions: PositionViewDto[];
  accounts: AccountViewDto[];
  instruments: InstrumentInfoDto[];
  inputs: InputFactDto[];
  events: JournalEventDto[];
  executions: ExecutionFactDto[];
  requests: RequestRecordDto[];
  update: UpdateStateDto | null;
  diagnostics: DiagnosticsSummary | null;
  sync: SyncState;
  seenEventIds: string[];
  toast: ToastItem | null;
}

export type UiAction =
  | { type: "bootstrap"; bootstrap: BootstrapState }
  | { type: "connection"; connection: ConnectionState }
  | { type: "snapshot"; snapshot: SnapshotDto }
  | { type: "journal"; event: JournalEventDto }
  | { type: "resync"; generation: number; reason: string; message: string }
  | { type: "requests"; records: RequestRecordDto[] }
  | { type: "requestUpsert"; record: RequestRecordDto }
  | { type: "update"; update: UpdateStateDto }
  | { type: "downloadProgress"; progress: import("@orderhub/contracts").DownloadProgressDto }
  | { type: "lookupOrders"; orders: OrderViewDto[] }
  | { type: "diagnostics"; diagnostics: DiagnosticsSummary }
  | { type: "config"; config: ConfigSummary }
  | { type: "toast"; toast: ToastItem | null }
  | { type: "clearSession" };

const emptySync = (): SyncState => ({
  journalEpoch: null,
  stateCursor: null,
  durableCursor: null,
  lastBusinessSeq: null,
  lastProgressCursor: null,
  appliedEvents: 0,
  progressEvents: 0,
  unknownEvents: 0,
  resyncs: 0,
  inconsistent: false,
  lastEventAt: null,
});

export function initialUiState(): UiState {
  return {
    bootstrap: null,
    config: null,
    connection: {
      generation: 0,
      phase: "idle",
      changedAt: new Date().toISOString(),
      detail: "尚未连接",
    },
    snapshot: null,
    orders: {},
    positions: [],
    accounts: [],
    instruments: [],
    inputs: [],
    events: [],
    executions: [],
    requests: [],
    update: null,
    diagnostics: null,
    sync: emptySync(),
    seenEventIds: [],
    toast: null,
  };
}

function clearSession(state: UiState): UiState {
  return {
    ...state,
    snapshot: null,
    orders: {},
    positions: [],
    accounts: [],
    instruments: [],
    inputs: [],
    events: [],
    executions: [],
    seenEventIds: [],
    sync: {
      ...emptySync(),
      resyncs: state.sync.resyncs,
    },
  };
}

function compareDecimalStrings(left: string, right: string): number | null {
  if (!/^\d+$/.test(left) || !/^\d+$/.test(right)) return null;
  const leftBig = BigInt(left);
  const rightBig = BigInt(right);
  return leftBig === rightBig ? 0 : leftBig < rightBig ? -1 : 1;
}

function upsertPosition(list: PositionViewDto[], position: PositionViewDto): PositionViewDto[] {
  const index = list.findIndex(
    (item) =>
      item.strategyId === position.strategyId && item.instrumentId === position.instrumentId,
  );
  if (index === -1) return [...list, position];
  const next = [...list];
  next[index] = position;
  return next;
}

function upsertAccount(list: AccountViewDto[], account: AccountViewDto): AccountViewDto[] {
  const index = list.findIndex(
    (item) => item.accountId === account.accountId && item.strategyId === account.strategyId,
  );
  if (index === -1) return [...list, account];
  const next = [...list];
  next[index] = account;
  return next;
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "bootstrap": {
      return {
        ...state,
        bootstrap: action.bootstrap,
        config: action.bootstrap.config,
        connection: action.bootstrap.connection,
        requests: action.bootstrap.requests,
        update: action.bootstrap.update,
        diagnostics: action.bootstrap.diagnostics,
      };
    }
    case "connection": {
      const nextGeneration = action.connection.generation;
      const generationChanged =
        state.connection.generation > 0 && nextGeneration !== state.connection.generation;
      if (!generationChanged) {
        const currentAt = Date.parse(state.connection.changedAt);
        const incomingAt = Date.parse(action.connection.changedAt);
        // Channel status events and the connect command response can be
        // delivered out of order. Never regress to an older state for the
        // same generation (for example syncing -> connecting after the
        // snapshot has already arrived).
        if (Number.isFinite(currentAt) && Number.isFinite(incomingAt) && incomingAt < currentAt) {
          return state;
        }
      }
      const base = generationChanged ? clearSession(state) : state;
      return {
        ...base,
        connection: { ...action.connection },
      };
    }
    case "snapshot": {
      const activeOrders: Record<string, OrderViewDto> = {};
      for (const order of action.snapshot.activeOrders) {
        activeOrders[order.clientOrderId] = order;
      }
      return {
        ...state,
        snapshot: action.snapshot,
        orders: activeOrders,
        positions: action.snapshot.positions,
        accounts: action.snapshot.accounts,
        instruments: action.snapshot.instruments,
        inputs: action.snapshot.inputs,
        events: [],
        executions: [],
        seenEventIds: [],
        sync: {
          ...emptySync(),
          journalEpoch: action.snapshot.journalEpoch,
          stateCursor: action.snapshot.stateCursor,
          durableCursor: action.snapshot.durableCursor,
          lastBusinessSeq: action.snapshot.stateCursor,
          resyncs: state.sync.resyncs,
        },
      };
    }
    case "journal": {
      const event = action.event;
      if (!state.snapshot) return state;
      if (event.generation !== state.snapshot.generation) return state;
      if (event.journalEpoch !== state.snapshot.journalEpoch) {
        return {
          ...state,
          sync: { ...state.sync, inconsistent: true },
        };
      }
      if (event.kind === "progress") {
        return {
          ...state,
          sync: {
            ...state.sync,
            stateCursor: event.progress?.stateCursor ?? state.sync.stateCursor,
            lastProgressCursor: event.progress?.stateCursor ?? state.sync.lastProgressCursor,
            progressEvents: state.sync.progressEvents + 1,
            appliedEvents: state.sync.appliedEvents + 1,
            lastEventAt: event.receivedAt,
          },
        };
      }
      const key = event.eventId || `${event.journalEpoch}:${event.seq}:${event.kind}`;
      if (state.seenEventIds.includes(key)) return state;
      const seenEventIds = [...state.seenEventIds, key].slice(-2048);
      const comparison =
        state.sync.lastBusinessSeq === null
          ? null
          : compareDecimalStrings(event.seq, state.sync.lastBusinessSeq);
      const outOfOrder = comparison === -1;
      const lastBusinessSeq =
        state.sync.lastBusinessSeq === null ||
        (comparison !== null && comparison >= 0)
          ? event.seq
          : state.sync.lastBusinessSeq;
      let orders = state.orders;
      let positions = state.positions;
      let accounts = state.accounts;
      let connection = state.connection;
      if (event.view?.order) {
        orders = { ...orders, [event.view.order.clientOrderId]: event.view.order };
      }
      if (event.view?.position) {
        positions = upsertPosition(positions, event.view.position);
      }
      if (event.view?.account) {
        accounts = upsertAccount(accounts, event.view.account);
      }
      let snapshot = state.snapshot;
      if (event.control) {
        connection = {
          ...connection,
          readiness: event.control.readiness,
          writable: event.control.writable,
        };
        // Control is the freshest committed service state; keep the snapshot
        // projection in sync so gates never rely on a stale READY flag.
        snapshot = {
          ...snapshot,
          readiness: event.control.readiness,
          writable: event.control.writable,
        };
      }
      const unknown = event.kind === "unknown";
      const events = [...state.events, event].slice(-240);
      const executions = event.execution
        ? [...state.executions, event.execution].slice(-500)
        : state.executions;
      return {
        ...state,
        orders,
        positions,
        accounts,
        connection,
        snapshot,
        events,
        executions,
        seenEventIds,
        sync: {
          ...state.sync,
          lastBusinessSeq,
          appliedEvents: state.sync.appliedEvents + 1,
          unknownEvents: state.sync.unknownEvents + (unknown ? 1 : 0),
          inconsistent: state.sync.inconsistent || unknown || outOfOrder,
          lastEventAt: event.receivedAt,
        },
      };
    }
    case "resync": {
      if (action.generation !== state.connection.generation) return state;
      return {
        ...state,
        sync: { ...state.sync, resyncs: state.sync.resyncs + 1, inconsistent: true },
        connection: {
          ...state.connection,
          phase: "syncing",
          detail: action.message,
          changedAt: new Date().toISOString(),
        },
      };
    }
    case "requests":
      return { ...state, requests: action.records };
    case "requestUpsert": {
      const index = state.requests.findIndex(
        (record) => record.requestId === action.record.requestId,
      );
      const requests = [...state.requests];
      if (index === -1) requests.unshift(action.record);
      else requests[index] = action.record;
      return { ...state, requests };
    }
    case "update":
      return { ...state, update: action.update };
    case "downloadProgress":
      if (!state.update) return state;
      return {
        ...state,
        update: {
          ...state.update,
          phase: "downloading",
          download: action.progress,
        },
      };
    case "lookupOrders": {
      if (action.orders.length === 0) return state;
      const orders = { ...state.orders };
      for (const order of action.orders) orders[order.clientOrderId] = order;
      return { ...state, orders };
    }
    case "diagnostics":
      return { ...state, diagnostics: action.diagnostics };
    case "config":
      return { ...state, config: action.config };
    case "toast":
      return { ...state, toast: action.toast };
    case "clearSession":
      return clearSession(state);
    default:
      return state;
  }
}

export function activeOrders(state: UiState): OrderViewDto[] {
  return Object.values(state.orders).filter((order) => !isTerminalStatus(order.status));
}

export function terminalOrders(state: UiState): OrderViewDto[] {
  return Object.values(state.orders).filter((order) => isTerminalStatus(order.status));
}

export function sessionExecutions(state: UiState, clientOrderId: string): ExecutionFactDto[] {
  return state.executions.filter((execution) => execution.clientOrderId === clientOrderId);
}

export function tradingBlockReason(state: UiState): string | null {
  if (!state.snapshot) return "尚无完整业务快照；请先连接并完成同步。";
  if (state.connection.phase !== "synced") {
    return `连接状态为 ${state.connection.phase}，不能新增报单。`;
  }
  if (state.snapshot.stale || state.connection.stale) {
    return "服务状态为 stale，新增报单已关闭。";
  }
  if (!state.snapshot.writable) return "服务当前不可写。";
  if (state.snapshot.readiness !== "READY") {
    return `服务 readiness 为 ${state.snapshot.readiness}。`;
  }
  if (state.sync.inconsistent || state.sync.unknownEvents > 0) {
    return "会话检测到未知或乱序事件，已停止新增报单，等待重新同步。";
  }
  if (!state.update) return "更新策略状态尚未加载，写入已保守关闭。";
  if (!state.update.policyGate.canTrade) {
    return state.update.policyGate.reason || "最低版本策略不允许新增报单。";
  }
  return null;
}

export function canTrade(state: UiState): boolean {
  return tradingBlockReason(state) === null;
}
