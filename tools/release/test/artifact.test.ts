import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManifest, sha256File, stageArtifact, writeManifest } from "../src/artifact.js";

const SIGNATURE = `untrusted comment: signature from tauri secret key\n${Buffer.alloc(64, 7).toString("base64")}\ntrusted comment: timestamp:1700000000\tfile:setup.exe\n${Buffer.alloc(64, 9).toString("base64")}`;

describe("release artifact staging", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  it("stages an immutable artifact, computes its hash and emits a valid manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "orderhub-stage-"));
    roots.push(root);
    const file = join(root, "OrderHub Setup 0.2.0.exe");
    writeFileSync(file, Buffer.alloc(2048, 3));
    writeFileSync(`${file}.sig`, SIGNATURE);

    const staged = await stageArtifact({
      file,
      artifactRoot: join(root, "artifacts"),
      publicBaseUrl: "https://updates.example.com/artifacts/",
      application: "com.orderhub.desktop",
      version: "0.2.0",
      channel: "beta",
      notes: "test release",
      target: "windows",
      arch: "x86_64",
      installer: "nsis",
    });

    expect(staged.manifest.version).toBe("0.2.0");
    expect(staged.manifest.artifacts[0]?.sha256).toBe(await sha256File(file));
    expect(staged.manifest.artifacts[0]?.size).toBe(2048);
    expect(staged.manifest.artifacts[0]?.url).toContain(
      "/0.2.0/windows-x86_64/OrderHub%20Setup%200.2.0.exe",
    );
    expect(readFileSync(staged.artifactPath).length).toBe(2048);

    const manifestPath = join(root, "manifest.json");
    writeManifest(staged, manifestPath);
    expect(readManifest(manifestPath).artifacts.length).toBe(1);
  });

  it("refuses to overwrite an immutable path with different bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "orderhub-stage-"));
    roots.push(root);
    const file = join(root, "setup.exe");
    writeFileSync(file, Buffer.alloc(64, 1));
    writeFileSync(`${file}.sig`, SIGNATURE);
    const base = {
      file,
      artifactRoot: join(root, "artifacts"),
      publicBaseUrl: "https://updates.example.com/artifacts",
      application: "com.orderhub.desktop",
      version: "0.2.0",
      channel: "beta" as const,
      notes: "",
      target: "windows" as const,
      arch: "x86_64" as const,
      installer: "nsis" as const,
    };
    await stageArtifact(base);
    writeFileSync(file, Buffer.alloc(64, 2));
    await expect(stageArtifact(base)).rejects.toThrow(/immutable artifact path/);
  });
});
