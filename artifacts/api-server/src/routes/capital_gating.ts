/**
 * routes/capital_gating.ts — Capital Gating & Controlled Launch API Routes
 *
 * Phase 117: Final phase before live trading
 *
 * Endpoints:
 *   GET    /tiers                         — all strategy tier assignments
 *   GET    /tiers/:strategyId             — specific strategy tier info
 *   POST   /tiers/:strategyId/promote     — request promotion
 *   POST   /tiers/:strategyId/demote      — force demotion
 *   GET    /tiers/:strategyId/history     — promotion history
 *   GET    /allocation                    — total capital allocation
 *   GET    /launch/plan                   — current launch plan
 *   POST   /launch/plan                   — create launch plan
 *   GET    /launch/status                 — launch status
 *   POST   /launch/advance                — advance launch phase
 *   POST   /launch/pause                  — pause launch
 *   POST   /launch/abort                  — abort launch
 *   GET    /launch/metrics                — real-time launch metrics
 *   GET    /launch/ramp                   — ramp schedule
 *   GET    /protection/checklist          — pre-launch checklist
 *   GET    /protection/capital-at-risk    — capital at risk
 *   GET    /protection/drawdown-budget    — drawdown budget
 *   POST   /protection/max-drawdown       — set max drawdown
 *   POST   /protection/emergency-halt     — emergency halt
 */

import { Router, Request, Response } from "express";
import {
  capitalGateEngine,
  controlledLaunchEngine,
  capitalProtectionEngine,
  type LaunchConfig,
} from "../lib/capital_gating";
import { logger as _logger } from "../lib/logger";

const logger = _logger.child({ module: "routes/capital_gating" });
const router = Router();

// ─── Capital Gating Endpoints ─────────────────────────────────────────────────

/**
 * GET /api/capital-gating/tiers
 * All strategy tier assignments grouped by tier
 */
