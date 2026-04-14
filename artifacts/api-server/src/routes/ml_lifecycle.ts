/**
 * routes/ml_lifecycle.ts — Phase 74 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  modelRegistry,
  driftMonitor,
  metricsTracker,
  retrainingEngine,
  type ModelKind,
  type ModelStatus,
} from "../lib/ml_lifecycle";

const router = Router();

// ── Models ─────────────────────────────────────────────────────────────────

router.post("/api/ml/models", (req: Request, res: Response) => {
  const { name, version, kind, framework, artifactUri, trainingDataset, featureSchema, hyperparameters, metrics } = req.body ?? {};
  if (!name || !version || !kind || !framework || !artifactUri) {
    return res.status(400).json({ error: "Missing model fields" });
  }
  return res.status(201).json(modelRegistry.register({
    name: String(name),
    version: String(version),
    kind: kind as ModelKind,
    framework: String(framework),
    artifactUri: String(artifactUri),
    trainingDataset: String(trainingDataset ?? "unknown"),
    featureSchema: Array.isArray(featureSchema) ? featureSchema : [],
    hyperparameters: hyperparameters ?? {},
    metrics: metrics ?? {},
  }));
});

router.get("/api/ml/models", (req: Request, res: Response) => {
  res.json({
    models: modelRegistry.list({
      name: req.query.name ? String(req.query.name) : undefined,
      status: req.query.status ? (String(req.query.status) as ModelStatus) : undefined,
      kind: req.query.kind ? (String(req.query.kind) as ModelKind) : undefined,
    }),
  });
});

router.get("/api/ml/models/current/:name", (req: Request, res: Response) => {
  const m = modelRegistry.current(String(req.params.name));
  if (!m) return res.status(404).json({ error: "No production model" });
  return res.json(m);
});

router.patch("/api/ml/models/:id/status", (req: Request, res: Response) => {
  const { status } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const m = modelRegistry.promote(String(req.params.id), status as ModelStatus);
  if (!m) return res.status(404).json({ error: "Not found" });
  return res.json(m);
});

// ── Drift ──────────────────────────────────────────────────────────────────

router.post("/api/ml/drift/evaluate", (req: Request, res: Response) => {
  const { modelId, feature, baseline, current } = req.body ?? {};
  if (!modelId || !feature || !Array.isArray(baseline) || !Array.isArray(current)) {
    return res.status(400).json({ error: "Missing modelId, feature, baseline, or current" });
  }
  return res.json(driftMonitor.evaluate(
    String(modelId),
    String(feature),
    baseline.map(Number),
    current.map(Number),
  ));
});

router.get("/api/ml/drift", (req: Request, res: Response) => {
  res.json({
    reports: driftMonitor.recent(
      req.query.modelId ? String(req.query.modelId) : undefined,
    ),
  });
});

// ── Metrics ────────────────────────────────────────────────────────────────

router.post("/api/ml/metrics/:modelId", (req: Request, res: Response) => {
  const metrics = req.body?.metrics ?? req.body;
  if (!metrics || typeof metrics !== "object") return res.status(400).json({ error: "Missing metrics" });
  return res.status(201).json(metricsTracker.record(String(req.params.modelId), metrics));
});

router.get("/api/ml/metrics/:modelId", (req: Request, res: Response) => {
  res.json({ snapshots: metricsTracker.recent(String(req.params.modelId)) });
});

router.get("/api/ml/metrics/:modelId/trend/:metric", (req: Request, res: Response) => {
  const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : 24 * 60 * 60 * 1000;
  res.json({
    points: metricsTracker.trend(String(req.params.modelId), String(req.params.metric), sinceMs),
    delta: metricsTracker.delta(String(req.params.modelId), String(req.params.metric)),
  });
});

// ── Retraining Triggers ───────────────────────────────────────────────────

router.post("/api/ml/triggers/policy/:modelId", (req: Request, res: Response) => {
  const { driftThreshold, metricDegradationPct, metric, scheduledIntervalMs } = req.body ?? {};
  if (driftThreshold === undefined || metricDegradationPct === undefined || !metric) {
    return res.status(400).json({ error: "Missing policy fields" });
  }
  retrainingEngine.setPolicy(String(req.params.modelId), {
    driftThreshold: Number(driftThreshold),
    metricDegradationPct: Number(metricDegradationPct),
    metric: String(metric),
    scheduledIntervalMs,
  });
  return res.json({ ok: true });
});

router.post("/api/ml/triggers/evaluate/:modelId", (req: Request, res: Response) => {
  res.json({ fired: retrainingEngine.evaluate(String(req.params.modelId)) });
});

router.post("/api/ml/triggers/manual/:modelId", (req: Request, res: Response) => {
  const { note } = req.body ?? {};
  res.status(201).json(retrainingEngine.fireManual(String(req.params.modelId), String(note ?? "manual")));
});

router.post("/api/ml/triggers/scheduled/:modelId", (req: Request, res: Response) => {
  res.status(201).json(retrainingEngine.fireScheduled(String(req.params.modelId)));
});

router.post("/api/ml/triggers/:id/acknowledge", (req: Request, res: Response) => {
  const t = retrainingEngine.acknowledge(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  return res.json(t);
});

router.get("/api/ml/triggers", (req: Request, res: Response) => {
  res.json({
    triggers: retrainingEngine.list(req.query.modelId ? String(req.query.modelId) : undefined),
  });
});

export default router;
