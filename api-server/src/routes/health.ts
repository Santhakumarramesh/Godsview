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

/* ── Startup timestamp ────────────────────────────────────────────── */
const startedAt = new Date().toISOString();

/* ── Liveness: is the process running? ────────────────────────────── */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    uptime: process.uptime(),
    startedAt,
    memoryMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
  });
});

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
    const hasAlpacaKey = !!process.env["ALPACA_API_KEY"];
    if (hasAlpacaKey) {
      const { getAccount } = await import("../lib/alpaca");
      await getAccount();
      checks["alpaca"] = { status: "ok", latencyMs: Date.now() - alpacaStart };
    } else {
      checks["alpaca"] = { status: "skipped", error: "ALPACA_API_KEY not configured" };
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
  const memThresholdMB = 512;
  if (memMB > memThresholdMB) {
    checks["memory"] = { status: "warning", error: `RSS ${memMB}MB exceeds ${memThresholdMB}MB threshold` };
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