router.get("/tiers", (req: Request, res: Response) => {
  try {
    const breakdown = capitalGateEngine.getTierBreakdown();
    res.json({
      success: true,
      data: breakdown,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting tier breakdown");
    res.status(500).json({
      success: false,
      error: "Failed to get tier breakdown",
    });
  }
});

/**
 * GET /api/capital-gating/tiers/:strategyId
 * Specific strategy tier information
 */
router.get("/tiers/:strategyId", (req: Request, res: Response) => {
  try {
    const strategyId = req.params.strategyId as string;
    const tierInfo = capitalGateEngine.getStrategyTier(strategyId);

    if (!tierInfo) {
      return res.status(404).json({
        success: false,
        error: "Strategy not found",
      });
    }

    return res.json({
      success: true,
      data: tierInfo,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting strategy tier");
    return res.status(500).json({
      success: false,
      error: "Failed to get strategy tier",
    });
  }
});

/**
 * POST /api/capital-gating/tiers/:strategyId/promote
 * Request tier promotion
 */
router.post("/tiers/:strategyId/promote", (req: Request, res: Response) => {
  try {
    const strategyId = req.params.strategyId as string;
    const result = capitalGateEngine.requestPromotion(strategyId);

    res.json({
      success: result.success,
      message: result.message,
      data: { nextTier: result.nextTier },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error requesting promotion");
    res.status(500).json({
      success: false,
      error: "Failed to request promotion",
    });
  }
});

/**
 * POST /api/capital-gating/tiers/:strategyId/demote
 * Force demotion with reason
 */
router.post("/tiers/:strategyId/demote", (req: Request, res: Response) => {
  try {
    const strategyId = req.params.strategyId as string;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Demotion reason required",
      });
    }

    const result = capitalGateEngine.demoteStrategy(strategyId, reason);

    return res.json({
      success: result.success,
      message: result.message,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error demoting strategy");
    return res.status(500).json({
      success: false,
      error: "Failed to demote strategy",
    });
  }
});

/**
 * GET /api/capital-gating/tiers/:strategyId/history
 * Promotion/demotion history for strategy
 */
router.get("/tiers/:strategyId/history", (req: Request, res: Response) => {
  try {
    const strategyId = req.params.strategyId as string;
    const history = capitalGateEngine.getPromotionHistory(strategyId);

    res.json({
      success: true,
      data: history,
      count: history.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting promotion history");
    res.status(500).json({
      success: false,
      error: "Failed to get promotion history",
    });
  }
});

/**
 * GET /api/capital-gating/allocation
 * Total capital allocation across all tiers
 */
router.get("/allocation", (req: Request, res: Response) => {
  try {
    const allocation = capitalGateEngine.getTotalCapitalAllocation();

    res.json({
      success: true,
      data: allocation,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting capital allocation");
    res.status(500).json({
      success: false,
      error: "Failed to get capital allocation",
    });
  }
});

// ─── Controlled Launch Endpoints ───────────────────────────────────────────────

/**
 * GET /api/capital-gating/launch/plan
 * Current launch plan
 */
router.get("/launch/plan", (req: Request, res: Response) => {
  try {
    const plan = controlledLaunchEngine.getLaunchPlan();

    res.json({
      success: true,
      data: plan,
      configured: plan !== null,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting launch plan");
    res.status(500).json({
      success: false,
      error: "Failed to get launch plan",
    });
  }
});

/**
 * POST /api/capital-gating/launch/plan
 * Create new launch plan
 */
router.post("/launch/plan", (req: Request, res: Response) => {
  try {
    const { strategies, startDate, rampSchedule } = req.body as LaunchConfig;

    if (!strategies || !Array.isArray(strategies) || !startDate || !rampSchedule) {
      return res.status(400).json({
        success: false,
        error: "strategies, startDate, and rampSchedule required",
      });
    }

    const result = controlledLaunchEngine.createLaunchPlan({
      strategies,
      startDate,
      rampSchedule,
    });

    return res.json({
      success: result.success,
      message: result.message,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error creating launch plan");
    return res.status(500).json({
      success: false,
      error: "Failed to create launch plan",
    });
  }
});

/**
 * GET /api/capital-gating/launch/status
 * Current launch status
 */
router.get("/launch/status", (req: Request, res: Response) => {
  try {
    const status = controlledLaunchEngine.getLaunchStatus();
    const currentPhase = controlledLaunchEngine.getCurrentPhase();

    res.json({
      success: true,
      data: {
        status,
        currentPhase,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting launch status");
    res.status(500).json({
      success: false,
      error: "Failed to get launch status",
    });
  }
});

/**
 * POST /api/capital-gating/launch/advance
 * Advance to next launch phase
 */
router.post("/launch/advance", (req: Request, res: Response) => {
  try {
    const result = controlledLaunchEngine.advanceLaunchPhase();

    res.json({
      success: result.success,
      message: result.message,
      data: { currentPhase: result.currentPhase },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error advancing launch phase");
    res.status(500).json({
      success: false,
      error: "Failed to advance launch phase",
    });
  }
});

/**
 * POST /api/capital-gating/launch/pause
 * Pause the launch
 */
router.post("/launch/pause", (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Pause reason required",
      });
    }

    const result = controlledLaunchEngine.pauseLaunch(reason);

    return res.json({
      success: result.success,
      message: result.message,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error pausing launch");
    return res.status(500).json({
      success: false,
      error: "Failed to pause launch",
    });
  }
});

/**
 * POST /api/capital-gating/launch/abort
 * Abort the launch
 */
router.post("/launch/abort", (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Abort reason required",
      });
    }

    const result = controlledLaunchEngine.abortLaunch(reason);

    return res.json({
      success: result.success,
      message: result.message,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error aborting launch");
    return res.status(500).json({
      success: false,
      error: "Failed to abort launch",
    });
  }
});

/**
 * GET /api/capital-gating/launch/metrics
 * Real-time launch metrics (P&L, drawdown, fill quality, slippage)
 */
router.get("/launch/metrics", (req: Request, res: Response) => {
  try {
    const metrics = controlledLaunchEngine.getLaunchMetrics();

    res.json({
      success: true,
      data: metrics,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting launch metrics");
    res.status(500).json({
      success: false,
      error: "Failed to get launch metrics",
    });
  }
});

/**
 * GET /api/capital-gating/launch/ramp
 * Ramp schedule
 */
router.get("/launch/ramp", (req: Request, res: Response) => {
  try {
    const rampSchedule = controlledLaunchEngine.getRampSchedule();

    res.json({
      success: true,
      data: {
        schedule: rampSchedule,
        phases: rampSchedule.map((ramp, idx) => ({
          phase: idx,
          capitalRamp: ramp,
          capitalPercent: Math.round(ramp * 100),
        })),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting ramp schedule");
    res.status(500).json({
      success: false,
      error: "Failed to get ramp schedule",
    });
  }
});

// ─── Capital Protection Endpoints ──────────────────────────────────────────────

/**
 * GET /api/capital-gating/protection/checklist
 * Pre-launch checklist
 */
router.get("/protection/checklist", (req: Request, res: Response) => {
  try {
    const checklist = capitalProtectionEngine.runPreLaunchChecklist();

    res.json({
      success: true,
      data: checklist,
      allPass: checklist.allPass,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error running pre-launch checklist");
    res.status(500).json({
      success: false,
      error: "Failed to run pre-launch checklist",
    });
  }
});

/**
 * GET /api/capital-gating/protection/capital-at-risk
 * Capital currently at risk
 */
router.get("/protection/capital-at-risk", (req: Request, res: Response) => {
  try {
    const capitalAtRisk = capitalProtectionEngine.getCapitalAtRisk();

    res.json({
      success: true,
      data: {
        capitalAtRisk: Math.round(capitalAtRisk),
        formatted: `$${Math.round(capitalAtRisk).toLocaleString()}`,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting capital at risk");
    res.status(500).json({
      success: false,
      error: "Failed to get capital at risk",
    });
  }
});

/**
 * GET /api/capital-gating/protection/drawdown-budget
 * Drawdown budget status
 */
router.get("/protection/drawdown-budget", (req: Request, res: Response) => {
  try {
    const budget = capitalProtectionEngine.getDrawdownBudget();

    res.json({
      success: true,
      data: {
        used: Math.round(budget.used),
        remaining: Math.round(budget.remaining),
        threshold: Math.round(budget.threshold),
        percentUsed: Math.round(budget.percentUsed * 10) / 10,
        usedFormatted: `$${Math.round(budget.used).toLocaleString()}`,
        remainingFormatted: `$${Math.round(budget.remaining).toLocaleString()}`,
        thresholdFormatted: `$${Math.round(budget.threshold).toLocaleString()}`,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error getting drawdown budget");
    res.status(500).json({
      success: false,
      error: "Failed to get drawdown budget",
    });
  }
});

/**
 * POST /api/capital-gating/protection/max-drawdown
 * Set max drawdown threshold
 */
router.post("/protection/max-drawdown", (req: Request, res: Response) => {
  try {
    const { amount } = req.body;

    if (!amount || typeof amount !== "number") {
      return res.status(400).json({
        success: false,
        error: "Valid amount required",
      });
    }

    const result = capitalProtectionEngine.setMaxDrawdown(amount);

    return res.json({
      success: result.success,
      message: result.message,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error setting max drawdown");
    return res.status(500).json({
      success: false,
      error: "Failed to set max drawdown",
    });
  }
});

/**
 * POST /api/capital-gating/protection/emergency-halt
 * Trigger emergency halt
 */
router.post("/protection/emergency-halt", (req: Request, res: Response) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: "Halt reason required",
      });
    }

    const result = capitalProtectionEngine.triggerEmergencyHalt(reason);

    return res.json({
      success: result.success,
      message: result.message,
      timestamp: Date.now(),
    });
  } catch (error) {
    logger.error({ error }, "Error triggering emergency halt");
    return res.status(500).json({
      success: false,
      error: "Failed to trigger emergency halt",
    });
  }
});

export default router;
