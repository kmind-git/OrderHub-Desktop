import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  apiErrorSchema,
  channelPolicyResponseSchema,
  channelPolicyUpdateSchema,
  eligibilityResponseSchema,
  healthResponseSchema,
  readyResponseSchema,
  releaseActionSchema,
  releaseRegistrationSchema,
  releaseSummarySchema,
  tauriUpdateResponseSchema,
  updateEventAckSchema,
  updateEventSchema,
  updatePolicyResponseSchema,
} from "./update-api.js";

const schemaEntries = {
  ApiError: apiErrorSchema,
  ChannelPolicyResponse: channelPolicyResponseSchema,
  ChannelPolicyUpdate: channelPolicyUpdateSchema,
  EligibilityResponse: eligibilityResponseSchema,
  HealthResponse: healthResponseSchema,
  ReadyResponse: readyResponseSchema,
  ReleaseAction: releaseActionSchema,
  ReleaseRegistration: releaseRegistrationSchema,
  ReleaseSummary: releaseSummarySchema,
  TauriUpdateResponse: tauriUpdateResponseSchema,
  UpdateEvent: updateEventSchema,
  UpdateEventAck: updateEventAckSchema,
  UpdatePolicyResponse: updatePolicyResponseSchema,
} as const;

function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output") {
  return z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io,
    unrepresentable: "any",
  });
}

