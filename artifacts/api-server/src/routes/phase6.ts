/**
 * Phase 6 — production-hardening read-only endpoints.
 *
 *   GET /api/health/phase6    — service + db + redis + last reconciler/data-health timestamps
 *   GET /api/ready/phase6     — strict readiness (db + redis + required env)
 *   GET /api/ops/metrics      — JSON observability baseline (counts only)
 *
 * These supplement the existing `/healthz`, `/readyz`, and `/metrics`
 * endpoints. They are NOT replacements; the existing endpoints stay
 * untouched. Operators can alias these via nginx if they want the
 * Phase 6 shape to live at the canonical paths.
 */
import { Router, type Request, type Response } from "express";
import { proofLog, reconLog } from "../lib/log_channels";
import { snapshotCounters } from "../lib/ops/counters";
import { snapshotJobsStatus } from "../lib/paper_trades/jobs";
import { listRejectedTrades } from "../lib/paper_trades/store";
import { withRetry } from "../lib/ops/with_retry";

const router = Router();

interface ComponentStatus {
  status: "ok" | "fail" | "skipped";
  detail?: string;
  latency_ms?: number;
}

async function checkDb(): Promise<ComponentStatus> {
  try {
    const { checkDbHealth } = await import("@workspace/db");
    const r = await withRetry(() => checkDbHealth() as Promise<{ ok: boolean; error?: string; latencyMs?: number }>, {
      timeoutMs: 3_000,
      maxRetries: 1,
      backoffMs: 200,
    });
    if (r.ok) return { status: "ok", latency_ms: r.latencyMs };
    return { status: "fail", detail: r.error ?? "unknown" };
  } catch (err) {
    return { status: "fail", detail: (err as Error).message ?? String(err) };
  }
}

async function checkRedis(): Promise<ComponentStatus> {
  const url = (process.env.REDIS_URL ?? "").trim();
  if (!url) return { status: "skipped", detail: "REDIS_URL not configured" };
  try {
    const start = Date.now();
    const u = new URL(url);
    const net = await import("net");
    const ok = await new Promise<boolean>((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(2_000);
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("error", () => { sock.destroy(); resolve(false); });
      sock.once("timeout", () => { sock.destroy(); resolve(false); });
      sock.connect(Number(u.port) || 6379, u.hostname);
    });
    return ok
      ? { status: "ok", latency_ms: Date.now() - start }
      : { status: "fail", detail: "tcp_connect_failed" };
  } catch (err) {
    return { status: "fail", detail: (err as Error).message ?? String(err) };
  }
}

// ── GET /api/health/phase6 ────────────────────────────────────────────────
router.get("/api/health/phase6", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
    const jobs = snapshotJobsStatus();
    const allOk = db.status === "ok" && redis.status !== "fail";
    const body = {
      service: { status: allOk ? "ok" : "fail", uptime_sec: Math.floor(process.uptime()) },
      db,
      redis,
      last_reconciler_run: jobs.reconciler.last_result?.ran_at ?? null,
      last_data_health_check: jobs.data_health.last_result?.ran_at ?? null,
      checked_at: new Date().toISOString(),
    };
    res.status(allOk ? 200 : 503).json(body);
  } catch (err) {
    proofLog.error({ err }, "[phase6/health] failed");
    res.status(503).json({ service: { status: "fail" }, error: String(err) });
  }
});

// ── GET /api/ready/phase6 ─────────────────────────────────────────────────
router.get("/api/ready/phase6", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [db, redis] = await Promise.all([checkDb(), checkRedis()]);
    // Required env (matches phase6_env.ts contract; demo mode permits broker keys absent)
    const mode = String(process.env.GODSVIEW_SYSTEM_MODE ?? "").toLowerCase();
    const isDemo = mode === "demo";
    const requiredEnv = [
      ["DATABASE_URL", false],
      ["GODSVIEW_OPERATOR_TOKEN", false],
      ["ALPACA_API_KEY", isDemo],
      ["ALPACA_SECRET_KEY", isDemo],
      ["REDIS_URL", isDemo],
    ] as const;
    const envMissing = requiredEnv
      .filter(([_n, allowMissing]) => !allowMissing)
      .map(([n]) => n)
      .filter((n) => !(process.env[n] ?? "").trim());

    const reasons: string[] = [];
    if (db.status !== "ok") reasons.push(`db_${db.status}`);
    if (redis.status === "fail") reasons.push("redis_fail");
    if (envMissing.length > 0) reasons.push(`env_missing:${envMissing.join(",")}`);

    const ready = reasons.length === 0;
    res.status(ready ? 200 : 503).json({
      ready,
      reasons,
      db,
      redis,
      env_missing: envMissing,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    proofLog.error({ err }, "[phase6/ready] failed");
    res.status(503).json({ ready: false, error: String(err) });
  }
});

// ── GET /api/ops/metrics ──────────────────────────────────────────────────
router.get("/api/ops/metrics", async (_req: Request, res: Response): Promise<void> => {
  try {
    const counters = snapshotCounters();
    // rejected_trades is sourced from the persisted execution_audit, NOT from
    // an in-process counter, so the count survives restarts.
    let rejectedTrades = 0;
    try {
      const rejected = listRejectedTrades(50_000);
      rejectedTrades = rejected.length;
    } catch (err) {
      reconLog.warn({ err: (err as Error).message ?? String(err) }, "[phase6/metrics] rejected_trades read failed");
    }
    const jobs = snapshotJobsStatus();
    res.json({
      counters: {
        ...counters,
        rejected_trades: rejectedTrades,
        last_reconciler_run: jobs.reconciler.last_result?.ran_at ?? null,
        last_data_health_check: jobs.data_health.last_result?.ran_at ?? null,
      },
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    proofLog.error({ err }, "[phase6/metrics] failed");
    res.status(503).json({ error: "metrics_unavailable", message: String(err) });
  }
});

export default router;
