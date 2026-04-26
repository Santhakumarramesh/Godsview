/**
 * System metrics, recent logs, and deep health endpoints.
 *
 *   GET /api/system/metrics          — counters, latency p50/p95/p99, uptime
 *   GET /api/system/logs/recent      — in-memory ring of last 100 events
 *   GET /api/system/health/deep      — DB + Redis + disk + audit-table probe
 *
 * These are operator endpoints. Lightweight, no auth (assumed to be behind
 * the platform's reverse proxy + IP allowlist for the metrics path).
 */

import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import * as net from "net";
import {
  signalsTable,
  tradesTable,
  auditEventsTable,
  brainEntitiesTable,
  db,
} from "@workspace/db";
import { systemMetrics } from "../lib/system_metrics";
import { recentErrors } from "../middlewares/error_capture";
import { requireOperator } from "../lib/auth_guard";
import { isAutonomyAllowed } from "../lib/autonomy_gate";

const router = Router();

// Operator-only — counters can leak business signals (rejection patterns,
// throughput, failure rates) so we don't expose them on the public surface.
router.get("/metrics", requireOperator, (_req: Request, res: Response) => {
  res.json({ ok: true, ...systemMetrics.snapshot() });
});

// Prometheus exposition format
router.get("/metrics/prometheus", (_req: Request, res: Response) => {
  const s = systemMetrics.snapshot();
  const lines: string[] = [];
  const push = (name: string, type: string, help: string, value: number, labels?: string) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name}${labels ? labels : ""} ${value}`);
  };
  push("godsview_uptime_seconds", "gauge", "Process uptime in seconds", s.uptimeSec);
  push("godsview_signals_received_total", "counter", "Total webhook signals received", s.counters.signalsReceived);
  push("godsview_signals_accepted_total", "counter", "Total webhook signals that became paper trades", s.counters.signalsAccepted);
  push("godsview_signals_rejected_total", "counter", "Total webhook signals rejected", s.counters.signalsRejected);
  push("godsview_webhook_latency_ms_avg", "gauge", "Average webhook latency (ms)", Math.round(s.latencyMs.avg));
  push("godsview_webhook_latency_ms_p50", "gauge", "p50 webhook latency (ms)", s.latencyMs.p50);
  push("godsview_webhook_latency_ms_p95", "gauge", "p95 webhook latency (ms)", s.latencyMs.p95);
  push("godsview_webhook_latency_ms_p99", "gauge", "p99 webhook latency (ms)", s.latencyMs.p99);
  // Rejection reasons as labels
  for (const [reason, count] of Object.entries(s.rejectionReasons)) {
    const safe = reason.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64);
    push(
      "godsview_signals_rejected_by_reason_total",
      "counter",
      "Rejections grouped by reason",
      count,
      `{reason="${safe}"}`
    );
  }
  res.set("Content-Type", "text/plain; version=0.0.4");
  res.send(lines.join("\n") + "\n");
});

router.get("/logs/recent", requireOperator, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  res.json({ ok: true, count: limit, events: systemMetrics.recentLogs(limit) });
});

router.get("/errors", requireOperator, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
  res.json({ ok: true, count: limit, errors: recentErrors(limit) });
});

// Autonomy gate state — public read-only so the dashboard can warn the
// operator if any code path tries to enable autonomous mode prematurely.
router.get("/autonomy", (_req: Request, res: Response) => {
  res.json({ ok: true, ...isAutonomyAllowed() });
});

async function pingTcp(host: string, port: number, payload?: string, expect?: RegExp): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: 1500 }, () => {
      if (payload) sock.write(payload);
      else { sock.end(); resolve({ ok: true, ms: Date.now() - t0 }); }
    });
    sock.once("data", (buf) => {
      sock.end();
      if (!expect) return resolve({ ok: true, ms: Date.now() - t0 });
      resolve({ ok: expect.test(buf.toString()), ms: Date.now() - t0 });
    });
    sock.once("error", (err) => resolve({ ok: false, ms: Date.now() - t0, error: err.message }));
    sock.once("timeout", () => { sock.destroy(); resolve({ ok: false, ms: Date.now() - t0, error: "timeout" }); });
  });
}

router.get("/health/deep", async (_req: Request, res: Response) => {
  // DB connectivity + each critical table
  const dbStart = Date.now();
  let dbOk = false;
  let dbDetail = "";
  let tableCounts: Record<string, number | string> = {};
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
    dbDetail = `connected in ${Date.now() - dbStart}ms`;
    for (const [name, t] of [
      ["signals", signalsTable],
      ["trades", tradesTable],
      ["audit_events", auditEventsTable],
      ["brain_entities", brainEntitiesTable],
    ] as const) {
      try {
        const rows = await db.select({ c: sql<number>`count(*)::int` }).from(t);
        tableCounts[name] = (rows?.[0] as any)?.c ?? 0;
      } catch (err: any) {
        tableCounts[name] = `error: ${err?.message ?? String(err)}`;
      }
    }
  } catch (err: any) {
    dbOk = false;
    dbDetail = err?.message ?? String(err);
  }

  // Redis
  let redis: any = { ok: false };
  const redisUrl = (process.env.REDIS_URL ?? "").trim();
  if (redisUrl) {
    try {
      const u = new URL(redisUrl);
      redis = await pingTcp(u.hostname, parseInt(u.port || "6379", 10), "PING\r\n", /\+PONG/i);
    } catch (err: any) {
      redis = { ok: false, error: err?.message ?? String(err) };
    }
  } else {
    redis = { ok: false, error: "REDIS_URL not configured" };
  }

  // Disk free check (cheap, optional)
  let disk: any = null;
  try {
    const fs = await import("fs");
    const path = await import("path");
    const target = path.resolve(process.cwd());
    const stat = fs.statfsSync ? fs.statfsSync(target) : null;
    if (stat) {
      const freeBytes = (stat as any).bavail * (stat as any).bsize;
      disk = { freeMb: Math.round(freeBytes / (1024 * 1024)), path: target };
    }
  } catch {
    /* ignore */
  }

  // DB pool stats (best-effort — not every driver exposes them)
  let pool: any = null;
  try {
    const dbMod: any = await import("@workspace/db");
    const p = dbMod.pool;
    if (p && typeof p === "object") {
      pool = {
        total: typeof p.totalCount === "number" ? p.totalCount : null,
        idle: typeof p.idleCount === "number" ? p.idleCount : null,
        waiting: typeof p.waitingCount === "number" ? p.waitingCount : null,
      };
    }
  } catch { /* no pool stats available */ }

  const overall = dbOk && redis.ok;

  // Production safety nets — missing means the operator should know.
  const isProd = (process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const sentry = {
    configured: !!process.env.SENTRY_DSN,
    requiredInProd: isProd,
    warning: isProd && !process.env.SENTRY_DSN ? "SENTRY_DSN not set in production" : null,
  };
  const webhookSecret = {
    configured: !!process.env.TRADINGVIEW_WEBHOOK_SECRET,
    requiredInProd: isProd,
    warning: isProd && !process.env.TRADINGVIEW_WEBHOOK_SECRET
      ? "TRADINGVIEW_WEBHOOK_SECRET not set — production webhooks will return 503"
      : null,
  };

  res.status(overall ? 200 : 503).json({
    ok: overall,
    timestamp: new Date().toISOString(),
    db: { ok: dbOk, detail: dbDetail, tableCounts, pool },
    redis,
    disk,
    safetyNets: { sentry, webhookSecret },
    metrics: systemMetrics.snapshot(),
  });
});

export default router;
