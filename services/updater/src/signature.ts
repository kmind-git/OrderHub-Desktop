import { createHash, createPublicKey, verify as verifyEd25519 } from "node:crypto";

/**
 * Minimal minisign verifier for Tauri v2 updater `.sig` files.
 *
 * Tauri accepts either the literal multi-line `.sig` text or a single Base64
 * blob containing that text. The signature is Ed25519 over either the raw
 * artifact (`Ed`) or its BLAKE2b-512 digest (`ED`); a second Ed25519 signature
 * covers the signature bytes plus the trusted comment text.
 */

const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface ParsedSignature {
  keyId: Buffer;
  signature: Buffer;
  trustedComment: string;
  globalSignature: Buffer;
  prehashed: boolean;
}

function decodeMaybeBase64Signature(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("\n")) return trimmed;
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (!decoded.includes("\n")) {
    throw new Error("signature is neither multi-line text nor Base64-encoded signature text");
  }
  return decoded;
}

export function parseSignature(raw: string): ParsedSignature {
  const text = decodeMaybeBase64Signature(raw);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 4) throw new Error("signature must contain four non-empty lines");
  const signatureBin = Buffer.from(lines[1]!, "base64");
  if (signatureBin.length !== 74) throw new Error("signature payload must be 74 bytes");
  const trustedCommentLine = lines[2]!;
  if (!trustedCommentLine.startsWith("trusted comment: ")) {
    throw new Error("signature is missing the trusted comment");
  }
  const globalSignature = Buffer.from(lines[3]!, "base64");
  if (globalSignature.length !== 64) {
    throw new Error("global signature must be 64 bytes");
  }
  const algorithm = signatureBin.subarray(0, 2).toString("latin1");
  if (algorithm !== "Ed" && algorithm !== "ED") {
    throw new Error(`unsupported minisign algorithm ${JSON.stringify(algorithm)}`);
  }
  return {
    keyId: signatureBin.subarray(2, 10),
    signature: signatureBin.subarray(10, 74),
    trustedComment: trustedCommentLine.slice("trusted comment: ".length),
    globalSignature,
    prehashed: algorithm === "ED",
  };
}

function parsePublicKey(raw: string): { keyId: Buffer; key: Buffer } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("untrusted comment:"));
  const encoded = lines[0];
  if (!encoded) throw new Error("public key is empty");
  const bin = Buffer.from(encoded, "base64");
  if (bin.length !== 42) throw new Error("public key must be 42 bytes");
  const algorithm = bin.subarray(0, 2).toString("latin1");
  if (algorithm !== "Ed" && algorithm !== "ED") {
    throw new Error("unsupported minisign public key algorithm");
  }
  return { keyId: bin.subarray(2, 10), key: bin.subarray(10, 42) };
}

function verify(key: Buffer, message: Buffer, signature: Buffer): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_ED25519_PREFIX, key]),
      format: "der",
      type: "spki",
    });
    return verifyEd25519(null, message, publicKey, signature);
  } catch {
    return false;
  }
}

export interface SignatureCheckOptions {
  publicKey: string;
  expectedVersion?: string;
}

export function verifyArtifactSignature(
  bytes: Buffer,
  rawSignature: string,
  options: SignatureCheckOptions,
): void {
  const signature = parseSignature(rawSignature);
  const publicKey = parsePublicKey(options.publicKey);
  if (!publicKey.keyId.equals(signature.keyId)) {
    throw new Error("signature key id does not match the configured public key");
  }
  const message = signature.prehashed
    ? createHash("blake2b512").update(bytes).digest()
    : bytes;
  if (!verify(publicKey.key, message, signature.signature)) {
    throw new Error("artifact signature is invalid");
  }
  const globalMessage = Buffer.concat([
    signature.signature,
    Buffer.from(signature.trustedComment, "utf8"),
  ]);
  if (!verify(publicKey.key, globalMessage, signature.globalSignature)) {
    throw new Error("signature trusted comment is not covered by the global signature");
  }
  if (options.expectedVersion !== undefined) {
    const match = /(?:^|[\s\t])version:([^\s\t]+)/.exec(signature.trustedComment);
    if (!match) {
      throw new Error(
        "signature trusted comment does not include the signed version; re-sign with the Tauri bundler",
      );
    }
    if (match[1] !== options.expectedVersion) {
      throw new Error(
        `signature is bound to version ${match[1]}, not the release version ${options.expectedVersion}`,
      );
    }
  }
}
