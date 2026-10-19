import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  releaseRegistrationSchema,
  sha256Schema,
  type ReleaseRegistration,
} from "@orderhub/contracts";

export interface StageInput {
  file: string;
  signatureFile?: string;
  artifactRoot: string;
  publicBaseUrl: string;
  application: string;
  version: string;
  channel: "stable" | "beta";
  notes: string;
  target: "windows";
  arch: "x86_64";
  installer: "nsis";
}

export interface StagedRelease {
  manifest: ReleaseRegistration;
  manifestPath: string | null;
  artifactPath: string;
  signaturePath: string;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = await import("node:fs").then(({ createReadStream }) => createReadStream(path));
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function safeFilename(path: string): string {
  const name = basename(path);
  if (!/^[A-Za-z0-9._ -]{1,180}$/.test(name) || name.trim() !== name) {
    throw new Error(
      "artifact filename must use only letters, digits, dot, underscore, dash and spaces (max 180 characters)",
    );
  }
  return name;
}

function sanitizeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return value;
}

export async function stageArtifact(input: StageInput): Promise<StagedRelease> {
  const source = resolve(input.file);
  if (!existsSync(source)) throw new Error(`artifact not found: ${source}`);
  const signatureFile = input.signatureFile
    ? resolve(input.signatureFile)
    : `${source}.sig`;
  if (!existsSync(signatureFile)) {
    throw new Error(
      `signature file not found: ${signatureFile}. Sign the final installer first (Tauri updater signature).`,
    );
  }
  const version = sanitizeSegment(input.version, "version");
  const filename = safeFilename(source);
  const signature = readFileSync(signatureFile, "utf8").trim();
  if (!signature) throw new Error("signature file is empty");

  const relativeDir = join(version, `${input.target}-${input.arch}`);
  const destinationDir = join(resolve(input.artifactRoot), relativeDir);
  const destination = join(destinationDir, filename);
  const destinationSig = `${destination}.sig`;
  mkdirSync(destinationDir, { recursive: true });

  const sourceSha = await sha256File(source);
  if (existsSync(destination)) {
    const existing = await sha256File(destination);
    if (existing !== sourceSha) {
      throw new Error(
        `immutable artifact path already contains different bytes: ${destination}. ` +
          "Never overwrite a published artifact path; publish a new version.",
      );
    }
  } else {
    copyFileSync(source, destination);
  }
  if (!existsSync(destinationSig)) {
    writeFileSync(destinationSig, `${signature}\n`, "utf8");
  }
  const size = statSync(destination).size;
  const url = `${input.publicBaseUrl.replace(/\/+$/, "")}/${relativeDir.replaceAll("\\", "/")}/${encodeURIComponent(filename)}`;

  const manifest: ReleaseRegistration = releaseRegistrationSchema.parse({
    application: input.application,
    version: input.version,
    channel: input.channel,
    notes: input.notes,
    artifacts: [
      {
        target: input.target,
        arch: input.arch,
        installer: input.installer,
        url,
        size,
        sha256: sha256Schema.parse(sourceSha),
        signature,
      },
    ],
  });

  return {
    manifest,
    manifestPath: null,
    artifactPath: destination,
    signaturePath: destinationSig,
  };
}

export function writeManifest(staged: StagedRelease, outputPath: string): StagedRelease {
  writeFileSync(outputPath, `${JSON.stringify(staged.manifest, null, 2)}\n`, "utf8");
  return { ...staged, manifestPath: resolve(outputPath) };
}

export function readManifest(path: string): ReleaseRegistration {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return releaseRegistrationSchema.parse(parsed);
}
