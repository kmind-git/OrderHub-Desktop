import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AckCheckpointInput,
  CancelOrderInput,
  CancelOrderResult,
  DiagnosticExportResult,
  DownloadUpdateResult,
  InstallUpdateResult,
  IpcError,
  JournalEventDto,
  OrderLookupResult,
  RequestLookupResult,
  SessionEvent,
  SubmitOrderInput,
  SubmitOrderResult,
  UpdateStateDto,
} from "@orderhub/contracts";
import { getBackend, toIpcError, type Backend } from "../lib/bridge";
import {
  activeOrders,
  canTrade,
  initialUiState,
  tradingBlockReason,
  uiReducer,
  type ToastItem,
  type UiState,
} from "../lib/reducer";

interface AppContextValue {
  state: UiState;
  backendKind: Backend["kind"];
  isDemo: boolean;
  loading: boolean;
  fatalError: IpcError | null;
  canTrade: boolean;
  tradingBlockReason: string | null;
  activeOrders: ReturnType<typeof activeOrders>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  reloadConfig: () => Promise<void>;
  retryBootstrap: () => void;
  submitOrder: (input: SubmitOrderInput) => Promise<SubmitOrderResult>;
  cancelOrder: (input: CancelOrderInput) => Promise<CancelOrderResult>;
  lookupOrder: (orderIds: string[]) => Promise<OrderLookupResult>;
  lookupRequest: (requestId: string) => Promise<RequestLookupResult>;
  refreshRequests: () => Promise<void>;
  checkUpdate: (manual: boolean) => Promise<UpdateStateDto | null>;
  downloadUpdate: () => Promise<DownloadUpdateResult>;
  installUpdate: (confirmUnknownRequests: boolean) => Promise<InstallUpdateResult>;
  exportDiagnostics: (confirmed: boolean) => Promise<DiagnosticExportResult>;
  refreshDiagnostics: () => Promise<void>;
  refreshOrder: (clientOrderId: string) => Promise<boolean>;
  showToast: (toast: ToastItem) => void;
  dismissToast: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const backend = useMemo(() => getBackend(), []);
  const [state, dispatch] = useReducer(uiReducer, undefined, initialUiState);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<IpcError | null>(null);
  const [bootstrapNonce, setBootstrapNonce] = useState(0);
  const toastTimer = useRef<number | null>(null);
  const ackTimer = useRef<number | null>(null);
  const pendingAck = useRef<AckCheckpointInput | null>(null);
  const connecting = useRef(false);
  const lastNotifiedPhase = useRef<string>("");
  const generationRef = useRef(0);

