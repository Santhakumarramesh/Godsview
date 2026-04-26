/**
 * Health & Readiness Endpoints
 * - /healthz       — Liveness probe (is the process alive?)
 * - /readyz        — Readiness probe (are dependencies healthy?)
 * - /metrics       — Prometheus-compatible metrics
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { collectMetrics } from "../lib/metrics";
import { checkDbHealth } from "@workspace/db";
import { getDegradationSnapshot } from "../lib/degradation";

const router: IRouter = Router();

/* ── Startup timestamp ────────────────────────────────────────────── */
const startedAt = new Date().toISOString();

/* ── Liveness: is the process running? ────────────────────────────── */
router.get("/healthz", (_req: Request, res: Response): void => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    uptime: process.uptime(),
    startedAt,
    memoryMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
  });
});

/* ── Readiness: are dependencies healthy? ─────────────────────────── */
router.get("/readyz", async (_req: Request, res: Response): Promise<void> => {
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

  // Check 2: Redis connectivity
  const redisUrl = (process.env.REDIS_URL ?? "").trim();
  if (redisUrl) {
    try {
      const redisStart = Date.now();
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
      if (redisOk) {
        checks["redis"] = { status: "ok", latencyMs: Date.now() - redisStart };
      } else {
        checks["redis"] = { status: "error", error: "TCP connect failed" };
        allHealthy = false;
      }
    } catch (err: any) {
      checks["redis"] = { status: "error", error: err.message };
      allHealthy = false;
    }
  } else {
    checks["redis"] = { status: "skipped", error: "REDIS_URL not configured" };
  }

  // Check 3: Alpaca API connectivity
  try {
    const alpacaStart = Date.now();
    const { getAccount, getAlpacaCredentialStatus } = await import("../lib/alpaca");
    const credStatus = getAlpacaCredentialStatus();
    if (credStatus.keyConfigured && credStatus.secretConfigured) {
      if (!credStatus.hasValidTradingKey) {
        // Key present but not a valid trading key (e.g. broker key)
        checks["alpaca"] = { status: "degraded", error: `Key kind '${credStatus.keyKind}' — broker keys require trading account access` };
      } else {
        // Try a real connectivity check
        const account = await getAccount() as Record<string, unknown>;
        if (account && typeof account === "object" && "error" in account) {
          const errKey = String((account as any).error ?? "");
          const errMsg = String((account as any).message ?? "");
          checks["alpaca"] = { status: "degraded", error: errMsg ? `${errKey}: ${errMsg}` : errKey };
        } else {
          checks["alpaca"] = { status: "ok", latencyMs: Date.now() - alpacaStart };
        }
      }
    } else {
      checks["alpaca"] = { status: "skipped", error: "ALPACA_API_KEY not configured" };
    }
  } catch (err: any) {
    checks["alpaca"] = { status: "degraded", error: err.message };
  }

  // Check 4: Claude API availability
  try {
    const hasAnthropicKey = !!process.env["ANTHROPIC_API_KEY"];
    checks["claude"] = hasAnthropicKey
      ? { status: "ok" }
      : { status: "skipped", error: "ANTHROPIC_API_KEY not configured" };
  } catch (err: any) {
    checks["claude"] = { status: "degraded", error: err.message };
  }

  // Check 5: Memory pressure
  const memMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);
  const memThresholdMB = 512;
  if (memMB > memThresholdMB) {
    checks["memory"] = { status: "warning", error: `RSS ${memMB}MB exceeds ${memThresholdMB}MB threshold` };
  } else {
    checks["memory"] = { status: "ok", latencyMs: 0 };
  }

  // Check 6: Event loop lag (detect blocking)
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
router.get("/metrics", (_req: Request, res: Response): void => {
  try {
    const metrics = collectMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metrics);
  } catch (err) {
    logger.error({ err }, "Failed to collect metrics");
    res.status(503).json({ error: "Failed to collect metrics" });
  }
});

/* ── Degradation Status ───────────────────────────────────────────── */
router.get("/degradation", (_req: Request, res: Response): void => {
  try {
    const snapshot = getDegradationSnapshot();
    res.json(snapshot);
  } catch (err: any) {
    logger.error({ err }, "Failed to get degradation snapshot");
    res.status(503).json({ error: "Failed to get degradation snapshot" });
  }
});

/* ── Auth Failure State ───────────────────────────────────────────── */
router.get("/auth-failures", async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getAlpacaAuthFailureState } = await import("../lib/alpaca");
    const { getOrderbookAuthFailureState } = await import("../lib/market/orderbook");
    res.json({
      alpaca: { authFailure: getAlpacaAuthFailureState() },
      orderbook: { authFailure: getOrderbookAuthFailureState() },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get auth failure state");
    res.status(503).json({ error: "Failed to get auth failure state" });
  }
});

/* ── Reasoning Fallback State ────────────────────────────────────── */
router.get("/reasoning-fallback", async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getReasoningFallbackState } = await import("../lib/reasoning_engine");
    const fallbackState = getReasoningFallbackState();
    res.json({
      claudeConfigured: !!process.env.ANTHROPIC_API_KEY,
      reasoningFallback: fallbackState,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get reasoning fallback state");
    res.status(503).json({ error: "Failed to get reasoning fallback state" });
  }
});

/* ── DB Health (detailed) ─────────────────────────────────────────── */
router.get("/db-health", async (_req: Request, res: Response): Promise<void> => {
  try {
    const health = await checkDbHealth();
    res.status(health.ok ? 200 : 503).json(health);
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

export default router;
