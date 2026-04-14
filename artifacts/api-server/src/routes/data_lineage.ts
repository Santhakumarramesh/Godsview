/**
 * routes/data_lineage.ts — Phase 64 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  lineageGraph,
  dataQualityEngine,
  schemaRegistry,
  type DatasetNode,
  type QualityCheckKind,
  type Severity,
  type SchemaField,
} from "../lib/data_lineage";

const router = Router();

// ── Lineage Nodes / Edges ──────────────────────────────────────────────────

router.post("/api/lineage/nodes", (req: Request, res: Response) => {
  const { name, source, layer, owner } = req.body ?? {};
  if (!name || !source || !layer || !owner) {
    return res.status(400).json({ error: "Missing name, source, layer, or owner" });
  }
  return res.status(201).json(lineageGraph.addNode({
    name: String(name),
    source: source as DatasetNode["source"],
    layer: layer as DatasetNode["layer"],
    owner: String(owner),
  }));
});

router.get("/api/lineage/nodes", (_req: Request, res: Response) => {
  res.json({ nodes: lineageGraph.listNodes() });
});

router.post("/api/lineage/edges", (req: Request, res: Response) => {
  const { from, to, transformation } = req.body ?? {};
  if (!from || !to || !transformation) {
    return res.status(400).json({ error: "Missing from, to, or transformation" });
  }
  const edge = lineageGraph.addEdge(String(from), String(to), String(transformation));
  if (!edge) return res.status(404).json({ error: "Node not found" });
  return res.status(201).json(edge);
});

router.get("/api/lineage/edges", (_req: Request, res: Response) => {
  res.json({ edges: lineageGraph.listEdges() });
});

router.get("/api/lineage/nodes/:id/downstream", (req: Request, res: Response) => {
  res.json({ downstream: lineageGraph.downstream(String(req.params.id)) });
});

router.get("/api/lineage/nodes/:id/upstream", (req: Request, res: Response) => {
  res.json({ upstream: lineageGraph.upstream(String(req.params.id)) });
});

// ── Data Quality ───────────────────────────────────────────────────────────

router.post("/api/lineage/quality/checks", (req: Request, res: Response) => {
  const { datasetId, kind, threshold, severity, description } = req.body ?? {};
  if (!datasetId || !kind || threshold === undefined || !severity) {
    return res.status(400).json({ error: "Missing datasetId, kind, threshold, or severity" });
  }
  return res.status(201).json(dataQualityEngine.addCheck({
    datasetId: String(datasetId),
    kind: kind as QualityCheckKind,
    threshold: Number(threshold),
    severity: severity as Severity,
    description: String(description ?? ""),
  }));
});

router.get("/api/lineage/quality/checks", (req: Request, res: Response) => {
  const datasetId = req.query.datasetId ? String(req.query.datasetId) : undefined;
  res.json({ checks: dataQualityEngine.listChecks(datasetId) });
});

router.post("/api/lineage/quality/run/:checkId", (req: Request, res: Response) => {
  const { observed } = req.body ?? {};
  if (observed === undefined) return res.status(400).json({ error: "Missing observed" });
  const result = dataQualityEngine.runCheck(String(req.params.checkId), Number(observed));
  if (!result) return res.status(404).json({ error: "Check not found" });
  return res.json(result);
});

router.get("/api/lineage/quality/results", (req: Request, res: Response) => {
  const datasetId = req.query.datasetId ? String(req.query.datasetId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  res.json({ results: dataQualityEngine.recentResults(datasetId, limit) });
});

router.get("/api/lineage/quality/summary/:datasetId", (req: Request, res: Response) => {
  res.json(dataQualityEngine.summary(String(req.params.datasetId)));
});

// ── Schemas ────────────────────────────────────────────────────────────────

router.post("/api/lineage/schemas", (req: Request, res: Response) => {
  const { datasetId, fields } = req.body ?? {};
  if (!datasetId || !Array.isArray(fields)) {
    return res.status(400).json({ error: "Missing datasetId or fields[]" });
  }
  return res.status(201).json(schemaRegistry.register(String(datasetId), fields as SchemaField[]));
});

router.get("/api/lineage/schemas/:datasetId", (req: Request, res: Response) => {
  res.json({
    current: schemaRegistry.current(String(req.params.datasetId)),
    history: schemaRegistry.history(String(req.params.datasetId)),
  });
});

router.post("/api/lineage/schemas/:datasetId/drift", (req: Request, res: Response) => {
  const { observedFields } = req.body ?? {};
  if (!Array.isArray(observedFields)) return res.status(400).json({ error: "Missing observedFields[]" });
  return res.json(schemaRegistry.drift(String(req.params.datasetId), observedFields as SchemaField[]));
});

export default router;
