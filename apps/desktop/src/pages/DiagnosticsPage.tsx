import { useEffect, useState } from "react";
import type { DiagnosticExportResult } from "@orderhub/contracts";
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
  Spinner,
} from "../components/ui";
import { formatBytes, formatTimestamp } from "../lib/format";

export function DiagnosticsPage() {
  const {
    state,
    refreshDiagnostics,
    exportDiagnostics,
    isDemo,
  } = useApp();
  const diagnostics = state.diagnostics;
  const [refreshing, setRefreshing] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<DiagnosticExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    void refreshDiagnostics();
  }, [refreshDiagnostics, state.connection.phase, state.sync.journalEpoch]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshDiagnostics();
    } finally {
      setRefreshing(false);
    }
  };

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const result = await exportDiagnostics(confirmed);
      setExported(result);
      setExportOpen(false);
      setConfirmed(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="SYSTEM / DIAGNOSTICS"
        title="诊断与脱敏信息"
        description={
          <>
            汇总连接阶段、同步水位、错误码和本地记录数量。导出前会再次脱敏；Token、Authorization、
            page/resume token 与完整请求参数不会写入诊断文件。
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
              刷新
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setExported(null);
                setExportOpen(true);
              }}
            >
              <Icon name="download" size={16} />
              导出诊断文件
            </button>
          </>
        }
      />

      {isDemo ? (
        <Callout tone="warn" title="演示模式" icon="info">
          诊断数据来自 fixture；导出会在本地返回只读错误，不会写入文件。
        </Callout>
      ) : null}

      {!diagnostics ? (
        <Panel>
          <EmptyState
            icon="shield"
            title="诊断摘要尚未加载"
            message="点击刷新从原生层读取脱敏后的运行摘要。"
            action={
              <button type="button" className="button button-primary" onClick={() => void refresh()}>
                刷新诊断
              </button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="metric-grid metric-grid-4">
            <Metric
              label="连接阶段"
              value={diagnostics.connection.phase}
              hint={diagnostics.connection.detail}
              tone={
                diagnostics.connection.phase === "synced"
                  ? "ok"
                  : diagnostics.connection.phase === "idle"
                    ? "default"
                    : "warn"
              }
            />
            <Metric
              label="活动订单"
              value={<span className="mono">{diagnostics.sync.activeOrders}</span>}
              hint={`epoch ${diagnostics.sync.journalEpoch ?? "—"}`}
            />
            <Metric
              label="未知事件 / 重同步"
              value={
                <span className="mono">
                  {diagnostics.sync.unknownEventCount} / {diagnostics.sync.resyncCount}
                </span>
              }
              tone={diagnostics.sync.unknownEventCount > 0 ? "danger" : "default"}
            />
            <Metric
              label="请求记录"
              value={<span className="mono">{diagnostics.runtime.requestRecordCount}</span>}
              hint={`待核对 ${diagnostics.runtime.unknownRequestCount}`}
              tone={diagnostics.runtime.unknownRequestCount > 0 ? "warn" : "default"}
            />
          </div>

          <div className="diagnostics-grid">
            <div className="diagnostics-main">
              <Panel title="应用与配置" subtitle={`生成于 ${formatTimestamp(diagnostics.generatedAt)}`}>
                <div className="kv-grid">
                  <KeyValue label="应用版本" mono>
                    {diagnostics.app.name} {diagnostics.app.version}
                  </KeyValue>
                  <KeyValue label="Tauri / 平台" mono>
                    {diagnostics.app.tauriVersion} · {diagnostics.app.os}/{diagnostics.app.arch}
                  </KeyValue>
                  <KeyValue label="构建类型">{diagnostics.app.profile}</KeyValue>
                  <KeyValue label="配置目录" mono>
                    <span className="path-text">{diagnostics.config.configDir}</span>
                  </KeyValue>
                  <KeyValue label="服务地址（脱敏）" mono>
                    {diagnostics.config.address || "—"}
                  </KeyValue>
                  <KeyValue label="TLS 名称（脱敏）" mono>
                    {diagnostics.config.tlsDomain || "—"}
                  </KeyValue>
                  <KeyValue label="CA / Token">
                    <span className="inline-status">
                      <Badge tone={diagnostics.config.caConfigured ? "ok" : "danger"}>
                        CA {diagnostics.config.caConfigured ? "已配置" : "缺失"}
                      </Badge>
                      <Badge tone={diagnostics.config.tokenConfigured ? "ok" : "danger"}>
                        Token {diagnostics.config.tokenConfigured ? "已配置" : "缺失"}
                      </Badge>
                    </span>
                  </KeyValue>
                  <KeyValue label="环境指纹" mono>
                    {diagnostics.config.fingerprint}
                    <CopyButton value={diagnostics.config.fingerprint} compact />
                  </KeyValue>
                </div>
                {diagnostics.config.issues.length > 0 ? (
                  <div className="issue-list compact">
                    {diagnostics.config.issues.map((issue) => (
                      <div className={`issue issue-${issue.severity}`} key={issue.code}>
                        <Icon name={issue.severity === "error" ? "alert" : "info"} size={15} />
                        <div>
                          <div className="issue-message">{issue.message}</div>
                          <div className="issue-meta mono">{issue.code}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Panel>

              <Panel title="同步与运行时" subtitle="检查点由原生层保管；界面只接收不透明事件与安全水位。">
                <div className="kv-grid">
                  <KeyValue label="会话世代" mono>
                    #{diagnostics.sync.generation}
                  </KeyValue>
                  <KeyValue label="journal_epoch" mono>
                    {diagnostics.sync.journalEpoch ?? "—"}
                  </KeyValue>
                  <KeyValue label="state_cursor" mono>
                    {diagnostics.sync.stateCursor ?? "—"}
                  </KeyValue>
                  <KeyValue label="durable_cursor" mono>
                    {diagnostics.sync.durableCursor ?? "—"}
                  </KeyValue>
                  <KeyValue label="readiness / writable">
                    {diagnostics.sync.readiness ?? "—"} /{" "}
                    {diagnostics.sync.writable === null
                      ? "—"
                      : diagnostics.sync.writable
                        ? "true"
                        : "false"}
                  </KeyValue>
                  <KeyValue label="stale">
                    {diagnostics.sync.stale === null
                      ? "—"
                      : diagnostics.sync.stale
                        ? "true"
                        : "false"}
                  </KeyValue>
                  <KeyValue label="本地数据目录" mono>
                    <span className="path-text">{diagnostics.runtime.dataDir}</span>
                  </KeyValue>
                  <KeyValue label="installation_id 引用" mono>
                    …{diagnostics.runtime.installationIdRef}
                  </KeyValue>
                </div>
              </Panel>

              <Panel
                title="最近错误"
                subtitle="仅保留脱敏后的错误码与关联 ID，最多 100 条。"
                actions={<Badge tone="muted">{diagnostics.recentErrors.length} 条</Badge>}
              >
                {diagnostics.recentErrors.length === 0 ? (
                  <EmptyState compact icon="check" title="当前会话没有记录错误" />
                ) : (
                  <div className="table-scroll">
                    <table className="data-table">
                      <caption className="sr-only">最近错误</caption>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>类别</th>
                          <th>错误码</th>
                          <th>关联 ID</th>
                          <th>消息</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...diagnostics.recentErrors].reverse().map((error) => (
                          <tr key={`${error.at}-${error.code}-${error.correlationId}`}>
                            <td className="small">{formatTimestamp(error.at)}</td>
                            <td>
                              <Badge tone="muted">{error.category}</Badge>
                            </td>
                            <td className="mono small">{error.code}</td>
                            <td className="mono small">
                              {error.correlationId.slice(0, 12)}
                            </td>
                            <td className="small">{error.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            <aside className="diagnostics-aside">
              <Panel title="导出脱敏清单" subtitle="导出文件只包含以下信息。">
                <ul className="redaction-list">
                  <li>
                    <Icon name="check" size={14} />
                    应用版本、平台、连接阶段、错误码
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    脱敏后的地址、TLS 名称、环境指纹
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    同步水位、事件计数、本地记录数量
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    installation_id 的末 8 位引用
                  </li>
                  <li className="redaction-excluded">
                    <Icon name="close" size={14} />
                    Bearer Token / Authorization
                  </li>
                  <li className="redaction-excluded">
                    <Icon name="close" size={14} />
                    page_token / resume_token / 完整游标
                  </li>
                  <li className="redaction-excluded">
                    <Icon name="close" size={14} />
                    完整业务请求参数
                  </li>
                  <li className="redaction-excluded">
                    <Icon name="close" size={14} />
                    本地用户名与完整主机地址
                  </li>
                </ul>
                <Callout tone="info" title="导出前需要确认" icon="shield">
                  诊断文件用于排障，不包含凭证或订单参数；导出位置默认为系统下载目录（桌面运行时）。
                </Callout>
              </Panel>

              {exported ? (
                <Panel title="最近导出" actions={<Badge tone="ok">成功</Badge>}>
                  <div className="mono small path-text">{exported.path}</div>
                  <div className="small muted">
                    {formatBytes(String(exported.bytes))} · {formatTimestamp(exported.createdAt)}
                  </div>
                  <div className="inline-status">
                    {exported.redactions.map((redaction) => (
                      <Badge tone="muted" key={redaction}>
                        {redaction}
                      </Badge>
                    ))}
                  </div>
                </Panel>
              ) : null}

              {exportError ? (
                <Panel title="导出失败" actions={<Badge tone="danger">失败</Badge>}>
                  <p className="small">{exportError}</p>
                </Panel>
              ) : null}

              <Panel title="更新状态" className="subtle-panel">
                <div className="mini-kv">
                  <div>
                    <span>通道</span>
                    <strong className="mono">{diagnostics.update.channel}</strong>
                  </div>
                  <div>
                    <span>阶段</span>
                    <strong>{diagnostics.update.phase}</strong>
                  </div>
                  <div>
                    <span>策略可写入</span>
                    <strong>{diagnostics.update.policyGate.canTrade ? "true" : "false"}</strong>
                  </div>
                  <div>
                    <span>策略 revision</span>
                    <strong className="mono">
                      {diagnostics.update.policyGate.revision ?? "—"}
                    </strong>
                  </div>
                </div>
                {diagnostics.update.error ? (
                  <p className="small danger-text">{diagnostics.update.error.message}</p>
                ) : null}
              </Panel>
            </aside>
          </div>
        </>
      )}

      <Modal
        open={exportOpen}
        title="导出诊断文件"
        description="文件将写入本机下载目录；不会上传到任何服务器。"
        onClose={() => {
          if (!exporting) setExportOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setExportOpen(false)}
              disabled={exporting}
            >
              取消
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void runExport()}
              disabled={!confirmed || exporting}
            >
              {exporting ? <Spinner size={15} /> : <Icon name="download" size={16} />}
              导出
            </button>
          </>
        }
      >
        <div className="export-confirm">
          <Callout tone="warn" title="请确认内容已脱敏" icon="shield">
            导出包含连接阶段、错误码、脱敏地址、同步水位和 installation_id 的末 8 位；
            不包含 Token、Authorization、page/resume token 或完整订单参数。
          </Callout>
          <label className="check-line">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我已确认诊断文件内容已脱敏，并同意导出到本机。</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}