  const showToast = useCallback((toast: ToastItem) => {
    dispatch({ type: "toast", toast });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      dispatch({ type: "toast", toast: null });
      toastTimer.current = null;
    }, 7000);
  }, []);

  useEffect(() => {
    generationRef.current = state.connection.generation;
  }, [state.connection.generation]);

  const dismissToast = useCallback(() => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    dispatch({ type: "toast", toast: null });
  }, []);

  const flushAck = useCallback(() => {
    if (ackTimer.current !== null) {
      window.clearTimeout(ackTimer.current);
      ackTimer.current = null;
    }
    const latest = pendingAck.current;
    pendingAck.current = null;
    if (!latest) return;
    void backend.ackCheckpoint(latest).catch(() => {
      // A failed checkpoint ack is safe: the native layer will replay from its
      // last acknowledged point and the reducer deduplicates by event id.
    });
  }, [backend]);

  const scheduleAck = useCallback((event: JournalEventDto) => {
    if (!event.seq) return;
    pendingAck.current = {
      generation: event.generation,
      journalEpoch: event.journalEpoch,
      seq: event.seq,
    };
    if (ackTimer.current === null) {
      ackTimer.current = window.setTimeout(flushAck, 120);
    }
  }, [flushAck]);

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      switch (event.type) {
        case "status": {
          dispatch({ type: "connection", connection: event.state });
          const notifyKey = `${event.state.generation}:${event.state.phase}`;
          if (
            ["error", "reauth_required"].includes(event.state.phase) &&
            lastNotifiedPhase.current !== notifyKey
          ) {
            lastNotifiedPhase.current = notifyKey;
            showToast({
              tone: "danger",
              title: event.state.phase === "reauth_required" ? "需要重新认证" : "业务连接错误",
              message: event.state.detail,
              error: event.state.error,
            });
          }
          if (event.state.phase === "synced") lastNotifiedPhase.current = "";
          break;
        }
        case "snapshot":
          dispatch({ type: "snapshot", snapshot: event.snapshot });
          break;
        case "journal":
          dispatch({ type: "journal", event: event.event });
          scheduleAck(event.event);
          break;
        case "resync":
          dispatch({
            type: "resync",
            generation: event.generation,
            reason: event.reason,
            message: event.message,
          });
          showToast({
            tone: "warn",
            title: "需要重新同步",
            message: event.message,
          });
          break;
        case "checkpoint":
          break;
      }
    },
    [scheduleAck, showToast],
  );

  const connect = useCallback(async () => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      const initial = await backend.connect(handleSessionEvent);
      dispatch({ type: "connection", connection: initial });
    } catch (error) {
      const ipc = toIpcError(error);
      dispatch({
        type: "connection",
        connection: {
          generation: generationRef.current,
          phase: "error",
          changedAt: new Date().toISOString(),
          detail: "无法启动业务连接",
          error: ipc,
        },
      });
      showToast({ tone: "danger", title: "业务连接失败", error: ipc });
    } finally {
      connecting.current = false;
    }
  }, [backend, handleSessionEvent, showToast]);

  const disconnect = useCallback(async () => {
    try {
      const connection = await backend.disconnect();
      dispatch({ type: "connection", connection });
      showToast({ tone: "info", title: "已断开业务连接", message: "旧事件订阅已取消。" });
    } catch (error) {
      showToast({ tone: "danger", title: "断开连接失败", error: toIpcError(error) });
    }
  }, [backend, showToast]);

  const reloadConfig = useCallback(async () => {
    try {
      const config = await backend.reloadConfig();
      dispatch({ type: "config", config });
      dispatch({
        type: "connection",
        connection: {
          generation: state.connection.generation + 1,
          phase: "idle",
          changedAt: new Date().toISOString(),
          detail: "配置已重新读取，请显式重新连接",
        },
      });
      showToast({
        tone: "ok",
        title: "配置已重新读取",
        message: "旧会话已结束；请点击“连接服务”使用新配置重新同步。",
      });
    } catch (error) {
      showToast({ tone: "danger", title: "读取配置失败", error: toIpcError(error) });
    }
  }, [backend, showToast, state.connection.generation]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFatalError(null);
    (async () => {
      try {
        const bootstrap = await backend.getBootstrapState();
        if (cancelled) return;
        dispatch({ type: "bootstrap", bootstrap });
        setLoading(false);
        const confirmed = await backend.confirmStartup().catch(() => false);
        if (confirmed) {
          showToast({
            tone: "ok",
            title: "新版本启动确认已记录",
            message: `当前版本 ${bootstrap.app.version}。`,
          });
        }
        if (bootstrap.config.valid) {
          void connect();
        }
        if (bootstrap.config.update.autoCheck && backend.kind !== "unavailable") {
          window.setTimeout(async () => {
            try {
              const result = await backend.checkUpdate(false);
              if (cancelled) return;
              dispatch({ type: "update", update: result.state });
              if (
                bootstrap.config.update.autoDownload &&
                result.state.phase === "available"
              ) {
                const downloaded = await backend.downloadUpdate((progress) =>
                  dispatch({ type: "downloadProgress", progress }),
                );
                if (!cancelled) dispatch({ type: "update", update: downloaded.state });
              }
            } catch (error) {
              if (!cancelled) {
                showToast({
                  tone: "warn",
                  title: "后台更新检查失败",
                  error: toIpcError(error),
                });
              }
            }
          }, 1400);
        }
      } catch (error) {
        if (cancelled) return;
        const ipc = toIpcError(error);
        setFatalError(ipc);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, bootstrapNonce, connect, showToast]);

  useEffect(() => {
    const updateConfig = state.config?.update;
    if (!updateConfig?.autoCheck || backend.kind === "unavailable") return;
    const baseMs = Math.max(60, updateConfig.checkIntervalSecs) * 1000;
    const jittered = Math.round(baseMs * (0.9 + Math.random() * 0.2));
    const interval = window.setInterval(
      async () => {
        try {
          const result = await backend.checkUpdate(false);
          dispatch({ type: "update", update: result.state });
        } catch {
          // A failed background check must not interrupt a live trading session.
        }
      },
      jittered,
    );
    return () => window.clearInterval(interval);
  }, [backend, state.config?.update.autoCheck, state.config?.update.checkIntervalSecs]);

  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      if (ackTimer.current !== null) window.clearTimeout(ackTimer.current);
    };
  }, []);

  const submitOrder = useCallback(
    async (input: SubmitOrderInput) => {
      try {
        const result = await backend.submitOrder(input);
        dispatch({ type: "requestUpsert", record: result.record });
        if (result.admission) {
          const accepted = ["ADMITTED", "CANCEL_INTENT_ACCEPTED"].includes(
            result.admission.result,
          );
          showToast({
            tone: accepted ? "ok" : "danger",
            title: accepted ? "报单请求已受理" : "报单被业务拒绝",
            message: accepted
              ? `client_order_id: ${result.admission.clientOrderId || "—"}。已受理不等于成交或已刷盘。`
              : result.admission.reason || "服务端返回业务拒绝。",
          });
        } else if (result.error) {
          showToast({
            tone: result.error.category === "transport" ? "warn" : "danger",
            title:
              result.error.category === "transport"
                ? "报单结果未知"
                : "报单未完成",
            message: result.error.message,
            error: result.error,
          });
        }
        return result;
      } catch (error) {
        const ipc = toIpcError(error);
        showToast({ tone: "danger", title: "报单被拒绝", error: ipc });
        throw ipc;
      }
    },
    [backend, showToast],
  );

  const cancelOrder = useCallback(
    async (input: CancelOrderInput) => {
      try {
        const result = await backend.cancelOrder(input);
        dispatch({ type: "requestUpsert", record: result.record });
        if (result.admission) {
          showToast({
            tone: "ok",
            title: "撤单意图已受理",
            message:
              "撤单受理不等于撤成；撤单过程中仍可能成交，最终状态以服务端订单状态为准。",
          });
        } else if (result.error) {
          showToast({
            tone: result.error.category === "transport" ? "warn" : "danger",
            title:
              result.error.category === "transport" ? "撤单结果未知" : "撤单未完成",
            message: result.error.message,
            error: result.error,
          });
        }
        return result;
      } catch (error) {
        const ipc = toIpcError(error);
        showToast({ tone: "danger", title: "撤单被拒绝", error: ipc });
        throw ipc;
      }
    },
    [backend, showToast],
  );

  const lookupOrder = useCallback(
    async (orderIds: string[]) => {
      try {
        const result = await backend.lookupOrder(orderIds);
        dispatch({ type: "lookupOrders", orders: result.orders });
        return result;
      } catch (error) {
        showToast({ tone: "danger", title: "订单查询失败", error: toIpcError(error) });
        throw error;
      }
    },
    [backend, showToast],
  );

  const refreshOrder = useCallback(
    async (clientOrderId: string) => {
      const result = await lookupOrder([clientOrderId]);
      return result.orders.some((order) => order.clientOrderId === clientOrderId);
    },
    [lookupOrder],
  );

  const lookupRequest = useCallback(
    async (requestId: string) => {
      const result = await backend.lookupSessionRequest(requestId);
      dispatch({ type: "requestUpsert", record: result.record });
      if (result.found) {
        showToast({
          tone: "ok",
          title: "已查回原始请求结果",
          message: "该结果是原始受理/拒绝结果，不是订单终态。",
        });
      } else {
        showToast({
          tone: "warn",
          title: "请求结果仍未知",
          message: result.error?.message,
          error: result.error ?? undefined,
        });
      }
      return result;
    },
    [backend, showToast],
  );

  const refreshRequests = useCallback(async () => {
    try {
      const records = await backend.listRequests();
      dispatch({ type: "requests", records });
    } catch (error) {
      showToast({ tone: "danger", title: "读取请求记录失败", error: toIpcError(error) });
    }
  }, [backend, showToast]);

  const checkUpdate = useCallback(
    async (manual: boolean) => {
      try {
        const result = await backend.checkUpdate(manual);
        dispatch({ type: "update", update: result.state });
        if (result.state.error) {
          showToast({
            tone: manual ? "danger" : "warn",
            title: "更新检查失败",
            message: result.state.error.message,
            error: result.state.error,
          });
        } else if (manual) {
          showToast({
            tone: result.state.phase === "available" ? "ok" : "info",
            title:
              result.state.phase === "available"
                ? `发现新版本 ${result.state.metadata?.version ?? ""}`
                : "更新检查完成",
            message: result.state.message ?? undefined,
          });
        }
        return result.state;
      } catch (error) {
        showToast({ tone: "danger", title: "更新检查失败", error: toIpcError(error) });
        return null;
      }
    },
    [backend, showToast],
  );

  const downloadUpdate = useCallback(async () => {
    try {
      const result = await backend.downloadUpdate((progress) =>
        dispatch({ type: "downloadProgress", progress }),
      );
      dispatch({ type: "update", update: result.state });
      showToast({
        tone: result.downloaded ? "ok" : "warn",
        title: result.downloaded ? "更新包已下载并验签" : "更新包未下载",
        message: "安装前还会重新复核发布资格；暂停或撤回的版本会被拒绝。",
      });
      return result;
    } catch (error) {
      const ipc = toIpcError(error);
      showToast({ tone: "danger", title: "更新下载失败", error: ipc });
      throw ipc;
    }
  }, [backend, showToast]);

  const installUpdate = useCallback(
    async (confirmUnknownRequests: boolean) => {
      try {
        const result = await backend.installUpdate(confirmUnknownRequests);
        dispatch({ type: "update", update: result.state });
        showToast({
          tone: "ok",
          title: "安装器已启动",
          message: result.message,
        });
        return result;
      } catch (error) {
        const ipc = toIpcError(error);
        showToast({ tone: "danger", title: "无法安装更新", error: ipc });
        throw ipc;
      }
    },
    [backend, showToast],
  );

  const exportDiagnostics = useCallback(
    async (confirmed: boolean) => {
      const result = await backend.exportDiagnostics(confirmed);
      showToast({
        tone: "ok",
        title: "诊断文件已导出",
        message: result.path,
      });
      return result;
    },
    [backend, showToast],
  );

  const refreshDiagnostics = useCallback(async () => {
    try {
      const diagnostics = await backend.getDiagnostics();
      dispatch({ type: "diagnostics", diagnostics });
    } catch (error) {
      showToast({ tone: "danger", title: "读取诊断信息失败", error: toIpcError(error) });
    }
  }, [backend, showToast]);

  const retryBootstrap = useCallback(() => {
    setBootstrapNonce((value) => value + 1);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      backendKind: backend.kind,
      isDemo: backend.kind === "demo",
      loading,
      fatalError,
      canTrade: canTrade(state),
      tradingBlockReason: tradingBlockReason(state),
      activeOrders: activeOrders(state),
      connect,
      disconnect,
      reloadConfig,
      retryBootstrap,
      submitOrder,
      cancelOrder,
      lookupOrder,
      lookupRequest,
      refreshRequests,
      checkUpdate,
      downloadUpdate,
      installUpdate,
      exportDiagnostics,
      refreshDiagnostics,
      refreshOrder,
      showToast,
      dismissToast,
    }),
    [
      state,
      backend.kind,
      loading,
      fatalError,
      connect,
      disconnect,
      reloadConfig,
      retryBootstrap,
      submitOrder,
      cancelOrder,
      lookupOrder,
      lookupRequest,
      refreshRequests,
      checkUpdate,
      downloadUpdate,
      installUpdate,
      exportDiagnostics,
      refreshDiagnostics,
      refreshOrder,
      showToast,
      dismissToast,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
