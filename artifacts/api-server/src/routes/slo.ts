/**
 * SLO Routes (Phase 6)
 *
 *   GET  /api/slo/definitions          — codified SLO definitions
 *   GET  /api/slo/budgets              — full snapshot incl. burn rate per SLO
 *   GET  /api/slo/burn-rate            — alerting SLOs only
 *   GET  /api/slo/burn-rate/:id        — single SLO burn rate detail
 *   GET  /api/slo/router/status        — SSE alert router stats + run state
 *   POST /api/slo/reset                — operator-gated, clears observation buffers
 */

import { Router, type Request, type Response } from "express";
import { SLO_DEFINITIONS, findSLO } from "../lib/slo/slo_definitions";
import { sloTracker } from "../lib/slo/slo_tracker";
import { sseAlertRouter } from "../lib/alerts/sse_alert_router";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";

const router: Router = Router();

router.get("/api/slo/definitions", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    count: SLO_DEFINITIONS.length,
    slos: SLO_DEFINITIONS.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      kind: s.kind,
      tier: s.tier,
      target: s.target,
      percentile: s.percentile,
      objective: s.objective,
      windowMs: s.windowMs,
      alertBurnRate: s.alertBurnRate,
      routePrefixes: s.routePrefixes ?? [],
    })),
    timestamp: new Date().toISOString(),
  });
});
router.get("/api/slo/budgets", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    snapshot: sloTracker.getBudgetSnapshot(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/api/slo/burn-rate", (_req: Request, res: Response) => {
  const all = sloTracker.getAllBurnRates();
  const alerting = all.filter((b) => b.alerting);
  res.json({
    status: "success",
    alertingCount: alerting.length,
    totalCount: all.length,
    alerting,
    all,
    timestamp: new Date().toISOString(),
  });
});

router.get("/api/slo/burn-rate/:id", (req: Request, res: Response) => {
  const rawId = req.params["id"];
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : undefined;
  if (!id || typeof id !== "string") {
    res.status(400).json({ error: "id_required" });
    return;
  }
  if (!findSLO(id)) {
    res.status(404).json({ error: "slo_not_found", id });
    return;
  }
  const burn = sloTracker.getBurnRate(id);
  res.json({
    status: "success",
    burn,
    timestamp: new Date().toISOString(),
  });
});
router.get("/api/slo/router/status", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    router: sseAlertRouter.getStats(),
    timestamp: new Date().toISOString(),
  });
});

router.post("/api/slo/reset", requireOperator, (_req: Request, res: Response) => {
  try {
    sloTracker.reset();
    logger.warn("SLO tracker observations reset by operator");
    res.json({
      status: "success",
      message: "SLO observation buffers cleared",
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err: err?.message ?? String(err) }, "SLO reset failed");
    res.status(500).json({ error: "reset_failed", message: err?.message ?? "Unknown error" });
  }
});

export default router;
