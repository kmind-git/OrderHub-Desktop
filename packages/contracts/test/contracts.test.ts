import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  channelPolicyUpdateSchema,
  releaseRegistrationSchema,
  tauriUpdateResponseSchema,
  updateEventSchema,
  updatePolicyResponseSchema,
} from "../src/index.js";

const signature = `untrusted comment: signature from tauri secret key\n${Buffer.alloc(64, 7).toString("base64")}\ntrusted comment: timestamp:1700000000\tfile:setup.exe\n${Buffer.alloc(64, 9).toString("base64")}`;

const registration = {
  application: "com.orderhub.desktop",
  version: "0.2.0",
  channel: "beta",
  notes: "修复连接恢复",
  artifacts: [
    {
      target: "windows",
      arch: "x86_64",
      installer: "nsis",
      url: "https://updates.example.com/artifacts/0.2.0/windows-x86_64/setup.exe",
      size: 1024,
      sha256: "a".repeat(64),
      signature,
    },
  ],
};

describe("update API schemas", () => {
  it("accepts a complete release registration", () => {
    expect(releaseRegistrationSchema.parse(registration).version).toBe("0.2.0");
  });

  it("rejects unknown fields on admin input", () => {
    expect(() =>
      releaseRegistrationSchema.parse({ ...registration, unexpected: true }),
    ).toThrow();
  });

  it("rejects invalid SHA-256 and SemVer values", () => {
    const badHash = structuredClone(registration);
    badHash.artifacts[0]!.sha256 = "ABC";
    expect(() => releaseRegistrationSchema.parse(badHash)).toThrow();
    const badVersion = structuredClone(registration);
    badVersion.version = "1.0";
    expect(() => releaseRegistrationSchema.parse(badVersion)).toThrow();
  });

  it("accepts the Tauri updater response shape", () => {
    const parsed = tauriUpdateResponseSchema.parse({
      version: "0.2.0",
      pub_date: "2026-10-19T08:00:00Z",
      url: "https://updates.example.com/artifacts/0.2.0/windows-x86_64/setup.exe",
      signature,
      notes: "notes",
    });
    expect(parsed.version).toBe("0.2.0");
  });

  it("validates policy revision and rollout fields", () => {
    const policy = {
      expected_revision: 3,
      rollout_release_id: "rel_123",
      min_supported_version: "0.1.0",
      min_supported_effective_at: "2026-10-20T00:00:00Z",
      rollout_percent: 25,
      valid_for_seconds: 3600,
    };
    expect(channelPolicyUpdateSchema.parse(policy).rollout_percent).toBe(25);
    expect(() => channelPolicyUpdateSchema.parse({ ...policy, rollout_percent: 101 })).toThrow();
  });

  it("validates the policy response", () => {
    const parsed = updatePolicyResponseSchema.parse({
      policy_revision: 3,
      channel: "beta",
      target: "windows",
      arch: "x86_64",
      installer: "nsis",
      current_version: "0.1.0",
      min_supported_version: "0.1.0",
      min_supported_effective_at: null,
      valid_until: "2026-10-20T00:00:00Z",
      forced: false,
      update_available: true,
      selected_release: {
        release_id: "rel_123",
        version: "0.2.0",
        notes: "notes",
        pub_date: "2026-10-19T08:00:00Z",
        download_url: "https://updates.example.com/artifacts/0.2.0/windows-x86_64/setup.exe",
        size: 1024,
        sha256: "b".repeat(64),
      },
      manual_install_required: false,
      manual_install_url: null,
      generated_at: "2026-10-19T08:00:00Z",
    });
    expect(parsed.update_available).toBe(true);
  });

  it("rejects business payloads in update events", () => {
    const event = {
      event_id: "8f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c",
      installation_id: "6f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c",
      app_version: "0.1.0",
      channel: "stable",
      target: "windows",
      arch: "x86_64",
      installer: "nsis",
      stage: "check",
      error_category: null,
      occurred_at: "2026-10-19T08:00:00Z",
    };
    expect(updateEventSchema.parse(event).stage).toBe("check");
    expect(() => updateEventSchema.parse({ ...event, order_id: "O-1" })).toThrow();
  });

  it("keeps the generated OpenAPI document in sync with route constants", async () => {
    const doc = JSON.parse(
      await readFile(new URL("../openapi/updater.v1.json", import.meta.url), "utf8"),
    ) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toContain("/v1/update-policy/{channel}/{target}/{arch}/{currentVersion}");
    expect(Object.keys(doc.paths)).toContain("/v1/admin/channels/{channel}/policy");
  });
});
