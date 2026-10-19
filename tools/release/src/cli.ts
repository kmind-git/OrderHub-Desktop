#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  apiPaths,
  channelPolicyUpdateSchema,
  releaseRegistrationSchema,
  type ChannelPolicyResponse,
  type EligibilityResponse,
  type ReleaseRegistration,
  type ReleaseSummary,
  type TauriUpdateResponse,
  type UpdateChannel,
  type UpdatePolicyResponse,
} from "@orderhub/contracts";
import { readManifest, sha256File, stageArtifact, writeManifest } from "./artifact.js";
import { ApiClient, ApiClientError } from "./http.js";

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

const BOOLEAN_FLAGS = new Set(["json", "publish", "help"]);
const invocationCwd = process.env.INIT_CWD ?? process.cwd();

/** Resolve user-supplied paths against the directory the command was invoked
 * from, not the workspace package directory that pnpm changes into. */
function userPath(value: string): string {
  return resolve(invocationCwd, value);
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 2) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
        continue;
      }
      const name = token.slice(2);
      const next = argv[index + 1];
      if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith("--")) {
        flags.set(name, true);
      } else {
        flags.set(name, next);
        index += 1;
      }
    } else {
      positionals.push(token);
    }
  }
  return { command, positionals, flags };
}

function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name);
}

