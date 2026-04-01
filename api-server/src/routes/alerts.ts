/**
 * Alert & Execution API Routes
 * - GET  /alerts           — Recent alert history
 * - GET  /alerts/active    — Unacknowledged alerts only
 * - POST /alerts/:ts/ack   — Acknowledge an alert
 * - GET  /execution/mode   — Current execution mode
 * - GET  /execution/gate   — Production gate stats
 */

import { Router, type IRouter } from "express";
import {
  getAlertHistory,
  getActiveAlerts,
  acknowledgeAlert,
} from "../lib/alerts";
import { getExecutionMode } from "../lib/order_executor";
import { getProductionGateStats } from "../lib/production_gate";
import { getFullSessionStatus } from "../lib/session_guard";

const router: IRouter = Router();

// ── Alert Endpoints ──────────────────────────────────────────

router.get("/alerts", (req, res) => {
  const limit = Math.min(Number(req.query?.limit) || 50, 200);
  res.json({ alerts: getAlertHistory(limit) });
});
router.get("/alerts/active", (_req, res) => {
  res.json({ alerts: getActiveAlerts() });
});

router.post("/alerts/:ts/ack", (req, res) => {
  const ts = req.params.ts;
  if (!ts) {
    res.status(400).json({ error: "Timestamp parameter required" });
    return;
  }
  const acked = acknowledgeAlert(decodeURIComponent(ts));
  if (acked) {
    res.json({ acknowledged: true });
  } else {
    res.status(404).json({ error: "Alert not found" });
  }
});

// ── Execution Endpoints ──────────────────────────────────────

router.get("/execution/mode", (_req, res) => {
  res.json(getExecutionMode());
});

router.get("/execution/gate", (_req, res) => {
  res.json(getProductionGateStats());
});

router.get("/execution/session", (_req, res) => {
  res.json(getFullSessionStatus());
});

export default router;