import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AckCheckpointInput,
  BootstrapState,
  CancelOrderInput,
  CancelOrderResult,
  ConfigSummary,
  ConnectionState,
  DiagnosticExportResult,
  DiagnosticsSummary,
  DownloadProgressDto,
  DownloadUpdateResult,
  InstallUpdateResult,
  IpcError,
  OrderLookupResult,
  RequestLookupResult,
  RequestRecordDto,
  SessionEvent,
  SubmitOrderInput,
  SubmitOrderResult,
  UpdateCheckResult,
  UpdateStateDto,
} from "@orderhub/contracts";
import { demoBackend } from "./demo";

export interface Backend {
  readonly kind: "tauri" | "demo" | "unavailable";
  getBootstrapState(): Promise<BootstrapState>;
  getConfigSummary(): Promise<ConfigSummary>;
  reloadConfig(): Promise<ConfigSummary>;
  connect(onEvent: (event: SessionEvent) => void): Promise<ConnectionState>;
  disconnect(): Promise<ConnectionState>;
  ackCheckpoint(input: AckCheckpointInput): Promise<boolean>;
  lookupOrder(orderIds: string[]): Promise<OrderLookupResult>;
  submitOrder(input: SubmitOrderInput): Promise<SubmitOrderResult>;
  cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult>;
  lookupSessionRequest(requestId: string): Promise<RequestLookupResult>;
  listRequests(): Promise<RequestRecordDto[]>;
  checkUpdate(manual: boolean): Promise<UpdateCheckResult>;
  downloadUpdate(onProgress: (progress: DownloadProgressDto) => void): Promise<DownloadUpdateResult>;
  installUpdate(confirmUnknownRequests: boolean): Promise<InstallUpdateResult>;
  getUpdateState(): Promise<UpdateStateDto>;
  confirmStartup(): Promise<boolean>;
  getDiagnostics(): Promise<DiagnosticsSummary>;
  exportDiagnostics(confirmed: boolean): Promise<DiagnosticExportResult>;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function error(code: string, message: string): IpcError {
  return {
    category: "config",
    code,
    message,
    retryable: false,
    correlationId: "browser",
  };
}

const unavailableBackend: Backend = {
  kind: "unavailable",
  async getBootstrapState() {
    throw error(
      "DESKTOP_RUNTIME_REQUIRED",
      "该界面必须在 OrderHub Desktop 桌面客户端中运行；浏览器预览不会读取配置、连接服务或发送订单。",
    );
  },
  async getConfigSummary() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async reloadConfig() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async connect() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async disconnect() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async ackCheckpoint() {
    return false;
  },
  async lookupOrder() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async submitOrder() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async cancelOrder() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async lookupSessionRequest() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async listRequests() {
    return [];
  },
  async checkUpdate() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async downloadUpdate() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async installUpdate() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async getUpdateState() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async confirmStartup() {
    return false;
  },
  async getDiagnostics() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
  async exportDiagnostics() {
    throw error("DESKTOP_RUNTIME_REQUIRED", "桌面运行时不可用");
  },
};

const tauriBackend: Backend = {
  kind: "tauri",
  getBootstrapState: () => invoke<BootstrapState>("get_bootstrap_state"),
  getConfigSummary: () => invoke<ConfigSummary>("get_config_summary"),
  reloadConfig: () => invoke<ConfigSummary>("reload_config"),
  connect(onEvent) {
    const channel = new Channel<SessionEvent>();
    channel.onmessage = onEvent;
    return invoke<ConnectionState>("connect", { events: channel });
  },
  disconnect: () => invoke<ConnectionState>("disconnect"),
  ackCheckpoint: (input) => invoke<boolean>("ack_checkpoint", { input }),
  lookupOrder: (orderIds) => invoke<OrderLookupResult>("lookup_order", { orderIds }),
  submitOrder: (input) => invoke<SubmitOrderResult>("submit_order", { input }),
  cancelOrder: (input) => invoke<CancelOrderResult>("cancel_order", { input }),
  lookupSessionRequest: (requestId) =>
    invoke<RequestLookupResult>("lookup_session_request", { requestId }),
  async listRequests() {
    const result = await invoke<{ records: RequestRecordDto[] }>("list_requests");
    return result.records;
  },
  checkUpdate: (manual) => invoke<UpdateCheckResult>("check_update", { input: { manual } }),
  downloadUpdate(onProgress) {
    const channel = new Channel<DownloadProgressDto>();
    channel.onmessage = onProgress;
    return invoke<DownloadUpdateResult>("download_update", { progress: channel });
  },
  installUpdate: (confirmUnknownRequests) =>
    invoke<InstallUpdateResult>("install_update", {
      input: { confirmUnknownRequests },
    }),
  getUpdateState: () => invoke<UpdateStateDto>("get_update_state"),
  confirmStartup: () => invoke<boolean>("confirm_startup"),
  getDiagnostics: () => invoke<DiagnosticsSummary>("get_diagnostics"),
  exportDiagnostics: (confirmed) =>
    invoke<DiagnosticExportResult>("export_diagnostics", { input: { confirmed } }),
};

export function getBackend(): Backend {
  if (isTauriRuntime()) return tauriBackend;
  if (import.meta.env.DEV || import.meta.env.VITE_ORDERHUB_DEMO === "1") {
    return demoBackend;
  }
  return unavailableBackend;
}

export function isIpcError(value: unknown): value is IpcError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    "category" in value
  );
}

export function toIpcError(value: unknown): IpcError {
  if (isIpcError(value)) return value;
  return {
    category: "internal",
    code: "UNEXPECTED_UI_ERROR",
    message: value instanceof Error ? value.message : String(value),
    retryable: false,
    correlationId: "ui",
  };
}
