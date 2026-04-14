/**
 * routes/audit_trail.ts — Phase 62 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  auditLogger,
  retentionPolicy,
  complianceEvaluator,
  type AuditAction,
  type ComplianceFramework,
} from "../lib/audit_trail";

const router = Router();

router.post("/api/audit/events", (req: Request, res: Response) => {
  const { actor, action, target, outcome, metadata } = req.body ?? {};
  if (!actor || !action || !target || !outcome) {
    return res.status(400).json({ error: "Missing actor, action, target, or outcome" });
  }
  const record = auditLogger.append({
    actor: String(actor),
    action: action as AuditAction,
    target: String(target),
    outcome,
    metadata: metadata ?? {},
  });
  return res.status(201).json(record);
});

router.get("/api/audit/events", (req: Request, res: Response) => {
  const { actor, action, since, until, limit } = req.query;
  res.json({
    events: auditLogger.list({
      actor: actor ? String(actor) : undefined,
      action: action ? (String(action) as AuditAction) : undefined,
      since: since ? Number(since) : undefined,
      until: until ? Number(until) : undefined,
      limit: limit ? Number(limit) : undefined,
    }),
    size: auditLogger.size(),
  });
});

router.get("/api/audit/verify", (_req: Request, res: Response) => {
  res.json(auditLogger.verifyChain());
});

// ── Retention & Legal Holds ────────────────────────────────────────────────

router.get("/api/audit/retention", (_req: Request, res: Response) => {
  res.json({
    retentionDays: retentionPolicy.getRetentionDays(),
    activeHolds: retentionPolicy.activeHolds(),
  });
});

router.post("/api/audit/retention", (req: Request, res: Response) => {
  const { days } = req.body ?? {};
  if (days === undefined) return res.status(400).json({ error: "Missing days" });
  retentionPolicy.setRetentionDays(Number(days));
  return res.json({ retentionDays: retentionPolicy.getRetentionDays() });
});

router.post("/api/audit/holds", (req: Request, res: Response) => {
  const { reason, placedBy, scope } = req.body ?? {};
  if (!reason || !placedBy) return res.status(400).json({ error: "Missing reason or placedBy" });
  return res.status(201).json(retentionPolicy.placeHold({ reason: String(reason), placedBy: String(placedBy), scope }));
});

router.delete("/api/audit/holds/:id", (req: Request, res: Response) => {
  const ok = retentionPolicy.releaseHold(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.post("/api/audit/prune", (_req: Request, res: Response) => {
  res.json(retentionPolicy.prune());
});

// ── Compliance ─────────────────────────────────────────────────────────────

router.get("/api/audit/compliance", (req: Request, res: Response) => {
  const framework = req.query.framework ? (String(req.query.framework) as ComplianceFramework) : undefined;
  const windowDays = req.query.windowDays ? Number(req.query.windowDays) : 30;
  res.json(complianceEvaluator.evaluate(framework, windowDays));
});

export default router;
