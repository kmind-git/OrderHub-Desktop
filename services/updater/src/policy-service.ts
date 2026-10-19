import type { UpdatePolicyResponse } from "@orderhub/contracts";
import semver from "semver";
import type { Database } from "./db.js";
import type { UpdaterConfig } from "./config.js";
import type { PolicyRecord, SelectionResult, UpdateChannel } from "./domain.js";
import { addSeconds, listCandidates, readPolicy, selectRelease } from "./domain.js";
import { AppError } from "./errors.js";

export interface PolicyContext {
  channel: UpdateChannel;
  target: "windows";
  arch: "x86_64";
  installer: "nsis";
  currentVersion: string;
  installationId: string;
  now?: Date;
}

export interface ResolvedPolicy {
  policy: PolicyRecord;
  response: UpdatePolicyResponse;
  selection: SelectionResult;
}

export function resolvePolicy(
  db: Database,
  config: UpdaterConfig,
  context: PolicyContext,
): ResolvedPolicy {
  if (!semver.valid(context.currentVersion)) {
    throw new AppError(400, "INVALID_VERSION", "currentVersion must be a SemVer version.");
  }
  const now = context.now ?? new Date();
  const policy = readPolicy(db, context.channel, {
    defaultValidForSeconds: config.policyDefaultValidForSeconds,
  });
  const candidates = listCandidates(db, {
    application: config.applicationId,
    channel: context.channel,
    target: context.target,
    arch: context.arch,
    installer: context.installer,
  });
  const selection = selectRelease({
    currentVersion: context.currentVersion,
    installationId: context.installationId,
    candidates,
    policy,
    now,
  });

  if (selection.kind === "forced_unavailable") {
    throw new AppError(
      503,
      "FORCED_UPDATE_UNAVAILABLE",
      "This version is below the minimum supported version, but no compatible rescue package is available. Do not continue trading; install a trusted package manually or contact the deployment team.",
      {
        details: {
          min_supported_version: selection.minVersion,
          ...(config.supportUrl ? { support_url: config.supportUrl } : {}),
        },
      },
    );
  }

  const selected = selection.kind === "selected" ? selection : null;
  const response: UpdatePolicyResponse = {
    policy_revision: policy.revision,
    channel: context.channel,
    target: context.target,
    arch: context.arch,
    installer: context.installer,
    current_version: context.currentVersion,
    min_supported_version: policy.min_supported_version,
    min_supported_effective_at: policy.min_supported_effective_at,
    valid_until: addSeconds(now, policy.valid_for_seconds).toISOString(),
    forced: selected?.forced ?? false,
    update_available: Boolean(selected),
    selected_release: selected
      ? {
          release_id: selected.candidate.release.release_id,
          version: selected.candidate.release.version,
          notes: selected.candidate.release.notes,
          pub_date: selected.candidate.release.published_at ?? selected.candidate.release.created_at,
          download_url: selected.candidate.artifact.url,
          size: selected.candidate.artifact.size,
          sha256: selected.candidate.artifact.sha256,
        }
      : null,
    manual_install_required: false,
    manual_install_url: null,
    generated_at: now.toISOString(),
  };
  return { policy, response, selection };
}

export function assertPinnedSelection(
  resolved: ResolvedPolicy,
  pinnedReleaseId: string,
  pinnedRevision: number,
): Exclude<SelectionResult, { kind: "forced_unavailable" }> {
  if (resolved.policy.revision !== pinnedRevision) {
    throw new AppError(
      409,
      "POLICY_CHANGED",
      "The channel policy changed after it was read. Fetch the policy again before continuing.",
      { details: { current_revision: String(resolved.policy.revision) } },
    );
  }
  if (resolved.selection.kind !== "selected") {
    throw new AppError(
      409,
      "RELEASE_NOT_SELECTED",
      "The pinned release is no longer selected for this client.",
      { details: { current_revision: String(resolved.policy.revision) } },
    );
  }
  if (resolved.selection.candidate.release.release_id !== pinnedReleaseId) {
    throw new AppError(
      409,
      "RELEASE_NOT_SELECTED",
      "The pinned release is no longer selected for this client.",
      {
        details: {
          current_revision: String(resolved.policy.revision),
          selected_release_id: resolved.selection.candidate.release.release_id,
        },
      },
    );
  }
  return resolved.selection;
}
