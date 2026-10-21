import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UpdaterConfig } from "../src/config.js";
import { closeDatabase, openDatabase } from "../src/db.js";
import { ApiClient } from "../../../tools/release/src/http.js";
import { stageArtifact } from "../../../tools/release/src/artifact.js";

const ADMIN_TOKEN = "e2e-admin-token-0123456789";
const INSTALLATION_ID = "6f0c0a7e-3a8f-4f4d-9e8e-4c0f6f2a1b2c";
const SIGNATURE = `untrusted comment: signature from tauri secret key\n${Buffer.alloc(64, 7).toString("base64")}\ntrusted comment: timestamp:1700000000\tfile:setup.exe\n${Buffer.alloc(64, 9).toString("base64")}`;

describe("release tool → update service end-to-end", () => {
  let root: string | null = null;
  let closeServer: (() => Promise<void>) | null = null;
  let closeDb: (() => void) | null = null;

  afterEach(async () => {
    if (closeServer) await closeServer();
    if (closeDb) closeDb();
    if (root) rmSync(root, { recursive: true, force: true });
    closeServer = null;
    closeDb = null;
    root = null;
  });

  it("stages, registers, publishes, pins policy and serves the Tauri response", async () => {
    root = mkdtempSync(join(tmpdir(), "orderhub-e2e-"));
    const db = openDatabase(join(root, "updater.sqlite3"));
    closeDb = () => closeDatabase(db);
    const config: UpdaterConfig = {
      host: "127.0.0.1",
      port: 0,
      dbPath: join(root, "updater.sqlite3"),
      artifactRoot: join(root, "artifacts"),
      publicArtifactBaseUrl: "http://127.0.0.1:0/artifacts",
      adminToken: ADMIN_TOKEN,
      adminActor: "e2e",
      applicationId: "com.orderhub.desktop",
      serveArtifacts: true,
      verifyArtifactUrl: false,
      allowInsecureArtifactUrl: true,
      signingPublicKey: null,
      eventRetentionDays: 30,
      policyDefaultValidForSeconds: 3600,
      supportUrl: null,
      trustProxy: false,
    };
    const app = createApp({ db, config });
    let port = 0;
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => {
        port = info.port;
      },
    );
    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(port).toBeGreaterThan(0);

    const installer = join(root, "OrderHub Setup 0.2.0.exe");
    writeFileSync(installer, Buffer.alloc(4096, 5));
    writeFileSync(`${installer}.sig`, SIGNATURE);
    const staged = await stageArtifact({
      file: installer,
      artifactRoot: join(root, "artifacts"),
      publicBaseUrl: `http://127.0.0.1:${port}/artifacts`,
      application: "com.orderhub.desktop",
      version: "0.2.0",
      channel: "beta",
      notes: "E2E release",
      target: "windows",
      arch: "x86_64",
      installer: "nsis",
    });

    const client = new ApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      adminToken: ADMIN_TOKEN,
    });
    const registered = await client.request<{ release_id: string; revision: number }>(
      "/v1/admin/releases",
      { method: "POST", body: staged.manifest, admin: true },
    );
    const published = await client.request<{ revision: number; status: string }>(
      `/v1/admin/releases/${registered.release_id}/publish`,
      { method: "POST", body: { expected_revision: registered.revision }, admin: true },
    );
    expect(published.status).toBe("published");

    const policy = await client.request<{ policy_revision: number }>(
      "/v1/admin/channels/beta/policy",
      {
        method: "PUT",
        admin: true,
        body: {
          expected_revision: 0,
          rollout_release_id: registered.release_id,
          min_supported_version: "0.1.0",
          min_supported_effective_at: "2026-01-01T00:00:00Z",
          rollout_percent: 100,
          valid_for_seconds: 3600,
        },
      },
    );
    expect(policy.policy_revision).toBe(1);

    const headers = { "x-installation-id": INSTALLATION_ID, "x-installation-type": "nsis" };
    const policyResponse = await fetch(
      `http://127.0.0.1:${port}/v1/update-policy/beta/windows/x86_64/0.1.0?installer=nsis`,
      { headers },
    );
    expect(policyResponse.status).toBe(200);
    const policyBody = (await policyResponse.json()) as {
      selected_release: { release_id: string } | null;
      policy_revision: number;
      forced: boolean;
    };
    expect(policyBody.selected_release?.release_id).toBe(registered.release_id);
    expect(policyBody.forced).toBe(false);

    const updateResponse = await fetch(
      `http://127.0.0.1:${port}/v1/updates/beta/windows/x86_64/0.1.0?installer=nsis&release_id=${registered.release_id}&policy_revision=${policyBody.policy_revision}`,
      { headers },
    );
    expect(updateResponse.status).toBe(200);
    const updateBody = (await updateResponse.json()) as {
      version: string;
      url: string;
      signature: string;
    };
    expect(updateBody.version).toBe("0.2.0");
    expect(updateBody.signature).toContain("untrusted comment");
    expect(updateBody.url).toContain("/0.2.0/windows-x86_64/");

    const artifact = await fetch(updateBody.url);
    expect(artifact.status).toBe(200);
    expect((await artifact.arrayBuffer()).byteLength).toBe(4096);

    const eligibility = await fetch(
      `http://127.0.0.1:${port}/v1/releases/${registered.release_id}/eligibility?channel=beta&target=windows&arch=x86_64&current_version=0.1.0&installer=nsis&policy_revision=${policyBody.policy_revision}`,
      { headers },
    );
    expect(eligibility.status).toBe(200);
    expect(((await eligibility.json()) as { eligible: boolean }).eligible).toBe(true);
  });
});
