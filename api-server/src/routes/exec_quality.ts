import { Router, Request, Response } from "express";
import { execQualityService } from "../lib/exec_quality";

const router = Router();

// POST /exec-quality - Record execution
router.post("/", (req: Request, res: Response) => {
  const { order_id, symbol, side, quantity, expected_price, fill_price, fill_time_ms, broker_id, venue, strategy_id } = req.body;
  if (!order_id || !symbol || !side || !quantity || !expected_price || !fill_price || fill_time_ms === undefined || !broker_id) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = execQualityService.recordExecution(order_id, symbol, side, quantity, expected_price, fill_price, fill_time_ms, broker_id, venue, strategy_id);
  res.status(result.success ? 201 : 400).json(result);
});

// GET /exec-quality - Get all executions
router.get("/", (_req: Request, res: Response) => {
  const result = execQualityService.getAllExecutions();
  res.status(200).json(result);
});

// GET /exec-quality/:id - Get single execution
router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = execQualityService.getExecution(id);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /exec-quality/:id/score - Score execution
router.post("/:id/score", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = execQualityService.scoreExecution(id);
  res.status(result.success ? 200 : 404).json(result);
});

// GET /exec-quality/symbol/:symbol - Get executions by symbol
router.get("/symbol/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const result = execQualityService.getExecutionsBySymbol(symbol);
  res.status(200).json(result);
});

// GET /exec-quality/strategy/:strategyId - Get executions by strategy
router.get("/strategy/:strategyId", (req: Request, res: Response) => {
  const { strategyId } = req.params;
  const result = execQualityService.getExecutionsByStrategy(strategyId);
  res.status(200).json(result);
});

// GET /exec-quality/reports/slippage - Generate slippage report
router.get("/reports/slippage", (req: Request, res: Response) => {
  const period = (req.query.period as string) ?? "daily";
  const result = execQualityService.generateSlippageReport(period);
  res.status(result.success ? 200 : 400).json(result);
});

// GET /exec-quality/venues/compare - Compare venues
router.get("/venues/compare", (_req: Request, res: Response) => {
  const result = execQualityService.compareVenues();
  res.status(200).json(result);
});

// GET /exec-quality/venues/best - Get best venue
router.get("/venues/best", (_req: Request, res: Response) => {
  const result = execQualityService.getBestVenue();
  res.status(result.success ? 200 : 400).json(result);
});

// GET /exec-quality/costs/analyze - Analyze execution costs
router.get("/costs/analyze", (req: Request, res: Response) => {
  const commissionPerTrade = parseFloat((req.query.commission as string) ?? "0");
  const result = execQualityService.analyzeExecutionCosts(commissionPerTrade);
  res.status(result.success ? 200 : 400).json(result);
});

export default router;
