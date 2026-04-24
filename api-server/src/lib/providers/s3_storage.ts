/**
 * s3_storage.ts — S3-Compatible Object Storage Client (Massive.com)
 *
 * Provides persistent cloud storage for GodsView data:
 *   - Trade journals & execution logs
 *   - Backtest results & strategy snapshots
 *   - Brain state snapshots (for recovery)
 *   - Chart screenshots & recall memory
 *   - FRED/macro data archives
 *
 * Uses S3-compatible API (works with Massive, AWS S3, MinIO, etc.)
 *
 * Config via env vars:
 *   S3_ENDPOINT       — e.g., https://files.massive.com
 *   S3_ACCESS_KEY_ID  — access key
 *   S3_SECRET_ACCESS_KEY — secret key
 *   S3_BUCKET         — bucket name (default: "flatfiles")
 *   S3_REGION         — region (default: "us-east-1")
 */

import { logger } from "../logger.js";
import { createHmac, createHash } from "crypto";

// ── Config ──────────────────────────────────────────────────────────────────

function getConfig() {
  return {
    endpoint: process.env.S3_ENDPOINT ?? "",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",    bucket: process.env.S3_BUCKET ?? "flatfiles",
    region: process.env.S3_REGION ?? "us-east-1",
  };
}

function isConfigured(): boolean {
  const c = getConfig();
  return !!(c.endpoint && c.accessKeyId && c.secretAccessKey);
}

// ── AWS Signature V4 (minimal implementation) ───────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}
function signRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: string | Buffer,
  config: ReturnType<typeof getConfig>,
): Record<string, string> {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  const payloadHash = sha256Hex(body);

  // Include x-amz-* headers BEFORE signing (they must be part of the signature)
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");

  const canonicalRequest = [
    method,
    path,
    "", // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(config.secretAccessKey, dateStamp, config.region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ── S3 Operations ───────────────────────────────────────────────────────────

export interface S3PutResult {
  success: boolean;
  key: string;
  etag?: string;
  error?: string;
}

export interface S3GetResult {
  success: boolean;
  key: string;
  data?: string;
  contentType?: string;
  error?: string;
}
/**
 * Upload an object to S3.
 */
export async function s3Put(key: string, data: string | object, contentType = "application/json"): Promise<S3PutResult> {
  if (!isConfigured()) {
    return { success: false, key, error: "S3 not configured — missing env vars" };
  }

  const config = getConfig();
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const path = `/${config.bucket}/${key}`;
  const host = new URL(config.endpoint).host;

  const headers: Record<string, string> = {
    host,
    "content-type": contentType,
  };

  const signed = signRequest("PUT", path, headers, body, config);

  try {
    const res = await fetch(`${config.endpoint}${path}`, {
      method: "PUT",
      headers: signed,
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      logger.warn({ key, status: res.status, errText }, "[s3] PUT failed");
      return { success: false, key, error: `HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }

    const etag = res.headers.get("etag") ?? undefined;
    logger.debug({ key, etag }, "[s3] PUT success");
    return { success: true, key, etag };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ key, err: msg }, "[s3] PUT error");
    return { success: false, key, error: msg };
  }
}

/**
 * Download an object from S3.
 */
export async function s3Get(key: string): Promise<S3GetResult> {
  if (!isConfigured()) {
    return { success: false, key, error: "S3 not configured" };
  }

  const config = getConfig();
  const path = `/${config.bucket}/${key}`;
  const host = new URL(config.endpoint).host;

  const headers: Record<string, string> = { host };
  const signed = signRequest("GET", path, headers, "", config);
  try {
    const res = await fetch(`${config.endpoint}${path}`, {
      method: "GET",
      headers: signed,
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { success: false, key, error: `HTTP ${res.status}` };
    }

    const data = await res.text();
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    return { success: true, key, data, contentType };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, key, error: msg };
  }
}

/**
 * Check if S3 is configured and accessible.
 */
export async function s3HealthCheck(): Promise<{ configured: boolean; reachable: boolean; error?: string }> {
  if (!isConfigured()) {
    return { configured: false, reachable: false, error: "S3 env vars not set" };
  }

  try {
    const result = await s3Put("_health_check.json", { ts: new Date().toISOString(), status: "ok" });
    return { configured: true, reachable: result.success, error: result.error };
  } catch (err) {
    return { configured: true, reachable: false, error: err instanceof Error ? err.message : String(err) };
  }
}
// ── GodsView-specific helpers ───────────────────────────────────────────────

/** Save a trade journal entry */
export async function saveTradeJournal(tradeId: string, data: object): Promise<S3PutResult> {
  const date = new Date().toISOString().slice(0, 10);
  return s3Put(`godsview/trades/${date}/${tradeId}.json`, data);
}

/** Save a backtest result */
export async function saveBacktestResult(strategyId: string, runId: string, data: object): Promise<S3PutResult> {
  return s3Put(`godsview/backtests/${strategyId}/${runId}.json`, data);
}

/** Save a brain state snapshot (for disaster recovery) */
export async function saveBrainSnapshot(data: object): Promise<S3PutResult> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return s3Put(`godsview/brain-snapshots/${ts}.json`, data);
}

/** Save macro data archive */
export async function saveMacroArchive(data: object): Promise<S3PutResult> {
  const date = new Date().toISOString().slice(0, 10);
  return s3Put(`godsview/macro/${date}.json`, data);
}

/** Load the most recent brain snapshot */
export async function loadBrainSnapshot(snapshotKey: string): Promise<S3GetResult> {
  return s3Get(snapshotKey);
}
