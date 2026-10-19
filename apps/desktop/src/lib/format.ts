import type {
  ConnectionPhase,
  PolicyGateStatus,
  RequestStatus,
  UpdatePhase,
} from "@orderhub/contracts";

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function formatNanos(value: string | null | undefined): string {
  if (!value) return "—";
  if (!/^\d+$/.test(value)) return formatTimestamp(value);
  try {
    const millis = BigInt(value) / 1_000_000n;
    if (millis > 8_640_000_000_000_000n) return value;
    return formatTimestamp(new Date(Number(millis)).toISOString());
  } catch {
    return value;
  }
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed);
}

export function shortId(value: string | null | undefined, length = 20): string {
  if (!value) return "—";
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(4, length - 8))}…${value.slice(-6)}`;
}

export function formatBytes(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    let bytes = BigInt(value);
    if (bytes < 1024n) return `${bytes} B`;
    const units = ["KiB", "MiB", "GiB", "TiB"];
    let unit = -1;
    let divisor = 1n;
    while (bytes >= divisor * 1024n && unit < units.length - 1) {
      divisor *= 1024n;
      unit += 1;
    }
    const tenths = (bytes * 10n + divisor / 2n) / divisor;
    const whole = tenths / 10n;
    const fraction = tenths % 10n;
    return `${whole}.${fraction} ${units[unit]}`;
  } catch {
    return value;
  }
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

export const phaseLabels: Record<ConnectionPhase, string> = {
  idle: "未连接",
  connecting: "连接中",
  authenticating: "认证中",
  syncing: "同步中",
  synced: "已同步",
  reconnecting: "重连中",
  stale: "状态陈旧",
  reauth_required: "需重新认证",
  error: "连接错误",
};

export const updatePhaseLabels: Record<UpdatePhase, string> = {
  idle: "待检查",
  checking: "检查中",
  available: "发现更新",
  downloading: "下载中",
  ready: "待安装",
  installing: "安装中",
  failed: "检查失败",
  up_to_date: "已是最新",
  not_configured: "未配置",
  restart_pending: "等待启动确认",
};

export const requestStatusLabels: Record<RequestStatus, string> = {
  prepared: "已保存，未发送",
  sending: "等待受理",
  admitted: "已受理",
  rejected: "业务拒绝",
  unknown: "结果未知",
  failed: "未发送/失败",
};

export const policyStatusLabels: Record<PolicyGateStatus, string> = {
  not_configured: "未配置策略",
  loading: "加载中",
  valid: "策略有效",
  expired: "策略过期",
  missing: "缺少策略",
  error: "策略错误",
};

export function requestStatusTone(status: RequestStatus): string {
  switch (status) {
    case "admitted":
      return "ok";
    case "rejected":
      return "danger";
    case "unknown":
    case "sending":
      return "warn";
    case "failed":
      return "danger";
    default:
      return "muted";
  }
}

export function orderStatusTone(status: string): string {
  switch (status) {
    case "FILLED":
      return "ok";
    case "PARTIALLY_FILLED":
      return "accent";
    case "CANCELED":
      return "muted";
    case "REJECTED":
    case "EXPIRED":
      return "danger";
    case "ACCEPTED":
    case "SUBMITTED":
      return "info";
    case "PENDING_DISPATCH":
    case "DISPATCH_STARTED":
      return "warn";
    default:
      return "muted";
  }
}

export function sideTone(side: string): string {
  return side === "BUY" ? "buy" : side === "SELL" ? "sell" : "muted";
}

export function isTerminalStatus(status: string): boolean {
  return ["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(status);
}

export function availabilityLabel(value: boolean): string {
  return value ? "允许" : "不允许";
}

export function bytePercent(received: string, total: string | null): number | null {
  if (!total) return null;
  try {
    const denominator = BigInt(total);
    if (denominator === 0n) return null;
    return Number((BigInt(received) * 1000n) / denominator) / 10;
  } catch {
    return null;
  }
}
