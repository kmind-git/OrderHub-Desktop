import { useMemo, useState } from "react";
import { useApp } from "../app/AppProvider";
import { Icon } from "../components/Icon";
import {
  Badge,
  Callout,
  EmptyState,
  Metric,
  OrderStatusBadge,
  PageHeader,
  Panel,
  SideBadge,
} from "../components/ui";
import {
  formatTimestamp,
  isTerminalStatus,
  shortId,
} from "../lib/format";

const eventLabels: Record<string, string> = {
  admission: "请求受理元数据",
  outcome: "生命周期结果",
  execution: "执行事实",
  input: "持久输入",
  control: "运行控制",
  unknown: "未知事件",
};

export function WorkspacePage({ navigate }: { navigate: (path: string) => void }) {
  const {
    state,
    activeOrders,
    canTrade,
    tradingBlockReason,
    connect,
  } = useApp();
  const snapshot = state.snapshot;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sideFilter, setSideFilter] = useState("ALL");

  const statuses = useMemo(
    () => [...new Set(Object.values(state.orders).map((order) => order.status))].sort(),
    [state.orders],
  );
  const filteredOrders = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activeOrders.filter((order) => {
      if (statusFilter !== "ALL" && order.status !== statusFilter) return false;
      if (sideFilter !== "ALL" && order.side !== sideFilter) return false;
      if (!needle) return true;
      return [
        order.clientOrderId,
        order.strategyId,
        order.instrumentId,
        order.status,
        order.accountId,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [activeOrders, query, sideFilter, statusFilter]);

  const recentEvents = useMemo(
    () =>
      state.events
        .filter((event) => event.kind !== "progress")
        .slice(-8)
        .reverse(),
    [state.events],
  );
  const driftWarning =
    state.snapshot &&
    (state.sync.inconsistent ||
      state.sync.unknownEvents > 0 ||
      ["reconnecting", "error", "reauth_required", "stale"].includes(state.connection.phase));

  return (
    <div className="page">
      <PageHeader
        eyebrow="TRADING / WORKSPACE"
        title="业务工作台"
        description={
          <>
            只展示当前身份可见的授权策略投影。活动订单来自 Snapshot 与本次会话事件；历史订单与全账户资产另有边界，
            本页不会把它们标成全局数据。
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => navigate("/requests")}
            >
              <Icon name="list" size={16} />
              请求记录
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => navigate("/order")}
              disabled={!canTrade}
              title={tradingBlockReason ?? undefined}
            >
              <Icon name="ticket" size={16} />
              新建报单
            </button>
          </>
        }
      />

      {!snapshot ? (
        <Panel>
          <EmptyState
            icon="workspace"
            title="尚无完整业务快照"
            message={
              state.connection.phase === "idle"
                ? "连接业务服务后，客户端先获取完整 Snapshot，再启动 WatchEvents。没有快照时不会展示任何订单或持仓。"
                : state.connection.detail ??
                  "正在连接或同步；完成后工作台会自动建立基线。"
            }
            action={
              <button
                type="button"
                className="button button-primary"
                onClick={() => void connect()}
              >
                <Icon name="plug" size={16} />
                连接服务
              </button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="metric-grid metric-grid-4">
            <Metric
              label="服务 readiness"
              value={snapshot.readiness}
              hint={snapshot.committedHealth?.reason || "来自当前 Snapshot / Control 事件"}
              tone={snapshot.readiness === "READY" ? "ok" : "warn"}
            />
            <Metric
              label="写入许可"
              value={snapshot.writable ? "WRITABLE" : "CLOSED"}
              hint={
                canTrade
                  ? "当前满足客户端前置条件；服务端仍会逐单校验"
                  : tradingBlockReason ?? "新增报单受限"
              }
              tone={snapshot.writable ? "ok" : "danger"}
            />
            <Metric
              label="状态水位 state_cursor"
              value={<span className="mono">{state.sync.stateCursor ?? snapshot.stateCursor}</span>}
              hint={`epoch ${snapshot.journalEpoch}`}
              tone="accent"
            />
            <Metric
              label="持久化 durable_cursor"
              value={<span className="mono">{snapshot.durableCursor || "—"}</span>}
              hint={
                snapshot.persistenceMode === "async"
                  ? "async：受理可能早于刷盘"
                  : "sync：提交等待持久化"
              }
            />
          </div>

          {driftWarning ? (
            <Callout
              tone={state.sync.unknownEvents > 0 ? "danger" : "warn"}
              title={
                state.sync.unknownEvents > 0
                  ? "收到未知事件，已关闭新增报单"
                  : state.connection.phase === "stale"
                    ? "服务返回状态陈旧"
                    : "连接或同步状态需要注意"
              }
              icon="alert"
            >
              <div className="recovery-inline">
                <img
                  src="/assets/orderhub/connection-recovery-v2.png"
                  alt=""
                  width={1254}
                  height={1254}
                  className="recovery-inline-image"
                />
                <div>
                  <p>
                    {state.connection.detail ??
                      "事件流正在恢复；未确认的事件不会静默忽略。"}
                  </p>
                  <div className="small muted">
                    未知事件 {state.sync.unknownEvents} · 重同步 {state.sync.resyncs} · 当前
                    phase {state.connection.phase}
                  </div>
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => void connect()}
                  >
                    <Icon name="refresh" size={14} />
                    重新同步
                  </button>
                </div>
              </div>
            </Callout>
          ) : null}

          <div className="workspace-grid">
            <div className="workspace-main">
              <Panel
                title="活动订单"
                subtitle="仅活动订单；终态订单需要按订单 ID 查询或用当前会话事件核对。"
                actions={
                  <div className="filter-inline">
                    <Badge tone="muted">当前已加载数据</Badge>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setQuery("");
                        setStatusFilter("ALL");
                        setSideFilter("ALL");
                      }}
                    >
                      清除筛选
                    </button>
                  </div>
                }
              >
                <div className="table-toolbar">
                  <label className="search-field">
                    <Icon name="search" size={15} />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="筛选当前已加载的订单、合约或策略"
                      aria-label="筛选当前已加载的活动订单"
                    />
                  </label>
                  <label className="select-field">
                    <span>状态</span>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="ALL">全部</option>
                      {statuses
                        .filter((status) => !isTerminalStatus(status))
                        .map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="select-field">
                    <span>方向</span>
                    <select
                      value={sideFilter}
                      onChange={(event) => setSideFilter(event.target.value)}
                    >
                      <option value="ALL">全部</option>
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </label>
                </div>

                {filteredOrders.length === 0 ? (
                  <EmptyState
                    icon="list"
                    compact
                    title={
                      activeOrders.length === 0
                        ? "当前授权范围没有活动订单"
                        : "当前筛选条件下没有匹配订单"
                    }
                    message={
                      activeOrders.length === 0
                        ? "这不代表历史订单为空；Snapshot 只返回活动订单。"
                        : "筛选仅作用于当前已加载数据，不是服务端历史检索。"
                    }
                  />
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <caption className="sr-only">当前活动订单</caption>
                      <thead>
                        <tr>
                          <th>订单</th>
                          <th>合约 / 策略</th>
                          <th>方向</th>
                          <th className="align-right">数量</th>
                          <th className="align-right">价格</th>
                          <th className="align-right">已成交 / 剩余</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.map((order) => (
                          <tr
                            key={order.clientOrderId}
                            className="clickable-row"
                            onClick={() =>
                              navigate(`/orders/${encodeURIComponent(order.clientOrderId)}`)
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className="table-link mono cell-primary"
                                title={order.clientOrderId}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(
                                    `/orders/${encodeURIComponent(order.clientOrderId)}`,
                                  );
                                }}
                              >
                                {shortId(order.clientOrderId, 22)}
                              </button>
                              <div className="cell-secondary mono">
                                {order.accountId || "—"} · v{order.version}
                              </div>
                            </td>
                            <td>
                              <div>{order.instrumentId}</div>
                              <div className="cell-secondary mono">{order.strategyId}</div>
                            </td>
                            <td>
                              <SideBadge side={order.side} />
                            </td>
                            <td className="align-right mono">{order.quantity}</td>
                            <td className="align-right mono">{order.price}</td>
                            <td className="align-right mono">
                              {order.filledQuantity} / {order.remainingQuantity}
                            </td>
                            <td>
                              <OrderStatusBadge status={order.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              <Panel
                title="策略持仓"
                subtitle="PositionView 是授权策略的内部账本投影，不等于外部确认持仓或可卖数量。"
              >
                {snapshot.positions.length === 0 ? (
                  <EmptyState
                    compact
                    icon="wallet"
                    title="当前授权策略视图没有持仓"
                    message="这只是当前身份可见的投影，不代表全账户没有资产。"
                  />
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <caption className="sr-only">授权策略持仓</caption>
                      <thead>
                        <tr>
                          <th>策略</th>
                          <th>合约</th>
                          <th className="align-right">数量</th>
                          <th className="align-right">预占卖出</th>
                          <th className="align-right">成本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.positions.map((position) => (
                          <tr key={`${position.strategyId}-${position.instrumentId}`}>
                            <td className="mono">{position.strategyId}</td>
                            <td>{position.instrumentId}</td>
                            <td className="align-right mono">{position.quantity}</td>
                            <td className="align-right mono">{position.reservedQuantity}</td>
                            <td className="align-right mono">{position.cost}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            <aside className="workspace-aside">
              <Panel
                title="授权策略资金占用"
                subtitle="AccountView 是策略账本的已用现金和占用，不是全账户余额。"
              >
                {snapshot.accounts.length === 0 ? (
                  <EmptyState
                    compact
                    icon="wallet"
                    title="当前身份没有可见的策略账本"
                  />
                ) : (
                  <div className="stack">
                    {snapshot.accounts.map((account) => (
                      <div
                        className="account-card"
                        key={`${account.accountId}-${account.strategyId}`}
                      >
                        <div className="account-card-top">
                          <span className="mono">{account.strategyId}</span>
                          <Badge tone="muted">{account.accountId}</Badge>
                        </div>
                        <div className="account-values">
                          <div>
                            <span className="small-label">预占资金</span>
                            <strong className="mono">{account.reservedCash}</strong>
                          </div>
                          <div>
                            <span className="small-label">累计已用</span>
                            <strong className="mono">{account.spentCash}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-button align-left"
                      onClick={() => navigate("/accounts")}
                    >
                      查看全账户查询边界 <Icon name="arrow-right" size={13} />
                    </button>
                  </div>
                )}
              </Panel>

              <Panel title="运行视图" subtitle="状态与本次会话的消费情况。">
                <div className="mini-kv">
                  <div>
                    <span>持久化模式</span>
                    <strong className="mono">{snapshot.persistenceMode}</strong>
                  </div>
                  <div>
                    <span>合约信息</span>
                    <strong className="mono">{snapshot.instruments.length}</strong>
                  </div>
                  <div>
                    <span>输入事实</span>
                    <strong className="mono">{snapshot.inputs.length}</strong>
                  </div>
                  <div>
                    <span>会话事件</span>
                    <strong className="mono">{state.sync.appliedEvents}</strong>
                  </div>
                  <div>
                    <span>重同步</span>
                    <strong className="mono">{state.sync.resyncs}</strong>
                  </div>
                  <div>
                    <span>未知事件</span>
                    <strong className="mono">{state.sync.unknownEvents}</strong>
                  </div>
                </div>
                <div className="divider" />
                <div className="small-label">最近事件</div>
                {recentEvents.length === 0 ? (
                  <p className="muted small">本次会话尚未收到业务事件。</p>
                ) : (
                  <ul className="event-list">
                    {recentEvents.map((event) => (
                      <li key={event.eventId || `${event.seq}-${event.kind}`}>
                        <div className="event-top">
                          <Badge
                            tone={
                              event.kind === "execution"
                                ? "accent"
                                : event.kind === "control"
                                  ? "info"
                                  : event.kind === "unknown"
                                    ? "danger"
                                    : "muted"
                            }
                          >
                            {eventLabels[event.kind] ?? event.kind}
                          </Badge>
                          <span className="mono small muted">seq {event.seq}</span>
                        </div>
                        <div className="event-detail">
                          {event.execution
                            ? `${event.execution.kind} ${event.execution.quantity} @ ${event.execution.price}`
                            : event.outcome
                              ? `${event.outcome.outcome}${event.outcome.reason ? ` · ${event.outcome.reason}` : ""}`
                              : event.control
                                ? `${event.control.readiness} / writable=${event.control.writable}`
                                : event.input
                                  ? "输入事实已更新"
                                  : "—"}
                        </div>
                        {event.view?.order ? (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              navigate(
                                `/orders/${encodeURIComponent(event.view!.order!.clientOrderId)}`,
                              )
                            }
                          >
                            {shortId(event.view.order.clientOrderId, 24)}
                          </button>
                        ) : null}
                        <div className="event-time">{formatTimestamp(event.receivedAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="本次会话边界" className="subtle-panel">
                <ul className="plain-list small muted">
                  <li>活动订单只包含 Snapshot 返回的当前活动集合。</li>
                  <li>历史成交与完整历史订单没有查询接口，不在此页伪造。</li>
                  <li>单次 OrderLookup 不代表整体同步水位。</li>
                  <li>“已受理”不表示交易所接受、成交或刷盘。</li>
                </ul>
              </Panel>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
