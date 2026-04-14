/**
 * routes/chaos_engineering.ts — Phase 59 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  chaosOrchestrator,
  resilienceScorer,
  rollbackEngine,
  dependencyFaultSimulator,
  type ExperimentType,
  type DependencyKind,
} from "../lib/chaos_engineering";

const router = Router();

// ── Experiments ────────────────────────────────────────────────────────────

router.post("/api/chaos/experiments", (req: Request, res: Response) => {
  const { name, type, target, params, notes } = req.body ?? {};
  if (!name || !type || !target) return res.status(400).json({ error: "Missing name, type, or target" });
  const exp = chaosOrchestrator.plan({ name, type: type as ExperimentType, target, params, notes });
  return res.status(201).json(exp);
});

router.get("/api/chaos/experiments", (_req: Request, res: Response) => {
  res.json({
    experiments: chaosOrchestrator.list(),
    running: chaosOrchestrator.currentlyRunning(),
  });
});

router.get("/api/chaos/experiments/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const exp = chaosOrchestrator.get(id);
  if (!exp) return res.status(404).json({ error: "Not found" });
  const score = resilienceScorer.score(exp);
  return res.json({ experiment: exp, score });
});

router.post("/api/chaos/experiments/:id/start", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const exp = chaosOrchestrator.start(id);
  if (!exp) return res.status(409).json({ error: "Cannot start (maybe another running or state wrong)" });
  return res.json(exp);
});

router.post("/api/chaos/experiments/:id/observe", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { note, metrics } = req.body ?? {};
  chaosOrchestrator.observe(id, String(note ?? ""), metrics);
  return res.json({ ok: true });
});

router.post("/api/chaos/experiments/:id/complete", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { outcome, notes } = req.body ?? {};
  const exp = chaosOrchestrator.complete(id, outcome ?? "inconclusive", notes);
  if (!exp) return res.status(404).json({ error: "Not found" });
  return res.json({ experiment: exp, score: resilienceScorer.score(exp) });
});

router.post("/api/chaos/experiments/:id/abort", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { reason } = req.body ?? {};
  const exp = chaosOrchestrator.abort(id, String(reason ?? "manual"));
  if (!exp) return res.status(404).json({ error: "Not found" });
  return res.json(exp);
});

// ── Resilience ─────────────────────────────────────────────────────────────

router.get("/api/chaos/resilience", (_req: Request, res: Response) => {
  const all = chaosOrchestrator.list().filter((e) => e.status === "completed");
  res.json({ count: all.length, aggregate: resilienceScorer.aggregate(all) });
});

// ── Rollback ───────────────────────────────────────────────────────────────

router.post("/api/chaos/snapshots", (req: Request, res: Response) => {
  const { label, data } = req.body ?? {};
  if (!label) return res.status(400).json({ error: "Missing label" });
  const snap = rollbackEngine.snapshot(String(label), (data ?? {}) as Record<string, unknown>);
  return res.status(201).json(snap);
});

router.post("/api/chaos/snapshots/:id/restore", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const s = rollbackEngine.restore(id);
  if (!s) return res.status(404).json({ error: "Not found" });
  return res.json(s);
});

router.get("/api/chaos/snapshots", (_req: Request, res: Response) => {
  res.json({ snapshots: rollbackEngine.list() });
});

// ── Dependency Faults ──────────────────────────────────────────────────────

router.post("/api/chaos/faults/slow", (req: Request, res: Response) => {
  const { dependency, delayMs, durationMs } = req.body ?? {};
  if (!dependency) return res.status(400).json({ error: "Missing dependency" });
  const f = dependencyFaultSimulator.injectSlow(dependency as DependencyKind, Number(delayMs ?? 100), Number(durationMs ?? 30_000));
  return res.status(201).json(f);
});

router.post("/api/chaos/faults/error", (req: Request, res: Response) => {
  const { dependency, errorRate, durationMs } = req.body ?? {};
  if (!dependency) return res.status(400).json({ error: "Missing dependency" });
  const f = dependencyFaultSimulator.injectError(dependency as DependencyKind, Number(errorRate ?? 0.1), Number(durationMs ?? 30_000));
  return res.status(201).json(f);
});

router.post("/api/chaos/faults/unavailable", (req: Request, res: Response) => {
  const { dependency, durationMs } = req.body ?? {};
  if (!dependency) return res.status(400).json({ error: "Missing dependency" });
  const f = dependencyFaultSimulator.injectUnavailable(dependency as DependencyKind, Number(durationMs ?? 30_000));
  return res.status(201).json(f);
});

router.get("/api/chaos/faults", (_req: Request, res: Response) => {
  res.json({ faults: dependencyFaultSimulator.active() });
});

router.delete("/api/chaos/faults", (_req: Request, res: Response) => {
  dependencyFaultSimulator.clearAll();
  res.json({ ok: true });
});

export default router;
