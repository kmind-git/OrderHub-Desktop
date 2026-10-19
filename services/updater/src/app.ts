import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  channelPolicyUpdateSchema,
  eligibilityResponseSchema,
  healthResponseSchema,
  readyResponseSchema,
  releaseActionSchema,
  releaseRegistrationSchema,
  semVerSchema,
  updateChannelSchema,
  updateEventSchema,
  type ChannelPolicyResponse,
  type UpdateChannel,
} from "@orderhub/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { requireAdmin } from "./auth.js";
import type { UpdaterConfig } from "./config.js";
import type { Database } from "./db.js";
import { AppError } from "./errors.js";
import { assertPinnedSelection, resolvePolicy } from "./policy-service.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import {
  pauseRelease,
  publishRelease,
  registerRelease,
  releaseSummary,
  revokeRelease,
  updateChannelPolicy,
} from "./repository.js";
import type { AppEnv } from "./types.js";

const TARGET = "windows" as const;
const ARCH = "x86_64" as const;
const INSTALLER = "nsis" as const;

function parseWith<T>(schema: z.ZodType<T>, value: unknown, code = "INVALID_REQUEST"): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details: Record<string, string> = {};
  for (const issue of result.error.issues.slice(0, 8)) {
    details[issue.path.join(".") || "_"] = issue.message;
  }
  throw new AppError(400, code, "Request validation failed.", { details });
}

function resolveChannel(raw: string | undefined): UpdateChannel {
  const result = updateChannelSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(400, "INVALID_CHANNEL", "channel must be stable or beta.");
  }
  return result.data;
}

function resolveVersion(raw: string | undefined): string {
  const result = semVerSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(400, "INVALID_VERSION", "currentVersion must be a SemVer version.");
  }
  return result.data;
}

function requireInstallationId(c: { req: { header: (name: string) => string | undefined } }): string {
  const raw = c.req.header("x-installation-id");
  if (!raw) {
    throw new AppError(400, "INSTALLATION_ID_REQUIRED", "The X-Installation-ID header is required.");
  }
  return parseWith(
    z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        "must be a UUID",
      ),
    raw,
    "INVALID_INSTALLATION_ID",
  );
}

function requireInstaller(c: { req: { query: (name: string) => string | undefined; header: (name: string) => string | undefined } }): "nsis" {
  const value = c.req.query("installer");
  if (value !== INSTALLER) {
    throw new AppError(400, "INVALID_INSTALLER", "installer must be nsis.");
  }
  const header = c.req.header("x-installation-type");
  if (header && header !== INSTALLER) {
    throw new AppError(400, "INSTALLER_HEADER_MISMATCH", "X-Installation-Type conflicts with the installer query parameter.");
  }
  return INSTALLER;
}

function policyRevision(raw: string | undefined): number {
  if (raw === undefined) {
    throw new AppError(400, "POLICY_REVISION_REQUIRED", "policy_revision is required.");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new AppError(400, "INVALID_POLICY_REVISION", "policy_revision must be a non-negative integer.");
  }
  return value;
}

function correlationIdFrom(c: { req: { header: (name: string) => string | undefined } }): string {
  const provided = c.req.header("x-correlation-id");
  if (provided && /^[A-Za-z0-9._-]{8,64}$/.test(provided)) return provided;
  return randomUUID();
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
    const real = c.req.header("x-real-ip");
    if (real) return real;
  }
  return "direct";
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

export interface AppDependencies {
  db: Database;
  config: UpdaterConfig;
  now?: () => Date;
}

