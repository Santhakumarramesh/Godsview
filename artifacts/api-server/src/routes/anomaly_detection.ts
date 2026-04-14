/**
 * routes/anomaly_detection.ts — Phase 85 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  zScoreDetector,
  iqrDetector,
  ewmaDetector,
  changePointDetector,
  anomalyRegistry,
  type AnomalyKind,
  type AnomalyClassification,
} from "../lib/anomaly_detection";

const router = Router();

router.post("/api/anomaly/detect/zscore", (req: Request, res: Response) => {
  const { series, threshold } = req.body ?? {};
  if (!Array.isArray(series)) return res.status(400).json({ error: "Missing series[]" });
  return res.json({ anomalies: zScoreDetector.detect(series.map(Number), threshold ?? 3.0) });
});

router.post("/api/anomaly/detect/iqr", (req: Request, res: Response) => {
  const { series, multiplier } = req.body ?? {};
  if (!Array.isArray(series)) return res.status(400).json({ error: "Missing series[]" });
  return res.json({ anomalies: iqrDetector.detect(series.map(Number), multiplier ?? 1.5) });
});

router.post("/api/anomaly/detect/ewma", (req: Request, res: Response) => {
  const { series, alpha, threshold } = req.body ?? {};
  if (!Array.isArray(series)) return res.status(400).json({ error: "Missing series[]" });
  return res.json({ anomalies: ewmaDetector.detect(series.map(Number), alpha ?? 0.3, threshold ?? 3.0) });
});

router.post("/api/anomaly/detect/cusum", (req: Request, res: Response) => {
  const { series, threshold } = req.body ?? {};
  if (!Array.isArray(series)) return res.status(400).json({ error: "Missing series[]" });
  return res.json({ anomalies: changePointDetector.detect(series.map(Number), threshold ?? 5.0) });
});

router.post("/api/anomaly/events", (req: Request, res: Response) => {
  const { metric, detectorKind, kind, observedValue, score, reason, context } = req.body ?? {};
  if (!metric || !detectorKind || !kind || observedValue === undefined || score === undefined) {
    return res.status(400).json({ error: "Missing event fields" });
  }
  return res.status(201).json(anomalyRegistry.record({
    metric: String(metric),
    detectorKind,
    kind: kind as AnomalyKind,
    observedValue: Number(observedValue),
    score: Number(score),
    reason: String(reason ?? ""),
    context: context ?? {},
  }));
});

router.get("/api/anomaly/events", (req: Request, res: Response) => {
  res.json({
    events: anomalyRegistry.list({
      metric: req.query.metric ? String(req.query.metric) : undefined,
      kind: req.query.kind ? (String(req.query.kind) as AnomalyKind) : undefined,
      classification: req.query.classification ? (String(req.query.classification) as AnomalyClassification) : undefined,
    }),
    stats: anomalyRegistry.stats(),
  });
});

router.post("/api/anomaly/events/:id/classify", (req: Request, res: Response) => {
  const { classification, classifiedBy } = req.body ?? {};
  if (!classification || !classifiedBy) return res.status(400).json({ error: "Missing classification or classifiedBy" });
  const e = anomalyRegistry.classify(
    String(req.params.id),
    classification as AnomalyClassification,
    String(classifiedBy),
  );
  if (!e) return res.status(404).json({ error: "Not found" });
  return res.json(e);
});

router.get("/api/anomaly/stats", (_req: Request, res: Response) => {
  res.json(anomalyRegistry.stats());
});

export default router;
