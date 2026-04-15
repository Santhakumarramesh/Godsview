import { resolveSystemMode, type SystemMode } from "@workspace/strategy-core";

type NodeEnv = "development" | "test" | "production";

function parseNodeEnv(raw: string | undefined): NodeEnv {
  const normalized = String(raw ?? "development").trim().toLowerCase();
  if (normalized === "development" || normalized === "test" || normalized === "production") {
    return normalized;
  }
  throw new Error(`Invalid NODE_ENV "${String(raw)}". Expected development | test | production.`);
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer environment value for ${name}: "${raw}"`);
  }
  return parsed;
}

// P0-1: safe defaults for clean-clone boot. Fail-fast reserved for production + live_enabled.
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = "./.runtime";
const DEFAULT_CORS_ORIGIN = "http://localhost:3000";

function parsePort(raw: string | undefined, env: NodeEnv): number {
  if (!raw) {
    if (env === "production") {
      throw new Error("PORT environment variable is required in production.");
    }
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid PORT value "${raw}". Expected integer between 1 and 65535.`);
  }
  return parsed;
}

function parseCorsOrigins(raw: string | undefined, env: NodeEnv): string[] {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return env === "production" ? [] : [DEFAULT_CORS_ORIGIN];
  }
  return trimmed
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function ensureDataDir(): string {
  const raw = String(process.env.GODSVIEW_DATA_DIR ?? "").trim();
  if (raw) return raw;
  process.env.GODSVIEW_DATA_DIR = DEFAULT_DATA_DIR;
  return DEFAULT_DATA_DIR;
}

function parseBodyLimit(raw: string | undefined): string {
  const value = String(raw ?? "1mb").trim().toLowerCase();
  if (/^\d+(b|kb|mb)$/i.test(value)) return value;
  throw new Error(
    `Invalid GODSVIEW_REQUEST_BODY_LIMIT "${String(raw)}". Use values like 256kb or 1mb.`,
  );
}

function parseTrustProxy(raw: string | undefined): boolean | number {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return false;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;

  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;

  throw new Error(
    `Invalid GODSVIEW_TRUST_PROXY "${String(raw)}". Use true/false or a hop count integer.`,
  );
}

function requiredTrimmed(name: string): string {
  return String(process.env[name] ?? "").trim();
}

const legacyLiveTradingEnabled =
  String(process.env.GODSVIEW_ENABLE_LIVE_TRADING ?? "").trim().toLowerCase() === "true";
const nodeEnv = parseNodeEnv(process.env.NODE_ENV);
const systemMode = resolveSystemMode(process.env.GODSVIEW_SYSTEM_MODE, {
  liveTradingEnabled: legacyLiveTradingEnabled,
});
const dataDir = ensureDataDir();
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN, nodeEnv);
const operatorToken = requiredTrimmed("GODSVIEW_OPERATOR_TOKEN");
const hasAlpacaKeys =
  requiredTrimmed("ALPACA_API_KEY").length > 0 && requiredTrimmed("ALPACA_SECRET_KEY").length > 0;
const hasAnthropicKey = requiredTrimmed("ANTHROPIC_API_KEY").length > 0;

function validateRuntimeConfig(config: RuntimeConfig): void {
  if (config.nodeEnv === "production" && config.corsOrigins.length === 0) {
    throw new Error("CORS_ORIGIN is required in production.");
  }

  if (config.systemMode === "live_enabled" && !config.hasOperatorToken) {
    throw new Error(
      "GODSVIEW_OPERATOR_TOKEN is required when GODSVIEW_SYSTEM_MODE=live_enabled.",
    );
  }

  if (config.systemMode === "live_enabled" && !config.hasAlpacaKeys) {
    throw new Error(
      "ALPACA_API_KEY and ALPACA_SECRET_KEY are required when GODSVIEW_SYSTEM_MODE=live_enabled.",
    );
  }

  if (config.systemMode === "live_enabled") {
    const keyPrefix = requiredTrimmed("ALPACA_API_KEY").slice(0, 2).toUpperCase();
    if (keyPrefix !== "PK" && keyPrefix !== "AK") {
      throw new Error(
        "ALPACA_API_KEY must be a Trading API key (PK... for paper or AK... for live) when GODSVIEW_SYSTEM_MODE=live_enabled.",
      );
    }
  }
}

export interface RuntimeConfig {
  nodeEnv: NodeEnv;
  port: number;
  dataDir: string;
  corsOrigins: string[];
  systemMode: SystemMode;
  trustProxy: boolean | number;
  requestBodyLimit: string;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  headersTimeoutMs: number;
  shutdownTimeoutMs: number;
  maxRequestsPerSocket: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  hasAlpacaKeys: boolean;
  hasAnthropicKey: boolean;
  hasOperatorToken: boolean;
}

const config: RuntimeConfig = {
  nodeEnv,
  port: parsePort(process.env.PORT, nodeEnv),
  dataDir,
  corsOrigins,
  systemMode,
  trustProxy: parseTrustProxy(process.env.GODSVIEW_TRUST_PROXY),
  requestBodyLimit: parseBodyLimit(process.env.GODSVIEW_REQUEST_BODY_LIMIT),
  requestTimeoutMs: parsePositiveIntegerEnv("GODSVIEW_REQUEST_TIMEOUT_MS", 45_000),
  keepAliveTimeoutMs: parsePositiveIntegerEnv("GODSVIEW_KEEPALIVE_TIMEOUT_MS", 65_000),
  headersTimeoutMs: parsePositiveIntegerEnv("GODSVIEW_HEADERS_TIMEOUT_MS", 66_000),
  shutdownTimeoutMs: parsePositiveIntegerEnv("GODSVIEW_SHUTDOWN_TIMEOUT_MS", 20_000),
  maxRequestsPerSocket: parsePositiveIntegerEnv("GODSVIEW_MAX_REQUESTS_PER_SOCKET", 200),
  rateLimitWindowMs: parsePositiveIntegerEnv("GODSVIEW_RATE_LIMIT_WINDOW_MS", 60_000),
  rateLimitMax: parsePositiveIntegerEnv("GODSVIEW_RATE_LIMIT_MAX", 300),
  hasAlpacaKeys,
  hasAnthropicKey,
  hasOperatorToken: operatorToken.length > 0,
};

validateRuntimeConfig(config);

export const runtimeConfig: Readonly<RuntimeConfig> = Object.freeze(config);

export function getRuntimeConfigForLog(): Record<string, string | number | boolean> {
  return {
    nodeEnv: runtimeConfig.nodeEnv,
    port: runtimeConfig.port,
    dataDir: runtimeConfig.dataDir,
    systemMode: runtimeConfig.systemMode,
    corsOriginCount: runtimeConfig.corsOrigins.length,
    trustProxy: runtimeConfig.trustProxy,
    requestBodyLimit: runtimeConfig.requestBodyLimit,
    requestTimeoutMs: runtimeConfig.requestTimeoutMs,
    keepAliveTimeoutMs: runtimeConfig.keepAliveTimeoutMs,
    headersTimeoutMs: runtimeConfig.headersTimeoutMs,
    shutdownTimeoutMs: runtimeConfig.shutdownTimeoutMs,
    maxRequestsPerSocket: runtimeConfig.maxRequestsPerSocket,
    rateLimitWindowMs: runtimeConfig.rateLimitWindowMs,
    rateLimitMax: runtimeConfig.rateLimitMax,
    hasAlpacaKeys: runtimeConfig.hasAlpacaKeys,
    hasAnthropicKey: runtimeConfig.hasAnthropicKey,
    hasOperatorToken: runtimeConfig.hasOperatorToken,
  };
}