function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function intFlag(args: ParsedArgs, name: string, fallback?: number): number {
  const raw = flag(args, name);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer`);
  return value;
}

const HELP = `OrderHub release tool

Usage:
  pnpm release <command> [options]

Commands:
  stage       Copy an installer into the immutable artifact layout and emit a manifest
  register    Register a release as draft (from --manifest or --file)
  publish     Publish a release          <releaseId> --revision N
  pause       Pause a release            <releaseId> --revision N
  revoke      Revoke a release           <releaseId> --revision N
  policy      Update channel policy
  check       Query policy/updates/eligibility as a client would

Environment:
  ORDERHUB_UPDATER_API_BASE        default http://127.0.0.1:8787
  ORDERHUB_UPDATER_ADMIN_TOKEN     required for admin commands

Examples:
  pnpm release stage --file "OrderHub Desktop_0.2.0_x64-setup.exe" \\
    --version 0.2.0 --channel beta --artifact-root test-artifacts/artifacts \\
    --public-base-url http://127.0.0.1:8787/artifacts --out test-artifacts/manifest-0.2.0.json

  pnpm release register --manifest test-artifacts/manifest-0.2.0.json --publish

  pnpm release policy --channel beta --revision 0 --rollout-release rel_... \\
    --rollout-percent 10 --valid-for-seconds 86400

  pnpm release check --channel beta --version 0.1.0
`;

function print(value: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function buildRegistrationFromFile(args: ParsedArgs): Promise<ReleaseRegistration> {
  const file = userPath(requireFlag(args, "file"));
  const signatureFile = userPath(flag(args, "signature") ?? `${file}.sig`);
  const signature = readFileSync(signatureFile, "utf8").trim();
  const sha256 = await sha256File(file);
  const size = statSync(file).size;
  return releaseRegistrationSchema.parse({
    application: flag(args, "application") ?? "com.orderhub.desktop",
    version: requireFlag(args, "version"),
    channel: requireFlag(args, "channel") as UpdateChannel,
    notes: flag(args, "notes") ?? "",
    artifacts: [
      {
        target: flag(args, "target") ?? "windows",
        arch: flag(args, "arch") ?? "x86_64",
        installer: flag(args, "installer") ?? "nsis",
        url: requireFlag(args, "url"),
        size,
        sha256,
        signature,
      },
    ],
  });
}

async function registerCommand(client: ApiClient, args: ParsedArgs): Promise<void> {
  const registration = flag(args, "manifest")
    ? readManifest(userPath(requireFlag(args, "manifest")))
    : await buildRegistrationFromFile(args);
  const release = await client.request<ReleaseSummary>(apiPaths.adminReleases, {
    method: "POST",
    body: registration,
    admin: true,
  });
  let result: ReleaseSummary = release;
  if (boolFlag(args, "publish")) {
    result = await client.request<ReleaseSummary>(apiPaths.adminPublish(release.release_id), {
      method: "POST",
      body: { expected_revision: release.revision },
      admin: true,
    });
  }
  print(result, boolFlag(args, "json"));
}

async function actionCommand(
  client: ApiClient,
  args: ParsedArgs,
  action: "publish" | "pause" | "revoke",
): Promise<void> {
  const releaseId = args.positionals[0];
  if (!releaseId) throw new Error("a release id is required");
  const path =
    action === "publish"
      ? apiPaths.adminPublish(releaseId)
      : action === "pause"
        ? apiPaths.adminPause(releaseId)
        : apiPaths.adminRevoke(releaseId);
  const release = await client.request<ReleaseSummary>(path, {
    method: "POST",
    body: { expected_revision: intFlag(args, "revision") },
    admin: true,
  });
  print(release, boolFlag(args, "json"));
}

async function policyCommand(client: ApiClient, args: ParsedArgs): Promise<void> {
  const channel = requireFlag(args, "channel");
  const body = channelPolicyUpdateSchema.parse({
    expected_revision: intFlag(args, "revision"),
    rollout_release_id: flag(args, "rollout-release") ?? null,
    min_supported_version: flag(args, "min-version") ?? null,
    min_supported_effective_at: flag(args, "min-effective-at") ?? null,
    rollout_percent: intFlag(args, "rollout-percent", 100),
    valid_for_seconds: intFlag(args, "valid-for-seconds", 86400),
  });
  const response = await client.request<ChannelPolicyResponse>(
    apiPaths.adminChannelPolicy(channel),
    { method: "PUT", body, admin: true },
  );
  print(response, boolFlag(args, "json"));
}

async function checkCommand(args: ParsedArgs): Promise<void> {
  const client = new ApiClient({ baseUrl: apiBase(args) });
  const channel = requireFlag(args, "channel");
  const version = requireFlag(args, "version");
  const installationId = flag(args, "installation-id") ?? randomUUID();
  const headers = {
    "x-installation-id": installationId,
    "x-installation-type": "nsis",
  };
  const policy = await client.request<UpdatePolicyResponse>(
    `${apiPaths.updatePolicy(channel, "windows", "x86_64", version)}?installer=nsis`,
    { headers },
  );
  const output: Record<string, unknown> = { installation_id: installationId, policy };
  if (policy.update_available && policy.selected_release) {
    const update = await client.request<TauriUpdateResponse | null>(
      `${apiPaths.updates(channel, "windows", "x86_64", version)}?installer=nsis&release_id=${encodeURIComponent(
        policy.selected_release.release_id,
      )}&policy_revision=${policy.policy_revision}`,
      { headers },
    );
    output.update = update;
    output.eligibility = await client.request<EligibilityResponse>(
      `${apiPaths.eligibility(policy.selected_release.release_id)}?channel=${encodeURIComponent(
        channel,
      )}&target=windows&arch=x86_64&current_version=${encodeURIComponent(version)}&installer=nsis&policy_revision=${
        policy.policy_revision
      }`,
      { headers },
    );
  } else {
    output.update = null;
  }
  print(output, true);
}

function apiBase(args: ParsedArgs): string {
  return (
    flag(args, "api") ??
    process.env.ORDERHUB_UPDATER_API_BASE ??
    "http://127.0.0.1:8787"
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || boolFlag(args, "help")) {
    console.log(HELP);
    return;
  }
  if (args.command === "stage") {
    const staged = await stageArtifact({
      file: userPath(requireFlag(args, "file")),
      signatureFile: flag(args, "signature") ? userPath(flag(args, "signature")!) : undefined,
      artifactRoot: userPath(requireFlag(args, "artifact-root")),
      publicBaseUrl: requireFlag(args, "public-base-url"),
      application: flag(args, "application") ?? "com.orderhub.desktop",
      version: requireFlag(args, "version"),
      channel: requireFlag(args, "channel") as UpdateChannel,
      notes: flag(args, "notes") ?? "",
      target: (flag(args, "target") ?? "windows") as "windows",
      arch: (flag(args, "arch") ?? "x86_64") as "x86_64",
      installer: (flag(args, "installer") ?? "nsis") as "nsis",
    });
    const out = flag(args, "out");
    const result = out ? writeManifest(staged, userPath(out)) : staged;
    if (out) {
      console.log(`manifest: ${userPath(out)}`);
    }
    console.log(`artifact: ${result.artifactPath}`);
    console.log(JSON.stringify(result.manifest, null, 2));
    return;
  }

  const client = new ApiClient({
    baseUrl: apiBase(args),
    adminToken: process.env.ORDERHUB_UPDATER_ADMIN_TOKEN,
  });

  switch (args.command) {
    case "register":
      await registerCommand(client, args);
      break;
    case "publish":
    case "pause":
    case "revoke":
      await actionCommand(client, args, args.command);
      break;
    case "policy":
      await policyCommand(client, args);
      break;
    case "check":
      await checkCommand(args);
      break;
    default:
      console.error(`unknown command: ${args.command}\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  if (error instanceof ApiClientError) {
    console.error(`error ${error.code} (HTTP ${error.status}): ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    if (error.correlationId) console.error(`correlation_id: ${error.correlationId}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
