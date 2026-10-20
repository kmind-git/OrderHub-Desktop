import { useApp } from "../app/AppProvider";
import { Icon } from "../components/Icon";
import {
  Badge,
  Callout,
  ConnectionBadge,
  CopyButton,
  EmptyState,
  KeyValue,
  PageHeader,
  Panel,
  Spinner,
} from "../components/ui";
import { formatTimestamp, phaseLabels } from "../lib/format";

export function ConnectPage() {
  const { state, connect, disconnect, reloadConfig, isDemo } = useApp();
  const config = state.config;
  const connection = state.connection;
  const busy = ["connecting", "syncing", "reconnecting"].includes(connection.phase);
  const showRecovery = !["synced", "idle"].includes(connection.phase);

  return (
    <div className="page">
      <PageHeader
        eyebrow="SYSTEM / CONNECTION"
        title="连接设置"
        description={
          <>
            业务地址、TLS 名称、CA 与 Token 由当前目录 <code>config/client.toml</code> 读取。Token
            只由 Tauri 原生层使用，界面不读取、不显示、不持久化其内容。
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => void reloadConfig()}
              disabled={busy}
            >
              <Icon name="refresh" size={16} />
              重新读取配置
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void connect()}
              disabled={busy || !config?.valid}
            >
              {busy ? <Spinner size={15} /> : <Icon name="plug" size={16} />}
              {connection.phase === "idle" ? "连接服务" : "重新连接"}
            </button>
          </>
        }
      />

      {connection.phase === "reauth_required" || connection.phase === "error" ? (
        <Callout
          tone="danger"
          title="连接未建立"
          icon="alert"
        >
          {connection.error?.message ?? connection.detail ?? "请检查配置后重新连接。"}
          {connection.error ? (
            <span className="callout-code mono">
              {connection.error.code} · correlation {connection.error.correlationId}
            </span>
          ) : null}
        </Callout>
      ) : null}

      {isDemo ? (
        <Callout tone="warn" title="当前是浏览器开发演示数据" icon="info">
          这里展示的连接信息与快照均为 fixture；连接、报单和撤单不会访问真实服务。使用
          <code>pnpm dev:tauri</code> 启动桌面客户端进行真实联调。
        </Callout>
      ) : null}

      <div className="connect-grid">
        <div className="connect-main">
          <Panel
            title="业务服务配置"
            subtitle="真实地址、TLS 身份与凭证均由部署方提供；本界面只展示是否已配置。"
            actions={
              config ? (
                <Badge tone={config.valid ? "ok" : "danger"} dot>
                  {config.valid ? "配置可用" : "配置无效"}
                </Badge>
              ) : null
            }
          >
            {!config ? (
              <EmptyState
                icon="server"
                title="尚未读取配置"
                message="点击“重新读取配置”从 config/client.toml 载入。"
                compact
              />
            ) : (
              <>
                <div className="kv-grid">
                  <KeyValue
                    label="服务地址"
                    mono
                    title={config.connection?.address}
                  >
                    {config.connection?.address ?? "—"}
                  </KeyValue>
                  <KeyValue
                    label="TLS 服务名称"
                    mono
                    title={config.connection?.tlsDomain}
                  >
                    {config.connection?.tlsDomain ?? "—"}
                  </KeyValue>
                  <KeyValue label="CA 证书">
                    <span className="inline-status">
                      <Badge tone={config.connection?.caConfigured ? "ok" : "danger"}>
                        {config.connection?.caConfigured ? "已配置" : "缺失"}
                      </Badge>
                      <span
                        className="muted mono small"
                        title={config.connection?.caPath}
                      >
                        {config.connection?.caPath || "—"}
                      </span>
                    </span>
                  </KeyValue>
                  <KeyValue label="Bearer Token">
                    <span className="inline-status">
                      <Badge tone={config.connection?.tokenConfigured ? "ok" : "danger"}>
                        {config.connection?.tokenConfigured ? "已配置（内容不可见）" : "缺失"}
                      </Badge>
                    </span>
                  </KeyValue>
                  <KeyValue label="连接 / RPC 超时">
                    {config.connection
                      ? `${config.connection.connectTimeoutSecs}s / ${config.connection.rpcTimeoutSecs}s`
                      : "—"}
                  </KeyValue>
                  <KeyValue label="事件停滞检测">
                    {config.watchTimeoutSecs}s
                  </KeyValue>
                  <KeyValue label="配置目录" mono title={config.configDir}>
                    <span className="path-text">{config.configDir}</span>
                  </KeyValue>
                  <KeyValue label="环境指纹" mono>
                    {config.fingerprint || "—"}
                    {config.fingerprint ? <CopyButton value={config.fingerprint} compact /> : null}
                  </KeyValue>
                </div>

                <div className="config-update-row">
                  <div>
                    <div className="small-label">更新服务</div>
                    <div className="inline-status">
                      <Badge tone={config.update.configured ? "ok" : "muted"}>
                        {config.update.configured ? "已配置" : "未配置"}
                      </Badge>
                      <Badge tone="muted">{config.update.channel}</Badge>
                      {config.update.configured ? (
                        <span className="mono small muted">{config.update.baseUrl}</span>
                      ) : (
                        <span className="small muted">
                          当前 config 未提供 [update].base_url；最低版本策略在开发构建中未启用。
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="small muted">
                    自动检查 {config.update.autoCheck ? "开启" : "关闭"} · 自动下载{" "}
                    {config.update.autoDownload ? "开启" : "关闭"} · HTTP{" "}
                    {config.update.allowInsecureHttp ? "允许" : "禁止"} · 间隔{" "}
                    {Math.round(config.update.checkIntervalSecs / 60)} 分钟
                  </div>
                </div>

                {config.issues.length > 0 ? (
                  <div className="issue-list">
                    {config.issues.map((issue) => (
                      <div
                        key={`${issue.code}-${issue.field ?? ""}`}
                        className={`issue issue-${issue.severity}`}
                      >
                        <Icon
                          name={issue.severity === "error" ? "alert" : "info"}
                          size={16}
                        />
                        <div>
                          <div className="issue-message">{issue.message}</div>
                          <div className="issue-meta mono">
                            {issue.code}
                            {issue.field ? ` · ${issue.field}` : ""}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="config-ok">
                    <Icon name="check" size={15} />
                    配置校验通过。变更地址或 Token 后请重新连接；旧未知请求仍按原授权上下文核对。
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel
            title="会话状态"
            subtitle="只有完成快照同步、状态不陈旧且服务允许写入时才开放新报单。"
            actions={<ConnectionBadge phase={connection.phase} />}
          >
            <div className="connection-state-grid">
              <div>
                <div className="small-label">连接世代</div>
                <div className="mono connection-generation">#{connection.generation}</div>
              </div>
              <div>
                <div className="small-label">最近变化</div>
                <div>{formatTimestamp(connection.changedAt)}</div>
              </div>
              <div>
                <div className="small-label">Readiness</div>
                <div>{connection.readiness ?? state.snapshot?.readiness ?? "—"}</div>
              </div>
              <div>
                <div className="small-label">Writable</div>
                <div>
                  {connection.writable === undefined
                    ? "—"
                    : connection.writable
                      ? "是"
                      : "否"}
                </div>
              </div>
              <div>
                <div className="small-label">持久化模式</div>
                <div>{connection.persistenceMode ?? state.snapshot?.persistenceMode ?? "—"}</div>
              </div>
              <div>
                <div className="small-label">状态陈旧</div>
                <div>{connection.stale || state.snapshot?.stale ? "是" : "否"}</div>
              </div>
            </div>
            <div className="connection-detail">
              {connection.detail ?? "点击连接开始建立 TLS 会话并获取 Snapshot。"}
            </div>
            {connection.error ? (
              <div className="error-box">
                <div className="error-box-title">
                  <Icon name="alert" size={16} />
                  {connection.error.code}
                </div>
                <div>{connection.error.message}</div>
                <div className="mono small">
                  correlation {connection.error.correlationId}
                  {connection.error.retryable ? " · 可重试" : ""}
                </div>
                {connection.error.details ? (
                  <dl className="error-details">
                    {Object.entries(connection.error.details).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd className="mono">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}
            <div className="button-row">
              <button
                type="button"
                className="button button-primary"
                onClick={() => void connect()}
                disabled={busy || !config?.valid}
              >
                {busy ? <Spinner size={15} /> : <Icon name="plug" size={16} />}
                连接 / 重新同步
              </button>
              <button
                type="button"
                className="button button-ghost"
                onClick={() => void disconnect()}
                disabled={connection.phase === "idle"}
              >
                <Icon name="power" size={16} />
                断开并取消订阅
              </button>
            </div>
            <p className="panel-note">
              当前阶段：<strong>{phaseLabels[connection.phase]}</strong>。窗口关闭、切换环境或退出凭证时，
              原生层会取消旧订阅；旧世代迟到的事件会被拒绝。
            </p>
          </Panel>
        </div>

        <aside className="connect-aside">
          <Panel className="hero-panel" title="安全连接" subtitle="TLS · Bearer Token · 原生适配层">
            <img
              className="hero-image"
              src="/assets/orderhub/connection-hero.png"
              alt=""
              width={1536}
              height={1024}
            />
          </Panel>

          {showRecovery ? (
            <Panel
              className="recovery-panel"
              title="连接恢复"
              subtitle="错误原因与重试操作始终优先于装饰图。"
            >
              <div className="recovery-layout">
                <img
                  src="/assets/orderhub/connection-recovery-v2.png"
                  alt=""
                  width={1254}
                  height={1254}
                  className="recovery-image"
                />
                <div>
                  <div className="recovery-title">
                    {connection.phase === "reauth_required"
                      ? "需要更新 Token 后重新连接"
                      : connection.phase === "stale"
                        ? "状态已陈旧，已关闭新增报单"
                        : "连接中断，正在按检查点恢复"}
                  </div>
                  <p className="muted small">
                    普通断线从最后已应用检查点续传；token 失效、慢消费者或 epoch 变化会触发全量重同步。
                  </p>
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => void connect()}
                    disabled={busy || !config?.valid}
                  >
                    <Icon name="refresh" size={14} />
                    立即重连
                  </button>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel title="安全与配置边界">
            <ul className="security-list">
              <li>
                <Icon name="lock" size={15} />
                Token 仅在原生层读取；不写入日志、诊断文件或 WebView 存储。
              </li>
              <li>
                <Icon name="shield" size={15} />
                CA 与服务身份名称始终校验；没有关闭证书校验的正式开关。
              </li>
              <li>
                <Icon name="server" size={15} />
                本地请求记录使用 Windows DPAPI 加密，并写入用户数据目录。
              </li>
              <li>
                <Icon name="info" size={15} />
                更新服务与业务服务独立；生产建议 HTTPS，HTTP 仅在受信内网显式开启。
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
