import type { ReactNode } from "react";

export type IconName =
  | "workspace"
  | "ticket"
  | "list"
  | "history"
  | "trades"
  | "wallet"
  | "chart"
  | "plug"
  | "download"
  | "shield"
  | "activity"
  | "refresh"
  | "alert"
  | "check"
  | "close"
  | "arrow-right"
  | "arrow-left"
  | "copy"
  | "lock"
  | "server"
  | "clock"
  | "filter"
  | "search"
  | "chevron"
  | "menu"
  | "external"
  | "info"
  | "power"
  | "wifi"
  | "wifi-off";

const paths: Record<IconName, ReactNode> = {
  workspace: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 6.5h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z" />
      <path d="M12 7v2.2M12 11.4v2.2M12 15.8V18" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.6" cy="6" r="1" />
      <circle cx="4.6" cy="12" r="1" />
      <circle cx="4.6" cy="18" r="1" />
    </>
  ),
  history: (
    <>
      <path d="M3.8 12a8.2 8.2 0 1 0 2.6-6" />
      <path d="M3.5 4.2v4.6h4.6" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  trades: (
    <>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
      <path d="m4 6 5-3 6 5 5-4" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.4" />
      <path d="M3 9.5h18" />
      <path d="M16.5 14.5h2" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="m7 15 4-5 3.5 2.8L20 6" />
      <path d="M17 6h3v3" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16v5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4 19.5h16" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.4 3 7.7 7 9.5 4-1.8 7-5.1 7-9.5V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  activity: (
    <>
      <path d="M3 12h4l2.2-6 4.2 12 2.4-6H21" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.5-2.2L20 9M4 15l2.4 2.2A7 7 0 0 0 18 15" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5L20 6.5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  "arrow-right": (
    <>
      <path d="M4 12h16" />
      <path d="m14.5 6.5 5.5 5.5-5.5 5.5" />
    </>
  ),
  "arrow-left": (
    <>
      <path d="M20 12H4" />
      <path d="m9.5 6.5-5.5 5.5 5.5 5.5" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 4.5v8.5A1.5 1.5 0 0 0 5.5 14.5h1" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
      <path d="M12 14v2.5" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="6" rx="1.6" />
      <rect x="3.5" y="14" width="17" height="6" rx="1.6" />
      <path d="M7 7h.01M7 17h.01M10.5 7h5M10.5 17h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  power: (
    <>
      <path d="M12 3.5V12" />
      <path d="M6.4 6.8a8 8 0 1 0 11.2 0" />
    </>
  ),
  wifi: (
    <>
      <path d="M3.5 9a13 13 0 0 1 17 0" />
      <path d="M6.5 12.5a9 9 0 0 1 11 0" />
      <path d="M9.5 16a5 5 0 0 1 5 0" />
      <circle cx="12" cy="19" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  "wifi-off": (
    <>
      <path d="M3.5 9a13 13 0 0 1 4.2-2.3M12 6.2a13 13 0 0 1 8.5 2.8" />
      <path d="M6.5 12.5a9 9 0 0 1 3.4-1.8M15.5 11.4a9 9 0 0 1 2 1.1" />
      <path d="M9.5 16a5 5 0 0 1 5 0" />
      <path d="m3 3 18 18" />
      <circle cx="12" cy="19" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.65,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      src="/assets/orderhub/app-icon.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}
