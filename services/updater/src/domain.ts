import { createHash } from "node:crypto";
import semver from "semver";
import type { Database } from "./db.js";

export type UpdateChannel = "stable" | "beta";
export type ReleaseStatus = "draft" | "published" | "paused" | "revoked";

export interface PolicyRecord {
  channel: UpdateChannel;
  rollout_release_id: string | null;
  min_supported_version: string | null;
  min_supported_effective_at: string | null;
  rollout_percent: number;
  revision: number;
  valid_for_seconds: number;
  updated_at: string | null;
}

export interface ArtifactRecord {
  artifact_id: string;
  release_id: string;
  target: string;
  arch: string;
  installer: string;
  url: string;
  size: number;
  sha256: string;
  signature: string;
  created_at: string;
}

export interface ReleaseRow {
  release_id: string;
  application: string;
  version: string;
  channel: UpdateChannel;
  notes: string;
  status: ReleaseStatus;
  revision: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface Candidate {
  release: ReleaseRow;
  artifact: ArtifactRecord;
}

export interface ChannelPolicyDefaults {
  defaultValidForSeconds: number;
}

export function readPolicy(
  db: Database,
  channel: UpdateChannel,
  defaults: ChannelPolicyDefaults,
): PolicyRecord {
  const row = db.prepare("SELECT * FROM channel_policies WHERE channel = ?").get(channel) as
    | {
        channel: UpdateChannel;
        rollout_release_id: string | null;
        min_supported_version: string | null;
        min_supported_effective_at: string | null;
        rollout_percent: number;
        revision: number;
        valid_for_seconds: number;
        updated_at: string;
      }
    | undefined;
  if (!row) {
    return {
      channel,
      rollout_release_id: null,
      min_supported_version: null,
      min_supported_effective_at: null,
      rollout_percent: 0,
      revision: 0,
      valid_for_seconds: defaults.defaultValidForSeconds,
      updated_at: null,
    };
  }
  return row;
}

export function readRelease(db: Database, releaseId: string): ReleaseRow | null {
  const row = db.prepare("SELECT * FROM releases WHERE release_id = ?").get(releaseId) as
    | ReleaseRow
    | undefined;
  return row ?? null;
}

export function readArtifacts(db: Database, releaseId: string): ArtifactRecord[] {
  return db
    .prepare("SELECT * FROM artifacts WHERE release_id = ? ORDER BY target, arch, installer")
    .all(releaseId) as unknown as ArtifactRecord[];
}

export function listCandidates(
  db: Database,
  input: {
    application: string;
    channel: UpdateChannel;
    target: string;
    arch: string;
    installer: string;
  },
): Candidate[] {
  const rows = db
    .prepare(
      `SELECT
         r.release_id, r.application, r.version, r.channel, r.notes, r.status,
         r.revision, r.created_at, r.updated_at, r.published_at,
         a.artifact_id, a.target, a.arch, a.installer, a.url, a.size,
         a.sha256, a.signature, a.created_at AS artifact_created_at
       FROM releases r
       JOIN artifacts a ON a.release_id = r.release_id
       WHERE r.application = ?
         AND r.channel = ?
         AND r.status = 'published'
         AND a.target = ?
         AND a.arch = ?
         AND a.installer = ?
       ORDER BY r.created_at DESC`,
    )
    .all(input.application, input.channel, input.target, input.arch, input.installer) as unknown as Array<
    ReleaseRow & {
      artifact_id: string;
      target: string;
      arch: string;
      installer: string;
      url: string;
      size: number;
      sha256: string;
      signature: string;
      artifact_created_at: string;
    }
  >;

  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (!semver.valid(row.version)) continue;
    candidates.push({
      release: {
        release_id: row.release_id,
        application: row.application,
        version: row.version,
        channel: row.channel,
        notes: row.notes,
        status: row.status,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
        published_at: row.published_at,
      },
      artifact: {
        artifact_id: row.artifact_id,
        release_id: row.release_id,
        target: row.target,
        arch: row.arch,
        installer: row.installer,
        url: row.url,
        size: row.size,
        sha256: row.sha256,
        signature: row.signature,
        created_at: row.artifact_created_at,
      },
    });
  }
  candidates.sort((a, b) => semver.rcompare(a.release.version, b.release.version));
  return candidates;
}

export function rolloutBucket(releaseId: string, installationId: string): number {
  const digest = createHash("sha256")
    .update(releaseId, "utf8")
    .update("\0", "utf8")
    .update(installationId, "utf8")
    .digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function rolloutEligible(
  releaseId: string,
  installationId: string,
  percent: number,
): boolean {
  if (percent >= 100) return true;
  if (percent <= 0) return false;
  return rolloutBucket(releaseId, installationId) < percent * 100;
}

export type SelectionResult =
  | { kind: "none"; reason: "no_candidate" | "already_current" | "not_rolled_out" }
  | { kind: "selected"; candidate: Candidate; forced: boolean }
  | { kind: "forced_unavailable"; minVersion: string };

export interface SelectionInput {
  currentVersion: string;
  installationId: string;
  candidates: Candidate[];
  policy: PolicyRecord;
  now: Date;
}

export function selectRelease(input: SelectionInput): SelectionResult {
  const { currentVersion, candidates, policy, installationId, now } = input;
  if (!semver.valid(currentVersion)) {
    throw new Error(`invalid current version: ${currentVersion}`);
  }
  const min = policy.min_supported_version;
  const effectiveAt = policy.min_supported_effective_at
    ? new Date(policy.min_supported_effective_at)
    : null;
  const minActive = Boolean(
    min && semver.valid(min) && (!effectiveAt || Number.isNaN(effectiveAt.getTime()) || now >= effectiveAt),
  );
  const forced = Boolean(minActive && min && semver.lt(currentVersion, min));

  if (forced && min) {
    // A forced minimum must be backed by a published package at or above the
    // minimum. If there is none, the service reports an explicit recovery
    // error instead of pretending the client is current.
    const rescue = candidates.find(
      (candidate) => semver.valid(candidate.release.version) && semver.gte(candidate.release.version, min),
    );
    if (!rescue) {
      return { kind: "forced_unavailable", minVersion: min };
    }
    return { kind: "selected", candidate: rescue, forced: true };
  }

  // No promoted release means the channel has no active distribution. A
  // published package alone is not enough: release management must explicitly
  // promote it through the channel policy.
  if (!policy.rollout_release_id) {
    return { kind: "none", reason: "no_candidate" };
  }

  const applicable = candidates.filter(
    (candidate) => semver.valid(candidate.release.version) && semver.gt(candidate.release.version, currentVersion),
  );
  if (applicable.length === 0) {
    return { kind: "none", reason: "already_current" };
  }

  let sawRolloutExclusion = false;
  for (const candidate of applicable) {
    const isPromotion = policy.rollout_release_id === candidate.release.release_id;
    if (isPromotion && !rolloutEligible(candidate.release.release_id, installationId, policy.rollout_percent)) {
      sawRolloutExclusion = true;
      continue;
    }
    // Non-promotion releases remain available as a fallback. This lets a
    // client that is not yet in the rollout cohort still receive a supported
    // older build when one exists.
    return { kind: "selected", candidate, forced: false };
  }
  return { kind: "none", reason: sawRolloutExclusion ? "not_rolled_out" : "no_candidate" };
}

export function toIso(value: Date): string {
  return value.toISOString();
}

export function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000);
}
