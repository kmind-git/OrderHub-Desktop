import { useApp } from "./app/AppProvider";
import { Layout } from "./app/Layout";
import { useHashRoute } from "./app/useHashRoute";
import { BrandMark, Icon } from "./components/Icon";
import { Spinner } from "./components/ui";
import { ConnectPage } from "./pages/ConnectPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrderTicketPage } from "./pages/OrderTicketPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { RequestsPage } from "./pages/RequestsPage";
import { UpdatesPage } from "./pages/UpdatesPage";
import { WorkspacePage } from "./pages/WorkspacePage";

function Splash() {
  return (
    <div className="splash">
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-brand">
        <BrandMark size={64} />
        <div>
          <div className="splash-title">OrderHub Desktop</div>
          <div className="splash-sub">读取本地配置 · 加载安全存储 · 准备业务会话</div>
        </div>
      </div>
      <div className="splash-loader">
        <Spinner size={18} />
        <span>正在启动客户端…</span>
      </div>
    </div>
  );
}

function FatalScreen({
  message,
  code,
  desktopRequired,
  onRetry,
}: {
  message: string;
  code: string;
  desktopRequired: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="fatal-screen">
      <div className="fatal-card">
        <BrandMark size={52} />
        <div className="fatal-kicker">{desktopRequired ? "DESKTOP RUNTIME" : "STARTUP ERROR"}</div>
        <h1>{desktopRequired ? "需要桌面客户端运行时" : "客户端无法启动"}</h1>
        <p>{message}</p>
        <div className="fatal-code mono">{code}</div>
        {desktopRequired ? (
          <div className="fatal-instructions">
            <p>浏览器预览不会读取 config、连接 gRPC 或使用 DPAPI。请在项目根目录运行：</p>
            <pre className="config-snippet">{`pnpm install
pnpm dev:tauri`}</pre>
            <p className="small muted">
              仅做界面预览时可使用开发服务器；界面会明确标注“开发演示数据”，不会发送真实订单。
            </p>
          </div>
        ) : (
          <p className="small muted">
            请检查 config/client.toml、数据目录权限与 Windows WebView2 运行时，然后重试。
          </p>
        )}
        <button type="button" className="button button-primary" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          重试启动
        </button>
      </div>
    </div>
  );
}

function NotFound({ navigate }: { navigate: (path: string) => void }) {
  return (
    <div className="page">
      <div className="not-found">
        <div className="not-found-code mono">404</div>
        <h1>页面不存在</h1>
        <p>当前桌面路由没有对应页面。请从左侧导航进入工作台。</p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => navigate("/workspace")}
        >
          返回工作台
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { path, navigate } = useHashRoute();
  const {
    loading,
    fatalError,
    backendKind,
    retryBootstrap,
    state,
  } = useApp();

  if (loading) return <Splash />;
  if (fatalError) {
    return (
      <FatalScreen
        message={fatalError.message}
        code={fatalError.code}
        desktopRequired={backendKind === "unavailable"}
        onRetry={retryBootstrap}
      />
    );
  }
  if (!state.config) {
    return (
      <FatalScreen
        message="尚未读取到本地配置。"
        code="CONFIG_NOT_LOADED"
        desktopRequired={backendKind === "unavailable"}
        onRetry={retryBootstrap}
      />
    );
  }

  const orderMatch = /^\/orders\/([^/]+)$/.exec(path);
  let content;
  if (path === "/workspace" || path === "/" || path === "") {
    content = <WorkspacePage navigate={navigate} />;
  } else if (path === "/order") {
    content = <OrderTicketPage navigate={navigate} />;
  } else if (orderMatch) {
    content = (
      <OrderDetailPage
        clientOrderId={decodeURIComponent(orderMatch[1] ?? "")}
        navigate={navigate}
      />
    );
  } else if (path === "/requests") {
    content = <RequestsPage />;
  } else if (path === "/history") {
    content = <PlaceholderPage capabilityId="historyOrders" navigate={navigate} />;
  } else if (path === "/trades") {
    content = <PlaceholderPage capabilityId="trades" navigate={navigate} />;
  } else if (path === "/accounts") {
    content = <PlaceholderPage capabilityId="accountTotals" navigate={navigate} />;
  } else if (path === "/market") {
    content = <PlaceholderPage capabilityId="marketQuotes" navigate={navigate} />;
  } else if (path === "/connect") {
    content = <ConnectPage />;
  } else if (path === "/updates") {
    content = <UpdatesPage />;
  } else if (path === "/diagnostics") {
    content = <DiagnosticsPage />;
  } else {
    content = <NotFound navigate={navigate} />;
  }

  return (
    <Layout path={path} navigate={navigate}>
      {content}
    </Layout>
  );
}
