import { Router, Request, Response } from "express";
import {
  runPipelineValidation,
  getPipelineHealth,
  getStageHealth,
  resetMetrics,
} from "../lib/pipeline_validator";

const router = Router();

/**
 * GET /status
 * Returns full pipeline health summary with all stages
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const health = getPipelineHealth();
    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * GET /stages
 * Returns individual stage status with detailed metrics
 */
router.get("/stages", async (req: Request, res: Response) => {
  try {
    const health = getPipelineHealth();
    const stageDetails = Object.entries(health.stages).map(
      ([key, stage]) => ({
        id: key,
        ...stage,
      })
    );

    res.json({
      success: true,
      data: {
        timestamp: health.timestamp,
        stages: stageDetails,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * POST /validate
 * Triggers a full end-to-end pipeline validation run
 */
router.post("/validate", async (req: Request, res: Response) => {
  try {
    const result = await runPipelineValidation();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * GET /stages/:stageName
 * Returns metrics for a specific pipeline stage
 */
router.get("/stages/:stageName", async (req: Request, res: Response) => {
  try {
    const { stageName } = req.params;
    const stage = getStageHealth(stageName);

    if (!stage) {
      return res.status(404).json({
        success: false,
        error: `Stage '${stageName}' not found`,
      });
    }

    res.json({
      success: true,
      data: {
        name: stageName,
        ...stage,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * POST /reset
 * Resets all pipeline metrics (for testing)
 */
router.post("/reset", async (req: Request, res: Response) => {
  try {
    resetMetrics();
    res.json({
      success: true,
      message: "Pipeline metrics reset",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

export default router;
