import { z } from "zod";

/**
 * Shared schema for the OrderHub update service HTTP API (`/v1`).
 *
 * The update service and the release CLI both validate with these schemas.
 * Field names are snake_case on the wire because the updater response format
 * mandated by Tauri uses snake_case (`pub_date`).
 */

export const UPDATE_CHANNELS = ["stable", "beta"] as const;
export const updateChannelSchema = z.enum(UPDATE_CHANNELS);
export type UpdateChannel = z.infer<typeof updateChannelSchema>;

export const TARGETS = ["windows"] as const;
export const targetSchema = z.enum(TARGETS);
export type UpdateTarget = z.infer<typeof targetSchema>;

export const ARCHES = ["x86_64"] as const;
export const archSchema = z.enum(ARCHES);
export type UpdateArch = z.infer<typeof archSchema>;

export const INSTALLERS = ["nsis"] as const;
export const installerSchema = z.enum(INSTALLERS);
export type UpdateInstaller = z.infer<typeof installerSchema>;

export const semVerSchema = z
  .string()
  .min(5)
  .max(64)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    "must be a SemVer 2.0.0 version",
  );

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be lowercase SHA-256 hex");
export const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "must be a UUID",
  );
export const isoDateTimeSchema = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /T/.test(value);
}, "must be an RFC 3339 timestamp");
export const httpsUrlSchema = z.string().url().max(2048);

export const releaseArtifactSchema = z
  .object({
    target: targetSchema,
    arch: archSchema,
    installer: installerSchema,
    url: httpsUrlSchema,
    size: z.number().int().min(1).max(8 * 1024 * 1024 * 1024),
    sha256: sha256Schema,
    signature: z.string().min(40).max(16384),
  })
  .strict();

export const releaseRegistrationSchema = z
  .object({
    application: z.string().min(1).max(128),
    version: semVerSchema,
    channel: updateChannelSchema,
    notes: z.string().max(4000).default(""),
    artifacts: z.array(releaseArtifactSchema).min(1).max(4),
  })
  .strict();
export type ReleaseRegistration = z.infer<typeof releaseRegistrationSchema>;

export const releaseActionSchema = z
  .object({
    expected_revision: z.number().int().min(0),
  })
  .strict();
export type ReleaseAction = z.infer<typeof releaseActionSchema>;

export const channelPolicyUpdateSchema = z
  .object({
    expected_revision: z.number().int().min(0),
    rollout_release_id: z.string().min(1).max(128).nullable(),
    min_supported_version: semVerSchema.nullable(),
    min_supported_effective_at: isoDateTimeSchema.nullable(),
    rollout_percent: z.number().int().min(0).max(100),
    valid_for_seconds: z.number().int().min(300).max(7 * 24 * 3600),
  })
  .strict();
export type ChannelPolicyUpdate = z.infer<typeof channelPolicyUpdateSchema>;

export const releaseStatusSchema = z.enum(["draft", "published", "paused", "revoked"]);
export type ReleaseStatus = z.infer<typeof releaseStatusSchema>;

export const releaseArtifactSummarySchema = z
  .object({
    target: targetSchema,
    arch: archSchema,
    installer: installerSchema,
    url: httpsUrlSchema,
    size: z.number().int(),
    sha256: sha256Schema,
    signature: z.string(),
  })
  .strict();

export const releaseSummarySchema = z
  .object({
    release_id: z.string(),
    application: z.string(),
    version: semVerSchema,
    channel: updateChannelSchema,
    notes: z.string(),
    status: releaseStatusSchema,
    published_at: isoDateTimeSchema.nullable(),
    created_at: isoDateTimeSchema,
    revision: z.number().int().min(0),
    artifacts: z.array(releaseArtifactSummarySchema),
  })
  .strict();
export type ReleaseSummary = z.infer<typeof releaseSummarySchema>;

export const channelPolicyResponseSchema = z
  .object({
    channel: updateChannelSchema,
    policy_revision: z.number().int().min(0),
    rollout_release_id: z.string().nullable(),
    min_supported_version: semVerSchema.nullable(),
    min_supported_effective_at: isoDateTimeSchema.nullable(),
    rollout_percent: z.number().int().min(0).max(100),
    valid_until: isoDateTimeSchema,
    updated_at: isoDateTimeSchema.nullable(),
  })
  .strict();
export type ChannelPolicyResponse = z.infer<typeof channelPolicyResponseSchema>;

export const selectedReleaseSchema = z
  .object({
    release_id: z.string(),
    version: semVerSchema,
    notes: z.string(),
    pub_date: isoDateTimeSchema,
    download_url: httpsUrlSchema,
    size: z.number().int(),
    sha256: sha256Schema,
  })
  .strict();
