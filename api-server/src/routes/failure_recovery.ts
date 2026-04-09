import { Router, Request, Response } from "express";
import {
  recoveryEngine,
  type SystemState,
  type RecoveryTrigger,
} from "../lib/failure_recovery";

const router = Router();

interface StateRequest extends Request {
  body: Omit<SystemState, "id" | "captured_at">;
}

interface PlanRequest extends Request {
  body: {
    trigger: RecoveryTrigger;
    pre_state: SystemState;
  };
}

interface PlanCompleteRequest extends Request {
  body: {
    post_state: SystemState;
  };
}

interface PlanFailRequest extends Request {
  body: {
    error: string;
  };
}

interface DrillRequest extends Request {
  body: {
    drill_type: RecoveryTrigger;
    pass_criteria: string[];
  };
}

interface DrillAdvanceRequest extends Request {
  body: {
    finding?: string;
  };
}

interface DrillCompleteRequest extends Request {
  body: {
    criteria_met: boolean;
  };
}

// State capture
router.post("/state", (req: StateRequest, res: Response) => {
  try {
    const state = recoveryEngine.captureSystemState(req.body);
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to capture state",
    });
  }
});

// Get latest state
router.get("/state/latest", (req: Request, res: Response) => {
  try {
    const state = recoveryEngine.getLatestState();
    if (!state) {
      return res.status(404).json({
        success: false,
        error: "No system state found",
      });
    }
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get latest state",
    });
  }
});

// Create recovery plan
router.post("/plans", (req: PlanRequest, res: Response) => {
  try {
    const { trigger, pre_state } = req.body;

    if (!trigger || !pre_state) {
      return res.status(400).json({
        success: false,
        error: "Missing trigger or pre_state",
      });
    }

    const plan = recoveryEngine.createRecoveryPlan(trigger, pre_state);
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create recovery plan",
    });
  }
});

// List recovery plans
router.get("/plans", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const plans = recoveryEngine.getAllRecoveryPlans(limit);
    res.json({ success: true, data: plans });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to list plans",
    });
  }
});

// Get active recovery plan
router.get("/plans/active", (req: Request, res: Response) => {
  try {
    const plan = recoveryEngine.getActiveRecoveryPlan();
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: "No active recovery plan",
      });
    }
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get active plan",
    });
  }
});

// Get single recovery plan
router.get("/plans/:id", (req: Request, res: Response) => {
  try {
    const plan = recoveryEngine.getRecoveryPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        error: "Plan not found",
      });
    }
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to get plan",
    });
  }
});

// Execute recovery step
router.post(
  "/plans/:id/steps/:step_name",
  (req: Request, res: Response) => {
    try {
      const result = recoveryEngine.executeRecoveryStep(
        req.params.id,
        req.params.step_name
      );

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      const plan = recoveryEngine.getRecoveryPlan(req.params.id);
      res.json({ success: true, data: plan });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to execute step",
      });
    }
  }
);

// Complete recovery plan
router.post("/plans/:id/complete", (req: PlanCompleteRequest, res: Response) => {
  try {
    const { post_state } = req.body;

    if (!post_state) {
      return res.status(400).json({
        success: false,
        error: "Missing post_state",
      });
    }

    const result = recoveryEngine.completeRecoveryPlan(req.params.id, post_state);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    const plan = recoveryEngine.getRecoveryPlan(req.params.id);
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to complete plan",
    });
  }
});

// Fail recovery plan
router.post("/plans/:id/fail", (req: PlanFailRequest, res: Response) => {
  try {
    const { error } = req.body;

    if (!error) {
      return res.status(400).json({
        success: false,
        error: "Missing error description",
      });
    }

    const result = recoveryEngine.failRecoveryPlan(req.params.id, error);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    const plan = recoveryEngine.getRecoveryPlan(req.params.id);
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to fail plan",
    });
  }
});

// Schedule drill
router.post("/drills", (req: DrillRequest, res: Response) => {
  try {
    const { drill_type, pass_criteria } = req.body;

    if (!drill_type || !pass_criteria) {
      return res.status(400).json({
        success: false,
        error: "Missing drill_type or pass_criteria",
      });
    }

    const drill = recoveryEngine.scheduleDrill(drill_type, pass_criteria);
    res.json({ success: true, data: drill });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to schedule drill",
    });
  }
});

// Start drill
router.post("/drills/:id/start", (req: Request, res: Response) => {
  try {
    const result = recoveryEngine.startDrill(req.params.id);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    const drill = recoveryEngine.getDrill(req.params.id);
    res.json({ success: true, data: drill });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to start drill",
    });
  }
});

// Advance drill
router.post(
  "/drills/:id/advance",
  (req: DrillAdvanceRequest, res: Response) => {
    try {
      const result = recoveryEngine.advanceDrill(req.params.id, req.body.finding);

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      const drill = recoveryEngine.getDrill(req.params.id);
      res.json({ success: true, data: drill });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to advance drill",
      });
    }
  }
);

// Complete drill
router.post(
  "/drills/:id/complete",
  (req: DrillCompleteRequest, res: Response) => {
    try {
      const { criteria_met } = req.body;

      if (criteria_met === undefined) {
        return res.status(400).json({
          success: false,
          error: "Missing criteria_met",
        });
      }

      const result = recoveryEngine.completeDrill(req.params.id, criteria_met);

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      const drill = recoveryEngine.getDrill(req.params.id);
      res.json({ success: true, data: drill });
    } catch (error) {
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to complete drill",
      });
    }
  }
);

// Abort drill
router.post("/drills/:id/abort", (req: Request, res: Response) => {
  try {
    const result = recoveryEngine.abortDrill(req.params.id);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    const drill = recoveryEngine.getDrill(req.params.id);
    res.json({ success: true, data: drill });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to abort drill",
    });
  }
});

// List drills
router.get("/drills", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const drills = recoveryEngine.getAllDrills(limit);
    res.json({ success: true, data: drills });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to list drills",
    });
  }
});

// Get passed drills only
router.get("/drills/passed", (req: Request, res: Response) => {
  try {
    const drills = recoveryEngine.getPassedDrills();
    res.json({ success: true, data: drills });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to list passed drills",
    });
  }
});

export default router;
