/**
 * Recovery & Disaster Readiness Endpoints
 * Phase 35: Failure Recovery + Disaster Readiness
 *
 * POST /plan                    — Create startup recovery plan
 * POST /plan/:id/execute        — Execute next recovery step
 * GET /plan/:id                 — Get recovery plan status
 * GET /history                  — Recovery history
 * POST /drills                  — Create an incident drill
 * POST /drills/:id/start        — Start a drill
 * POST /drills/:id/step         — Execute next drill step
 * POST /drills/:id/complete     — Complete a drill
 * GET /drills                   — List recent drills
 * GET /drills/:id               — Get drill details
 * GET /summary                  — Recovery & disaster readiness summary
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  createRecoveryPlan,
  executeRecoveryStep,
  getRecoveryPlan,
  getRecoveryHistory,
  createDrill,
  startDrill,
  executeDrillStep,
  completeDrill,
  getDrill,
  getRecentDrills,
  getDrillsByType,
} from "../lib/recovery";
import type { DrillType } from "../lib/recovery";

const router: IRouter = Router();

// ── Recovery Plan Endpoints ──────────────────────────────────────

/**
 * POST /plan
 * Create a new startup recovery plan
 */
router.post("/plan", (_req: Request, res: Response) => {
  try {
    const result = createRecoveryPlan();
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to create recovery plan");
    res.status(500).json({
      success: false,
      error: "Failed to create recovery plan",
    });
  }
});

/**
 * POST /plan/:id/execute
 * Execute the next step in a recovery plan
 */
router.post("/plan/:id/execute", (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = executeRecoveryStep(id);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to execute recovery step");
    res.status(500).json({
      success: false,
      error: "Failed to execute recovery step",
    });
  }
});

/**
 * GET /plan/:id
 * Get recovery plan status and progress
 */
router.get("/plan/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const plan = getRecoveryPlan(id);
    if (!plan) {
      res.status(404).json({
        success: false,
        error: `Recovery plan ${id} not found`,
      });
      return;
    }

    res.json({
      success: true,
      data: plan,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get recovery plan");
    res.status(500).json({
      success: false,
      error: "Failed to get recovery plan",
    });
  }
});

/**
 * GET /history
 * Get recovery history
 */
router.get("/history", (_req: Request, res: Response) => {
  try {
    const history = getRecoveryHistory();

    res.json({
      success: true,
      data: {
        total_recoveries: history.length,
        recoveries: history.slice(-20), // Last 20
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get recovery history");
    res.status(500).json({
      success: false,
      error: "Failed to get recovery history",
    });
  }
});

// ── Drill Endpoints ──────────────────────────────────────────────

/**
 * POST /drills
 * Create a new incident drill
 */
router.post("/drills", (req: Request, res: Response) => {
  try {
    const { type, config } = req.body;

    if (!type) {
      res.status(400).json({
        success: false,
        error: "drill type is required",
      });
      return;
    }

    const result = createDrill(type as DrillType, config);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to create drill");
    res.status(500).json({
      success: false,
      error: "Failed to create drill",
    });
  }
});

/**
 * POST /drills/:id/start
 * Start an incident drill
 */
router.post("/drills/:id/start", (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = startDrill(id);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to start drill");
    res.status(500).json({
      success: false,
      error: "Failed to start drill",
    });
  }
});

/**
 * POST /drills/:id/step
 * Execute the next step in a drill
 */
router.post("/drills/:id/step", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { step_name } = req.body;

    if (!step_name) {
      res.status(400).json({
        success: false,
        error: "step_name is required",
      });
      return;
    }

    const result = executeDrillStep(id, step_name);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to execute drill step");
    res.status(500).json({
      success: false,
      error: "Failed to execute drill step",
    });
  }
});

/**
 * POST /drills/:id/complete
 * Complete a drill and record results
 */
router.post("/drills/:id/complete", (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = completeDrill(id);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error,
      });
      return;
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to complete drill");
    res.status(500).json({
      success: false,
      error: "Failed to complete drill",
    });
  }
});

/**
 * GET /drills
 * List recent drills
 */
router.get("/drills", (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const drills = getRecentDrills(limit);

    res.json({
      success: true,
      data: {
        total_drills: drills.length,
        drills,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get recent drills");
    res.status(500).json({
      success: false,
      error: "Failed to get recent drills",
    });
  }
});

/**
 * GET /drills/:id
 * Get details of a specific drill
 */
router.get("/drills/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const drill = getDrill(id);
    if (!drill) {
      res.status(404).json({
        success: false,
        error: `Drill ${id} not found`,
      });
      return;
    }

    res.json({
      success: true,
      data: drill,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get drill");
    res.status(500).json({
      success: false,
      error: "Failed to get drill",
    });
  }
});

/**
 * GET /summary
 * Recovery & disaster readiness summary
 */
router.get("/summary", (_req: Request, res: Response) => {
  try {
    const history = getRecoveryHistory();
    const drillTypes: DrillType[] = [
      "kill_switch",
      "breaker",
      "data_outage",
      "broker_outage",
      "db_outage",
      "partial_execution",
      "restart_during_market",
    ];

    const drillsByType = Object.fromEntries(
      drillTypes.map((type) => [type, getDrillsByType(type)]),
    );

    const summary = {
      recovery: {
        total_recoveries: history.length,
        successful: history.filter((r) => r.recovery_status === "completed")
          .length,
        failed: history.filter((r) => r.recovery_status === "failed").length,
      },
      drills: {
        by_type: Object.fromEntries(
          drillTypes.map((type) => [
            type,
            {
              total: drillsByType[type].length,
              passed: drillsByType[type].filter(
                (d) => d.results.failed_steps === 0,
              ).length,
              failed: drillsByType[type].filter(
                (d) => d.results.failed_steps > 0,
              ).length,
            },
          ]),
        ),
        total: Object.values(drillsByType).reduce(
          (sum, drills) => sum + drills.length,
          0,
        ),
      },
      readiness_score: calculateReadinessScore(
        history,
        Object.values(drillsByType).flat(),
      ),
    };

    res.json({
      success: true,
      data: summary,
    });
  } catch (err: any) {
    logger.error({ err }, "Failed to get summary");
    res.status(500).json({
      success: false,
      error: "Failed to get summary",
    });
  }
});

// ── Helpers ──────────────────────────────────────────────────────

function calculateReadinessScore(
  recoveries: any[],
  drills: any[],
): {
  overall: number;
  recovery_success_rate: number;
  drill_pass_rate: number;
  recommendation: string;
} {
  const recoverySuccessRate =
    recoveries.length > 0
      ? (recoveries.filter((r) => r.recovery_status === "completed").length /
          recoveries.length) *
        100
      : 0;

  const drillPassRate =
    drills.length > 0
      ? (drills.filter((d) => d.results.failed_steps === 0).length /
          drills.length) *
        100
      : 0;

  const overall = (recoverySuccessRate + drillPassRate) / 2;

  let recommendation = "Ready for production";
  if (overall < 70) recommendation = "Run more drills before live trading";
  else if (overall < 85) recommendation = "Monitor for edge cases";
  else if (overall < 95) recommendation = "Good readiness level";

  return {
    overall: Math.round(overall),
    recovery_success_rate: Math.round(recoverySuccessRate),
    drill_pass_rate: Math.round(drillPassRate),
    recommendation,
  };
}

export default router;
