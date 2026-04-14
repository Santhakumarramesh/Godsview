/**
 * routes/capacity_planning.ts — Phase 65 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  resourceMonitor,
  scalingRecommender,
  loadPatternDetector,
  type ResourceKind,
} from "../lib/capacity_planning";

const router = Router();

router.post("/api/capacity/samples", (req: Request, res: Response) => {
  const { kind, value, unit, host } = req.body ?? {};
  if (!kind || value === undefined || !unit) {
    return res.status(400).json({ error: "Missing kind, value, or unit" });
  }
  return res.status(201).json(resourceMonitor.record(kind as ResourceKind, Number(value), String(unit), host));
});

router.get("/api/capacity/samples", (req: Request, res: Response) => {
  const { kind, sinceMs } = req.query;
  if (!kind) return res.status(400).json({ error: "Missing kind" });
  const series = resourceMonitor.series(String(kind) as ResourceKind, sinceMs ? Number(sinceMs) : 60 * 60 * 1000);
  return res.json({ series, stats: resourceMonitor.stats(String(kind) as ResourceKind) });
});

router.get("/api/capacity/recommendation/:kind", (req: Request, res: Response) => {
  const kind = String(req.params.kind) as ResourceKind;
  const capacity = req.query.capacity ? Number(req.query.capacity) : 100;
  const horizon = req.query.horizon ? Number(req.query.horizon) : 12;
  res.json(scalingRecommender.recommend(kind, capacity, horizon));
});

router.get("/api/capacity/recommendations", (req: Request, res: Response) => {
  const capacity = req.query.capacity ? Number(req.query.capacity) : 100;
  const kinds: ResourceKind[] = ["cpu", "memory", "connections", "queue_depth", "disk", "network_bps"];
  res.json({
    recommendations: kinds.map((k) => scalingRecommender.recommend(k, capacity)),
  });
});

router.get("/api/capacity/pattern/:kind", (req: Request, res: Response) => {
  const kind = String(req.params.kind) as ResourceKind;
  const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : 24 * 60 * 60 * 1000;
  const samples = resourceMonitor.series(kind, sinceMs);
  res.json(loadPatternDetector.detect(samples));
});

export default router;
