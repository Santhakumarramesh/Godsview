/**
 * Health & Readiness Endpoints
 * - /healthz       — Liveness probe (is the process alive?)
 * - /readyz        — Readiness probe (are dependencies healthy?)
 * - /metrics       — Prometheus-compatible metrics
 */
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { collectMetrics } from "../lib/metrics";
import { checkDbHealth } from "@workspace/db";
import { getDegradationSnapshot } from "../lib/degradation";

const router: IRouter = Router();
const DEFAULT_HEALTH_MEMORY_WARN_MB = 1024;
const parsedHealthMemoryWarnMb = Number.parseInt(
  process.env.HEALTH_MEMORY_WARN_MB ?? String(DEFAULT_HEALTH_MEMORY_WARN_MB),
  10,
);
const HEALTH_MEMORY_WARN_MB =
  Number.isFinite(parsedHealthMemoryWarnMb) && parsedHealthMemoryWarnMb > 0
    ? parsedHealthMemoryWarnMb
    : DEFAULT_HEALTH_MEMORY_WARN_MB;

function extractPayloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const error = typeof rec.error === "string" ? rec.error.trim() : "";
  const message = typeof rec.message === "string" ? rec.message.trim() : "";
  if (!error && !message) return null;
  if (error && message) return `${error}: ${message}`;
  return error || message;
}

/* ── Startup timestamp ────────────────────────────────────────────── */
const startedAt = new Date().toISOString();

/* ── Liveness: is the process running? ────────────────────────────── */
const livenessHandler = (_req: import("express").Request, res: import("express").Response): void => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  const mem = process.memoryUsage();
  res.json({
    ...data,
    uptime: process.uptime(),
    startedAt,
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      externalMB: Math.round(mem.external / 1024 / 1024),
    },
  });
};
router.get("/healthz", livenessHandler);
// Production-readiness alias (matches NEXT_SESSION_PROMPT gate /api/health)
router.get("/health", livenessHandler);

/* ── Readiness: are dependencies healthy? ─────────────────────────── */
router.get("/readyz", async (_req, res) => {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let allHealthy = true;

  // Check 1: Database
  try {
    const dbHealth = await checkDbHealth();
    if (dbHealth.ok) {
      checks["database"] = {
        status: "ok",
        latencyMs: dbHealth.latencyMs,
        ...(dbHealth.poolTotal !== undefined && {
          error: `pool: ${dbHealth.poolTotal} total, ${dbHealth.poolIdle} idle, ${dbHealth.poolWaiting} waiting`,
        }),
      };
    } else {
      checks["database"] = { status: "error", error: dbHealth.error };
      allHealthy = false;
    }
  } catch (err: any) {
    checks["database"] = { status: "error", error: err.message };
    allHealthy = false;
  }

  // Check 2: Alpaca API connectivity
  try {
    const alpacaStart = Date.now();
    const { getAccount, getAlpacaCredentialStatus } = await import("../lib/alpaca");
    const creds = getAlpacaCredentialStatus();
    if (!creds.keyConfigured || !creds.secretConfigured) {
      checks["alpaca"] = { status: "skipped", error: "ALPACA_API_KEY/ALPACA_SECRET_KEY not configured" };
    } else if (!creds.hasValidTradingKey) {
      checks["alpaca"] = {
        status: "degraded",
        error: `Unsupported key type: ${creds.keyKind} (${creds.keyPrefix ?? "unknown"})`,
      };
    } else {
      const account = await getAccount();
      const payloadError = extractPayloadError(account);
      if (payloadError) {
        checks["alpaca"] = { status: "degraded", error: payloadError };
      } else {
        checks["alpaca"] = { status: "ok", latencyMs: Date.now() - alpacaStart };
      }
    }
  } catch (err: any) {
    checks["alpaca"] = { status: "degraded", error: err.message };
  }

  // Check 3: Claude API availability
  try {
    const hasAnthropicKey = !!process.env["ANTHROPIC_API_KEY"];
    checks["claude"] = hasAnthropicKey
      ? { status: "ok" }
      : { status: "skipped", error: "ANTHROPIC_API_KEY not configured" };
  } catch (err: any) {
    checks["claude"] = { status: "degraded", error: err.message };
  }

  // Check 4: Memory pressure
  const memMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);
  if (memMB > HEALTH_MEMORY_WARN_MB) {
    checks["memory"] = {
      status: "warning",
      error: `RSS ${memMB}MB exceeds ${HEALTH_MEMORY_WARN_MB}MB threshold`,
    };
  } else {
    checks["memory"] = { status: "ok", latencyMs: 0 };
  }

  // Check 5: Event loop lag (detect blocking)
  const lagStart = Date.now();
  await new Promise((resolve) => setImmediate(resolve));
  const lagMs = Date.now() - lagStart;
  if (lagMs > 100) {
    checks["eventLoop"] = { status: "warning", error: `Event loop lag ${lagMs}ms` };
  } else {
    checks["eventLoop"] = { status: "ok", latencyMs: lagMs };
  }

  const status = allHealthy ? 200 : 503;
  res.status(status).json({
    status: allHealthy ? "ready" : "not_ready",
    checks,
    uptime: process.uptime(),
    startedAt,
    nodeVersion: process.version,
    memoryMB: memMB,
  });
});

/* ── Prometheus Metrics ───────────────────────────────────────────── */
router.get("/metrics", (_req, res) => {
  try {
    const metrics = collectMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metrics);
  } catch (err) {
    logger.error({ err }, "Failed to collect metrics");
    res.status(500).json({ error: "Failed to collect metrics" });
  }
});

/* ── Degradation Status ───────────────────────────────────────────── */
router.get("/degradation", (_req, res) => {
  try {
    const snapshot = getDegradationSnapshot();
    res.json(snapshot);
  } catch (err: any) {
    logger.error({ err }, "Failed to get degradation snapshot");
    res.status(500).json({ error: "Failed to get degradation snapshot" });
  }
});

/* ── Auth Failure State ───────────────────────────────────────────── */
router.get("/auth-failures", async (_req, res) => {
  try {
    const { getAlpacaCredentialStatus, getAlpacaAuthFailureState } = await import("../lib/alpaca");
    const { getOrderbookAuthFailureState } = await import("../lib/market/orderbook");
    res.json({
      alpaca: {
        credentials: getAlpacaCredentialStatus(),
        authFailure: getAlpacaAuthFailureState(),
      },
      orderbook: {
        authFailure: getOrderbookAuthFailureState(),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get auth failure state");
    res.status(500).json({ error: "Failed to get auth failure state" });
  }
});

/* ── Reasoning Fallback State ─────────────────────────────────────── */
router.get("/reasoning-fallback", async (_req, res) => {
  try {
    const { getReasoningFallbackState } = await import("../lib/reasoning_engine");
    res.json({
      claudeConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      reasoningFallback: getReasoningFallbackState(),
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get reasoning fallback state");
    res.status(500).json({ error: "Failed to get reasoning fallback state" });
  }
});

/* ── DB Health (detailed) ─────────────────────────────────────────── */
router.get("/db-health", async (_req, res) => {
  try {
    const health = await checkDbHealth();
    res.status(health.ok ? 200 : 503).json(health);
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

export default router;
