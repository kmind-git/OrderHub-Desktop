import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UpdaterConfig } from "../src/config.js";
import { closeDatabase, openDatabase, type Database } from "../src/db.js";

const ADMIN_TOKEN = "test-admin-token-very-long-and-random";
const INSTALLATION_ID = "6f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c";
const OTHER_INSTALLATION_ID = "8f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c";
const APPLICATION = "com.orderhub.desktop";
const SIGNATURE = `untrusted comment: signature from tauri secret key\n${Buffer.alloc(64, 7).toString("base64")}\ntrusted comment: timestamp:1700000000\tfile:setup.exe\n${Buffer.alloc(64, 9).toString("base64")}`;

function testConfig(root: string, overrides: Partial<UpdaterConfig> = {}): UpdaterConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    dbPath: join(root, "updater.sqlite3"),
    artifactRoot: join(root, "artifacts"),
    publicArtifactBaseUrl: "https://updates.example.com/artifacts",
    adminToken: ADMIN_TOKEN,
    adminActor: "test-admin",
    applicationId: APPLICATION,
    serveArtifacts: true,
    verifyArtifactUrl: false,
    allowInsecureArtifactUrl: false,
    signingPublicKey: null,
    eventRetentionDays: 30,
    policyDefaultValidForSeconds: 3600,
    supportUrl: "https://support.example.com/orderhub",
    trustProxy: false,
    ...overrides,
  };
}

function registration(version = "0.2.0", channel = "beta") {
  return {
    application: APPLICATION,
    version,
    channel,
    notes: `Release ${version}`,
    artifacts: [
      {
        target: "windows",
        arch: "x86_64",
        installer: "nsis",
        url: `https://updates.example.com/artifacts/${version}/windows-x86_64/setup.exe`,
        size: 12_345_678,
        sha256: "a".repeat(64),
        signature: SIGNATURE,
      },
    ],
  };
}

function policyBody(overrides: Record<string, unknown> = {}) {
  return {
    expected_revision: 0,
    rollout_release_id: null,
    min_supported_version: null,
    min_supported_effective_at: null,
    rollout_percent: 100,
    valid_for_seconds: 3600,
    ...overrides,
  };
}

