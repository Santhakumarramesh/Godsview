import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { isLiveMode } from "@workspace/strategy-core";
import { runtimeConfig } from "../lib/runtime_config";
import { getStartupSnapshot } from "../lib/startup_state";
import { collectAllMetrics } from "../lib/metrics_execution";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  const startup = getStartupSnapshot();
  const checks = {
    database: { ok: false as boolean, detail: "" as string },
    mode: {
      ok: true as boolean,
      system_mode: runtimeConfig.systemMode,
      has_alpaca_keys: runtimeConfig.hasAlpacaKeys,
      has_operator_token: runtimeConfig.hasOperatorToken,
      has_anthropic_key: runtimeConfig.hasAnthropicKey,
    },
    ml_bootstrap: {
      ok: startup.mlBootstrap.state !== "failed",
      state: startup.mlBootstrap.state,
      error: startup.mlBootstrap.error,
    },
  };

  try {
    await db.execute(sql`select 1`);
    checks.database.ok = true;
    checks.database.detail = "database_ok";
  } catch (err) {
    checks.database.ok = false;
    checks.database.detail = err instanceof Error ? err.message : String(err);
  }

  if (isLiveMode(runtimeConfig.systemMode)) {
    checks.mode.ok =
      checks.mode.has_alpaca_keys &&
      checks.mode.has_operator_token;
  }

  const ready = checks.database.ok && checks.mode.ok;
  const degradedReasons: string[] = [];
  if (!checks.ml_bootstrap.ok) degradedReasons.push("ml_bootstrap_failed");
  if (!checks.mode.has_anthropic_key) degradedReasons.push("claude_layer_inactive");

  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    degraded: degradedReasons.length > 0,
    degraded_reasons: degradedReasons,
    timestamp: new Date().toISOString(),
    startup,
    checks,
  });
});

/* ── Prometheus Metrics ─────────────────────────────────────────── */
router.get("/metrics", (_req, res) => {
  try {
    const metrics = collectAllMetrics();
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(metrics);
  } catch {
    res.status(500).json({ error: "Failed to collect metrics" });
  }
});

export default router;
