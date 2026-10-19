import { useMemo, useState } from "react";
import { useApp } from "../app/AppProvider";
import { Icon } from "../components/Icon";
import {
  Badge,
  Callout,
  KeyValue,
  Modal,
  PageHeader,
  Panel,
  PolicyBadge,
  ProgressBar,
  Spinner,
} from "../components/ui";
import {
  formatBytes,
  formatTimestamp,
  updatePhaseLabels,
} from "../lib/format";

export function UpdatesPage() {
  const {
    state,
    checkUpdate,
    downloadUpdate,
    installUpdate,
    isDemo,
  } = useApp();
  const update = state.update;
  const app = state.bootstrap?.app;
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [confirmUnknown, setConfirmUnknown] = useState(false);
  const [confirmMaintenance, setConfirmMaintenance] = useState(false);

  const unknownRequests = useMemo(
    () =>
      state.requests.filter((record) =>
        ["prepared", "sending", "unknown"].includes(record.status),
      ),
    [state.requests],
  );
  const unknownCount = unknownRequests.length;
  const policy = update?.policyGate;
  const metadata = update?.metadata;
  const download = update?.download;
  const canInstall =
    update?.phase === "ready" &&
    (!unknownCount || (confirmUnknown && confirmMaintenance));

  const runCheck = async () => {
    setChecking(true);
    try {
      await checkUpdate(true);
    } finally {
      setChecking(false);
    }
  };

  const runDownload = async () => {
    setDownloading(true);
    try {
      await downloadUpdate();
    } catch {
      // Provider toast.
    } finally {
      setDownloading(false);
    }
  };

  const runInstall = async () => {
    setInstalling(true);
    try {
      await installUpdate(confirmUnknown);
      setInstallOpen(false);
    } catch {
      // Provider toast; keep the dialog so the user can read the failure.
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="SYSTEM / UPDATES"
        title="更新与关于"
        description={
          <>
            MVP 使用 Tauri updater 下载完整 NSIS 安装包并校验签名；Hono 更新服务只负责版本策略与发布元数据。
            安装前会再次复核发布资格，并保留未知结果请求。
          </>
        }
        actions={
          <>
            <Badge tone="muted">{update?.channel ?? "stable"} 通道</Badge>
            <button
              type="button"
              className="button button-primary"
              onClick={() => void runCheck()}
              disabled={checking || installing}
            >
              {checking ? <Spinner size={15} /> : <Icon name="refresh" size={16} />}
              检查更新
            </button>
          </>
        }
      />

      {isDemo ? (
        <Callout tone="warn" title="演示模式" icon="info">
          当前更新信息、下载进度与验签结果均为本地 fixture，不会访问更新服务或启动安装器。
        </Callout>
      ) : null}

      <div className="updates-grid">
        <div className="updates-main">
          <Panel
            title="当前版本"
            subtitle="版本、平台和安装类型由原生层提供，WebView 不能覆盖。"
            actions={
              <Badge
                tone={
                  update?.phase === "available" || update?.phase === "ready"
                    ? "accent"
                    : update?.phase === "failed"
                      ? "danger"
                      : "muted"
                }
                dot
              >
                {update ? updatePhaseLabels[update.phase] : "未加载"}
              </Badge>
            }
          >
            <div className="version-hero">
              <div>
                <div className="version-number mono">{app?.version ?? update?.currentVersion ?? "0.1.0"}</div>
                <div className="version-meta">
                  <span>{update?.channel ?? "stable"}</span>
                  <span>windows / x86_64</span>
                  <span>NSIS</span>
                </div>
              </div>
              <div className="version-state">
                <div className="small-label">最后检查</div>
                <div>{formatTimestamp(update?.lastCheckedAt)}</div>
              </div>
            </div>

            {!update?.configured ? (
              <Callout tone="warn" title="更新服务尚未配置" icon="server">
                当前 <code>config/client.toml</code> 没有提供 <code>[update].base_url</code>。
                第一版客户端已包含 updater、验签能力与读取更新配置的入口；部署更新服务后补齐地址即可启用。
                开发构建中最低版本策略不会启用。
                <pre className="config-snippet">{`[update]
base_url = "https://updates.example.com"
channel = "stable"
auto_check = true
auto_download = false
enforce_min_version = true`}</pre>
              </Callout>
            ) : null}

            {update?.error ? (
              <div className="error-box">
                <div className="error-box-title">
                  <Icon name="alert" size={16} />
                  {update.error.code}
                </div>
                <div>{update.error.message}</div>
                <div className="mono small">
                  correlation {update.error.correlationId}
                  {update.error.retryable ? " · 可重试" : ""}
                </div>
                {update.error.details ? (
                  <dl className="error-details">
                    {Object.entries(update.error.details).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd className="mono">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}

            {metadata ? (
              <div className="update-available">
                <div className="update-available-head">
                  <div>
                    <div className="small-label">可用版本</div>
                    <div className="update-version mono">{metadata.version}</div>
                  </div>
                  <div className="inline-status">
                    {metadata.mandatory ? <Badge tone="danger">强制更新</Badge> : null}
                    <Badge tone="muted">发布 {formatTimestamp(metadata.pubDate)}</Badge>
                    <Badge tone="muted">
                      {formatBytes(metadata.sizeBytes ?? download?.totalBytes)}
                    </Badge>
                  </div>
                </div>
                <p className="update-notes">{metadata.notes || "发布说明为空。"}</p>

                {download ? (
                  <ProgressBar
                    percent={download.percent ?? null}
                    tone={update?.phase === "ready" ? "ok" : "accent"}
                    label={
                      <>
                        下载进度 · {formatBytes(download.receivedBytes)}
                        {download.totalBytes ? ` / ${formatBytes(download.totalBytes)}` : ""}
                      </>
                    }
                  />
                ) : null}

                <div className="button-row">
                  {update?.phase === "available" || update?.phase === "failed" ? (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void runDownload()}
                      disabled={downloading || update?.phase === "failed"}
                    >
                      {downloading ? <Spinner size={15} /> : <Icon name="download" size={16} />}
                      下载并验签
                    </button>
                  ) : null}
                  {update?.phase === "downloading" ? (
                    <button type="button" className="button button-primary" disabled>
                      <Spinner size={15} />
                      正在下载
                    </button>
                  ) : null}
                  {update?.phase === "ready" ? (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => setInstallOpen(true)}
                      disabled={installing}
                    >
                      <Icon name="shield" size={16} />
                      立即安装
                    </button>
                  ) : null}
                  {update?.phase === "failed" ? (
                    <button
                      type="button"
                      className="button button-ghost"
                      onClick={() => void runCheck()}
                    >
                      <Icon name="refresh" size={16} />
                      重新检查
                    </button>
                  ) : null}
                </div>
                <p className="small muted">
                  下载与安装互斥；安装前会重新请求 eligibility，暂停或撤回的版本会被拒绝。安装器启动后应用将退出，
                  “调用安装成功”不等于新版本已经可用。
                </p>
              </div>
            ) : update?.phase === "up_to_date" ? (
              <Callout tone="ok" title="当前版本符合更新策略" icon="check">
                {update.message ?? "没有可用更新。"}
              </Callout>
            ) : null}

            {update?.phase === "checking" ? (
              <div className="checking-row">
                <Spinner size={16} />
                正在获取策略并检查更新端点…
              </div>
            ) : null}
          </Panel>

          <Panel
            title="最低版本与灰度策略"
            subtitle="策略由更新服务返回；客户端在原生报单命令入口与界面同时执行。"
            actions={policy ? <PolicyBadge status={policy.status} /> : null}
          >
            <div className="kv-grid">
              <KeyValue label="策略 revision" mono>
                {policy?.revision ?? "—"}
              </KeyValue>
              <KeyValue label="最低支持版本" mono>
                {policy?.minSupportedVersion ?? "—"}
              </KeyValue>
              <KeyValue label="生效时间">
                {formatTimestamp(policy?.effectiveAt)}
              </KeyValue>
              <KeyValue label="策略有效期">
                {formatTimestamp(policy?.validUntil)}
              </KeyValue>
              <KeyValue label="新增报单">
                <Badge tone={policy?.canTrade ? "ok" : "danger"}>
                  {policy?.canTrade ? "允许" : "受限"}
                </Badge>
              </KeyValue>
              <KeyValue label="更新服务">
                <Badge tone={update?.configured ? "ok" : "muted"}>
                  {update?.configured ? "已配置" : "未配置"}
                </Badge>
              </KeyValue>
            </div>
            <p className={`policy-reason ${policy?.canTrade ? "" : "policy-reason-blocked"}`}>
              {policy?.reason ?? "尚未加载更新策略。"}
            </p>
            <ul className="plain-list small muted">
              <li>低于最低版本时绕过灰度，但仍校验平台、架构和包签名。</li>
              <li>更新服务不可达时使用上次有效策略；策略过期或无策略时进入受限模式。</li>
              <li>短暂检查失败不会改变尚有效的授权状态。</li>
              <li>这是客户端产品策略；现有业务协议没有可信客户端版本准入。</li>
            </ul>
          </Panel>

          <Panel title="关于 OrderHub Desktop" subtitle="本地打包前端，不远程加载可执行 JavaScript。">
            <div className="kv-grid">
              <KeyValue label="应用">{app?.name ?? "OrderHub Desktop"}</KeyValue>
              <KeyValue label="版本" mono>
                {app?.version ?? update?.currentVersion ?? "0.1.0"}
              </KeyValue>
              <KeyValue label="Tauri" mono>
                {app?.tauriVersion ?? "—"}
              </KeyValue>
              <KeyValue label="平台 / 架构" mono>
                {app?.os ?? "—"} / {app?.arch ?? "—"}
              </KeyValue>
              <KeyValue label="构建类型">{app?.profile ?? "—"}</KeyValue>
              <KeyValue label="安装包">NSIS · Windows x64</KeyValue>
            </div>
            <div className="about-note">
              <Icon name="shield" size={16} />
              <span>
                Tauri updater 签名公钥随客户端内置；签名私钥不进入客户端或 config。Authenticode
                代码签名与 updater 签名分别管理，不能互相替代。
              </span>
            </div>
          </Panel>
        </div>

        <aside className="updates-aside">
          <Panel className="update-visual-panel">
            <img
              src="/assets/orderhub/update-package.png"
              alt=""
              width={1254}
              height={1254}
              className="update-image"
            />
            <div className="update-visual-caption">
              包下载、验签、安装结果由真实组件与状态文字表达，装饰图不暗示安装成功。
            </div>
          </Panel>

          <Panel title="更新流程" subtitle="完整安装包 · 后台下载 · 用户确认安装">
            <ol className="flow-list">
              <li className={update?.phase === "checking" ? "flow-active" : ""}>
                <span className="flow-index">1</span>
                检查策略与版本
              </li>
              <li
                className={
                  ["available", "downloading", "ready"].includes(update?.phase ?? "")
                    ? "flow-active"
                    : ""
                }
              >
                <span className="flow-index">2</span>
                下载并校验 Tauri 签名
              </li>
              <li className={update?.phase === "ready" ? "flow-active" : ""}>
                <span className="flow-index">3</span>
                安装前资格复核与业务保护
              </li>
              <li className={update?.phase === "installing" ? "flow-active" : ""}>
                <span className="flow-index">4</span>
                启动安装器、退出并重启
              </li>
              <li>
                <span className="flow-index">5</span>
                新版本写启动确认并上报
              </li>
            </ol>
            <p className="small muted">
              MVP 不承诺崩溃后保留已下载内容，也不做差分更新或无人值守自动回退。
            </p>
          </Panel>

          <Panel title="崩溃与恢复" className="subtle-panel">
            <ul className="plain-list small muted">
              <li>验签失败、包不可下载或磁盘不足时停止安装，可继续使用符合策略的旧版本。</li>
              <li>服务不可达时暂缓安装；已经进入安装器的任务无法靠后续撤回即时取消。</li>
              <li>安装失败或新版本无法启动时，使用保留的可信安装包人工修复。</li>
              <li>更新回执未收到不代表安装失败；不能据此自动回滚。</li>
            </ul>
          </Panel>
        </aside>
      </div>

      <Modal
        open={installOpen}
        title="安装前检查"
        description="安装会进入维护窗口：关闭新写入、取消事件流并启动安装器。"
        onClose={() => {
          if (!installing) setInstallOpen(false);
        }}
        footer={
          <>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => setInstallOpen(false)}
              disabled={installing}
            >
              稍后安装
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => void runInstall()}
              disabled={!canInstall || installing}
            >
              {installing ? <Spinner size={15} /> : <Icon name="shield" size={16} />}
              确认安装并重启
            </button>
          </>
        }
      >
        <div className="install-check">
          <div className="install-version">
            <div>
              <div className="small-label">目标版本</div>
              <div className="mono install-target">{metadata?.version ?? "—"}</div>
            </div>
            <Badge tone="muted">{formatBytes(metadata?.sizeBytes)}</Badge>
          </div>

          <Callout tone="warn" title="在途订单不会因关闭客户端而撤销" icon="alert">
            活动订单可能在客户端退出后继续运行；更新流程不会自动撤销订单。仍有结果未知的请求时，请先查询原请求
            或明确接受保留后继续。
          </Callout>

          {unknownCount > 0 ? (
            <div className="unknown-request-list">
              <div className="small-label">
                待人工核对的请求：{unknownCount} 条
              </div>
              <ul>
                {unknownRequests.slice(0, 5).map((record) => (
                  <li key={record.requestId} className="mono small">
                    {record.rpcMethod} · {record.requestId} · {record.status}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="check-line">
            <input
              type="checkbox"
              checked={confirmMaintenance}
              onChange={(event) => setConfirmMaintenance(event.target.checked)}
            />
            <span>我确认当前处于可维护时段，并理解安装器启动后应用会退出。</span>
          </label>
          {unknownCount > 0 ? (
            <label className="check-line">
              <input
                type="checkbox"
                checked={confirmUnknown}
                onChange={(event) => setConfirmUnknown(event.target.checked)}
              />
              <span>
                我确认保留上述 {unknownCount} 条等待受理/结果未知的请求，不会因升级清空，也不会自动重发。
              </span>
            </label>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
