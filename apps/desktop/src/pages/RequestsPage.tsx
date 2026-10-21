import { useEffect, useMemo, useState } from "react";
import type { RequestRecordDto, RequestStatus } from "@orderhub/contracts";
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
  PageHeader,
  Panel,
  RequestStatusBadge,
  Spinner,
} from "../components/ui";
import {
  formatTimestamp,
  requestStatusLabels,
  shortId,
} from "../lib/format";

const statusOptions: Array<{ value: "ALL" | RequestStatus; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "unknown", label: "结果未知" },
  { value: "admitted", label: "已受理" },
  { value: "rejected", label: "业务拒绝" },
  { value: "failed", label: "未发送/失败" },
  { value: "prepared", label: "已保存未发送" },
  { value: "sending", label: "等待受理" },
];

function paramEntries(record: RequestRecordDto) {
  return Object.entries(record.params);
}

export function RequestsPage() {
  const { state, lookupRequest, refreshRequests, showToast } = useApp();
  const [statusFilter, setStatusFilter] = useState<"ALL" | RequestStatus>("ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const recovery = state.requestRecovery;

  // Bootstrap deliberately carries only a recent window. The detailed list is
  // loaded when this page is opened, and again when native recovery finishes.
  useEffect(() => {
    if (recovery?.ready) void refreshRequests();
  }, [recovery?.ready, refreshRequests]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {
      all: state.requests.length,
      unknown: 0,
      admitted: 0,
      rejected: 0,
      failed: 0,
    };
    for (const record of state.requests) result[record.status] = (result[record.status] ?? 0) + 1;
    return result;
  }, [state.requests]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.requests.filter((record) => {
      if (statusFilter !== "ALL" && record.status !== statusFilter) return false;
      if (!needle) return true;
      return [record.requestId, record.clientOrderId, record.epoch, record.rpcMethod]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [query, state.requests, statusFilter]);

  const selected = state.requests.find((record) => record.requestId === selectedId) ?? null;

  const queryRequest = async (record: RequestRecordDto) => {
    setBusyId(record.requestId);
    try {
      const result = await lookupRequest(record.requestId);
      if (result.found) setSelectedId(result.record.requestId);
    } catch {
      // Provider already surfaced a toast.
    } finally {
      setBusyId(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshRequests();
      showToast({ tone: "info", title: "请求记录已刷新", message: "记录来自本地加密存储。" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="TRADING / REQUESTS"
        title="请求记录"
        description={
          <>
            区分等待受理、已受理、业务拒绝与结果未知。记录在发送前持久保存；进程重启后仍可查询原请求，
            但 MVP 不会自动重发写请求。
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? <Spinner size={15} /> : <Icon name="refresh" size={16} />}
              刷新记录
            </button>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setStatusFilter("unknown")}
            >
              <Icon name="alert" size={16} />
              查看未知结果
            </button>
          </>
        }
      />

      <Callout tone="warn" title="未知结果的安全边界" icon="shield">
        RequestLookup 只会自动查询结果，不会换新 ID 自动补单。<strong>REQUEST_NOT_FOUND</strong>{" "}
        仅表示查询时尚无可见结果，不能证明请求没有执行。环境、凭证或 epoch 变化后，旧请求会保留为待人工核对。
      </Callout>

      {recovery && recovery.loadErrors.length > 0 ? (
        <Callout tone="danger" title="有本地请求记录无法读取" icon="alert">
          <p>
            这些文件没有被删除，但已作为“结果未知”列入请求列表并计入待核对数量。请保留文件并提供诊断导出，
            不要把它们当作不存在。
          </p>
          <ul>
            {recovery.loadErrors.slice(0, 5).map((error) => (
              <li className="mono small" key={error}>
                {error}
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="metric-grid metric-grid-4">
        <Metric label="全部请求" value={<span className="mono">{counts.all}</span>} />
        <Metric
          label="结果未知"
          value={<span className="mono">{counts.unknown ?? 0}</span>}
          tone="warn"
          hint="需要查询原请求或人工核对"
        />
        <Metric
          label="已受理"
          value={<span className="mono">{counts.admitted ?? 0}</span>}
          tone="ok"
          hint="原始受理结果，不是订单终态"
        />
        <Metric
          label="业务拒绝"
          value={<span className="mono">{counts.rejected ?? 0}</span>}
          tone="danger"
          hint="同键重试仍返回原拒绝"
        />
      </div>

      <Panel
        title="本地请求记录"
        subtitle="按创建时间倒序；内容使用 Windows DPAPI 保护，升级时保留。"
        actions={
          <Badge tone={recovery?.ready ? "muted" : "warn"}>
            {recovery?.ready ? "当前已加载数据" : "正在恢复本地记录"}
          </Badge>
        }
      >
        <div className="table-toolbar">
          <label className="search-field">
            <Icon name="search" size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 request_id、订单 ID 或 epoch"
              aria-label="搜索本地请求记录"
            />
          </label>
          <div className="filter-tabs" role="group" aria-label="按状态筛选请求">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`filter-tab ${statusFilter === option.value ? "filter-tab-active" : ""}`}
                onClick={() => setStatusFilter(option.value)}
                aria-pressed={statusFilter === option.value}
              >
                {option.label}
                {option.value !== "ALL" ? (
                  <span className="filter-count">{counts[option.value] ?? 0}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon="list"
            title={state.requests.length === 0 ? "本地还没有请求记录" : "当前筛选没有匹配记录"}
            message={
              state.requests.length === 0
                ? "报单或撤单提交前会先写入本地加密记录。没有记录不代表服务端没有历史订单。"
                : "记录筛选只作用于本机已保存的数据。"
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">本地请求记录</caption>
              <thead>
                <tr>
                  <th>请求</th>
                  <th>状态</th>
                  <th>方法</th>
                  <th>订单</th>
                  <th>提交 epoch</th>
                  <th>创建时间</th>
                  <th>查询次数</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((record) => (
                  <tr
                    key={record.requestId}
                    className="clickable-row"
                    onClick={() => setSelectedId(record.requestId)}
                  >
                    <td>
                      <div className="mono cell-primary">
                        {shortId(record.requestId, 30)}
                      </div>
                      <div className="cell-secondary mono">
                        {record.credentialRef ? `cred ${record.credentialRef.slice(0, 8)}` : "—"}
                      </div>
                    </td>
                    <td>
                      <RequestStatusBadge status={record.status} />
                    </td>
                    <td className="mono">{record.rpcMethod}</td>
                    <td className="mono small">
                      {record.clientOrderId
                        ? shortId(record.clientOrderId, 24)
                        : record.admission?.clientOrderId
                          ? shortId(record.admission.clientOrderId, 24)
                          : "—"}
                    </td>
                    <td className="mono small">{record.epoch}</td>
                    <td className="small">{formatTimestamp(record.createdAt)}</td>
                    <td className="mono">{record.lookupAttempts}</td>
                    <td className="align-right">
                      <button
                        type="button"
                        className="button button-ghost button-tiny"
                        onClick={(event) => {
                          event.stopPropagation();
                          void queryRequest(record);
                        }}
                        disabled={busyId !== null}
                      >
                        {busyId === record.requestId ? (
                          <Spinner size={13} />
                        ) : (
                          <Icon name="search" size={13} />
                        )}
                        查询原请求
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={Boolean(selected)}
        title="请求详情"
        description={
          selected
            ? `${selected.rpcMethod} · ${requestStatusLabels[selected.status]}`
            : undefined
        }
        onClose={() => setSelectedId(null)}
        wide
        footer={
          selected ? (
            <>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => setSelectedId(null)}
              >
                关闭
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void queryRequest(selected)}
                disabled={busyId !== null}
              >
                {busyId === selected.requestId ? (
                  <Spinner size={15} />
                ) : (
                  <Icon name="search" size={16} />
                )}
                查询原请求结果
              </button>
            </>
          ) : null
        }
      >
        {selected ? (
          <div className="request-detail">
            <div className="request-detail-head">
              <div>
                <div className="small-label">request_id</div>
                <div className="mono request-id">
                  {selected.requestId}
                  <CopyButton value={selected.requestId} compact />
                </div>
              </div>
              <RequestStatusBadge status={selected.status} />
            </div>

            <div className="kv-grid">
              <KeyValue label="RPC 方法" mono>
                {selected.rpcMethod}
              </KeyValue>
              <KeyValue label="提交 epoch" mono>
                {selected.epoch}
              </KeyValue>
              <KeyValue label="环境指纹" mono>
                {selected.environmentId}
              </KeyValue>
              <KeyValue label="凭证引用" mono>
                {selected.credentialRef}
              </KeyValue>
              <KeyValue label="创建时间">{formatTimestamp(selected.createdAt)}</KeyValue>
              <KeyValue label="更新时间">{formatTimestamp(selected.updatedAt)}</KeyValue>
              <KeyValue label="最近查询">{formatTimestamp(selected.lastLookupAt)}</KeyValue>
              <KeyValue label="查询次数" mono>
                {selected.lookupAttempts}
              </KeyValue>
            </div>

            <div className="request-section">
              <div className="small-label">原始请求参数（本地加密记录）</div>
              <div className="param-grid">
                {paramEntries(selected).map(([key, value]) => (
                  <div className="param-row" key={key}>
                    <span className="mono">{key}</span>
                    <strong className="mono">{String(value)}</strong>
                  </div>
                ))}
              </div>
            </div>

            {selected.admission ? (
              <div className="request-section">
                <div className="small-label">原始受理结果（不是订单终态）</div>
                <div className="kv-grid">
                  <KeyValue label="result" mono>
                    {selected.admission.result}
                  </KeyValue>
                  <KeyValue label="reason" mono>
                    {selected.admission.reason || "—"}
                  </KeyValue>
                  <KeyValue label="seq" mono>
                    {selected.admission.seq}
                  </KeyValue>
                  <KeyValue label="client_order_id" mono>
                    {selected.admission.clientOrderId || "—"}
                  </KeyValue>
                  <KeyValue label="already_admitted" mono>
                    {selected.admission.alreadyAdmitted ? "true" : "false"}
                  </KeyValue>
                  <KeyValue label="journal_epoch" mono>
                    {selected.admission.journalEpoch}
                  </KeyValue>
                </div>
              </div>
            ) : null}

            {selected.error ? (
              <div className="error-box">
                <div className="error-box-title">
                  <Icon name="alert" size={16} />
                  {selected.error.code}
                </div>
                <div>{selected.error.message}</div>
                <div className="mono small">
                  {selected.error.category} · correlation {selected.error.correlationId}
                </div>
              </div>
            ) : null}

            <Callout tone="info" title="不会自动重发" icon="shield">
              查询只使用原 environment、RPC 方法、epoch 和 request_id。若当前凭证或环境已变化，原生层会拒绝自动查询；
              旧意图保留为待人工核对。绝不换新 ID 自动补单。
            </Callout>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
