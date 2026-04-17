/**
 * routes/autonomous.ts — Autonomous System API Routes
 *
 * Endpoints for monitoring and controlling the autonomous trading system:
 *
 *   GET    /api/autonomous/status         — current mode and health
 *   GET    /api/autonomous/drift/:id      — drift analysis for strategy
 *   GET    /api/autonomous/selfcheck      — self-check report
 *   GET    /api/autonomous/boundaries     — boundary status
 *   GET    /api/autonomous/readiness      — trading readiness
 *   POST   /api/autonomous/mode           — change mode
 *   GET    /api/autonomous/post-trade/:id — post-trade analysis
 *   GET    /api/autonomous/daily-review   — daily review
 *   POST   /api/autonomous/emergency-stop — emergency stop
 */

import { Router, Request, Response } from "express";
import {
  autonomousOrchestrator,
  selfMonitor,
  modeManager,
  driftDetector,
  safetyBoundaries,
  postTradeLoop,
} from "../lib/autonomous";
import { logger as _logger } from "../lib/logger";

const logger = _logger.child({ module: "routes/autonomous" });
const router = Router();

// ─── GET /api/autonomous/status ────────────────────────────────────────────

/**
 * Get current system status: mode, health, alerts, readiness
 */
router.get("/status", (req: Request, res: Response) => {
  try {
    const status = autonomousOrchestrator.getStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error({ error }, "Error getting autonomous status");
    res.status(500).json({
      success: false,
      error: "Failed to get autonomous status",
    });
  }
});

// ─── GET /api/autonomous/drift/:strategyId ────────────────────────────────

/**
 * Get drift analysis for a specific strategy
 */
router.get("/drift/:strategyId", (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params;

    // In production, would fetch actual live and backtest metrics from database
    const liveMetrics = {
      strategyId,
      timestamp: Date.now(),
      totalPnL: 2500,
      winRate: 0.56,
      profitFactor: 1.65,
      sharpeRatio: 1.85,
      maxDrawdown: 0.035,
      consecutiveLosses: 2,
      averageWin: 450,
      averageLoss: 350,
      avgSlippage: 0.0015,
      avgFillTime: 45,
      partialFillRate: 0.02,
      recentTradeCount: 20,
      recentWinCount: 11,
    };

    const backtestMetrics = {
      strategyId,
      expectedWinRate: 0.55,
      expectedSharpeRatio: 1.8,
      expectedMaxDrawdown: 0.04,
      expectedAvgSlippage: 0.0012,
      expectedProfitFactor: 1.6,
      expectedAvgWin: 440,
      expectedAvgLoss: 360,
    };

    const driftReport = driftDetector.detectDrift(liveMetrics, backtestMetrics);

    res.json({
      success: true,
      data: driftReport,
    });
  } catch (error) {
    logger.error({ error }, "Error getting drift report");
    res.status(500).json({
      success: false,
      error: "Failed to get drift report",
    });
  }
});

// ─── GET /api/autonomous/selfcheck ─────────────────────────────────────────

/**
 * Run self-check and get health report
 */
router.get("/selfcheck", (req: Request, res: Response) => {
  try {
    const selfCheckReport = selfMonitor.runSelfCheck();

    res.json({
      success: true,
      data: selfCheckReport,
    });
  } catch (error) {
    logger.error({ error }, "Error running self-check");
    res.status(500).json({
      success: false,
      error: "Failed to run self-check",
    });
  }
});

// ─── GET /api/autonomous/boundaries ────────────────────────────────────────

/**
 * Check safety boundaries
 */
router.get("/boundaries", (req: Request, res: Response) => {
  try {
    // In production, would get actual system state from database/memory
    const currentState = {
      portfolioValue: 98500,
      cash: 48500,
      positions: [
        { symbol: "SPY", quantity: 10, value: 5000 },
        { symbol: "QQQ", quantity: 5, value: 2500 },
        { symbol: "IWM", quantity: 8, value: 1800 },
      ],
      recentTrades: [],
      openOrders: [],
      timestamp: Date.now(),
    };

    const boundaryReport = safetyBoundaries.checkBoundaries(currentState);

    res.json({
      success: true,
      data: boundaryReport,
    });
  } catch (error) {
    logger.error({ error }, "Error checking boundaries");
    res.status(500).json({
      success: false,
      error: "Failed to check boundaries",
    });
  }
});

// ─── GET /api/autonomous/readiness ────────────────────────────────────────

/**
 * Check if system is ready for trading
 */
router.get("/readiness", (req: Request, res: Response) => {
  try {
    const readiness = selfMonitor.shouldBeTrading();

    res.json({
      success: true,
      data: {
        ready: readiness.ready,
        score: readiness.score,
        blockers: readiness.blockers,
        warnings: readiness.warnings,
        conditions: readiness.conditions,
      },
    });
  } catch (error) {
    logger.error({ error }, "Error checking readiness");
    res.status(500).json({
      success: false,
      error: "Failed to check trading readiness",
    });
  }
});

// ─── POST /api/autonomous/mode ─────────────────────────────────────────────

/**
 * Change operating mode
 */
