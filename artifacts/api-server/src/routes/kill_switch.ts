/**
 * Kill-switch operator API.
 *
 *   GET    /api/system/kill-switch          — snapshot (public, read-only)
 *   POST   /api/system/kill-switch          — activate (operator only)
 *   DELETE /api/system/kill-switch          — deactivate (operator only)
 *
 * Activation also writes an audit_event with event_type='kill_switch.activated'.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { auditEventsTable, db } from "@workspace/db";
import { requireOperator } from "../lib/auth_guard";
import {
  activateKillSwitch,
  deactivateKillSwitch,
  getKillSwitchSnapshot,
} from "../lib/kill_switch";
import { systemMetrics } from "../lib/system_metrics";

const router = Router();

const ActivateSchema = z.object({
  reason: z.string().min(1).max(240),
});

router.get("/kill-switch", (_req: Request, res: Response) => {
  res.json({ ok: true, ...getKillSwitchSnapshot() });
});

router.post("/kill-switch", requireOperator, async (req: Request, res: Response) => {
  const parsed = ActivateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues });
    return;
  }
  const operatorId = (req as any).user?.id ?? "operator";
  const snap = activateKillSwitch(operatorId, parsed.data.reason);
  systemMetrics.log("warn", "kill_switch.activated", { by: operatorId, reason: parsed.data.reason });

  // Best-effort audit row (don't block on DB errors)
  try {
    await db.insert(auditEventsTable).values({
      event_type: "kill_switch.activated",
      decision_state: "blocked",
      system_mode: "paper",
      actor: String(operatorId),
      reason: parsed.data.reason,
      payload_json: JSON.stringify(snap),
    } as any);
  } catch { /* non-fatal */ }

  res.status(201).json({ ok: true, ...snap });
});

router.delete("/kill-switch", requireOperator, async (req: Request, res: Response) => {
  const operatorId = (req as any).user?.id ?? "operator";
  const snap = deactivateKillSwitch(operatorId);
  systemMetrics.log("warn", "kill_switch.deactivated", { by: operatorId });

  try {
    await db.insert(auditEventsTable).values({
      event_type: "kill_switch.deactivated",
      decision_state: "allowed",
      system_mode: "paper",
      actor: String(operatorId),
      payload_json: JSON.stringify(snap),
    } as any);
  } catch { /* non-fatal */ }

  res.json({ ok: true, ...snap });
});

export default router;
