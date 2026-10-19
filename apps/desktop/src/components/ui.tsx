import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  ConnectionPhase,
  PolicyGateStatus,
  RequestStatus,
} from "@orderhub/contracts";
import { Icon, type IconName } from "./Icon";
import {
  orderStatusTone,
  phaseLabels,
  policyStatusLabels,
  requestStatusLabels,
  requestStatusTone,
  sideTone,
} from "../lib/format";
import type { ToastItem } from "../lib/reducer";

export type Tone = "ok" | "warn" | "danger" | "info" | "accent" | "muted" | "buy" | "sell";

export function Badge({
  tone = "muted",
  children,
  className = "",
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()} id={id}>
      {title || actions ? (
        <header className="panel-header">
          <div>
            {title ? <h2 className="panel-title">{title}</h2> : null}
            {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {description ? <div className="page-description">{description}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone = "default",
  mono = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger" | "accent";
  mono?: boolean;
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${mono ? "mono" : ""}`}>{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon = "info",
  title,
  message,
  action,
  compact = false,
}: {
  icon?: IconName;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`.trim()}>
      <div className="empty-icon">
        <Icon name={icon} size={compact ? 20 : 26} />
      </div>
      <div>
        <div className="empty-title">{title}</div>
        {message ? <div className="empty-message">{message}</div> : null}
        {action ? <div className="empty-action">{action}</div> : null}
      </div>
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  icon = "info",
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className={`callout callout-${tone}`} role={tone === "danger" ? "alert" : "note"}>
      <div className="callout-icon">
        <Icon name={icon} size={17} />
      </div>
      <div className="callout-body">
        {title ? <div className="callout-title">{title}</div> : null}
        <div className="callout-content">{children}</div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? "modal-wide" : ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Toast({ toast, onDismiss }: { toast: ToastItem | null; onDismiss: () => void }) {
  if (!toast) return null;
  const icon: IconName =
    toast.tone === "ok" ? "check" : toast.tone === "danger" ? "alert" : toast.tone === "warn" ? "alert" : "info";
  return (
    <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
      <div className="toast-icon">
        <Icon name={icon} size={18} />
      </div>
      <div className="toast-body">
        <div className="toast-title">{toast.title}</div>
        {toast.message ? <div className="toast-message">{toast.message}</div> : null}
        {toast.error ? (
          <div className="toast-meta mono">
            {toast.error.code}
            {toast.error.correlationId ? ` · ${toast.error.correlationId.slice(0, 12)}` : ""}
          </div>
        ) : null}
      </div>
      <button type="button" className="icon-button" onClick={onDismiss} aria-label="关闭通知">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function CopyButton({
  value,
  label = "复制",
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`copy-button ${compact ? "copy-button-compact" : ""}`.trim()}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      title={value}
    >
      <Icon name={copied ? "check" : "copy"} size={13} />
      {compact ? null : <span>{copied ? "已复制" : label}</span>}
    </button>
  );
}

export function KeyValue({
  label,
  children,
  mono = false,
  title,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="kv-row">
      <div className="kv-label">{label}</div>
      <div className={`kv-value ${mono ? "mono" : ""}`} title={title}>
        {children}
      </div>
    </div>
  );
}

export function ProgressBar({
  percent,
  label,
  tone = "accent",
  indeterminate = false,
}: {
  percent: number | null;
  label?: ReactNode;
  tone?: Tone;
  indeterminate?: boolean;
}) {
  const width = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="progress-wrap">
      {label ? (
        <div className="progress-label">
          <span>{label}</span>
          {percent !== null ? <span className="mono">{width.toFixed(0)}%</span> : null}
        </div>
      ) : null}
      <div
        className={`progress-track ${indeterminate ? "progress-indeterminate" : ""}`.trim()}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div className={`progress-fill tone-${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function ConnectionBadge({ phase }: { phase: ConnectionPhase }) {
  const tone: Tone =
    phase === "synced"
      ? "ok"
      : phase === "stale"
        ? "warn"
        : phase === "error" || phase === "reauth_required"
          ? "danger"
          : phase === "idle"
            ? "muted"
            : "info";
  return (
    <Badge tone={tone} dot>
      {phaseLabels[phase]}
    </Badge>
  );
}

export function OrderStatusBadge({ status }: { status: string }) {
  const tone = orderStatusTone(status) as Tone;
  return <Badge tone={tone}>{status || "UNKNOWN"}</Badge>;
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const tone = requestStatusTone(status) as Tone;
  return <Badge tone={tone}>{requestStatusLabels[status]}</Badge>;
}

export function SideBadge({ side }: { side: string }) {
  const tone = sideTone(side) as Tone;
  return <Badge tone={tone}>{side === "BUY" ? "买入" : side === "SELL" ? "卖出" : side}</Badge>;
}

export function PolicyBadge({ status }: { status: PolicyGateStatus }) {
  const tone: Tone =
    status === "valid"
      ? "ok"
      : status === "not_configured"
        ? "muted"
        : status === "loading"
          ? "info"
          : "warn";
  return <Badge tone={tone}>{policyStatusLabels[status]}</Badge>;
}

export function Divider() {
  return <div className="divider" role="separator" />;
}
