import { resolve } from "node:path";

export interface UpdaterConfig {
  host: string;
  port: number;
  dbPath: string;
  artifactRoot: string;
  publicArtifactBaseUrl: string;
  adminToken: string | null;
  adminActor: string;
  applicationId: string;
  serveArtifacts: boolean;
  verifyArtifactUrl: boolean;
  allowInsecureArtifactUrl: boolean;
  /** Minisign/Tauri updater public key used to verify artifacts before publish. */
  signingPublicKey: string | null;
  eventRetentionDays: number;
  policyDefaultValidForSeconds: number;
  supportUrl: string | null;
  trustProxy: boolean;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`configuration value out of range: expected ${min}..${max}, got ${value}`);
  }
  return parsed;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): UpdaterConfig {
  const cwd = process.cwd();
  const publicBaseUrl = trimSlash(
    env.ORDERHUB_UPDATER_PUBLIC_BASE_URL ?? "http://127.0.0.1:8787/artifacts",
  );
  const base = new URL(publicBaseUrl);
  const isLoopback = ["127.0.0.1", "::1", "localhost"].includes(base.hostname);
  const allowInsecure = bool(env.ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL, isLoopback);
  if (base.protocol !== "https:" && !allowInsecure) {
    throw new Error(
      "ORDERHUB_UPDATER_PUBLIC_BASE_URL must use HTTPS unless ORDERHUB_UPDATER_ALLOW_INSECURE_ARTIFACT_URL is explicitly enabled",
    );
  }
  const serveArtifacts = bool(env.ORDERHUB_UPDATER_SERVE_ARTIFACTS, env.NODE_ENV !== "production");

  return {
    host: env.ORDERHUB_UPDATER_HOST ?? "127.0.0.1",
    port: int(env.ORDERHUB_UPDATER_PORT, 8787, 1, 65535),
    dbPath: resolve(cwd, env.ORDERHUB_UPDATER_DB ?? "data/updater.sqlite3"),
    artifactRoot: resolve(cwd, env.ORDERHUB_UPDATER_ARTIFACT_DIR ?? "data/artifacts"),
    publicArtifactBaseUrl: publicBaseUrl,
    adminToken: env.ORDERHUB_UPDATER_ADMIN_TOKEN?.trim() || null,
    adminActor: env.ORDERHUB_UPDATER_ADMIN_ACTOR?.trim() || "release-cli",
    applicationId: env.ORDERHUB_UPDATER_APP_ID?.trim() || "com.orderhub.desktop",
    serveArtifacts,
    verifyArtifactUrl: bool(env.ORDERHUB_UPDATER_VERIFY_ARTIFACT_URL, true),
    allowInsecureArtifactUrl: allowInsecure,
    signingPublicKey: env.ORDERHUB_UPDATER_SIGNING_PUBLIC_KEY?.trim() || null,
    eventRetentionDays: int(env.ORDERHUB_UPDATER_EVENT_RETENTION_DAYS, 30, 1, 365),
    policyDefaultValidForSeconds: int(env.ORDERHUB_UPDATER_POLICY_VALID_SECONDS, 86400, 300, 7 * 24 * 3600),
    supportUrl: env.ORDERHUB_UPDATER_SUPPORT_URL?.trim() || null,
    trustProxy: bool(env.ORDERHUB_UPDATER_TRUST_PROXY, false),
  };
}