export function createApp({ db, config, now = () => new Date() }: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const eventLimiter = new FixedWindowRateLimiter(30, 60_000);
  const clientLimiter = new FixedWindowRateLimiter(600, 60_000);

  app.use("*", async (c, next) => {
    const correlationId = correlationIdFrom(c);
    c.set("correlationId", correlationId);
    c.set("actor", "");
    c.header("X-Correlation-ID", correlationId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    const started = Date.now();
    await next();
    console.log(
      JSON.stringify({
        level: "info",
        event: "request",
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Date.now() - started,
        correlation_id: correlationId,
      }),
    );
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => {
        c.status(413);
        return c.json({
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body is too large.",
          correlation_id: c.get("correlationId") ?? "unknown",
        });
      },
    }),
  );

  app.use("/v1/admin/*", requireAdmin(config.adminToken, config.adminActor));

  app.get("/healthz", (c) => {
    return c.json(
      healthResponseSchema.parse({
        status: "ok",
        service: "orderhub-updater",
        time: now().toISOString(),
      }),
    );
  });

  app.get("/readyz", (c) => {
    let database = false;
    try {
      db.prepare("SELECT 1").get();
      database = true;
    } catch {
      database = false;
    }
    let artifactStore = false;
    try {
      mkdirSync(config.artifactRoot, { recursive: true });
      accessSync(config.artifactRoot, constants.R_OK | constants.W_OK);
      artifactStore = true;
    } catch {
      artifactStore = false;
    }
    const ready = database && artifactStore;
    c.status(ready ? 200 : 503);
    return c.json(
      readyResponseSchema.parse({
        status: ready ? "ready" : "not_ready",
        database,
        artifact_store: artifactStore,
        time: now().toISOString(),
      }),
    );
  });

  app.get("/v1/update-policy/:channel/:target/:arch/:currentVersion", (c) => {
    c.header("Cache-Control", "no-store");
    clientLimiter.consume(`policy:${clientIp(c, config.trustProxy)}`);
    const channel = resolveChannel(c.req.param("channel"));
    const target = c.req.param("target");
    const arch = c.req.param("arch");
    if (target !== TARGET || arch !== ARCH) {
      throw new AppError(404, "UNSUPPORTED_PLATFORM", "This update service does not serve that target or architecture.");
    }
    const installer = requireInstaller(c);
    const installationId = requireInstallationId(c);
    const currentVersion = resolveVersion(c.req.param("currentVersion"));
    const resolved = resolvePolicy(db, config, {
      channel,
      target,
      arch,
      installer,
      currentVersion,
      installationId,
      now: now(),
    });
    return c.json(resolved.response);
  });

  app.get("/v1/updates/:channel/:target/:arch/:currentVersion", (c) => {
    c.header("Cache-Control", "no-store");
    clientLimiter.consume(`updates:${clientIp(c, config.trustProxy)}`);
    const channel = resolveChannel(c.req.param("channel"));
    const target = c.req.param("target");
    const arch = c.req.param("arch");
    if (target !== TARGET || arch !== ARCH) {
      throw new AppError(404, "UNSUPPORTED_PLATFORM", "This update service does not serve that target or architecture.");
    }
    const installer = requireInstaller(c);
    const installationId = requireInstallationId(c);
    const currentVersion = resolveVersion(c.req.param("currentVersion"));
    const releaseId = c.req.query("release_id");
    if (!releaseId) {
      throw new AppError(400, "RELEASE_ID_REQUIRED", "release_id is required.");
    }
    const revision = policyRevision(c.req.query("policy_revision"));
    const resolved = resolvePolicy(db, config, {
      channel,
      target,
      arch,
      installer,
      currentVersion,
      installationId,
      now: now(),
    });
    if (resolved.policy.revision !== revision) {
      throw new AppError(
        409,
        "POLICY_CHANGED",
        "The channel policy changed after it was read. Fetch the policy again before continuing.",
        { details: { current_revision: String(resolved.policy.revision) } },
      );
    }
    if (resolved.selection.kind === "none") {
      c.status(204);
      return c.body(null, 204);
    }
    assertPinnedSelection(resolved, releaseId, revision);
    const selected = resolved.selection.kind === "selected" ? resolved.selection : null;
    if (!selected) {
      c.status(204);
      return c.body(null, 204);
    }
    return c.json({
      version: selected.candidate.release.version,
      pub_date: selected.candidate.release.published_at ?? selected.candidate.release.created_at,
      url: selected.candidate.artifact.url,
      signature: selected.candidate.artifact.signature,
      notes: selected.candidate.release.notes,
    });
  });

  app.get("/v1/releases/:releaseId/eligibility", (c) => {
    c.header("Cache-Control", "no-store");
    clientLimiter.consume(`eligibility:${clientIp(c, config.trustProxy)}`);
    const releaseId = c.req.param("releaseId");
    const channel = resolveChannel(c.req.query("channel"));
    const target = c.req.query("target");
    const arch = c.req.query("arch");
    if (target !== TARGET || arch !== ARCH) {
      throw new AppError(404, "UNSUPPORTED_PLATFORM", "This update service does not serve that target or architecture.");
    }
    const installer = requireInstaller(c);
    const installationId = requireInstallationId(c);
    const currentVersion = resolveVersion(c.req.query("current_version"));
    const revision = policyRevision(c.req.query("policy_revision"));

    const release = db
      .prepare("SELECT * FROM releases WHERE release_id = ?")
      .get(releaseId) as { status: string } | undefined;
    if (!release) throw new AppError(404, "RELEASE_NOT_FOUND", "Release not found.");
    if (release.status === "revoked") {
      throw new AppError(410, "RELEASE_REVOKED", "This release was revoked and cannot be installed.");
    }
    if (release.status === "paused") {
      throw new AppError(410, "RELEASE_PAUSED", "This release was paused. Installation must be cancelled.");
    }
    if (release.status !== "published") {
      throw new AppError(409, "RELEASE_NOT_PUBLISHED", "This release is not available for installation.");
    }

    const resolved = resolvePolicy(db, config, {
      channel,
      target,
      arch,
      installer,
      currentVersion,
      installationId,
      now: now(),
    });
    const selected = assertPinnedSelection(resolved, releaseId, revision);
    const candidate = selected.kind === "selected" ? selected.candidate : null;
    if (!candidate) {
      throw new AppError(409, "RELEASE_NOT_SELECTED", "The pinned release is no longer selected.");
    }
    return c.json(
      eligibilityResponseSchema.parse({
        eligible: true,
        release_id: candidate.release.release_id,
        policy_revision: resolved.policy.revision,
        version: candidate.release.version,
        pub_date: candidate.release.published_at ?? candidate.release.created_at,
        url: candidate.artifact.url,
        signature: candidate.artifact.signature,
        notes: candidate.release.notes,
        size: candidate.artifact.size,
        sha256: candidate.artifact.sha256,
      }),
    );
  });

  app.post("/v1/update-events", async (c) => {
    c.status(202);
    const body = await readJson(c);
    const event = parseWith(updateEventSchema, body, "INVALID_UPDATE_EVENT");
    eventLimiter.consume(`${event.installation_id}:${clientIp(c, config.trustProxy)}`);
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO update_events
           (event_id, installation_id, app_version, channel, target, arch, installer,
            stage, error_category, occurred_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.event_id,
        event.installation_id,
        event.app_version,
        event.channel,
        event.target,
        event.arch,
        event.installer,
        event.stage,
        event.error_category,
        event.occurred_at,
        now().toISOString(),
      );
    return c.json({ accepted: true, duplicate: result.changes === 0 }, 202);
  });

  app.post("/v1/admin/releases", async (c) => {
    const body = await readJson(c);
    const input = parseWith(releaseRegistrationSchema, body);
    const release = registerRelease(
      db,
      config,
      input,
      c.get("actor"),
      c.get("correlationId"),
      now(),
    );
    c.status(201);
    return c.json(releaseSummary(db, release));
  });

  app.post("/v1/admin/releases/:releaseId/publish", async (c) => {
    const body = parseWith(releaseActionSchema, await readJson(c));
    const release = await publishRelease(
      db,
      config,
      c.req.param("releaseId"),
      body.expected_revision,
      c.get("actor"),
      c.get("correlationId"),
      now(),
    );
    return c.json(releaseSummary(db, release));
  });

  app.post("/v1/admin/releases/:releaseId/pause", async (c) => {
    const body = parseWith(releaseActionSchema, await readJson(c));
    const release = pauseRelease(
      db,
      c.req.param("releaseId"),
      body.expected_revision,
      c.get("actor"),
      c.get("correlationId"),
      now(),
    );
    return c.json(releaseSummary(db, release));
  });

  app.post("/v1/admin/releases/:releaseId/revoke", async (c) => {
    const body = parseWith(releaseActionSchema, await readJson(c));
    const release = revokeRelease(
      db,
      c.req.param("releaseId"),
      body.expected_revision,
      c.get("actor"),
      c.get("correlationId"),
      now(),
    );
    return c.json(releaseSummary(db, release));
  });

  app.put("/v1/admin/channels/:channel/policy", async (c) => {
    const channel = resolveChannel(c.req.param("channel"));
    const input = parseWith(channelPolicyUpdateSchema, await readJson(c));
    const result = updateChannelPolicy(
      db,
      config,
      {
        channel,
        expected_revision: input.expected_revision,
        rollout_release_id: input.rollout_release_id,
        min_supported_version: input.min_supported_version,
        min_supported_effective_at: input.min_supported_effective_at,
        rollout_percent: input.rollout_percent,
        valid_for_seconds: input.valid_for_seconds,
      },
      c.get("actor"),
      c.get("correlationId"),
      now(),
    );
    const response: ChannelPolicyResponse = {
      channel,
      policy_revision: result.policy.revision,
      rollout_release_id: result.policy.rollout_release_id,
      min_supported_version: result.policy.min_supported_version,
      min_supported_effective_at: result.policy.min_supported_effective_at,
      rollout_percent: result.policy.rollout_percent,
      valid_until: result.validUntil,
      updated_at: result.policy.updated_at,
    };
    return c.json(response);
  });

  if (config.serveArtifacts) {
    mkdirSync(config.artifactRoot, { recursive: true });
    app.use("/artifacts/*", async (c, next) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
      await next();
    });
    app.use(
      "/artifacts/*",
      serveStatic({
        root: config.artifactRoot,
        rewriteRequestPath: (path) => path.replace(/^\/artifacts/, ""),
      }),
    );
  }

  app.notFound((c) => {
    return c.json(
      {
        code: "NOT_FOUND",
        message: "Route not found.",
        correlation_id: c.get("correlationId") ?? "unknown",
      },
      404,
    );
  });

  app.onError((error, c) => {
    const correlationId = c.get("correlationId") ?? "unknown";
    if (error instanceof AppError) {
      if (error.retryAfterSeconds !== undefined) {
        c.header("Retry-After", String(error.retryAfterSeconds));
      }
      return c.json(
        {
          code: error.code,
          message: error.message,
          correlation_id: correlationId,
          ...(error.details ? { details: error.details } : {}),
        },
        error.status,
      );
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "unhandled_error",
        correlation_id: correlationId,
        error_name: error.name,
        message: error.message,
      }),
    );
    return c.json(
      {
        code: "INTERNAL_ERROR",
        message: "The update service failed to process the request.",
        correlation_id: correlationId,
      },
      500,
    );
  });

  return app;
}

export function cleanupUpdateEvents(db: Database, retentionDays: number, now = new Date()): number {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 3600 * 1000).toISOString();
  const result = db.prepare("DELETE FROM update_events WHERE received_at < ?").run(cutoff);
  // Keep the table bounded even under a burst of unique installation IDs.
  db.prepare(
    `DELETE FROM update_events
      WHERE event_id IN (
        SELECT event_id FROM update_events
        ORDER BY received_at DESC
        LIMIT -1 OFFSET 200000
      )`,
  ).run();
  return Number(result.changes);
}
