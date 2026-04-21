/**
 * Preflight Checks — Validates all required subsystems before the server
 * starts accepting traffic. Runs once on boot.
 *
 * Checks:
 * 1. Database connectivity
 * 2. Alpaca API credentials (if trading mode)
 * 3. Anthropic API key (optional, logs warning)
 * 4. Environment variable completeness
 * 5. Disk space (PGlite data dir)
 * 6. Process permissions
 */

import { logger } from "./logger";
import { runtimeConfig } from "./runtime_config";

export interface PreflightResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
    critical: boolean;
  }>;
  duration_ms: number;
}

export async function runPreflight(): Promise<PreflightResult> {
  const start = Date.now();
  const checks: PreflightResult["checks"] = [];

  // 1. Database connectivity
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.push({ name: "database", passed: true, detail: "Connected", critical: true });
  } catch (err: any) {
    checks.push({ name: "database", passed: false, detail: err.message ?? "Connection failed", critical: true });
  }

  // 2. Alpaca API credentials
  const alpacaKey = (process.env.ALPACA_API_KEY ?? "").trim();
  const alpacaSecret = (process.env.ALPACA_SECRET_KEY ?? "").trim();
  if (alpacaKey && alpacaSecret) {
    // Verify key format
    const validPrefix = alpacaKey.startsWith("PK") || alpacaKey.startsWith("AK") || alpacaKey.startsWith("CK");
    if (validPrefix) {
      checks.push({ name: "alpaca_keys", passed: true, detail: `Key prefix: ${alpacaKey.substring(0, 2)}`, critical: false });
    } else {
      checks.push({ name: "alpaca_keys", passed: false, detail: `Unknown key prefix: ${alpacaKey.substring(0, 2)}`, critical: false });
    }

    // Try a lightweight API call
    try {
      const { getAccount } = await import("./alpaca");
      const account = await getAccount() as Record<string, unknown>;
      // Check for structured error responses (e.g. {error: "broker_key", message: "..."})
      if (account && typeof account === "object" && "error" in account) {
        const msg = String((account as any).message ?? (account as any).error ?? "Unknown broker error");
        checks.push({ name: "alpaca_connectivity", passed: false, detail: msg.substring(0, 100), critical: false });
      } else {
        checks.push({ name: "alpaca_connectivity", passed: true, detail: "Account accessible", critical: false });
      }
    } catch (err: any) {
      checks.push({ name: "alpaca_connectivity", passed: false, detail: err.message?.substring(0, 100) ?? "Unreachable", critical: false });
    }
  } else {
    checks.push({ name: "alpaca_keys", passed: false, detail: "Not configured — market data limited", critical: false });
  }

  // 3. Anthropic API key
  const anthropicKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (anthropicKey) {
    checks.push({ name: "anthropic_key", passed: true, detail: "Configured", critical: false });
  } else {
    checks.push({ name: "anthropic_key", passed: false, detail: "Not set — Claude veto layer disabled", critical: false });
  }

  // 4. System mode validation
  const mode = runtimeConfig.systemMode;
  const modeOk = ["dry_run", "paper_enabled", "live_enabled"].includes(mode);
  checks.push({
    name: "system_mode",
    passed: modeOk,
    detail: `Mode: ${mode}`,
    critical: true,
  });

  // 5. Operator token (required for live mode)
  if (mode === "live_enabled") {
    const hasToken = runtimeConfig.hasOperatorToken;
    checks.push({
      name: "operator_token",
      passed: hasToken,
      detail: hasToken ? "Configured" : "MISSING — live trading will be blocked",
      critical: true,
    });
  }

  // 6. Redis connectivity (if configured)
  const redisUrl = (process.env.REDIS_URL ?? "").trim();
  if (redisUrl) {
    try {
      // Lightweight TCP check — doesn't require ioredis
      const url = new URL(redisUrl);
      const net = await import("net");
      const redisOk = await new Promise<boolean>((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(3000);
        sock.once("connect", () => { sock.destroy(); resolve(true); });
        sock.once("error", () => { sock.destroy(); resolve(false); });
        sock.once("timeout", () => { sock.destroy(); resolve(false); });
        sock.connect(Number(url.port) || 6379, url.hostname);
      });
      checks.push({
        name: "redis",
        passed: redisOk,
        detail: redisOk ? `Connected to ${url.hostname}:${url.port || 6379}` : "TCP connect failed",
        critical: false,
      });
    } catch (err: any) {
      checks.push({ name: "redis", passed: false, detail: err.message ?? "Invalid REDIS_URL", critical: false });
    }
  } else {
    checks.push({ name: "redis", passed: true, detail: "Not configured — using in-process cache", critical: false });
  }

  // 7. Memory store path writability
  const memPath = process.env.MEMORY_STORE_PATH || (
    process.env.NODE_ENV === "production" ? "/data/memory" : "/tmp/godsview-memory"
  );
  try {
    const fsCheck = await import("fs");
    if (!fsCheck.existsSync(memPath)) {
      fsCheck.mkdirSync(memPath, { recursive: true });
    }
    // Write and remove a test file
    const testFile = `${memPath}/.preflight_test_${Date.now()}`;
    fsCheck.writeFileSync(testFile, "ok");
    fsCheck.unlinkSync(testFile);
    checks.push({ name: "memory_store_path", passed: true, detail: `Writable: ${memPath}`, critical: false });
  } catch (err: any) {
    checks.push({
      name: "memory_store_path",
      passed: false,
      detail: `${memPath} not writable: ${err.message}`,
      critical: process.env.NODE_ENV === "production",
    });
  }

  // 8. Process memory check
  const rssBytes = process.memoryUsage.rss();
  const rssMB = Math.round(rssBytes / 1024 / 1024);
  checks.push({
    name: "memory",
    passed: rssMB < 1024,
    detail: `RSS: ${rssMB}MB`,
    critical: false,
  });

  // 9. Node version check
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1), 10);
  checks.push({
    name: "node_version",
    passed: majorVersion >= 20,
    detail: nodeVersion,
    critical: majorVersion < 18,
  });

  const allCriticalPassed = checks.filter((c) => c.critical).every((c) => c.passed);
  const allPassed = checks.every((c) => c.passed);
  const duration = Date.now() - start;

  const result: PreflightResult = {
    passed: allCriticalPassed,
    checks,
    duration_ms: duration,
  };

  // Log results
  for (const check of checks) {
    if (check.passed) {
      logger.info({ check: check.name, detail: check.detail }, "Preflight ✓");
    } else if (check.critical) {
      logger.error({ check: check.name, detail: check.detail }, "Preflight ✗ CRITICAL");
    } else {
      logger.warn({ check: check.name, detail: check.detail }, "Preflight ✗ (non-critical)");
    }
  }

  if (allCriticalPassed) {
    logger.info({ duration_ms: duration, total: checks.length, passed: checks.filter((c) => c.passed).length },
      allPassed ? "All preflight checks passed" : "Preflight passed with warnings");
  } else {
    logger.fatal({ duration_ms: duration, failed: checks.filter((c) => !c.passed && c.critical).map((c) => c.name) },
      "PREFLIGHT FAILED — critical checks did not pass");
  }

  return result;
}
