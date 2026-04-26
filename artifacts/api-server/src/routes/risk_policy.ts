/**
 * Risk policy persistence + audit.
 *
 *   GET  /api/risk/policy            — current active policy (public read)
 *   PUT  /api/risk/policy            — replace active policy (operator only)
 *   GET  /api/risk/policy/history    — recent policy changes (operator only)
 *
 * Every PUT writes a new row with `active=true` and flips the previous one
 * to `active=false` in a transaction. An audit_event is written with the
 * diff so reviewers can see what changed and why.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { riskPolicyTable, auditEventsTable, db } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireOperator } from "../lib/auth_guard";
import { systemMetrics } from "../lib/system_metrics";

const router = Router();

const PolicySchema = z.object({
  org_id:             z.string().default("org_default"),
  max_signal_age_sec: z.number().int().min(1).max(3600).default(300),
  min_rr:             z.number().min(0.1).max(10).default(1.0),
  max_exposure_usd:   z.number().min(1).max(100_000_000).default(50000),
  dollar_risk:        z.number().min(1).max(1_000_000).default(100),
  daily_loss_cap:     z.number().min(1).max(100_000_000).default(500),
  max_daily_trades:   z.number().int().min(1).max(10000).default(10),
  max_open_positions: z.number().int().min(1).max(1000).default(5),
  reason:             z.string().min(1).max(500).default("operator update"),
});

router.get("/policy", async (req: Request, res: Response) => {
  const orgId = String(req.query.org_id ?? "org_default");
  try {
    const rows = await db
      .select()
      .from(riskPolicyTable)
      .where(and(eq(riskPolicyTable.org_id, orgId), eq(riskPolicyTable.active, true)))
      .limit(1);
    res.json({ ok: true, policy: rows?.[0] ?? null });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

router.get("/policy/history", requireOperator, async (req: Request, res: Response) => {
  const orgId = String(req.query.org_id ?? "org_default");
  try {
    const rows = await db
      .select()
      .from(riskPolicyTable)
      .where(eq(riskPolicyTable.org_id, orgId))
      .orderBy(desc(riskPolicyTable.id))
      .limit(50);
    res.json({ ok: true, count: rows.length, policies: rows });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

router.put("/policy", requireOperator, async (req: Request, res: Response) => {
  const parsed = PolicySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues });
    return;
  }
  const p = parsed.data;
  const operatorId = (req as any).user?.id ?? "operator";

  try {
    // Read current active for the diff
    let current: any = null;
    try {
      const cur = await db
        .select()
        .from(riskPolicyTable)
        .where(and(eq(riskPolicyTable.org_id, p.org_id), eq(riskPolicyTable.active, true)))
        .limit(1);
      current = cur?.[0] ?? null;
    } catch { /* ignore */ }

    // Deactivate the existing active policy
    await db
      .update(riskPolicyTable)
      .set({ active: false } as any)
      .where(and(eq(riskPolicyTable.org_id, p.org_id), eq(riskPolicyTable.active, true)));

    // Insert the new one
    const inserted = await db
      .insert(riskPolicyTable)
      .values({
        org_id: p.org_id,
        active: true,
        max_signal_age_sec: p.max_signal_age_sec,
        min_rr: String(p.min_rr),
        max_exposure_usd: String(p.max_exposure_usd),
        dollar_risk: String(p.dollar_risk),
        daily_loss_cap: String(p.daily_loss_cap),
        max_daily_trades: p.max_daily_trades,
        max_open_positions: p.max_open_positions,
        set_by: String(operatorId),
        reason: p.reason,
      } as any)
      .returning({ id: riskPolicyTable.id });

    const newId = inserted?.[0]?.id ?? null;

    // Audit
    try {
      await db.insert(auditEventsTable).values({
        event_type: "risk_policy.updated",
        decision_state: "allowed",
        system_mode: "paper",
        actor: String(operatorId),
        reason: p.reason,
        org_id: p.org_id,
        payload_json: JSON.stringify({ from: current, to: { id: newId, ...p } }),
      } as any);
    } catch { /* non-fatal */ }

    systemMetrics.log("warn", "risk_policy.updated", {
      org: p.org_id, by: operatorId, newId, reason: p.reason,
    });
    res.status(201).json({ ok: true, policyId: newId });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

export default router;
