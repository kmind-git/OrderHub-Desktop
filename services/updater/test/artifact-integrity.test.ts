import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { UpdaterConfig } from "../src/config.js";
import { closeDatabase, openDatabase, type Database } from "../src/db.js";

const ADMIN_TOKEN = "test-admin-token-very-long-and-random";
const APPLICATION = "com.orderhub.desktop";

interface SigningKey {
  publicKey: string;
  sign(bytes: Buffer, version: string): string;
}

function createSigningKey(): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = randomBytes(8);
  const publicBlob = Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64");
  return {
    publicKey: publicBlob,
    sign(bytes, version) {
      const digest = createHash("blake2b512").update(bytes).digest();
      const signature = sign(null, digest, privateKey);
      const trusted = `timestamp:1790000000\tfile:setup.exe\tversion:${version}`;
      const global = sign(
        null,
        Buffer.concat([signature, Buffer.from(trusted, "utf8")]),
        privateKey,
      );
      const blob = Buffer.concat([Buffer.from("ED"), keyId, signature]);
      return [
        "untrusted comment: signature from tauri secret key",
        blob.toString("base64"),
        `trusted comment: ${trusted}`,
        global.toString("base64"),
      ].join("\n");
    },
  };
}

describe("artifact integrity before publish", () => {
  let root: string | undefined;
  let db: Database | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    if (db) closeDatabase(db);
    if (root) rmSync(root, { recursive: true, force: true });
    db = undefined;
    root = undefined;
  });

  async function setup(
    body: Buffer,
    options: { allowInsecure?: boolean; signingKey?: string | null } = {},
  ) {
    root = mkdtempSync(join(tmpdir(), "orderhub-integrity-"));
    const config: UpdaterConfig = {
      host: "127.0.0.1",
      port: 0,
      dbPath: join(root, "updater.sqlite3"),
      artifactRoot: join(root, "artifacts"),
      publicArtifactBaseUrl: "http://127.0.0.1:0/artifacts",
      adminToken: ADMIN_TOKEN,
      adminActor: "test",
      applicationId: APPLICATION,
      serveArtifacts: false,
      verifyArtifactUrl: true,
      allowInsecureArtifactUrl: options.allowInsecure ?? true,
      signingPublicKey: options.signingKey ?? null,
      eventRetentionDays: 30,
      policyDefaultValidForSeconds: 3600,
      supportUrl: null,
      trustProxy: false,
    };
    db = openDatabase(config.dbPath);
    const app = createApp({ db, config });

    let served = body;
    let status = 200;
    server = createServer((_request, response) => {
      response.statusCode = status;
      response.setHeader("content-length", String(served.length));
      response.end(served);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no test server address");
    const url = `http://127.0.0.1:${address.port}/setup.exe`;

    const admin = (payload: unknown, path: string, method = "POST") =>
      app.request(path, {
        method,
        headers: {
          authorization: `Bearer ${ADMIN_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

    const register = (bytes: Buffer, overrides: Record<string, unknown> = {}) =>
      admin(
        {
          application: APPLICATION,
          version: "0.2.0",
          channel: "beta",
          notes: "integrity",
          artifacts: [
            {
              target: "windows",
              arch: "x86_64",
              installer: "nsis",
              url,
              size: bytes.length,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              signature: "placeholder",
              ...overrides,
            },
          ],
        },
        "/v1/admin/releases",
      );

    const publish = async (releaseId: string, revision: number) =>
      admin({ expected_revision: revision }, `/v1/admin/releases/${releaseId}/publish`);

    return {
      app,
      register,
      publish,
      setServed(next: Buffer) {
        served = next;
      },
      setStatus(next: number) {
        status = next;
      },
    };
  }

  it("publishes only after size, SHA-256 and signed version match", async () => {
    const key = createSigningKey();
    const bytes = Buffer.from("a complete MSI/NSIS payload");
    const ctx = await setup(bytes, { signingKey: key.publicKey });
    const registered = await ctx.register(bytes, { signature: key.sign(bytes, "0.2.0") });
    expect(registered.status).toBe(201);
    const release = (await registered.json()) as { release_id: string; revision: number };
    const published = await ctx.publish(release.release_id, release.revision);
    expect(published.status).toBe(200);
  });

  it("rejects a declared size that does not match the fetched bytes", async () => {
    const key = createSigningKey();
    const bytes = Buffer.from("short");
    const ctx = await setup(bytes, { signingKey: key.publicKey });
    const registered = await ctx.register(bytes, {
      size: bytes.length + 1,
      signature: key.sign(bytes, "0.2.0"),
    });
    const release = (await registered.json()) as { release_id: string; revision: number };
    const published = await ctx.publish(release.release_id, release.revision);
    expect(published.status).toBe(409);
    expect((await published.json()) as { code: string }).toMatchObject({
      code: "ARTIFACT_SIZE_MISMATCH",
    });
  });

  it("rejects a digest mismatch even when the signature is valid", async () => {
    const key = createSigningKey();
    const bytes = Buffer.from("payload");
    const ctx = await setup(bytes, { signingKey: key.publicKey });
    const registered = await ctx.register(bytes, {
      sha256: "b".repeat(64),
      signature: key.sign(bytes, "0.2.0"),
    });
    const release = (await registered.json()) as { release_id: string; revision: number };
    const published = await ctx.publish(release.release_id, release.revision);
    expect(published.status).toBe(409);
    expect((await published.json()) as { code: string }).toMatchObject({
      code: "ARTIFACT_DIGEST_MISMATCH",
    });
  });

  it("rejects a signature bound to another version", async () => {
    const key = createSigningKey();
    const bytes = Buffer.from("payload");
    const ctx = await setup(bytes, { signingKey: key.publicKey });
    const registered = await ctx.register(bytes, { signature: key.sign(bytes, "0.1.9") });
    const release = (await registered.json()) as { release_id: string; revision: number };
    const published = await ctx.publish(release.release_id, release.revision);
    expect(published.status).toBe(409);
    expect((await published.json()) as { code: string }).toMatchObject({
      code: "INVALID_ARTIFACT_SIGNATURE",
    });
  });

  it("accepts an explicitly allowed non-loopback HTTP artifact URL", async () => {
    const key = createSigningKey();
    const bytes = Buffer.from("payload");
    const ctx = await setup(bytes, { signingKey: key.publicKey });
    const registered = await ctx.register(bytes, {
      url: "http://192.0.2.10:8787/artifacts/setup.exe",
      signature: key.sign(bytes, "0.2.0"),
    });
    expect(registered.status).toBe(201);
  });
});
