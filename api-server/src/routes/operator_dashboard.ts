import { Router, Request, Response } from "express";
import {
  setSystemMode,
  registerStrategy,
  updateStrategyCard,
  getStrategyCards,
  createAlert,
  acknowledgeAlert,
  getActiveAlerts,
  getAllAlerts,
  generateDailyBrief,
  getBrief,
  getAllBriefs,
  getSystemOverview,
  StrategyCard,
  SystemMode,
} from "../lib/operator_dashboard";

const router = Router();

// GET /api/operator/overview
router.get("/overview", (req: Request, res: Response) => {
  try {
    const overview = getSystemOverview();
    res.json({ success: true, data: overview });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/operator/mode
router.post("/mode", (req: Request<{}, {}, { mode: SystemMode }>, res: Response) => {
  try {
    const result = setSystemMode(req.body.mode);
    if (result.success) {
      const overview = getSystemOverview();
      res.json({ success: true, data: overview });
    } else {
      res.status(400).json({ success: false, error: "Invalid mode" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/operator/strategies
router.post("/strategies", (req: Request<{}, {}, StrategyCard>, res: Response) => {
  try {
    const card = registerStrategy(req.body);
    res.status(201).json({ success: true, data: card });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: msg });
  }
});

// PATCH /api/operator/strategies/:strategy_id
router.patch("/strategies/:strategy_id", (req: Request<{ strategy_id: string }, {}, Partial<StrategyCard>>, res: Response) => {
  try {
    const result = updateStrategyCard(req.params.strategy_id, req.body);
    if (result.success) {
      const cards = getStrategyCards();
      const updated = cards.find(c => c.strategy_id === req.params.strategy_id);
      res.json({ success: true, data: updated });
    } else {
      res.status(404).json({ success: false, error: result.error });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/operator/strategies
router.get("/strategies", (req: Request, res: Response) => {
  try {
    const cards = getStrategyCards();
    res.json({ success: true, data: cards });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/operator/alerts
router.post("/alerts", (req: Request<{}, {}, { strategy_id: string; severity: string; message: string }>, res: Response) => {
  try {
    const alert = createAlert({
      strategy_id: req.body.strategy_id,
      severity: req.body.severity as any,
      message: req.body.message,
    });
    res.status(201).json({ success: true, data: alert });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: msg });
  }
});

// POST /api/operator/alerts/:alert_id/acknowledge
router.post("/alerts/:alert_id/acknowledge", (req: Request<{ alert_id: string }, {}, { acknowledged_by: string }>, res: Response) => {
  try {
    const result = acknowledgeAlert(req.params.alert_id, req.body.acknowledged_by);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: result.error });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/operator/alerts/active
router.get("/alerts/active", (req: Request, res: Response) => {
  try {
    const alerts = getActiveAlerts();
    res.json({ success: true, data: alerts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/operator/alerts
router.get("/alerts", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const alerts = getAllAlerts(limit);
    res.json({ success: true, data: alerts });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/operator/briefs/generate
router.post("/briefs/generate", (req: Request, res: Response) => {
  try {
    const brief = generateDailyBrief();
    res.status(201).json({ success: true, data: brief });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/operator/briefs/:id
router.get("/briefs/:id", (req: Request, res: Response) => {
  try {
    const brief = getBrief(req.params.id);
    if (brief) {
      res.json({ success: true, data: brief });
    } else {
      res.status(404).json({ success: false, error: "Brief not found" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/operator/briefs
router.get("/briefs", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const briefs = getAllBriefs(limit);
    res.json({ success: true, data: briefs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