export type SelectedRelease = z.infer<typeof selectedReleaseSchema>;

export const updatePolicyResponseSchema = z
  .object({
    policy_revision: z.number().int().min(0),
    channel: updateChannelSchema,
    target: targetSchema,
    arch: archSchema,
    installer: installerSchema,
    current_version: semVerSchema,
    min_supported_version: semVerSchema.nullable(),
    min_supported_effective_at: isoDateTimeSchema.nullable(),
    valid_until: isoDateTimeSchema,
    forced: z.boolean(),
    update_available: z.boolean(),
    selected_release: selectedReleaseSchema.nullable(),
    manual_install_required: z.boolean(),
    manual_install_url: httpsUrlSchema.nullable(),
    generated_at: isoDateTimeSchema,
  })
  .strict();
export type UpdatePolicyResponse = z.infer<typeof updatePolicyResponseSchema>;

/** Standard response understood by the Tauri updater plugin. */
export const tauriUpdateResponseSchema = z
  .object({
    version: semVerSchema,
    pub_date: isoDateTimeSchema,
    url: httpsUrlSchema,
    signature: z.string().min(40),
    notes: z.string(),
  })
  .strict();
export type TauriUpdateResponse = z.infer<typeof tauriUpdateResponseSchema>;

export const eligibilityResponseSchema = z
  .object({
    eligible: z.literal(true),
    release_id: z.string(),
    policy_revision: z.number().int().min(0),
    version: semVerSchema,
    pub_date: isoDateTimeSchema,
    url: httpsUrlSchema,
    signature: z.string().min(40),
    notes: z.string(),
    size: z.number().int(),
    sha256: sha256Schema,
  })
  .strict();
export type EligibilityResponse = z.infer<typeof eligibilityResponseSchema>;

export const apiErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlation_id: z.string().min(1),
    details: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

export const updateEventStageSchema = z.enum([
  "check",
  "download_started",
  "download_completed",
  "install_started",
  "start_confirmed",
  "failure",
]);
export type UpdateEventStage = z.infer<typeof updateEventStageSchema>;

export const updateEventSchema = z
  .object({
    event_id: uuidSchema,
    installation_id: uuidSchema,
    app_version: semVerSchema,
    channel: updateChannelSchema,
    target: targetSchema,
    arch: archSchema,
    installer: installerSchema,
    stage: updateEventStageSchema,
    error_category: z.string().min(1).max(64).nullable(),
    occurred_at: isoDateTimeSchema,
  })
  .strict();
export type UpdateEvent = z.infer<typeof updateEventSchema>;

export const updateEventAckSchema = z
  .object({
    accepted: z.literal(true),
    duplicate: z.boolean(),
  })
  .strict();

export const healthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("orderhub-updater"),
    time: isoDateTimeSchema,
  })
  .strict();

export const readyResponseSchema = z
  .object({
    status: z.enum(["ready", "not_ready"]),
    database: z.boolean(),
    artifact_store: z.boolean(),
    time: isoDateTimeSchema,
  })
  .strict();

export const apiPaths = {
  healthz: "/healthz",
  readyz: "/readyz",
  updatePolicy: (channel: string, target: string, arch: string, currentVersion: string) =>
    `/v1/update-policy/${encodeURIComponent(channel)}/${encodeURIComponent(target)}/${encodeURIComponent(arch)}/${encodeURIComponent(currentVersion)}`,
  updates: (channel: string, target: string, arch: string, currentVersion: string) =>
    `/v1/updates/${encodeURIComponent(channel)}/${encodeURIComponent(target)}/${encodeURIComponent(arch)}/${encodeURIComponent(currentVersion)}`,
  eligibility: (releaseId: string) => `/v1/releases/${encodeURIComponent(releaseId)}/eligibility`,
  updateEvents: "/v1/update-events",
  adminReleases: "/v1/admin/releases",
  adminRelease: (releaseId: string) => `/v1/admin/releases/${encodeURIComponent(releaseId)}`,
  adminPublish: (releaseId: string) => `/v1/admin/releases/${encodeURIComponent(releaseId)}/publish`,
  adminPause: (releaseId: string) => `/v1/admin/releases/${encodeURIComponent(releaseId)}/pause`,
  adminRevoke: (releaseId: string) => `/v1/admin/releases/${encodeURIComponent(releaseId)}/revoke`,
  adminChannelPolicy: (channel: string) => `/v1/admin/channels/${encodeURIComponent(channel)}/policy`,
} as const;
