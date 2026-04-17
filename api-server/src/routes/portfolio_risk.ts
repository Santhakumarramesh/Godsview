import { Router, type Request, type Response } from "express";
import { PortfolioRiskEngine, type PortfolioPosition } from "../lib/portfolio_risk";
import pino from "pino";

const logger = pino();
const router = Router();
const engine = new PortfolioRiskEngine();

router.get("/positions", (_req: Request, res: Response) => {
  try {
    const positions = engine.getPositions();
    res.json({ success: true, data: positions });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch positions" });
  }
});

router.post("/positions", (req: Request, res: Response) => {
  try {
    const { symbol, strategy_id, quantity, entry_price, current_price, side } = req.body;

    if (!symbol || !strategy_id || quantity === undefined || entry_price === undefined || current_price === undefined || !side) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: symbol, strategy_id, quantity, entry_price, current_price, side",
      });
    }

    engine.addPosition({
      symbol,
      strategy_id,
      quantity,
      entry_price,
      current_price,
      side,
    });

    const positions = engine.getPositions();
    const position = positions.find((p) => p.symbol === symbol && p.strategy_id === strategy_id);

    res.status(201).json({ success: true, data: position });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to add position" });
  }
});

router.patch("/positions/:symbol/:strategy_id", (req: Request, res: Response) => {
  try {
    const { symbol, strategy_id } = req.params;
    const updates = req.body;

    const result = engine.updatePosition(symbol, strategy_id, updates);

    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error });
    }

    const positions = engine.getPositions();
    const position = positions.find((p) => p.symbol === symbol && p.strategy_id === strategy_id);

    res.json({ success: true, data: position });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to update position" });
  }
});

router.delete("/positions/:symbol/:strategy_id", (req: Request, res: Response) => {
  try {
    const { symbol, strategy_id } = req.params;

    const result = engine.removePosition(symbol, strategy_id);

    if (!result.success) {
      return res.status(404).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: { symbol, strategy_id } });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to remove position" });
  }
});

router.get("/metrics", (_req: Request, res: Response) => {
  try {
    const metrics = engine.computeRiskMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to compute metrics" });
  }
});

router.get("/correlations", (_req: Request, res: Response) => {
  try {
    const correlations = engine.getCorrelations();
    res.json({ success: true, data: correlations });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch correlations" });
  }
});

router.get("/correlations/:symbol", (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!symbol) {
      return res.status(400).json({ success: false, error: "Symbol is required" });
    }

    const correlations = engine.getCorrelationsForSymbol(symbol);
    res.json({ success: true, data: correlations });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch correlations" });
  }
});

router.post("/correlations", (req: Request, res: Response) => {
  try {
    const { symbol_a, symbol_b, correlation, period_days } = req.body;

    if (!symbol_a || !symbol_b || correlation === undefined || period_days === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: symbol_a, symbol_b, correlation, period_days",
      });
    }

    const pair = engine.addCorrelation({
      symbol_a,
      symbol_b,
      correlation,
      period_days,
    });

    res.status(201).json({ success: true, data: pair });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to add correlation" });
  }
});

router.get("/hedges", (_req: Request, res: Response) => {
  try {
    const suggestions = engine.getHedgeSuggestions();
    res.json({ success: true, data: suggestions });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch hedge suggestions" });
  }
});

router.get("/hedges/:symbol", (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    if (!symbol) {
      return res.status(400).json({ success: false, error: "Symbol is required" });
    }

    const suggestion = engine.suggestHedge(symbol);

    if (!suggestion) {
      return res.status(404).json({
        success: false,
        error: "No hedge suggestion found for this symbol",
      });
    }

    res.json({ success: true, data: suggestion });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch hedge suggestion" });
  }
});

router.get("/alerts", (_req: Request, res: Response) => {
  try {
    const alerts = engine.getRiskAlerts();
    res.json({ success: true, data: alerts });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to fetch alerts" });
  }
});

router.post("/alerts/check", (_req: Request, res: Response) => {
  try {
    const alerts = engine.checkRiskAlerts();
    res.json({ success: true, data: alerts });
  } catch (error) {
    logger.error(error);
    res.status(500).json({ success: false, error: "Failed to check risk alerts" });
  }
});

export default router;
