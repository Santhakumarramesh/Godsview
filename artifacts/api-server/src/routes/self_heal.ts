/**
 * routes/self_heal.ts — Phase 90 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  diagnosticsRunner,
  remediationCatalog,
  selfHealRecommender,
  autoApplyGuard,
  type SafetyClass,
} from "../lib/self_heal";

const router = Router();

// ── Diagnostics ───────────────────────────────────────────────────────────

router.get("/api/heal/probes", (_req: Request, res: Response) => {
  res.json({ probes: diagnosticsRunner.listProbes() });
});

router.post("/api/heal/probes/:name/run", async (req: Request, res: Response) => {
  const f = await diagnosticsRunner.runOne(String(req.params.name));
  return res.json({ finding: f });
});

router.post("/api/heal/probes/run-all", async (_req: Request, res: Response) => {
  const findings = await diagnosticsRunner.runAll();
  res.json({ findings });
});

router.get("/api/heal/findings", (_req: Request, res: Response) => {
  res.json({ findings: diagnosticsRunner.recent(), open: diagnosticsRunner.open() });
});

router.post("/api/heal/findings/:id/resolve", (req: Request, res: Response) => {
  const f = diagnosticsRunner.resolve(String(req.params.id));
  if (!f) return res.status(404).json({ error: "Not found" });
  return res.json(f);
});

// ── Remediation Catalog ───────────────────────────────────────────────────

router.post("/api/heal/remediations", (req: Request, res: Response) => {
  const { name, description, matchSymptomPattern, safetyClass, estimatedImpactSeconds } = req.body ?? {};
  if (!name || !matchSymptomPattern || !safetyClass) {
    return res.status(400).json({ error: "Missing name, matchSymptomPattern, or safetyClass" });
  }
  return res.status(201).json(remediationCatalog.register({
    name: String(name),
    description: String(description ?? ""),
    matchSymptomPattern: String(matchSymptomPattern),
    safetyClass: safetyClass as SafetyClass,
    estimatedImpactSeconds: Number(estimatedImpactSeconds ?? 5),
  }));
});

router.get("/api/heal/remediations", (_req: Request, res: Response) => {
  res.json({ remediations: remediationCatalog.list() });
});

router.get("/api/heal/remediations/:id/effectiveness", (req: Request, res: Response) => {
  res.json(remediationCatalog.effectiveness(String(req.params.id)));
});

router.post("/api/heal/remediations/:id/applies", (req: Request, res: Response) => {
  const { findingId, outcome, durationMs, notes } = req.body ?? {};
  if (!findingId || !outcome) return res.status(400).json({ error: "Missing findingId or outcome" });
  const apply = remediationCatalog.recordApply({
    remediationId: String(req.params.id),
    findingId: String(findingId),
    outcome,
    durationMs: Number(durationMs ?? 0),
    notes: String(notes ?? ""),
  });
  if (outcome === "succeeded") autoApplyGuard.recordApply();
  return res.status(201).json(apply);
});

router.get("/api/heal/applies", (req: Request, res: Response) => {
  res.json({
    applies: remediationCatalog.applyHistory(req.query.remediationId ? String(req.query.remediationId) : undefined),
  });
});

// ── Recommendations ──────────────────────────────────────────────────────

router.get("/api/heal/recommendations", (_req: Request, res: Response) => {
  const recs = selfHealRecommender.recommend();
  res.json({
    recommendations: recs.map((r) => ({
      ...r,
      autoApplyDecision: autoApplyGuard.decide(r),
    })),
  });
});

// ── Auto-Apply Guard ─────────────────────────────────────────────────────

router.get("/api/heal/auto-apply", (_req: Request, res: Response) => {
  res.json(autoApplyGuard.get());
});

router.post("/api/heal/auto-apply", (req: Request, res: Response) => {
  res.json(autoApplyGuard.set(req.body ?? {}));
});

export default router;
