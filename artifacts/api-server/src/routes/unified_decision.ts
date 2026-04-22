/**
 * routes/unified_decision.ts — Unified Decision Engine API
 *
 * REST endpoints for the central intelligence orchestrator.
 *
 * Routes:
 *   POST /api/ude/evaluate          — Evaluate a trade through full pipeline
 *   GET  /api/ude/status            — Engine status and stats
 *   GET  /api/ude/quality           — Decision quality metrics
 *   GET  /api/ude/history           — Recent decision history
 *   GET  /api/ude/history/:id       — Get specific decision by ID
 *   GET  /api/ude/symbol/:symbol    — Recent decisions for a symbol
 *   GET  /api/ude/pipeline/:id      — Full pipeline trace for a decision
 */

import { Router, Request, Response } from "express";
import {
  evaluateDecision,
  getDecisionStats,
  getDecisionQuality,
  getDecisionHistory,
  getDecisionById,
  getRecentDecisionsForSymbol,
  type DecisionRequest,
} from "../lib/unified_decision_engine";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /api/ude/evaluate
 * Run a trade candidate through the full decision pipeline
 */
router.post("/evaluate", async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<DecisionRequest>;

    // Validate required fields
    const required = ["symbol", "direction", "strategy", "setupType", "entryPrice", "stopLoss", "takeProfit"];
    const missing = required.filter((f) => !(f in body) || body[f as keyof DecisionRequest] === undefined);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    // Fill defaults
    const request: DecisionRequest = {
      requestId: body.requestId || `ude_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      symbol: body.symbol!,
      direction: body.direction!,
      strategy: body.strategy!,
      setupType: body.setupType!,
      entryPrice: body.entryPrice!,
      stopLoss: body.stopLoss!,
      takeProfit: body.takeProfit!,
      structureScore: body.structureScore ?? 0.5,
      orderFlowScore: body.orderFlowScore ?? 0.5,
      recallScore: body.recallScore ?? 0.5,
      regime: body.regime ?? "ranging",
      session: body.session ?? "us",
      timeframe: body.timeframe ?? "5m",
      volatility: body.volatility ?? 0.02,
      atr: body.atr ?? Math.abs(body.entryPrice! - body.stopLoss!) * 2,
      equity: body.equity ?? 100000,
      openPositions: body.openPositions ?? 0,
      dailyPnl: body.dailyPnl ?? 0,
      dailyDrawdown: body.dailyDrawdown ?? 0,
      timeframeScores: body.timeframeScores,
      macroBias: body.macroBias,
      sentimentScore: body.sentimentScore,
    };

    const result = await evaluateDecision(request);

    res.json({
      success: true,
      decision: result,
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] Evaluate failed");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/ude/status
 * Engine status and aggregate stats
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    const stats = getDecisionStats();

    res.json({
      success: true,
      engine: "unified_decision_engine",
      version: "1.0.0",
      stats,
      config: {
        minConfidence: parseFloat(process.env.UDE_MIN_CONFIDENCE ?? "0.55"),
        maxPositions: parseInt(process.env.UDE_MAX_POSITIONS ?? "5", 10),
        maxDailyDrawdown: parseFloat(process.env.UDE_MAX_DAILY_DD ?? "0.03"),
        kellyMaxFraction: parseFloat(process.env.UDE_KELLY_MAX ?? "0.05"),
        minEdgeScore: parseFloat(process.env.UDE_MIN_EDGE ?? "0.15"),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] Status failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/quality
 * Decision quality metrics
 */
router.get("/quality", async (_req: Request, res: Response) => {
  try {
    const quality = getDecisionQuality();

    res.json({
      success: true,
      quality,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] Quality failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/history
 * Recent decision history
 */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, parseInt((req.query.limit as string) || "50", 10));
    const history = getDecisionHistory(limit);

    res.json({
      success: true,
      count: history.length,
      decisions: history,
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] History failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/history/:id
 * Get specific decision by request ID
 */
router.get("/history/:id", async (req: Request, res: Response) => {
  try {
    const decision = getDecisionById(req.params.id);

    if (!decision) {
      return res.status(404).json({
        error: `Decision ${req.params.id} not found`,
      });
    }

    res.json({
      success: true,
      decision,
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] History lookup failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/symbol/:symbol
 * Recent decisions for a specific symbol
 */
router.get("/symbol/:symbol", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, parseInt((req.query.limit as string) || "20", 10));
    const decisions = getRecentDecisionsForSymbol(req.params.symbol, limit);

    res.json({
      success: true,
      symbol: req.params.symbol,
      count: decisions.length,
      decisions,
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] Symbol history failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/pipeline/:id
 * Full pipeline trace for a decision — used for debugging and learning
 */
router.get("/pipeline/:id", async (req: Request, res: Response) => {
  try {
    const decision = getDecisionById(req.params.id);

    if (!decision) {
      return res.status(404).json({
        error: `Decision ${req.params.id} not found`,
      });
    }

    res.json({
      success: true,
      requestId: decision.requestId,
      symbol: decision.symbol,
      decision: decision.decision,
      pipeline: decision.pipelineTrace,
      explanation: decision.explanation,
      confidence: decision.confidence,
      memoryRecall: decision.memoryRecall,
      latencyMs: decision.latencyMs,
    });
  } catch (error: any) {
    logger.error({ error }, "[UDE] Pipeline trace failed");
    res.status(500).json({ error: error.message });
  }
});

export default router;
