import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CancelOrderResult } from "@orderhub/contracts";
import { useApp } from "../app/AppProvider";
import { Icon } from "../components/Icon";
import {
  Badge,
  Callout,
  CopyButton,
  EmptyState,
  KeyValue,
  Metric,
  Modal,
  OrderStatusBadge,
  PageHeader,
  Panel,
  SideBadge,
  Spinner,
} from "../components/ui";
import {
  formatNanos,
  formatTimestamp,
  isTerminalStatus,
  shortId,
} from "../lib/format";

export function OrderDetailPage({
  clientOrderId,
  navigate,
}: {
  clientOrderId: string;
  navigate: (path: string) => void;
}) {
  const { state, cancelOrder, refreshOrder, showToast } = useApp();
  const order = state.orders[clientOrderId];
  const snapshot = state.snapshot;
  const [lookupBusy, setLookupBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelResult, setCancelResult] = useState<CancelOrderResult | null>(null);
  const autoLookup = useRef(false);

  const refresh = useCallback(async () => {
    setLookupBusy(true);
    try {
      const found = await refreshOrder(clientOrderId);
      if (!found) {
        showToast({
          tone: "warn",
          title: "未查到该订单",
          message:
            "OrderLookup 对不存在的订单和无权限订单通常返回相同的 PERMISSION_DENIED，不能据此判断订单是否成交或属于他人。",
        });
      }
    } catch {
      // The provider already surfaced the error.
    } finally {
      setLookupBusy(false);
    }
  }, [clientOrderId, refreshOrder, showToast]);

  useEffect(() => {
    if (order || autoLookup.current) return;
    autoLookup.current = true;
    void refresh();
  }, [order, refresh]);

  const executions = useMemo(
    () => state.executions.filter((execution) => execution.clientOrderId === clientOrderId),
    [clientOrderId, state.executions],
  );
  const orderEvents = useMemo(
    () =>
      state.events
        .filter(
          (event) =>
            (event.outcome?.clientOrderId === clientOrderId ||
              event.execution?.clientOrderId === clientOrderId) &&
            event.kind !== "progress",
        )
        .slice(-12)
        .reverse(),
    [clientOrderId, state.events],
  );

  const terminal = order ? isTerminalStatus(order.status) : false;
  const cancelAllowed =
    Boolean(order) &&
    Boolean(snapshot) &&
    !terminal &&
    !cancelBusy &&
    ["synced", "stale"].includes(state.connection.phase) &&
    state.update?.phase !== "installing";

  const submitCancel = async () => {
    if (!snapshot || !order) return;
    setCancelBusy(true);
    try {
      const result = await cancelOrder({
        expectedGeneration: snapshot.generation,
        expectedEpoch: snapshot.journalEpoch,
        clientOrderId: order.clientOrderId,
      });
      setCancelResult(result);
      setCancelOpen(false);
    } catch {
      setCancelOpen(false);
    } finally {
      setCancelBusy(false);
    }
  };

  if (!order) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="TRADING / ORDER DETAIL"
          title="订单详情"
          description="按已知 client_order_id 查询活动或终态订单。"
          actions={
            <button
              type="button"
              className="button button-ghost"
              onClick={() => navigate("/workspace")}
            >
              <Icon name="arrow-left" size={16} />
              返回工作台
            </button>
          }
        />
        <Panel>
          <EmptyState
            icon="search"
            title={lookupBusy ? "正在查询订单" : "当前本地视图中没有该订单"}
            message={
              <>
                <span className="mono">{clientOrderId}</span>
                <br />
                可执行单次 OrderLookup。该查询可以返回终态订单，但不代表整体同步水位。
              </>
            }
            action={
              <button
                type="button"
                className="button button-primary"
                onClick={() => void refresh()}
                disabled={lookupBusy}
              >
                {lookupBusy ? <Spinner size={15} /> : <Icon name="search" size={16} />}
                查询订单
              </button>
            }
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="TRADING / ORDER DETAIL"
        title={`订单 ${shortId(order.clientOrderId, 28)}`}
        description={
          <span className="inline-status">
            <SideBadge side={order.side} />
            <span className="mono">{order.instrumentId}</span>
            <OrderStatusBadge status={order.status} />
            {terminal ? <Badge tone="muted">终态</Badge> : <Badge tone="info">活动</Badge>}
          </span>
        }
        actions={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => navigate("/workspace")}
            >
              <Icon name="arrow-left" size={16} />
              返回
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => void refresh()}
              disabled={lookupBusy}
            >
              {lookupBusy ? <Spinner size={15} /> : <Icon name="refresh" size={16} />}
              查询最新状态
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => setCancelOpen(true)}
              disabled={!cancelAllowed}
            >
              <Icon name="close" size={16} />
              撤单
            </button>
          </>
        }
      />

      {terminal ? (
        <Callout tone="info" title="该订单当前为终态" icon="info">
          最终状态以服务端 OrderView 为准。撤单意图受理期间仍可能发生成交；终态订单不会因为客户端关闭而改变。
        </Callout>
      ) : null}

      {state.connection.phase === "stale" ? (
        <Callout tone="warn" title="当前状态陈旧" icon="alert">
          新增报单已关闭；撤单是否可用仍由业务服务决定。本页的订单投影可能不是最新。
        </Callout>
      ) : null}

      <div className="metric-grid metric-grid-4">
        <Metric label="委托数量" value={<span className="mono">{order.quantity}</span>} />
        <Metric
          label="已成交"
          value={<span className="mono">{order.filledQuantity}</span>}
          hint={`剩余 ${order.remainingQuantity}`}
          tone="accent"
        />
        <Metric label="限价" value={<span className="mono">{order.price}</span>} />
        <Metric
          label="累计费用"
          value={<span className="mono">{order.fees || "0"}</span>}
          hint="当前币种 USD，按服务端账本"
        />
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <Panel
            title="订单字段"
            subtitle="所有 ID、版本和价格保持服务端原始字符串。"
            actions={<CopyButton value={order.clientOrderId} label="复制订单 ID" />}
          >
            <div className="kv-grid">
              <KeyValue label="client_order_id" mono title={order.clientOrderId}>
                {order.clientOrderId}
              </KeyValue>
              <KeyValue label="账户" mono>
                {order.accountId || "—"}
              </KeyValue>
              <KeyValue label="策略" mono>
                {order.strategyId}
              </KeyValue>
              <KeyValue label="合约" mono>
                {order.instrumentId}
              </KeyValue>
              <KeyValue label="方向" mono>
                {order.side}
              </KeyValue>
              <KeyValue label="状态版本" mono>
                {order.version}
              </KeyValue>
              <KeyValue label="剩余数量" mono>
                {order.remainingQuantity}
              </KeyValue>
              <KeyValue label="预计费用" mono>
                {order.fees || "0"}
              </KeyValue>
            </div>
          </Panel>

          <Panel
            title="本次会话执行事实"
            subtitle="只包含当前进程收到的执行事件，不是历史成交查询结果。"
            actions={<Badge tone="muted">{executions.length} 条</Badge>}
          >
            {executions.length === 0 ? (
              <EmptyState
                compact
                icon="trades"
                title="本次会话尚未收到该订单的执行事实"
                message="这不代表历史没有成交；当前 proto 没有独立的历史成交查询接口。请以订单累计成交和服务端状态为准。"
              />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <caption className="sr-only">本次会话执行事实</caption>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th className="align-right">数量</th>
                      <th className="align-right">价格</th>
                      <th className="align-right">费用</th>
                      <th>执行事实 ID</th>
                      <th>事件时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map((execution) => (
                      <tr key={`${execution.eventId}-${execution.tradeId}`}>
                        <td>
                          <Badge tone={execution.kind === "FILL" ? "accent" : "muted"}>
                            {execution.kind}
                          </Badge>
                        </td>
                        <td className="align-right mono">{execution.quantity}</td>
                        <td className="align-right mono">{execution.price}</td>
                        <td className="align-right mono">{execution.fee || "0"}</td>
                        <td className="mono small">{shortId(execution.tradeId || execution.eventId, 26)}</td>
                        <td className="small">{formatNanos(execution.eventTimeNs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {cancelResult ? (
            <Panel
              title="最近一次撤单请求"
              subtitle={formatTimestamp(cancelResult.record.updatedAt)}
              actions={
                <Badge
                  tone={
                    cancelResult.admission?.result === "CANCEL_INTENT_ACCEPTED"
                      ? "ok"
                      : cancelResult.error
                        ? "warn"
                        : "muted"
                  }
                >
                  {cancelResult.record.status}
                </Badge>
              }
            >
              {cancelResult.admission ? (
                <>
                  <KeyValue label="原始受理结果" mono>
                    {cancelResult.admission.result}
                  </KeyValue>
                  <KeyValue label="reason" mono>
                    {cancelResult.admission.reason || "—"}
                  </KeyValue>
                  <p className="small muted">
                    撤单意图已受理不等于撤单成功。请继续观察订单最终状态；撤单过程中仍可能成交。
                  </p>
                </>
              ) : (
                <div className="error-box">
                  <div className="error-box-title">
                    <Icon name="alert" size={16} />
                    {cancelResult.error?.code ?? "CANCEL_INCOMPLETE"}
                  </div>
                  <div>{cancelResult.error?.message ?? "撤单未得到明确结果。"}</div>
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => navigate("/requests")}
                  >
                    查看请求记录
                  </button>
                </div>
              )}
            </Panel>
          ) : null}
        </div>

        <aside className="detail-aside">
          <Panel title="会话事件" subtitle="按收到顺序展示最近 12 条相关事件。">
            {orderEvents.length === 0 ? (
              <p className="muted small">本次会话暂未收到该订单的生命周期事件。</p>
            ) : (
              <ol className="timeline">
                {orderEvents.map((event) => (
                  <li key={event.eventId || `${event.seq}-${event.kind}`}>
                    <div className="timeline-dot" aria-hidden="true" />
                    <div className="timeline-body">
                      <div className="timeline-top">
                        <Badge tone={event.kind === "execution" ? "accent" : "muted"}>
                          {event.kind}
                        </Badge>
                        <span className="mono small muted">seq {event.seq}</span>
                      </div>
                      <div className="small">
                        {event.outcome
                          ? `${event.outcome.outcome}${event.outcome.reason ? ` · ${event.outcome.reason}` : ""}`
                          : event.execution
                            ? `${event.execution.kind} ${event.execution.quantity} @ ${event.execution.price}`
                            : "—"}
                      </div>
                      <div className="small muted">{formatTimestamp(event.receivedAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="查询边界" className="subtle-panel">
            <ul className="plain-list small muted">
              <li>OrderLookup 只更新本次查询到的订单，不改变整体同步水位。</li>
              <li>未知订单和无权限订单通常返回相同的 PERMISSION_DENIED。</li>
              <li>Snapshot 仅包含活动订单，不能枚举完整历史订单。</li>
              <li>未知写结果请用原 request_id 查询，不要换新 ID 自动补单。</li>
            </ul>
          </Panel>
        </aside>
      </div>

      <Modal
        open={cancelOpen}
        title="确认提交撤单"
        description="撤单使用新的独立 request_id；撤单过程中订单仍可能成交。"
        onClose={() => {
          if (!cancelBusy) setCancelOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setCancelOpen(false)}
              disabled={cancelBusy}
            >
              取消
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => void submitCancel()}
              disabled={cancelBusy || !cancelAllowed}
            >
              {cancelBusy ? <Spinner size={15} /> : <Icon name="close" size={16} />}
              确认撤单
            </button>
          </>
        }
      >
        <div className="confirm-order">
          <div className="confirm-side">
            <SideBadge side={order.side} />
            <span className="mono">{order.instrumentId}</span>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="confirm-numbers">
            <div>
              <span className="small-label">订单 ID</span>
              <strong className="mono">{shortId(order.clientOrderId, 30)}</strong>
            </div>
            <div>
              <span className="small-label">剩余数量</span>
              <strong className="mono">{order.remainingQuantity}</strong>
            </div>
            <div>
              <span className="small-label">当前 epoch</span>
              <strong className="mono">{snapshot?.journalEpoch ?? "—"}</strong>
            </div>
          </div>
          <Callout tone="warn" title="撤单受理不等于撤成" icon="alert">
            只有服务端最终状态变为 CANCELED 才表示撤单成功。撤单进行中仍可能成交；本操作不会自动撤销其他订单。
          </Callout>
        </div>
      </Modal>
    </div>
  );
}
