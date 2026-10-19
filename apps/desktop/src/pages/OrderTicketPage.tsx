import { useEffect, useMemo, useRef, useState } from "react";
import type { Side, SubmitOrderResult } from "@orderhub/contracts";
import { useApp } from "../app/AppProvider";
import { Icon } from "../components/Icon";
import {
  Badge,
  Callout,
  EmptyState,
  KeyValue,
  Modal,
  PageHeader,
  Panel,
  SideBadge,
  Spinner,
} from "../components/ui";
import { notional, validateOrderInput } from "../lib/decimal";
import { formatTimestamp, shortId } from "../lib/format";

interface FormState {
  strategyId: string;
  instrumentId: string;
  side: Side;
  quantity: string;
  price: string;
}

export function OrderTicketPage({ navigate }: { navigate: (path: string) => void }) {
  const {
    state,
    canTrade,
    tradingBlockReason,
    submitOrder,
    connect,
    isDemo,
  } = useApp();
  const snapshot = state.snapshot;
  const defaults = state.config?.orderDefaults;
  const strategies = useMemo(() => {
    const values = new Set<string>();
    for (const account of state.accounts) values.add(account.strategyId);
    for (const position of state.positions) values.add(position.strategyId);
    return [...values].filter(Boolean);
  }, [state.accounts, state.positions]);
  const instruments = snapshot?.instruments ?? [];
  const [form, setForm] = useState<FormState>({
    strategyId: defaults?.strategyId ?? "",
    instrumentId: defaults?.instrumentId ?? "",
    side: (defaults?.side as Side) ?? "BUY",
    quantity: defaults?.quantity ?? "",
    price: defaults?.price ?? "",
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitOrderResult | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !snapshot) return;
    initialized.current = true;
    setForm((current) => {
      const strategyId =
        current.strategyId && strategies.includes(current.strategyId)
          ? current.strategyId
          : (strategies[0] ?? "");
      const instrumentId =
        current.instrumentId &&
        instruments.some((instrument) => instrument.instrumentId === current.instrumentId)
          ? current.instrumentId
          : (instruments[0]?.instrumentId ?? "");
      return { ...current, strategyId, instrumentId };
    });
  }, [instruments, snapshot, strategies]);

  const instrument = instruments.find(
    (item) => item.instrumentId === form.instrumentId,
  );
  const errors = instrument
    ? validateOrderInput({
        quantity: form.quantity,
        price: form.price,
        priceIncrement: instrument.priceIncrement,
        sizeIncrement: instrument.sizeIncrement,
        pricePrecision: instrument.pricePrecision,
      })
    : ["当前没有可用合约信息"];
  if (!form.strategyId) errors.unshift("请选择授权策略");
  if (!form.instrumentId) errors.unshift("请选择合约");
  const estimatedNotional = notional(form.quantity, form.price);
  const ready = canTrade && errors.length === 0 && Boolean(snapshot) && Boolean(instrument);

  const submit = async () => {
    if (!snapshot || !ready) return;
    setSubmitting(true);
    try {
      const response = await submitOrder({
        expectedGeneration: snapshot.generation,
        expectedEpoch: snapshot.journalEpoch,
        strategyId: form.strategyId,
        instrumentId: form.instrumentId,
        side: form.side,
        quantity: form.quantity,
        price: form.price,
        timeInForce: "DAY",
        postOnly: false,
        reduceOnly: false,
      });
      setResult(response);
      setConfirmOpen(false);
    } catch {
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!snapshot) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="TRADING / TICKET"
          title="报单面板"
          description="只有完整快照建立、状态不陈旧且服务允许写入时才开放新报单。"
        />
        <Panel>
          <EmptyState
            icon="ticket"
            title="尚无完整快照"
            message="没有 Snapshot 时无法获得合约步进、授权策略和当前 epoch，因此不会开放报单表单。"
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
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="TRADING / NEW ORDER"
        title="报单面板"
        description={
          <>
            当前 MVP 只暴露 Snapshot 支持的合约、限价、整股、DAY 与授权策略。提交前会精确校验合约步进，
            服务端仍会执行权限、资金和持仓检查。
          </>
        }
        actions={
          <Badge tone={canTrade ? "ok" : "warn"} dot>
            {canTrade ? "新增报单门禁开放" : "新增报单受限"}
          </Badge>
        }
      />

      {!canTrade ? (
        <Callout tone="warn" title="当前不能新增报单" icon="lock">
          {tradingBlockReason ?? "客户端前置条件未满足。"}
          {state.connection.phase !== "synced" ? (
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => void connect()}
            >
              重新连接
            </button>
          ) : null}
        </Callout>
      ) : null}

      {isDemo ? (
        <Callout tone="warn" title="演示模式不会发送写请求" icon="info">
          表单校验与确认流程可预览，但点击“确认提交”只会得到本地只读错误，不会产生真实订单。
        </Callout>
      ) : null}

      <div className="ticket-grid">
        <Panel
          title="新报单"
          subtitle={`epoch ${snapshot.journalEpoch} · 会话世代 #${snapshot.generation}`}
          actions={
            <span className="inline-status">
              <Badge tone="muted">LIMIT</Badge>
              <Badge tone="muted">DAY</Badge>
              <Badge tone="muted">整股</Badge>
            </span>
          }
        >
          <form
            className="order-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) setConfirmOpen(true);
            }}
          >
            <div className="field-grid">
              <label className="field">
                <span className="field-label">授权策略</span>
                <select
                  value={form.strategyId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, strategyId: event.target.value }))
                  }
                  required
                >
                  <option value="" disabled>
                    选择策略
                  </option>
                  {strategies.map((strategy) => (
                    <option value={strategy} key={strategy}>
                      {strategy}
                    </option>
                  ))}
                </select>
                <span className="field-hint">只列出当前 Snapshot 授权视图中的策略。</span>
              </label>

              <label className="field">
                <span className="field-label">合约</span>
                <select
                  value={form.instrumentId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, instrumentId: event.target.value }))
                  }
                  required
                >
                  <option value="" disabled>
                    选择合约
                  </option>
                  {instruments.map((item) => (
                    <option value={item.instrumentId} key={item.instrumentId}>
                      {item.instrumentId}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  价格步进 {instrument?.priceIncrement ?? "—"} · 数量步进{" "}
                  {instrument?.sizeIncrement ?? "—"} · 精度 {instrument?.pricePrecision ?? "—"}
                </span>
              </label>
            </div>

            <div className="field">
              <span className="field-label">方向</span>
              <div className="segmented" role="group" aria-label="买卖方向">
                <button
                  type="button"
                  className={`segment ${form.side === "BUY" ? "segment-buy-active" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, side: "BUY" }))}
                  aria-pressed={form.side === "BUY"}
                >
                  <Icon name="arrow-right" size={15} className="rotate-buy" />
                  买入 BUY
                </button>
                <button
                  type="button"
                  className={`segment ${form.side === "SELL" ? "segment-sell-active" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, side: "SELL" }))}
                  aria-pressed={form.side === "SELL"}
                >
                  <Icon name="arrow-right" size={15} className="rotate-sell" />
                  卖出 SELL
                </button>
              </div>
            </div>

            <div className="field-grid">
              <label className="field">
                <span className="field-label">数量（股）</span>
                <input
                  className="mono numeric-input"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.quantity}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, quantity: event.target.value }))
                  }
                  placeholder="例如 100"
                  required
                  aria-describedby="quantity-hint"
                />
                <span className="field-hint" id="quantity-hint">
                  正整数，当前上限 10000 股；服务端仍会校验资金和可卖数量。
                </span>
              </label>
              <label className="field">
                <span className="field-label">限价</span>
                <input
                  className="mono numeric-input"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.price}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, price: event.target.value }))
                  }
                  placeholder={instrument ? `步进 ${instrument.priceIncrement}` : "例如 153.22"}
                  required
                  aria-describedby="price-hint"
                />
                <span className="field-hint" id="price-hint">
                  精确十进制字符串，不使用浮点数计算；按合约步进校验。
                </span>
              </label>
            </div>

            <div className="field-grid">
              <div className="field">
                <span className="field-label">有效期</span>
                <div className="readonly-field mono">DAY</div>
                <span className="field-hint">
                  业务文档要求当前使用 DAY；proto 注释中的 GTC/IOC/FOK 会被当前服务拒绝，不能据此生成下拉框。
                </span>
              </div>
              <div className="field">
                <span className="field-label">高级选项</span>
                <div className="option-stack">
                  <label className="disabled-check">
                    <input type="checkbox" checked={false} disabled readOnly />
                    <span>post_only（当前固定 false）</span>
                  </label>
                  <label className="disabled-check">
                    <input type="checkbox" checked={false} disabled readOnly />
                    <span>reduce_only（当前固定 false）</span>
                  </label>
                </div>
              </div>
            </div>

            {errors.length > 0 && (form.quantity || form.price || !form.strategyId) ? (
              <div className="validation-list" role="alert">
                {errors.map((error) => (
                  <div key={error}>
                    <Icon name="alert" size={14} />
                    {error}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="form-footer">
              <div className="form-summary">
                <div>
                  <span className="small-label">客户端名义金额</span>
                  <strong className="mono">{estimatedNotional ?? "—"} USD</strong>
                </div>
                <div>
                  <span className="small-label">提交 epoch</span>
                  <strong className="mono">{snapshot.journalEpoch}</strong>
                </div>
              </div>
              <button
                type="submit"
                className="button button-primary button-large"
                disabled={!ready}
                title={!canTrade ? (tradingBlockReason ?? undefined) : undefined}
              >
                <Icon name="ticket" size={17} />
                检查并确认报单
              </button>
            </div>
          </form>
        </Panel>

        <aside className="ticket-aside">
          <Panel title="提交前确认" subtitle="界面校验不能替代服务端校验。">
            <div className="order-preview">
              <div className="preview-side">
                <SideBadge side={form.side} />
                <span className="preview-instrument">{form.instrumentId || "未选择合约"}</span>
              </div>
              <div className="preview-price mono">
                {form.price || "—"} <span className="muted">×</span> {form.quantity || "—"}
              </div>
              <div className="preview-strategy mono">{form.strategyId || "未选择策略"}</div>
            </div>
            <div className="mini-kv">
              <div>
                <span>订单类型</span>
                <strong>LIMIT</strong>
              </div>
              <div>
                <span>有效期</span>
                <strong>DAY</strong>
              </div>
              <div>
                <span>合约步进</span>
                <strong className="mono">{instrument?.priceIncrement ?? "—"}</strong>
              </div>
              <div>
                <span>价格精度</span>
                <strong className="mono">{instrument?.pricePrecision ?? "—"}</strong>
              </div>
            </div>
            <div className="divider" />
            <ul className="plain-list small muted">
              <li>ADMITTED 只表示 OrderHub 已接纳，不代表交易所接受、成交或已刷盘。</li>
              <li>结果未知时请到“请求记录”查询原 request_id，不要换新 ID 自动补单。</li>
              <li>卖出受已确认持仓与策略归属约束；PositionView 数量不等于可卖数量。</li>
            </ul>
          </Panel>

          {result ? (
            <Panel
              title="最近一次提交"
              subtitle={formatTimestamp(result.record.updatedAt)}
              actions={
                <Badge
                  tone={
                    result.admission
                      ? ["ADMITTED", "CANCEL_INTENT_ACCEPTED"].includes(result.admission.result)
                        ? "ok"
                        : "danger"
                      : "warn"
                  }
                >
                  {result.record.status}
                </Badge>
              }
            >
              {result.admission ? (
                <>
                  <KeyValue label="原始结果" mono>
                    {result.admission.result}
                    {result.admission.alreadyAdmitted ? " · already_admitted" : ""}
                  </KeyValue>
                  <KeyValue label="受理序号" mono>
                    {result.admission.seq}
                  </KeyValue>
                  <KeyValue label="client_order_id" mono>
                    {result.admission.clientOrderId || "—"}
                  </KeyValue>
                  {result.admission.reason ? (
                    <KeyValue label="reason" mono>
                      {result.admission.reason}
                    </KeyValue>
                  ) : null}
                  <div className="button-row">
                    {result.admission.clientOrderId ? (
                      <button
                        type="button"
                        className="button button-ghost button-small"
                        onClick={() =>
                          navigate(
                            `/orders/${encodeURIComponent(result.admission!.clientOrderId)}`,
                          )
                        }
                      >
                        查看订单
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button button-ghost button-small"
                      onClick={() => navigate("/requests")}
                    >
                      打开请求记录
                    </button>
                  </div>
                </>
              ) : (
                <div className="error-box">
                  <div className="error-box-title">
                    <Icon name="alert" size={16} />
                    {result.error?.code ?? "SUBMIT_INCOMPLETE"}
                  </div>
                  <div>{result.error?.message ?? "请求未得到明确结果。"}</div>
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => navigate("/requests")}
                  >
                    查询请求记录
                  </button>
                </div>
              )}
              <div className="small muted mono">
                request_id {shortId(result.record.requestId, 32)}
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>

      <Modal
        open={confirmOpen}
        title="确认提交报单"
        description="提交后会先持久保存请求参数与 request_id，再调用服务端。"
        onClose={() => {
          if (!submitting) setConfirmOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void submit()}
              disabled={submitting || !ready}
            >
              {submitting ? <Spinner size={15} /> : <Icon name="check" size={16} />}
              确认提交
            </button>
          </>
        }
      >
        <div className="confirm-order">
          <div className="confirm-side">
            <SideBadge side={form.side} />
            <span className="mono">{form.instrumentId}</span>
            <Badge tone="muted">{form.strategyId}</Badge>
          </div>
          <div className="confirm-numbers">
            <div>
              <span className="small-label">数量</span>
              <strong className="mono">{form.quantity}</strong>
            </div>
            <div>
              <span className="small-label">限价</span>
              <strong className="mono">{form.price}</strong>
            </div>
            <div>
              <span className="small-label">名义金额</span>
              <strong className="mono">{estimatedNotional ?? "—"} USD</strong>
            </div>
          </div>
          <Callout tone="warn" title="请核对精确值" icon="alert">
            ADMITTED 仅表示服务端接纳请求，不代表订单已被交易所接受、成交或已经刷盘。订单最终状态以
            OrderView / 执行事实为准。
          </Callout>
        </div>
      </Modal>
    </div>
  );
}
