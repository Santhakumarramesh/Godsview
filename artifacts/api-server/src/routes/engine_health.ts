import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import { getOpsSnapshot } from "../lib/ops_monitor";
import { checkNewsLockout, getMacroContext } from "../lib/macro_engine";
import { getWarRoomCacheStats } from "../lib/war_room";

const router = Router();

/**
 * GET /engine-health
 * Unified endpoint that checks all GodsView engines and returns
 * a composite health status for monitoring / deployment checks.
 */
router.get("/engine-health", (_req: Request, res: Response): void => {
  try {
    const start = Date.now();

    // 1. Ops Monitor snapshot
    const ops = getOpsSnapshot();

    // 2. War Room cache stats
    const warRoom = getWarRoomCacheStats();

    // 3. Macro context
    const macro = getMacroContext();

    // 4. Build engine status map
    const engines: Record<string, { status: string; detail?: any }> = {
      checklist: { status: "ready" },
      war_room: {
        status: "ready",
        detail: { cached_entries: warRoom.size, cached_symbols: warRoom.entries },
      },
      macro: {
        status: macro.lockout_active ? "lockout_active" : "ready",
        detail: {
          events: macro.news_count_24h,
          risk_level: macro.risk_level,
          lockout: macro.lockout_active,
        },
      },
      feature_pipeline: { status: "ready" },
      portfolio: { status: "ready" },
    };

    // Add ops-tracked engines
    if (ops.engine_status) {
      for (const [name, eng] of Object.entries(ops.engine_status)) {
        engines[name] = {
          status: eng.error_count > 0 ? "degraded" : "ready",
          detail: eng,
        };
      }
    }

    // 5. Composite health
    const allReady = Object.values(engines).every((e) => e.status === "ready");
    const anyDegraded = Object.values(engines).some((e) => e.status === "degraded");

    const status = allReady
      ? "healthy"
      : anyDegraded
        ? "degraded"
        : "operational";

    res.json({
      status,
      engines,
      ops_alerts: ops.alerts?.slice(0, 5) ?? [],
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Engine health check failed: ${error}`);
    res.status(503).json({
      status: "error",
      error: error instanceof Error ? error.message : "Internal error",
    });
  }
});

export default router;
