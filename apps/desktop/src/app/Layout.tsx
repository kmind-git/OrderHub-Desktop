import { useEffect, useState, type ReactNode } from "react";
import type { IconName } from "../components/Icon";
import { BrandMark, Icon } from "../components/Icon";
import {
  Badge,
  ConnectionBadge,
  Toast,
} from "../components/ui";
import { formatTimestamp } from "../lib/format";
import { useApp } from "./AppProvider";

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  badge?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

function isActive(path: string, item: string): boolean {
  if (item === "/workspace") return path === "/workspace" || path === "/";
  return path === item || path.startsWith(`${item}/`);
}

export function Layout({
  path,
  navigate,
  children,
}: {
  path: string;
  navigate: (to: string) => void;
  children: ReactNode;
}) {
  const {
    state,
    isDemo,
    canTrade,
    tradingBlockReason,
    activeOrders,
    dismissToast,
    connect,
    disconnect,
  } = useApp();
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    setMobileNav(false);
  }, [path]);

  const unknownRequests = state.requests.filter((request) =>
    ["unknown", "sending", "prepared"].includes(request.status),
  ).length;
  const groups: NavGroup[] = [
    {
      title: "交易",
      items: [
        { path: "/workspace", label: "工作台", icon: "workspace", badge: activeOrders.length },
        { path: "/order", label: "报单", icon: "ticket" },
        { path: "/requests", label: "请求记录", icon: "list", badge: unknownRequests },
      ],
    },
    {
      title: "查询",
      items: [
        { path: "/history", label: "历史订单", icon: "history" },
        { path: "/trades", label: "历史成交", icon: "trades" },
        { path: "/accounts", label: "全账户资金/持仓", icon: "wallet" },
        { path: "/market", label: "行情", icon: "chart" },
      ],
    },
    {
      title: "系统",
      items: [
        { path: "/connect", label: "连接设置", icon: "plug" },
        { path: "/updates", label: "更新与关于", icon: "download" },
        { path: "/diagnostics", label: "诊断", icon: "shield" },
      ],
    },
  ];
  const updateAvailable =
    state.update &&
    ["available", "ready", "downloading", "installing"].includes(state.update.phase);
  const readiness = state.snapshot?.readiness ?? state.connection.readiness;
  const writable = state.snapshot?.writable ?? state.connection.writable;
  const stale = state.snapshot?.stale ?? state.connection.stale;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="主导航">
        <div className="sidebar-brand">
          <BrandMark size={38} />
          <div>
            <div className="brand-name">OrderHub</div>
            <div className="brand-sub">
              Desktop · {state.bootstrap?.app.version ?? "0.1.0"}
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={`nav-item ${isActive(path, item.path) ? "nav-item-active" : ""}`}
                  onClick={() => navigate(item.path)}
                  aria-current={isActive(path, item.path) ? "page" : undefined}
                >
                  <Icon name={item.icon} size={17} />
                  <span className="nav-label">{item.label}</span>
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <ConnectionBadge phase={state.connection.phase} />
            {state.connection.stale ? <Badge tone="warn">STALE</Badge> : null}
          </div>
          <div className="sidebar-meta">
            <span>gRPC orderhub.v1</span>
            <span>NSIS · x64</span>
          </div>
          {isDemo ? (
            <div className="demo-sidebar">
              开发演示数据
              <small>不会连接或提交真实订单</small>
            </div>
          ) : null}
        </div>
      </aside>

      {mobileNav ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      ) : null}

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-menu"
              onClick={() => setMobileNav((value) => !value)}
              aria-label="打开导航"
              aria-expanded={mobileNav}
            >
              <Icon name="menu" size={19} />
            </button>
            <div className="topbar-context">
              <span className="topbar-label">业务状态</span>
              <button
                type="button"
                className="inline-link"
                onClick={() => navigate("/connect")}
                title="打开连接设置"
              >
                {state.config?.connection?.address ?? "未读取配置"}
              </button>
            </div>
          </div>
          <div className="topbar-right">
            <div className="status-cluster" aria-label="服务状态">
              <ConnectionBadge phase={state.connection.phase} />
              {readiness ? (
                <Badge tone={readiness === "READY" ? "ok" : "warn"}>{readiness}</Badge>
              ) : null}
              {writable !== undefined ? (
                <Badge tone={writable ? "ok" : "danger"}>
                  {writable ? "WRITABLE" : "NOT WRITABLE"}
                </Badge>
              ) : null}
              {stale ? <Badge tone="warn">STALE</Badge> : null}
              {!canTrade && state.snapshot ? (
                <span className="status-reason" title={tradingBlockReason ?? undefined}>
                  新增报单受限
                </span>
              ) : null}
            </div>
            {updateAvailable ? (
              <button
                type="button"
                className="update-chip"
                onClick={() => navigate("/updates")}
              >
                <span className="update-dot" aria-hidden="true" />
                更新 {state.update?.metadata?.version ?? ""}
              </button>
            ) : null}
            {state.connection.phase === "idle" ||
            state.connection.phase === "error" ||
            state.connection.phase === "reauth_required" ? (
              <button type="button" className="button button-small" onClick={() => void connect()}>
                <Icon name="plug" size={15} />
                连接服务
              </button>
            ) : (
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => void disconnect()}
              >
                <Icon name="power" size={15} />
                断开
              </button>
            )}
          </div>
        </header>

        {isDemo ? (
          <div className="demo-banner" role="status">
            <Icon name="info" size={15} />
            <span>
              开发演示数据：界面使用本地 fixture 预览，不会读取真实 Token、连接业务服务、提交订单或启动安装器。
            </span>
          </div>
        ) : null}
        {state.update?.phase === "installing" ? (
          <div className="maintenance-banner" role="status">
            <Icon name="lock" size={15} />
            正在准备安装更新：新写入已关闭，安装器启动后应用将退出。
          </div>
        ) : null}

        <main className="main-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>
            OrderHub Desktop {state.bootstrap?.app.version ?? "0.1.0"} ·{" "}
            {state.update?.channel ?? "stable"} 通道
          </span>
          <span>
            最后事件：{formatTimestamp(state.sync.lastEventAt)} · 会话事件 {state.sync.appliedEvents}
          </span>
        </footer>
      </div>

      <Toast toast={state.toast} onDismiss={dismissToast} />
    </div>
  );
}
