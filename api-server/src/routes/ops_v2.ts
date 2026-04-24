/**
 * Operations V2 Routes — Hardened operator-facing endpoints.
 *
 * Routes:
 * - GET  /api/ops/v2/brief           — Operator daily brief
 * - GET  /api/ops/v2/kill-switch     — Kill switch status
 * - POST /api/ops/v2/kill-switch/activate   — Activate kill switch
 * - POST /api/ops/v2/kill-switch/deactivate — Deactivate kill switch
 * - GET  /api/ops/v2/exposure        — Current exposure limits
 * - GET  /api/ops/v2/drift           — Strategy calibration drift
 * - GET  /api/ops/v2/startup         — Startup validation result
 */
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { generateOperatorBrief } from "../lib/ops/operator_brief";
import {
  activateKillSwitch,
  deactivateKillSwitch,
  getKillSwitchState,
  getKillSwitchEvents,
  type KillSwitchReason,
} from "../lib/risk/kill_switch";
import { getExposureLimits } from "../lib/risk/exposure_guard";
import { getAllTrackers, getDriftAlerts, getCriticalDriftStrategies } from "../lib/learning/post_trade_loop";
import { runStartupValidation } from "../lib/ops/startup_validator";

const router: IRouter = Router();

// ── Operator Brief ──────────────────────────────────────────────────────────

router.get("/brief", (_req, res) => {
  try {
    const brief = generateOperatorBrief();
    res.json(brief);
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to generate operator brief");
    res.status(500).json({ error: "Failed to generate brief" });
  }
});

// ── Kill Switch ─────────────────────────────────────────────────────────────

router.get("/kill-switch", (_req, res) => {
  res.json({
    state: getKillSwitchState(),
    recentEvents: getKillSwitchEvents(20),
  });
});

router.post("/kill-switch/activate", (req, res) => {
  const { reason, actor } = req.body ?? {};
  const validReasons: KillSwitchReason[] = [
    "operator_manual", "circuit_breaker_escalation", "drawdown_halt",
    "data_quality_degraded", "calibration_drift", "system_health_failure",
    "exposure_limit_breach", "preflight_failure",
  ];

  const ksReason: KillSwitchReason = validReasons.includes(reason) ? reason : "operator_manual";
  const ksActor = typeof actor === "string" ? actor : "operator_api";

  const activated = activateKillSwitch(ksReason, ksActor);
  res.json({
    activated,
    state: getKillSwitchState(),
  });
});

router.post("/kill-switch/deactivate", (req, res) => {
  const { actor } = req.body ?? {};

  if (!actor || typeof actor !== "string") {
    res.status(400).json({ error: "actor is required (string identifier)" });
    return;
  }

  const result = deactivateKillSwitch(actor);
  res.json({
    ...result,
    state: getKillSwitchState(),
  });
});

// ── Exposure ────────────────────────────────────────────────────────────────

router.get("/exposure", (_req, res) => {
  res.json({
    limits: getExposureLimits(),
    generatedAt: new Date().toISOString(),
  });
});

// ── Drift & Calibration ─────────────────────────────────────────────────────

router.get("/drift", (_req, res) => {
  res.json({
    trackers: getAllTrackers(),
    alerts: getDriftAlerts(),
    critical: getCriticalDriftStrategies(),
    generatedAt: new Date().toISOString(),
  });
});

// ── Startup Validation ──────────────────────────────────────────────────────

router.get("/startup", (_req, res) => {
  const result = runStartupValidation();
  res.json(result);
});

export default router;