router.post("/mode", (req: Request, res: Response) => {
  try {
    const { newMode, reason } = req.body;

    if (!newMode) {
      return res.status(400).json({
        success: false,
        error: "newMode is required",
      });
    }

    const changeRecord = modeManager.changeMode(newMode, reason || "API request");

    res.json({
      success: true,
      data: {
        fromMode: changeRecord.fromMode,
        toMode: changeRecord.toMode,
        reason: changeRecord.reason,
        timestamp: changeRecord.timestamp,
      },
    });
  } catch (error) {
    logger.error({ error }, "Error changing mode");
    res.status(500).json({
      success: false,
      error: "Failed to change mode",
    });
  }
});

// ─── GET /api/autonomous/mode ──────────────────────────────────────────────

/**
 * Get current mode and parameters
 */
router.get("/mode", (req: Request, res: Response) => {
  try {
    const currentMode = modeManager.getCurrentMode();
    const history = modeManager.getModeHistory(7);  // Last 7 days

    res.json({
      success: true,
      data: {
        current: currentMode,
        history: history.slice(-10),  // Last 10 changes
      },
    });
  } catch (error) {
    logger.error({ error }, "Error getting mode");
    res.status(500).json({
      success: false,
      error: "Failed to get mode information",
    });
  }
});

// ─── GET /api/autonomous/post-trade/:tradeId ───────────────────────────────

/**
 * Get post-trade analysis for a specific trade
 */
router.get("/post-trade/:tradeId", (req: Request, res: Response) => {
  try {
    const { tradeId } = req.params;

    // In production, would fetch actual trade from database
    const trade = {
      tradeId,
      strategyId: "strategy-1",
      entryTime: Date.now() - 60000,
      exitTime: Date.now(),
      entryPrice: 150.25,
      exitPrice: 152.50,
      quantity: 100,
      pnl: 225,
      pnlPercent: 0.015,
      maxFavorable: 350,
      maxAdverse: -50,
      slippage: 0.001,
      fillTime: 45,
      modelConfidence: 0.72,
      regime: "trending",
    };

    const context = {};

    const analysis = postTradeLoop.analyzeTrade(trade, context);

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    logger.error({ error }, "Error analyzing trade");
    res.status(500).json({
      success: false,
      error: "Failed to analyze trade",
    });
  }
});

// ─── GET /api/autonomous/daily-review ───────────────────────────────────────

/**
 * Get daily review for a date
 */
router.get("/daily-review", (req: Request, res: Response) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split("T")[0];

    const review = postTradeLoop.dailyReview(date);

    res.json({
      success: true,
      data: review,
    });
  } catch (error) {
    logger.error({ error }, "Error getting daily review");
    res.status(500).json({
      success: false,
      error: "Failed to get daily review",
    });
  }
});

// ─── POST /api/autonomous/emergency-stop ───────────────────────────────────

/**
 * Trigger emergency stop (requires authentication)
 */
router.post("/emergency-stop", (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "reason is required",
      });
    }

    const result = autonomousOrchestrator.emergencyStop(reason);

    // In production, would alert human operators
    logger.error(
      { reason, timestamp: Date.now() },
      "EMERGENCY STOP initiated via API"
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error({ error }, "Error triggering emergency stop");
    res.status(500).json({
      success: false,
      error: "Failed to trigger emergency stop",
    });
  }
});

// ─── GET /api/autonomous/mode-evaluation ───────────────────────────────────

/**
 * Evaluate potential mode transition (dry-run)
 */
router.get("/mode-evaluation", (req: Request, res: Response) => {
  try {
    // Get current metrics
    const selfCheck = selfMonitor.runSelfCheck();

    // Placeholder drift report
    const driftReport = {
      overallDrift: 0.12,
      status: "stable",
    };

    // Placeholder performance
    const performance = {
      winRate: 0.56,
      consecutiveLosses: 2,
      drawdown: 0.032,
      sharpeRatio: 1.85,
    };

    const decision = modeManager.evaluateMode(selfCheck, driftReport, performance);

    res.json({
      success: true,
      data: decision,
    });
  } catch (error) {
    logger.error({ error }, "Error evaluating mode");
    res.status(500).json({
      success: false,
      error: "Failed to evaluate mode",
    });
  }
});

// ─── GET /api/autonomous/boundaries-config ────────────────────────────────

/**
 * Get current boundary configuration
 */
router.get("/boundaries-config", (req: Request, res: Response) => {
  try {
    const config = safetyBoundaries.getBoundaries();

    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    logger.error({ error }, "Error getting boundary config");
    res.status(500).json({
      success: false,
      error: "Failed to get boundary configuration",
    });
  }
});

// ─── POST /api/autonomous/boundaries-config ────────────────────────────────

/**
 * Update boundary configuration (requires authentication)
 */
router.post("/boundaries-config", (req: Request, res: Response) => {
  try {
    const { boundary, value } = req.body;

    if (!boundary || value === undefined) {
      return res.status(400).json({
        success: false,
        error: "boundary and value are required",
      });
    }

    safetyBoundaries.updateBoundary(boundary, value);

    const updated = safetyBoundaries.getBoundaries();

    res.json({
      success: true,
      data: {
        updated: boundary,
        newValue: value,
        config: updated,
      },
    });
  } catch (error) {
    logger.error({ error }, "Error updating boundary config");
    res.status(500).json({
      success: false,
      error: "Failed to update boundary configuration",
    });
  }
});

export default router;
