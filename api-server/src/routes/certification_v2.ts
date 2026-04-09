import { Router, Request, Response } from "express";
import pino from "pino";
import {
  runCertification,
  abortCertification,
  getCertificationRun,
  getAllRuns,
  getRunsByStrategy,
  getLatestCertification,
  createPolicy,
  getPolicy,
  getAllPolicies,
  activatePolicy,
  deactivatePolicy,
  getCertificationHistory,
  getSystemCertificationStatus,
} from "../lib/certification_v2";

const logger = pino();
const router = Router();

// POST /run - Run certification
router.post("/run", (req: Request, res: Response) => {
  try {
    const { strategy_id, initiated_by, dimension_scores } = req.body;

    if (!initiated_by) {
      return res.status(400).json({
        success: false,
        error: "initiated_by is required",
      });
    }

    if (!dimension_scores || typeof dimension_scores !== "object") {
      return res.status(400).json({
        success: false,
        error: "dimension_scores object is required",
      });
    }

    const run = runCertification({
      strategy_id,
      initiated_by,
      dimension_scores,
    });

    return res.status(201).json({
      success: true,
      data: run,
    });
  } catch (error) {
    logger.error(error, "Error running certification");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /runs - List runs
router.get("/runs", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const runs = getAllRuns(limit);

    return res.status(200).json({
      success: true,
      data: runs,
    });
  } catch (error) {
    logger.error(error, "Error listing runs");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /runs/:id - Single run
router.get("/runs/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const run = getCertificationRun(id);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: `Certification run ${id} not found`,
      });
    }

    return res.status(200).json({
      success: true,
      data: run,
    });
  } catch (error) {
    logger.error(error, "Error fetching run");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /runs/strategy/:strategy_id - By strategy
router.get("/runs/strategy/:strategy_id", (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const runs = getRunsByStrategy(strategy_id);

    return res.status(200).json({
      success: true,
      data: runs,
    });
  } catch (error) {
    logger.error(error, "Error fetching runs by strategy");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /runs/strategy/:strategy_id/latest - Latest for strategy
router.get("/runs/strategy/:strategy_id/latest", (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const run = getLatestCertification(strategy_id);

    if (!run) {
      return res.status(404).json({
        success: false,
        error: `No certification runs found for strategy ${strategy_id}`,
      });
    }

    return res.status(200).json({
      success: true,
      data: run,
    });
  } catch (error) {
    logger.error(error, "Error fetching latest certification");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /runs/:id/abort - Abort run
router.post("/runs/:id/abort", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = abortCertification(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const run = getCertificationRun(id);
    return res.status(200).json({
      success: true,
      data: run,
    });
  } catch (error) {
    logger.error(error, "Error aborting certification");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /policies - Create policy
router.post("/policies", (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      dimensions_required,
      min_overall_score,
      hard_fail_dimensions,
      restriction_dimensions,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Policy name is required",
      });
    }

    const policy = createPolicy({
      name,
      description,
      dimensions_required,
      min_overall_score,
      hard_fail_dimensions,
      restriction_dimensions,
    });

    return res.status(201).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    logger.error(error, "Error creating policy");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /policies - List policies
router.get("/policies", (req: Request, res: Response) => {
  try {
    const policies = getAllPolicies();

    return res.status(200).json({
      success: true,
      data: policies,
    });
  } catch (error) {
    logger.error(error, "Error listing policies");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /policies/:id - Single policy
router.get("/policies/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const policy = getPolicy(id);

    if (!policy) {
      return res.status(404).json({
        success: false,
        error: `Policy ${id} not found`,
      });
    }

    return res.status(200).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    logger.error(error, "Error fetching policy");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /policies/:id/activate - Activate policy
router.post("/policies/:id/activate", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = activatePolicy(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const policy = getPolicy(id);
    return res.status(200).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    logger.error(error, "Error activating policy");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /policies/:id/deactivate - Deactivate policy
router.post("/policies/:id/deactivate", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = deactivatePolicy(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const policy = getPolicy(id);
    return res.status(200).json({
      success: true,
      data: policy,
    });
  } catch (error) {
    logger.error(error, "Error deactivating policy");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /history/:strategy_id - Certification history
router.get("/history/:strategy_id", (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const history = getCertificationHistory(strategy_id);

    return res.status(200).json({
      success: true,
      data: history,
    });
  } catch (error) {
    logger.error(error, "Error fetching certification history");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /status - System certification status
router.get("/status", (req: Request, res: Response) => {
  try {
    const status = getSystemCertificationStatus();

    return res.status(200).json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error(error, "Error fetching system certification status");
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
