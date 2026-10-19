import { randomUUID } from "node:crypto";
import semver from "semver";
import type { Database } from "./db.js";
import { withTransaction } from "./db.js";
import type { PolicyRecord, ReleaseRow, ReleaseStatus, UpdateChannel } from "./domain.js";
import { addSeconds, listCandidates, readPolicy } from "./domain.js";
import { AppError } from "./errors.js";
import type { UpdaterConfig } from "./config.js";

export const SUPPORTED_COMBINATIONS = [
  { target: "windows", arch: "x86_64", installer: "nsis" },
] as const;

export interface ArtifactInput {
  target: string;
  arch: string;
  installer: string;
  url: string;
  size: number;
  sha256: string;
  signature: string;
}

export interface ReleaseRegistrationInput {
  application: string;
  version: string;
  channel: UpdateChannel;
  notes: string;
  artifacts: ArtifactInput[];
}

export interface AuditInput {
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  before: unknown;
  after: unknown;
  correlationId: string;
}

export function writeAudit(db: Database, input: AuditInput, now = new Date()): void {
  db.prepare(
    `INSERT INTO audit_logs
       (actor, action, object_type, object_id, before_json, after_json, correlation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.actor,
    input.action,
    input.objectType,
    input.objectId,
    input.before === null ? null : JSON.stringify(input.before),
    input.after === null ? null : JSON.stringify(input.after),
    input.correlationId,
    now.toISOString(),
  );
}

export function artifactSummary(artifact: {
  target: string;
  arch: string;
  installer: string;
  url: string;
  size: number;
  sha256: string;
  signature: string;
}) {
  return {
    target: artifact.target as "windows",
    arch: artifact.arch as "x86_64",
    installer: artifact.installer as "nsis",
    url: artifact.url,
    size: artifact.size,
    sha256: artifact.sha256,
    signature: artifact.signature,
  };
}

export function releaseAuditSummary(release: ReleaseRow, artifacts: Array<{ url: string; sha256: string; target: string; arch: string; installer: string }>) {
  return {
    release_id: release.release_id,
    application: release.application,
    version: release.version,
    channel: release.channel,
    status: release.status,
    revision: release.revision,
    published_at: release.published_at,
    artifacts: artifacts.map((artifact) => ({
      target: artifact.target,
      arch: artifact.arch,
      installer: artifact.installer,
      url: artifact.url,
      sha256: artifact.sha256,
    })),
  };
}

export function releaseSummary(db: Database, release: ReleaseRow) {
  const artifacts = db
    .prepare("SELECT * FROM artifacts WHERE release_id = ? ORDER BY target, arch, installer")
    .all(release.release_id) as Array<{
    target: string;
    arch: string;
    installer: string;
    url: string;
    size: number;
    sha256: string;
    signature: string;
  }>;
  return {
    release_id: release.release_id,
    application: release.application,
    version: release.version,
    channel: release.channel,
    notes: release.notes,
    status: release.status,
    published_at: release.published_at,
    created_at: release.created_at,
    revision: release.revision,
    artifacts: artifacts.map(artifactSummary),
  };
}

function isLoopbackHost(hostname: string): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(hostname);
}

function validateArtifactUrl(url: string, config: UpdaterConfig): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(400, "INVALID_ARTIFACT_URL", "Artifact URL is not a valid absolute URL.");
  }
  if (parsed.protocol === "https:") return;
  if (
    parsed.protocol === "http:" &&
    config.allowInsecureArtifactUrl &&
    isLoopbackHost(parsed.hostname)
  ) {
    return;
  }
  throw new AppError(
    400,
    "INSECURE_ARTIFACT_URL",
    "Artifact URL must use HTTPS. HTTP is accepted only for loopback development when explicitly enabled.",
  );
}

function validateSignature(signature: string): void {
  const trimmed = signature.trim();
  // Tauri v2's updater `.sig` is a single base64 blob. Older/minisign tooling
  // can emit the full multi-line "untrusted comment" form; accept both.
  const singleLine = trimmed.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && singleLine.length >= 80) {
    return;
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const base64Lines = lines.filter((line) => /^[A-Za-z0-9+/=]{40,}$/.test(line));
  if (lines.length >= 2 && base64Lines.length >= 2) {
    return;
  }
  throw new AppError(
    400,
    "INVALID_SIGNATURE",
    "Artifact signature must be the complete Tauri/minisign signature text (.sig), not a URL.",
  );
}

export function registerRelease(
  db: Database,
  config: UpdaterConfig,
  input: ReleaseRegistrationInput,
  actor: string,
  correlationId: string,
  now = new Date(),
): ReleaseRow {
  if (input.application !== config.applicationId) {
    throw new AppError(
      400,
      "APPLICATION_MISMATCH",
      "Release application does not match ORDERHUB_UPDATER_APP_ID.",
      { details: { expected: config.applicationId } },
    );
  }
  const duplicate = db
    .prepare(
      "SELECT release_id FROM releases WHERE application = ? AND version = ? AND channel = ?",
    )
    .get(input.application, input.version, input.channel) as { release_id: string } | undefined;
  if (duplicate) {
    throw new AppError(
      409,
      "RELEASE_VERSION_EXISTS",
      "This application, version and channel already has a release record.",
      { details: { release_id: duplicate.release_id } },
    );
  }
  const seen = new Set<string>();
  for (const artifact of input.artifacts) {
    const key = `${artifact.target}/${artifact.arch}/${artifact.installer}`;
    if (seen.has(key)) {
      throw new AppError(400, "DUPLICATE_ARTIFACT", `Duplicate artifact for ${key}.`);
    }
    seen.add(key);
    validateArtifactUrl(artifact.url, config);
    validateSignature(artifact.signature);
  }

  const releaseId = `rel_${randomUUID()}`;
  const nowIso = now.toISOString();
  const release: ReleaseRow = {
    release_id: releaseId,
    application: input.application,
    version: input.version,
    channel: input.channel,
    notes: input.notes,
    status: "draft",
    revision: 0,
    created_at: nowIso,
    updated_at: nowIso,
    published_at: null,
  };

  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO releases
         (release_id, application, version, channel, notes, status, revision, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, 'draft', 0, ?, ?, NULL)`,
    ).run(
      release.release_id,
      release.application,
      release.version,
      release.channel,
      release.notes,
      release.created_at,
      release.updated_at,
    );
    for (const artifact of input.artifacts) {
      db.prepare(
        `INSERT INTO artifacts
           (artifact_id, release_id, target, arch, installer, url, size, sha256, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `art_${randomUUID()}`,
        releaseId,
        artifact.target,
        artifact.arch,
        artifact.installer,
        artifact.url,
        artifact.size,
        artifact.sha256,
        artifact.signature,
        nowIso,
      );
    }
    writeAudit(
      db,
      {
        actor,
        action: "release.register",
        objectType: "release",
        objectId: releaseId,
        before: null,
        after: releaseAuditSummary(release, input.artifacts),
        correlationId,
      },
      now,
    );
  });
  return release;
}

async function assertArtifactReachable(artifact: ArtifactInput, config: UpdaterConfig): Promise<void> {
  if (!config.verifyArtifactUrl) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    let response = await fetch(artifact.url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(artifact.url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: controller.signal,
        redirect: "follow",
      });
      await response.body?.cancel();
    }
    if (!response.ok && response.status !== 206) {
      throw new AppError(503, "ARTIFACT_UNREACHABLE", "The artifact URL is not readable.", {
        details: { status: String(response.status) },
      });
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      503,
      "ARTIFACT_UNREACHABLE",
      "The artifact URL could not be read before publishing.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function loadReleaseOrThrow(db: Database, releaseId: string): Promise<ReleaseRow> {
  const release = db.prepare("SELECT * FROM releases WHERE release_id = ?").get(releaseId) as
    | ReleaseRow
    | undefined;
  if (!release) {
    throw new AppError(404, "RELEASE_NOT_FOUND", "Release not found.");
  }
  return release;
}

export async function publishRelease(
  db: Database,
  config: UpdaterConfig,
  releaseId: string,
  expectedRevision: number,
  actor: string,
  correlationId: string,
  now = new Date(),
): Promise<ReleaseRow> {
  const release = await loadReleaseOrThrow(db, releaseId);
  if (release.status === "published") {
    throw new AppError(409, "RELEASE_ALREADY_PUBLISHED", "Release is already published.");
  }
  if (release.status === "revoked") {
    throw new AppError(409, "RELEASE_REVOKED", "A revoked release cannot be published again.");
  }
  if (release.revision !== expectedRevision) {
    throw new AppError(409, "RELEASE_REVISION_CONFLICT", "Release changed since it was read.", {
      details: { current_revision: String(release.revision) },
    });
  }
  const artifacts = db
    .prepare("SELECT * FROM artifacts WHERE release_id = ?")
    .all(releaseId) as unknown as ArtifactInput[];
  if (artifacts.length === 0) {
    throw new AppError(409, "RELEASE_ARTIFACT_MISSING", "A release without artifacts cannot be published.");
  }
  for (const artifact of artifacts) {
    validateArtifactUrl(artifact.url, config);
    validateSignature(artifact.signature);
    await assertArtifactReachable(artifact, config);
  }

  const nowIso = now.toISOString();
  const before = releaseAuditSummary(release, artifacts);
  return withTransaction(db, () => {
    const result = db
      .prepare(
        `UPDATE releases
            SET status = 'published', revision = revision + 1, published_at = ?, updated_at = ?
          WHERE release_id = ? AND revision = ? AND status IN ('draft', 'paused')`,
      )
      .run(nowIso, nowIso, releaseId, expectedRevision);
    if (result.changes !== 1) {
      throw new AppError(409, "RELEASE_REVISION_CONFLICT", "Release changed concurrently.");
    }
    const updated = {
      ...release,
      status: "published" as ReleaseStatus,
      revision: release.revision + 1,
      published_at: nowIso,
      updated_at: nowIso,
    };
    writeAudit(
      db,
      {
        actor,
        action: "release.publish",
        objectType: "release",
        objectId: releaseId,
        before,
        after: releaseAuditSummary(updated, artifacts),
        correlationId,
      },
      now,
    );
    return updated;
  });
}

export function pauseRelease(
  db: Database,
  releaseId: string,
  expectedRevision: number,
  actor: string,
  correlationId: string,
  now = new Date(),
): ReleaseRow {
  const release = db.prepare("SELECT * FROM releases WHERE release_id = ?").get(releaseId) as
    | ReleaseRow
    | undefined;
  if (!release) throw new AppError(404, "RELEASE_NOT_FOUND", "Release not found.");
  if (release.status !== "published") {
    throw new AppError(409, "RELEASE_NOT_PUBLISHED", "Only a published release can be paused.");
  }
  if (release.revision !== expectedRevision) {
    throw new AppError(409, "RELEASE_REVISION_CONFLICT", "Release changed since it was read.", {
      details: { current_revision: String(release.revision) },
    });
  }
  const artifacts = db.prepare("SELECT * FROM artifacts WHERE release_id = ?").all(releaseId) as unknown as ArtifactInput[];
  const nowIso = now.toISOString();
  return withTransaction(db, () => {
    const result = db
      .prepare(
        `UPDATE releases
            SET status = 'paused', revision = revision + 1, updated_at = ?
          WHERE release_id = ? AND revision = ? AND status = 'published'`,
      )
      .run(nowIso, releaseId, expectedRevision);
    if (result.changes !== 1) {
      throw new AppError(409, "RELEASE_REVISION_CONFLICT", "Release changed concurrently.");
    }
    const updated = { ...release, status: "paused" as ReleaseStatus, revision: release.revision + 1, updated_at: nowIso };
    writeAudit(
      db,
      {
        actor,
        action: "release.pause",
        objectType: "release",
        objectId: releaseId,
        before: releaseAuditSummary(release, artifacts),
        after: releaseAuditSummary(updated, artifacts),
        correlationId,
      },
      now,
    );
    return updated;
  });
}

export function revokeRelease(
  db: Database,
  releaseId: string,
  expectedRevision: number,
  actor: string,
  correlationId: string,
  now = new Date(),
): ReleaseRow {
  const release = db.prepare("SELECT * FROM releases WHERE release_id = ?").get(releaseId) as
    | ReleaseRow
    | undefined;
  if (!release) throw new AppError(404, "RELEASE_NOT_FOUND", "Release not found.");
  if (release.status === "revoked") {
    throw new AppError(409, "RELEASE_ALREADY_REVOKED", "Release is already revoked.");
  }
  if (release.revision !== expectedRevision) {
    throw new AppError(409, "RELEASE_REVISION_CONFLICT", "Release changed since it was read.", {
      details: { current_revision: String(release.revision) },
    });
  }
  const artifacts = db.prepare("SELECT * FROM artifacts WHERE release_id = ?").all(releaseId) as unknown as ArtifactInput[];
  const nowIso = now.toISOString();
  return withTransaction(db, () => {
    const result = db
      .prepare(
        `UPDATE releases
            SET status = 'revoked', revision = revision + 1, updated_at = ?
          WHERE release_id = ? AND revision = ?`,
      )
      .run(nowIso, releaseId, expectedRevision);
    if (result.changes !== 1) {
      throw new AppError(409, "RELEASE_REVISION_CONFLICT", "Release changed concurrently.");
    }
    const updated = { ...release, status: "revoked" as ReleaseStatus, revision: release.revision + 1, updated_at: nowIso };
    writeAudit(
      db,
      {
        actor,
        action: "release.revoke",
        objectType: "release",
        objectId: releaseId,
        before: releaseAuditSummary(release, artifacts),
        after: releaseAuditSummary(updated, artifacts),
        correlationId,
      },
      now,
    );
    return updated;
  });
}

export interface ChannelPolicyInput {
  channel: UpdateChannel;
  expected_revision: number;
  rollout_release_id: string | null;
  min_supported_version: string | null;
  min_supported_effective_at: string | null;
  rollout_percent: number;
  valid_for_seconds: number;
}

function assertUpgradePathForMinimum(
  db: Database,
  application: string,
  channel: UpdateChannel,
  minVersion: string,
): void {
  for (const combo of SUPPORTED_COMBINATIONS) {
    const candidates = listCandidates(db, {
      application,
      channel,
      target: combo.target,
      arch: combo.arch,
      installer: combo.installer,
    });
    const hasPath = candidates.some((candidate) => semver.gte(candidate.release.version, minVersion));
    if (!hasPath) {
      throw new AppError(
        409,
        "MIN_VERSION_HAS_NO_UPGRADE_PATH",
        "A minimum supported version cannot be set without a published, compatible package at or above it.",
        { details: { target: combo.target, arch: combo.arch, installer: combo.installer } },
      );
    }
  }
}

export function updateChannelPolicy(
  db: Database,
  config: UpdaterConfig,
  input: ChannelPolicyInput,
  actor: string,
  correlationId: string,
  now = new Date(),
): { policy: PolicyRecord; validUntil: string } {
  const current = readPolicy(db, input.channel, {
    defaultValidForSeconds: config.policyDefaultValidForSeconds,
  });
  if (current.revision !== input.expected_revision) {
    throw new AppError(409, "POLICY_REVISION_CONFLICT", "Channel policy changed since it was read.", {
      details: { current_revision: String(current.revision) },
    });
  }
  if (input.rollout_release_id) {
    const rollout = db.prepare("SELECT * FROM releases WHERE release_id = ?").get(input.rollout_release_id) as
      | ReleaseRow
      | undefined;
    if (!rollout) {
      throw new AppError(404, "ROLLOUT_RELEASE_NOT_FOUND", "The rollout release was not found.");
    }
    if (rollout.channel !== input.channel) {
      throw new AppError(409, "ROLLOUT_RELEASE_CHANNEL_MISMATCH", "The rollout release belongs to another channel.");
    }
    if (rollout.status !== "published") {
      throw new AppError(409, "ROLLOUT_RELEASE_NOT_PUBLISHED", "Only a published release can be promoted.");
    }
  }
  if (input.min_supported_version) {
    assertUpgradePathForMinimum(db, config.applicationId, input.channel, input.min_supported_version);
  }
  const nowIso = now.toISOString();
  const before = {
    channel: current.channel,
    rollout_release_id: current.rollout_release_id,
    min_supported_version: current.min_supported_version,
    min_supported_effective_at: current.min_supported_effective_at,
    rollout_percent: current.rollout_percent,
    revision: current.revision,
    valid_for_seconds: current.valid_for_seconds,
  };
  const updated: PolicyRecord = {
    channel: input.channel,
    rollout_release_id: input.rollout_release_id,
    min_supported_version: input.min_supported_version,
    min_supported_effective_at: input.min_supported_version
      ? input.min_supported_effective_at ?? nowIso
      : null,
    rollout_percent: input.rollout_percent,
    revision: current.revision + 1,
    valid_for_seconds: input.valid_for_seconds,
    updated_at: nowIso,
  };

  withTransaction(db, () => {
    if (current.revision === 0) {
      db.prepare(
        `INSERT INTO channel_policies
           (channel, rollout_release_id, min_supported_version, min_supported_effective_at,
            rollout_percent, revision, valid_for_seconds, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        updated.channel,
        updated.rollout_release_id,
        updated.min_supported_version,
        updated.min_supported_effective_at,
        updated.rollout_percent,
        updated.valid_for_seconds,
        nowIso,
      );
    } else {
      const result = db
        .prepare(
          `UPDATE channel_policies
              SET rollout_release_id = ?, min_supported_version = ?, min_supported_effective_at = ?,
                  rollout_percent = ?, revision = revision + 1, valid_for_seconds = ?, updated_at = ?
            WHERE channel = ? AND revision = ?`,
        )
        .run(
          updated.rollout_release_id,
          updated.min_supported_version,
          updated.min_supported_effective_at,
          updated.rollout_percent,
          updated.valid_for_seconds,
          nowIso,
          updated.channel,
          current.revision,
        );
      if (result.changes !== 1) {
        throw new AppError(409, "POLICY_REVISION_CONFLICT", "Channel policy changed concurrently.");
      }
    }
    writeAudit(
      db,
      {
        actor,
        action: "channel_policy.update",
        objectType: "channel_policy",
        objectId: input.channel,
        before,
        after: updated,
        correlationId,
      },
      now,
    );
  });
  return { policy: updated, validUntil: addSeconds(now, updated.valid_for_seconds).toISOString() };
}