describe("update service", () => {
  let root: string;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let config: UpdaterConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "orderhub-updater-test-"));
    config = testConfig(root);
    db = openDatabase(config.dbPath);
    app = createApp({ db, config });
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(root, { recursive: true, force: true });
  });

  const admin = (body: unknown, path: string, method = "POST") =>
    app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const clientHeaders = { "x-installation-id": INSTALLATION_ID };

  async function createPublishedRelease(version = "0.2.0", channel = "beta") {
    const registered = await admin(registration(version, channel), "/v1/admin/releases");
    expect(registered.status).toBe(201);
    const release = (await registered.json()) as { release_id: string; revision: number };
    const published = await admin(
      { expected_revision: release.revision },
      `/v1/admin/releases/${release.release_id}/publish`,
    );
    expect(published.status).toBe(200);
    return (await published.json()) as { release_id: string; revision: number };
  }

  async function setPolicy(
    channel: string,
    expectedRevision: number,
    overrides: Record<string, unknown> = {},
  ) {
    return admin(
      policyBody({ expected_revision: expectedRevision, ...overrides }),
      `/v1/admin/channels/${channel}/policy`,
      "PUT",
    );
  }

  async function getPolicy(
    version = "0.1.0",
    channel = "beta",
    installationId = INSTALLATION_ID,
  ) {
    return app.request(
      `/v1/update-policy/${channel}/windows/x86_64/${version}?installer=nsis`,
      { headers: { "x-installation-id": installationId } },
    );
  }

  it("reports liveness and readiness", async () => {
    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
    expect((await health.json()) as { status: string }).toMatchObject({ status: "ok" });
    const ready = await app.request("/readyz");
    expect(ready.status).toBe(200);
    expect((await ready.json()) as { status: string }).toMatchObject({ status: "ready" });
  });

  it("requires admin authentication and marks cache-control on client responses", async () => {
    const unauthorized = await app.request("/v1/admin/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registration()),
    });
    expect(unauthorized.status).toBe(401);
    const response = await app.request(
      "/v1/update-policy/beta/windows/x86_64/0.1.0?installer=nsis",
      { headers: clientHeaders },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      policy_revision: number;
      update_available: boolean;
      selected_release: unknown;
    };
    expect(body.policy_revision).toBe(0);
    expect(body.update_available).toBe(false);
    expect(body.selected_release).toBeNull();
  });

  it("registers, publishes and serves a beta release with a pinned policy", async () => {
    const release = await createPublishedRelease("0.2.0", "beta");
    const policyResponse = await setPolicy("beta", 0, {
      rollout_release_id: release.release_id,
      rollout_percent: 100,
    });
    expect(policyResponse.status).toBe(200);
    const policy = await getPolicy("0.1.0");
    const policyJson = (await policy.json()) as {
      policy_revision: number;
      update_available: boolean;
      forced: boolean;
      selected_release: { release_id: string; version: string } | null;
    };
    expect(policyJson.update_available).toBe(true);
    expect(policyJson.forced).toBe(false);
    expect(policyJson.selected_release?.release_id).toBe(release.release_id);

    const update = await app.request(
      `/v1/updates/beta/windows/x86_64/0.1.0?installer=nsis&release_id=${release.release_id}&policy_revision=${policyJson.policy_revision}`,
      { headers: clientHeaders },
    );
    expect(update.status).toBe(200);
    const updateJson = (await update.json()) as { version: string; signature: string; url: string };
    expect(updateJson.version).toBe("0.2.0");
    expect(updateJson.signature).toContain("untrusted comment");

    const eligibility = await app.request(
      `/v1/releases/${release.release_id}/eligibility?channel=beta&target=windows&arch=x86_64&current_version=0.1.0&installer=nsis&policy_revision=${policyJson.policy_revision}`,
      { headers: clientHeaders },
    );
    expect(eligibility.status).toBe(200);
    expect(((await eligibility.json()) as { eligible: boolean }).eligible).toBe(true);
  });

  it("returns 204 when there is no update and 409 on a stale policy revision", async () => {
    const release = await createPublishedRelease();
    const noUpdate = await app.request(
      `/v1/updates/beta/windows/x86_64/0.1.0?installer=nsis&release_id=${release.release_id}&policy_revision=0`,
      { headers: clientHeaders },
    );
    expect(noUpdate.status).toBe(204);

    const updated = await setPolicy("beta", 0, { rollout_release_id: release.release_id });
    expect(updated.status).toBe(200);
    const stale = await app.request(
      `/v1/updates/beta/windows/x86_64/0.1.0?installer=nsis&release_id=${release.release_id}&policy_revision=0`,
      { headers: clientHeaders },
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe("POLICY_CHANGED");
  });

  it("enforces stable/beta separation and rollout buckets", async () => {
    const betaRelease = await createPublishedRelease("0.2.0", "beta");
    const stablePolicy = await getPolicy("0.1.0", "stable");
    expect(((await stablePolicy.json()) as { update_available: boolean }).update_available).toBe(false);

    await setPolicy("beta", 0, { rollout_release_id: betaRelease.release_id, rollout_percent: 0 });
    const excluded = (await (await getPolicy("0.1.0", "beta")).json()) as {
      update_available: boolean;
      policy_revision: number;
    };
    expect(excluded.update_available).toBe(false);
    expect(excluded.policy_revision).toBe(1);

    await setPolicy("beta", 1, { rollout_release_id: betaRelease.release_id, rollout_percent: 100 });
    const included = (await (await getPolicy("0.1.0", "beta", OTHER_INSTALLATION_ID)).json()) as {
      update_available: boolean;
    };
    expect(included.update_available).toBe(true);
  });

  it("forces a minimum version past rollout and blocks when no rescue path exists", async () => {
    const release = await createPublishedRelease("0.2.0");
    const policy = await setPolicy("beta", 0, {
      rollout_release_id: release.release_id,
      rollout_percent: 0,
      min_supported_version: "0.2.0",
      min_supported_effective_at: "2020-01-01T00:00:00Z",
    });
    expect(policy.status).toBe(200);
    const forced = (await (await getPolicy("0.1.0")).json()) as {
      forced: boolean;
      update_available: boolean;
    };
    expect(forced.forced).toBe(true);
    expect(forced.update_available).toBe(true);

    const noPath = await setPolicy("beta", 1, {
      rollout_release_id: release.release_id,
      rollout_percent: 0,
      min_supported_version: "0.3.0",
      min_supported_effective_at: "2020-01-01T00:00:00Z",
    });
    expect(noPath.status).toBe(409);
    expect(((await noPath.json()) as { code: string }).code).toBe("MIN_VERSION_HAS_NO_UPGRADE_PATH");
  });

  it("pauses and revokes releases, blocking eligibility", async () => {
    const release = await createPublishedRelease("0.2.0");
    const paused = await admin(
      { expected_revision: release.revision },
      `/v1/admin/releases/${release.release_id}/pause`,
    );
    expect(paused.status).toBe(200);
    const pausedEligibility = await app.request(
      `/v1/releases/${release.release_id}/eligibility?channel=beta&target=windows&arch=x86_64&current_version=0.1.0&installer=nsis&policy_revision=0`,
      { headers: clientHeaders },
    );
    expect(pausedEligibility.status).toBe(410);
    const pausedRevision = ((await paused.json()) as { revision: number }).revision;
    const revoked = await admin(
      { expected_revision: pausedRevision },
      `/v1/admin/releases/${release.release_id}/revoke`,
    );
    expect(revoked.status).toBe(200);
    const revokedEligibility = await app.request(
      `/v1/releases/${release.release_id}/eligibility?channel=beta&target=windows&arch=x86_64&current_version=0.1.0&installer=nsis&policy_revision=0`,
      { headers: clientHeaders },
    );
    expect(revokedEligibility.status).toBe(410);
  });

  it("rejects duplicate versions and concurrent revision conflicts", async () => {
    const release = await createPublishedRelease("0.2.0");
    const duplicate = await admin(registration("0.2.0"), "/v1/admin/releases");
    expect(duplicate.status).toBe(409);
    const conflict = await admin(
      { expected_revision: release.revision + 10 },
      `/v1/admin/releases/${release.release_id}/pause`,
    );
    expect(conflict.status).toBe(409);
  });

  it("accepts idempotent update events and rejects unknown fields", async () => {
    const event = {
      event_id: "3f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c",
      installation_id: INSTALLATION_ID,
      app_version: "0.1.0",
      channel: "beta",
      target: "windows",
      arch: "x86_64",
      installer: "nsis",
      stage: "check",
      error_category: null,
      occurred_at: "2026-10-19T08:00:00Z",
    };
    const first = await app.request("/v1/update-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    expect(first.status).toBe(202);
    expect((await first.json()) as { duplicate: boolean }).toMatchObject({ duplicate: false });
    const second = await app.request("/v1/update-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    expect((await second.json()) as { duplicate: boolean }).toMatchObject({ duplicate: true });
    const invalid = await app.request("/v1/update-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, event_id: undefined, order_id: "O-1" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("accepts a real Tauri v2 single-line base64 signature", async () => {
    const registrationWithSingleLineSignature = registration("0.2.2");
    const singleLine = Buffer.alloc(336, 11).toString("base64");
    registrationWithSingleLineSignature.artifacts[0]!.signature = singleLine;
    const response = await admin(registrationWithSingleLineSignature, "/v1/admin/releases");
    expect(response.status).toBe(201);
    const body = (await response.json()) as { artifacts: Array<{ signature: string }> };
    expect(body.artifacts[0]?.signature).toBe(singleLine);
  });

  it("rejects missing installation identifiers and insecure artifact URLs", async () => {
    const missing = await app.request("/v1/update-policy/beta/windows/x86_64/0.1.0?installer=nsis");
    expect(missing.status).toBe(400);
    const insecure = {
      ...registration("0.2.1"),
      artifacts: [{ ...registration("0.2.1").artifacts[0], url: "http://updates.example.com/setup.exe" }],
    };
    const response = await admin(insecure, "/v1/admin/releases");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("INSECURE_ARTIFACT_URL");
  });
});
