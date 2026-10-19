import { describe, expect, it } from "vitest";
import type {
  JournalEventDto,
  OrderViewDto,
  SnapshotDto,
  UpdateStateDto,
} from "@orderhub/contracts";
import {
  activeOrders,
  canTrade,
  initialUiState,
  tradingBlockReason,
  uiReducer,
} from "../src/lib/reducer";

const order: OrderViewDto = {
  clientOrderId: "O-1",
  strategyId: "S-1",
  instrumentId: "AAPL.GOX",
  side: "BUY",
  quantity: "100",
  price: "153.22",
  status: "SUBMITTED",
  filledQuantity: "0",
  remainingQuantity: "100",
  accountId: "A-1",
  fees: "0",
  version: "1",
};

const snapshot: SnapshotDto = {
  generation: 3,
  journalEpoch: "8123",
  stateCursor: "4820",
  durableCursor: "4817",
  writable: true,
  readiness: "READY",
  stale: false,
  persistenceMode: "async",
  snapshotId: "s-1",
  activeOrders: [order],
  instruments: [
    { instrumentId: "AAPL.GOX", priceIncrement: "0.01", sizeIncrement: "1", pricePrecision: 2 },
  ],
  positions: [],
  accounts: [
    { accountId: "A-1", reservedCash: "100", spentCash: "200", strategyId: "S-1" },
  ],
  inputs: [],
  committedHealth: null,
  capturedAt: "2026-10-19T00:00:00Z",
};

const update: UpdateStateDto = {
  configured: true,
  channel: "stable",
  currentVersion: "0.1.0",
  phase: "up_to_date",
  metadata: null,
  download: null,
  policyGate: {
    status: "valid",
    canTrade: true,
    minSupportedVersion: "0.1.0",
    effectiveAt: null,
    revision: 1,
    validUntil: "2026-10-21T00:00:00Z",
    reason: "ok",
  },
  lastCheckedAt: null,
  error: null,
  message: null,
};

function event(overrides: Partial<JournalEventDto>): JournalEventDto {
  return {
    generation: 3,
    seq: "4821",
    journalEpoch: "8123",
    eventId: "8123:4821",
    kind: "outcome",
    receivedAt: "2026-10-19T00:00:01Z",
    ...overrides,
  };
}

function bootstrapped() {
  let state = uiReducer(initialUiState(), {
    type: "bootstrap",
    bootstrap: {
      app: {
        name: "OrderHub Desktop",
        version: "0.1.0",
        tauriVersion: "2",
        os: "windows",
        arch: "x86_64",
        profile: "test",
        demoMode: false,
      },
      config: {
        configDir: "config",
        exists: true,
        valid: true,
        loadedAt: "2026-10-19T00:00:00Z",
        fingerprint: "env",
        connection: null,
        watchTimeoutSecs: 15,
        orderDefaults: null,
        update: {
          configured: true,
          baseUrl: "https://updates.example.com",
          channel: "stable",
          autoCheck: true,
          autoDownload: false,
          enforceMinVersion: true,
          allowInsecureLoopback: false,
          checkIntervalSecs: 3600,
        },
        issues: [],
      },
      connection: {
        generation: 3,
        phase: "synced",
        changedAt: "2026-10-19T00:00:00Z",
      },
      update,
      requests: [],
      diagnostics: {} as never,
    },
  });
  state = uiReducer(state, {
    type: "connection",
    connection: {
      generation: 3,
      phase: "synced",
      changedAt: "2026-10-19T00:00:00Z",
      readiness: "READY",
      writable: true,
      stale: false,
    },
  });
  return uiReducer(state, { type: "snapshot", snapshot });
}

