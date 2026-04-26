/**
 * routes/decision_feedback.ts — Decision Feedback Loop API
 *
 * REST endpoints for recording trade outcomes and retrieving learning data.
 *
 * Routes:
 *   POST /api/ude/feedback           — Record a trade outcome
 *   GET  /api/ude/feedback/history    — Recent feedback history
 *   GET  /api/ude/feedback/stats      — Feedback stats
 *   GET  /api/ude/feedback/accuracy/strategies — Per-strategy accuracy
 *   GET  /api/ude/feedback/accuracy/regimes    — Per-regime accuracy
 *   GET  /api/ude/feedback/accuracy/factors    — Per-factor accuracy
 */

import { Router, Request, Response } from "express";
import {
  processTradeOutcome,
  getFeedbackHistory,
  getFeedbackStats,
  getStrategyAccuracy,
  getRegimeAccuracy,
  getFactorAccuracy,
  type TradeOutcome,
} from "../lib/decision_feedback_loop";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /api/ude/feedback
 * Record a trade outcome and trigger learning
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<TradeOutcome>;

    const required = ["symbol", "direction", "strategy", "entryPrice", "exitPrice", "pnl", "exitReason"];
    const missing = required.filter((f) => !(f in body));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }

    const outcome: TradeOutcome = {
      decisionRequestId: body.decisionRequestId || "unknown",
      symbol: body.symbol!,
      strategy: body.strategy!,
      direction: body.direction!,
      entryPrice: body.entryPrice!,
      exitPrice: body.exitPrice!,
      pnl: body.pnl!,
      pnlPct: body.pnlPct ?? (body.entryPrice! > 0 ? (body.exitPrice! - body.entryPrice!) / body.entryPrice! : 0),
      rMultiple: body.rMultiple ?? 0,
      exitReason: body.exitReason!,
      holdMinutes: body.holdMinutes ?? 0,
      slippageBps: body.slippageBps ?? 0,
      regime: body.regime ?? "unknown",
    };

    const feedback = await processTradeOutcome(outcome);

    res.json({
      success: true,
      feedback,
    });
  } catch (error: any) {
    logger.error({ error }, "[feedback] Record outcome failed");
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/feedback/history
 */
router.get("/history", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, parseInt((req.query.limit as string) || "50", 10));
    const history = getFeedbackHistory(limit);

    res.json({
      success: true,
      count: history.length,
      feedback: history,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/feedback/stats
 */
router.get("/stats", async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      stats: getFeedbackStats(),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/feedback/accuracy/strategies
 */
router.get("/accuracy/strategies", async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      strategies: getStrategyAccuracy(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/feedback/accuracy/regimes
 */
router.get("/accuracy/regimes", async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      regimes: getRegimeAccuracy(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/ude/feedback/accuracy/factors
 */
router.get("/accuracy/factors", async (_req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      factors: getFactorAccuracy(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