const components = Object.fromEntries(
  Object.entries(schemaEntries).map(([name, schema]) => [name, jsonSchema(schema)]),
);

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const errorResponses = {
  "400": {
    description: "Invalid request",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "401": {
    description: "Missing or invalid admin credential",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "404": {
    description: "Object not found",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "409": {
    description: "Policy changed, revision conflict or release state conflict",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "429": {
    description: "Rate limit exceeded",
    content: { "application/json": { schema: ref("ApiError") } },
  },
  "503": {
    description: "Update service, policy or artifact store is unavailable",
    content: { "application/json": { schema: ref("ApiError") } },
  },
} as const;

const pathParameters = {
  channel: { name: "channel", in: "path", required: true, schema: { type: "string", enum: ["stable", "beta"] } },
  target: { name: "target", in: "path", required: true, schema: { type: "string", enum: ["windows"] } },
  arch: { name: "arch", in: "path", required: true, schema: { type: "string", enum: ["x86_64"] } },
  currentVersion: {
    name: "currentVersion",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "SemVer reported by the native layer, never taken from the WebView.",
  },
  releaseId: { name: "releaseId", in: "path", required: true, schema: { type: "string" } },
} as const;

const installationHeader = {
  name: "X-Installation-ID",
  in: "header",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "Random installation identifier persisted by the native layer.",
} as const;

const installerQuery = {
  name: "installer",
  in: "query",
  required: true,
  schema: { type: "string", enum: ["nsis"] },
} as const;

const policyQuery = {
  name: "policy_revision",
  in: "query",
  required: true,
  schema: { type: "integer", minimum: 0 },
  description: "Revision pinned from the last policy response.",
} as const;

const releaseIdQuery = {
  name: "release_id",
  in: "query",
  required: true,
  schema: { type: "string" },
  description: "Release id pinned from the last policy response.",
} as const;

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "OrderHub Update Service API",
    version: "1.0.0",
    description:
      "Version policy, Tauri updater responses, install eligibility and release administration. Management endpoints require a Bearer token and are only reachable from a controlled network.",
  },
  servers: [{ url: "https://updates.example.com", description: "Replace with the deployment URL" }],
  tags: [
    { name: "Health" },
    { name: "Client" },
    { name: "Admin" },
  ],
  paths: {
    "/healthz": {
      get: {
        tags: ["Health"],
        summary: "Liveness probe",
        responses: {
          "200": { description: "Process is alive", content: { "application/json": { schema: ref("HealthResponse") } } },
        },
      },
    },
    "/readyz": {
      get: {
        tags: ["Health"],
        summary: "Readiness probe",
        responses: {
          "200": { description: "Database and artifact store are usable", content: { "application/json": { schema: ref("ReadyResponse") } } },
          "503": { description: "Not ready", content: { "application/json": { schema: ref("ReadyResponse") } } },
        },
      },
    },
    "/v1/update-policy/{channel}/{target}/{arch}/{currentVersion}": {
      get: {
        tags: ["Client"],
        summary: "Get the current channel policy and pinned release selection",
        parameters: [
          pathParameters.channel,
          pathParameters.target,
          pathParameters.arch,
          pathParameters.currentVersion,
          installationHeader,
          installerQuery,
        ],
        responses: {
          "200": { description: "Policy response", content: { "application/json": { schema: ref("UpdatePolicyResponse") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/updates/{channel}/{target}/{arch}/{currentVersion}": {
      get: {
        tags: ["Client"],
        summary: "Tauri updater check endpoint",
        description:
          "Returns 204 when no update is selected. The release_id and policy_revision must match the pinned policy context.",
        parameters: [
          pathParameters.channel,
          pathParameters.target,
          pathParameters.arch,
          pathParameters.currentVersion,
          installationHeader,
          installerQuery,
          releaseIdQuery,
          policyQuery,
        ],
        responses: {
          "200": { description: "Standard Tauri dynamic update response", content: { "application/json": { schema: ref("TauriUpdateResponse") } } },
          "204": { description: "No update selected for this client" },
          ...errorResponses,
        },
      },
    },
    "/v1/releases/{releaseId}/eligibility": {
      get: {
        tags: ["Client"],
        summary: "Re-confirm install eligibility immediately before installation",
        parameters: [
          pathParameters.releaseId,
          installationHeader,
          installerQuery,
          { name: "channel", in: "query", required: true, schema: { type: "string", enum: ["stable", "beta"] } },
          { name: "target", in: "query", required: true, schema: { type: "string", enum: ["windows"] } },
          { name: "arch", in: "query", required: true, schema: { type: "string", enum: ["x86_64"] } },
          { name: "current_version", in: "query", required: true, schema: { type: "string" } },
          policyQuery,
        ],
        responses: {
          "200": { description: "Release is still installable", content: { "application/json": { schema: ref("EligibilityResponse") } } },
          "410": { description: "Release paused or revoked", content: { "application/json": { schema: ref("ApiError") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/update-events": {
      post: {
        tags: ["Client"],
        summary: "Report a short update lifecycle event (idempotent, rate limited)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("UpdateEvent") } },
        },
        responses: {
          "202": { description: "Event accepted or deduplicated", content: { "application/json": { schema: ref("UpdateEventAck") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/admin/releases": {
      post: {
        tags: ["Admin"],
        summary: "Register a built release as a draft",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("ReleaseRegistration") } },
        },
        responses: {
          "201": { description: "Draft release registered", content: { "application/json": { schema: ref("ReleaseSummary") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/admin/releases/{releaseId}/publish": {
      post: {
        tags: ["Admin"],
        summary: "Publish a draft or paused release",
        security: [{ bearerAuth: [] }],
        parameters: [pathParameters.releaseId],
        requestBody: { required: true, content: { "application/json": { schema: ref("ReleaseAction") } } },
        responses: {
          "200": { description: "Published", content: { "application/json": { schema: ref("ReleaseSummary") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/admin/releases/{releaseId}/pause": {
      post: {
        tags: ["Admin"],
        summary: "Pause distribution of a release",
        security: [{ bearerAuth: [] }],
        parameters: [pathParameters.releaseId],
        requestBody: { required: true, content: { "application/json": { schema: ref("ReleaseAction") } } },
        responses: {
          "200": { description: "Paused", content: { "application/json": { schema: ref("ReleaseSummary") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/admin/releases/{releaseId}/revoke": {
      post: {
        tags: ["Admin"],
        summary: "Revoke a release permanently",
        security: [{ bearerAuth: [] }],
        parameters: [pathParameters.releaseId],
        requestBody: { required: true, content: { "application/json": { schema: ref("ReleaseAction") } } },
        responses: {
          "200": { description: "Revoked", content: { "application/json": { schema: ref("ReleaseSummary") } } },
          ...errorResponses,
        },
      },
    },
    "/v1/admin/channels/{channel}/policy": {
      put: {
        tags: ["Admin"],
        summary: "Update rollout and minimum-supported-version policy (revision checked)",
        security: [{ bearerAuth: [] }],
        parameters: [pathParameters.channel],
        requestBody: { required: true, content: { "application/json": { schema: ref("ChannelPolicyUpdate") } } },
        responses: {
          "200": { description: "Updated policy", content: { "application/json": { schema: ref("ChannelPolicyResponse") } } },
          ...errorResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: components,
  },
};

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../openapi/updater.v1.json");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(openapi, null, 2)}\n`, "utf8");
console.log(`wrote ${target}`);