describe("session reducer", () => {
  it("replaces the baseline and keeps only active orders", () => {
    const state = bootstrapped();
    expect(state.orders["O-1"]?.status).toBe("SUBMITTED");
    expect(activeOrders(state)).toHaveLength(1);
    expect(state.sync.journalEpoch).toBe("8123");
    expect(state.sync.stateCursor).toBe("4820");
    expect(canTrade(state)).toBe(true);
  });

  it("updates progress without changing order state", () => {
    const state = uiReducer(bootstrapped(), {
      type: "journal",
      event: event({
        kind: "progress",
        eventId: "",
        seq: "4820",
        progress: { stateCursor: "4821" },
      }),
    });
    expect(state.sync.stateCursor).toBe("4821");
    expect(state.sync.progressEvents).toBe(1);
    expect(state.orders["O-1"]?.status).toBe("SUBMITTED");
  });

  it("deduplicates business events by event id", () => {
    const action = {
      type: "journal" as const,
      event: event({
        view: { order: { ...order, status: "PARTIALLY_FILLED", filledQuantity: "40", version: "2" } },
      }),
    };
    const once = uiReducer(bootstrapped(), action);
    const twice = uiReducer(once, action);
    expect(once.sync.appliedEvents).toBe(1);
    expect(twice.sync.appliedEvents).toBe(1);
    expect(twice.orders["O-1"]?.filledQuantity).toBe("40");
    expect(twice.sync.inconsistent).toBe(false);
  });

  it("blocks new orders after an unknown event and resets after a new snapshot", () => {
    const unknown = uiReducer(
      bootstrapped(),
      {
        type: "journal",
        event: event({ kind: "unknown", eventId: "8123:4822", seq: "4822" }),
      },
    );
    expect(unknown.sync.unknownEvents).toBe(1);
    expect(canTrade(unknown)).toBe(false);
    expect(tradingBlockReason(unknown)).toContain("未知");

    const resynced = uiReducer(unknown, { type: "snapshot", snapshot });
    expect(resynced.sync.unknownEvents).toBe(0);
    expect(canTrade(resynced)).toBe(true);
  });

  it("rejects events from another generation or epoch", () => {
    const wrongGeneration = uiReducer(bootstrapped(), {
      type: "journal",
      event: event({ generation: 2, seq: "5000", eventId: "2:5000" }),
    });
    expect(wrongGeneration.sync.appliedEvents).toBe(0);

    const wrongEpoch = uiReducer(bootstrapped(), {
      type: "journal",
      event: event({ journalEpoch: "9999", seq: "5001", eventId: "9999:5001" }),
    });
    expect(wrongEpoch.sync.inconsistent).toBe(true);
    expect(canTrade(wrongEpoch)).toBe(false);
  });

  it("applies control facts and clears the old session on a new generation", () => {
    const controlled = uiReducer(bootstrapped(), {
      type: "journal",
      event: event({
        kind: "control",
        eventId: "8123:4823",
        seq: "4823",
        control: { readiness: "HALTED", writable: false, reason: "ops" },
      }),
    });
    expect(controlled.connection.readiness).toBe("HALTED");
    expect(canTrade(controlled)).toBe(false);

    const newGeneration = uiReducer(controlled, {
      type: "connection",
      connection: {
        generation: 4,
        phase: "connecting",
        changedAt: "2026-10-19T00:01:00Z",
      },
    });
    expect(newGeneration.snapshot).toBeNull();
    expect(Object.keys(newGeneration.orders)).toHaveLength(0);
  });

  it("ignores an older status event for the same generation", () => {
    const synced = uiReducer(bootstrapped(), {
      type: "connection",
      connection: {
        generation: 3,
        phase: "synced",
        changedAt: "2026-10-19T00:00:10Z",
        readiness: "READY",
        writable: true,
      },
    });
    const lateConnecting = uiReducer(synced, {
      type: "connection",
      connection: {
        generation: 3,
        phase: "connecting",
        changedAt: "2026-10-19T00:00:01Z",
      },
    });
    expect(lateConnecting.connection.phase).toBe("synced");
  });

  it("blocks trading when the policy gate or writable state is closed", () => {
    const blocked = uiReducer(bootstrapped(), {
      type: "update",
      update: {
        ...update,
        policyGate: { ...update.policyGate, canTrade: false, reason: "低于最低版本" },
      },
    });
    expect(tradingBlockReason(blocked)).toContain("最低版本");
  });
});
