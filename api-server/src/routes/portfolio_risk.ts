import { Router, Request, Response } from "express";
import pino from "pino";
import {
  addPosition,
  updatePosition,
  removePosition,
  getPositions,
  computeRiskMetrics,
  addCorrelation,
  getCorrelations,
  getCorrelationsForSymbol,
  suggestHedge,
  getHedgeSuggestions,
  checkRiskAlerts,
  getRiskAlerts,
} from "../lib/portfolio_risk";

const router = Router();
const logger = pino({ name: "portfolio-risk-routes" });

// GET /positions — all positions
router.get("/positions", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getPositions() });
  } catch (err: any) {
    logger.error({ err }, "Failed to get positions");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /positions — add position
router.post("/positions", (req: Request, res: Response) => {
  try {
    const { symbol, strategy_id, quantity, entry_price, current_price, side } = req.body;
    if (!symbol || !strategy_id || quantity === undefined || !entry_price || !current_price || !side) {
      res.status(400).json({ success: false, error: "Missing required fields: symbol, strategy_id, quantity, entry_price, current_price, side" });
      return;
    }
    addPosition({ symbol, strategy_id, quantity, entry_price, current_price, side });
    res.status(201).json({ success: true, data: getPositions().find(p => p.symbol === symbol && p.strategy_id === strategy_id) });
  } catch (err: any) {
    logger.error({ err }, "Failed to add position");
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /positions/:symbol/:strategy_id — update position
router.patch("/positions/:symbol/:strategy_id", (req: Request, res: Response) => {
  try {
    const result = updatePosition(req.params.symbol, req.params.strategy_id, req.body);
    if (!result.success) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Failed to update position");
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /positions/:symbol/:strategy_id — remove position
router.delete("/positions/:symbol/:strategy_id", (req: Request, res: Response) => {
  try {
    const result = removePosition(req.params.symbol, req.params.strategy_id);
    if (!result.success) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Failed to remove position");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /metrics — portfolio risk metrics
router.get("/metrics", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: computeRiskMetrics() });
  } catch (err: any) {
    logger.error({ err }, "Failed to compute risk metrics");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /correlations — all correlations
router.get("/correlations", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getCorrelations() });
  } catch (err: any) {
    logger.error({ err }, "Failed to get correlations");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /correlations/:symbol — correlations for symbol
router.get("/correlations/:symbol", (req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getCorrelationsForSymbol(req.params.symbol) });
  } catch (err: any) {
    logger.error({ err }, "Failed to get correlations for symbol");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /correlations — add correlation pair
router.post("/correlations", (req: Request, res: Response) => {
  try {
    const { symbol_a, symbol_b, correlation, period_days } = req.body;
    if (!symbol_a || !symbol_b || correlation === undefined || !period_days) {
      res.status(400).json({ success: false, error: "Missing required fields: symbol_a, symbol_b, correlation, period_days" });
      return;
    }
    const pair = addCorrelation({ symbol_a, symbol_b, correlation, period_days });
    res.status(201).json({ success: true, data: pair });
  } catch (err: any) {
    logger.error({ err }, "Failed to add correlation");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /hedges — all hedge suggestions
router.get("/hedges", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getHedgeSuggestions() });
  } catch (err: any) {
    logger.error({ err }, "Failed to get hedge suggestions");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /hedges/:symbol — hedge suggestion for symbol
router.get("/hedges/:symbol", (req: Request, res: Response) => {
  try {
    const suggestion = suggestHedge(req.params.symbol);
    if (!suggestion) {
      res.status(404).json({ success: false, error: "No position found for symbol" });
      return;
    }
    res.json({ success: true, data: suggestion });
  } catch (err: any) {
    logger.error({ err }, "Failed to get hedge suggestion");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /alerts — risk alerts
router.get("/alerts", (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getRiskAlerts() });
  } catch (err: any) {
    logger.error({ err }, "Failed to get risk alerts");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /alerts/check — run risk alert check
router.post("/alerts/check", (_req: Request, res: Response) => {
  try {
    const alerts = checkRiskAlerts();
    res.json({ success: true, data: alerts });
  } catch (err: any) {
    logger.error({ err }, "Failed to check risk alerts");
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
