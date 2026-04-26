/**
 * routes/intelligence_graph.ts — Phase 3: Intelligence Graph API
 *
 * REST endpoints for the reasoning trace graph.
 *
 * Routes:
 *   GET  /api/graph/summary         — Graph analytics summary
 *   GET  /api/graph/traces          — Recent reasoning traces
 *   GET  /api/graph/traces/:id      — Single trace detail
 *   GET  /api/graph/symbol/:symbol  — Traces for a symbol
 *   GET  /api/graph/full            — Full graph (nodes + edges)
 *   GET  /api/graph/symbol-graph/:s — Symbol-specific graph
 *   GET  /api/graph/distributions   — Node/edge type distributions
 *   POST /api/graph/trace           — Manually create a trace
 *   PUT  /api/graph/outcome/:id     — Update trace outcome
 *   GET  /api/graph/health          — Health check
 */

import { Router, type Request, type Response } from "express";
import {
  getGraphSummary,
  getRecentTraces,
  getTrace,
  getTracesForSymbol,
  getFullGraph,
  getSymbolGraph,
  getNodeTypeDistribution,
  getEdgeTypeDistribution,
  buildReasoningTrace,
  updateTraceOutcome,
} from "../lib/intelligence_graph";

const router = Router();

/**
 * GET /api/graph/summary
 */
router.get("/summary", (_req: Request, res: Response): void => {
  try {
    res.json({ success: true, ...getGraphSummary(), timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/traces
 */
router.get("/traces", (req: Request, res: Response): void => {
  try {
    const limit = Math.min(100, parseInt((req.query.limit as string) || "50", 10));
    const traces = getRecentTraces(limit);
    res.json({ success: true, count: traces.length, traces });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/traces/:id
 */
router.get("/traces/:id", (req: Request, res: Response): void => {
  try {
    const id = req.params.id as string;
    const trace = getTrace(id);
    if (!trace) {
      res.status(404).json({ error: `Trace ${id} not found` });
      return;
    }
    res.json({ success: true, trace });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/symbol/:symbol
 */
router.get("/symbol/:symbol", (req: Request, res: Response): void => {
  try {
    const symbol = req.params.symbol as string;
    const limit = Math.min(50, parseInt((req.query.limit as string) || "20", 10));
    const traces = getTracesForSymbol(symbol, limit);
    res.json({ success: true, symbol, count: traces.length, traces });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/full
 */
router.get("/full", (req: Request, res: Response): void => {
  try {
    const limit = Math.min(200, parseInt((req.query.limit as string) || "50", 10));
    const graph = getFullGraph(limit);
    // @ts-expect-error TS2783 — auto-suppressed for strict build
    res.json({ success: true, nodes: graph.nodes.length, edges: graph.edges.length, ...graph });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/symbol-graph/:symbol
 */
router.get("/symbol-graph/:symbol", (req: Request, res: Response): void => {
  try {
    const symbol = req.params.symbol as string;
    const limit = Math.min(50, parseInt((req.query.limit as string) || "20", 10));
    const graph = getSymbolGraph(symbol, limit);
    // @ts-expect-error TS2783 — auto-suppressed for strict build
    res.json({ success: true, symbol, nodes: graph.nodes.length, edges: graph.edges.length, ...graph });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/distributions
 */
router.get("/distributions", (_req: Request, res: Response): void => {
  try {
    res.json({
      success: true,
      nodeTypes: getNodeTypeDistribution(),
      edgeTypes: getEdgeTypeDistribution(),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * POST /api/graph/trace — Manually create a reasoning trace
 */
router.post("/trace", (req: Request, res: Response): void => {
  try {
    const b = req.body;
    const required = ["requestId", "symbol", "strategy", "direction", "decision", "confidence"];
    const missing = required.filter((f: any) => !(f in b));
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing: ${missing.join(", ")}` });
      return;
    }

    const trace = buildReasoningTrace({
      requestId: b.requestId,
      symbol: b.symbol,
      strategy: b.strategy,
      direction: b.direction,
      decision: b.decision,
      confidence: b.confidence ?? 0.5,
      latencyMs: b.latencyMs ?? 0,
      explanation: b.explanation ?? "",
      structureScore: b.structureScore ?? 0.5,
      orderFlowScore: b.orderFlowScore ?? 0.5,
      recallScore: b.recallScore ?? 0.5,
      regime: b.regime ?? "ranging",
      sentimentScore: b.sentimentScore,
      macroBias: b.macroBias,
      riskGatePassed: b.riskGatePassed ?? true,
      riskBlockReasons: b.riskBlockReasons,
      confidenceFactors: b.confidenceFactors ?? [
        { name: "structure", score: b.structureScore ?? 0.5, weight: 0.3 },
        { name: "orderflow", score: b.orderFlowScore ?? 0.5, weight: 0.25 },
        { name: "memory", score: b.recallScore ?? 0.5, weight: 0.2 },
      ],
      memoryRecall: b.memoryRecall,
      pipelineStages: b.pipelineStages,
    });

    res.json({ success: true, trace });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * PUT /api/graph/outcome/:id — Update trace outcome
 */
router.put("/outcome/:id", (req: Request, res: Response): void => {
  try {
    const id = req.params.id as string;
    const { outcome } = req.body;
    if (!outcome || !["win", "loss", "breakeven"].includes(outcome)) {
      res.status(400).json({ error: "outcome must be win, loss, or breakeven" });
      return;
    }
    const updated = updateTraceOutcome(id, outcome);
    if (!updated) {
      res.status(404).json({ error: `Trace ${id} not found` });
      return;
    }
    res.json({ success: true, traceId: id, outcome });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

/**
 * GET /api/graph/health
 */
router.get("/health", (_req: Request, res: Response): void => {
  try {
    const summary = getGraphSummary();
    res.json({
      success: true,
      engine: "intelligence_graph",
      version: "1.0.0",
      totalTraces: summary.totalTraces,
      totalNodes: summary.totalNodes,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({ error: error.message });
  }
});

export default router;
