/**
 * position_sizing.ts — Position Sizing Oracle API (Phase 56)
 */
import { Router, type Request, type Response } from "express";
import { calculatePositionSize, getSizingOracleSnapshot, resetSizingOracle } from "../lib/position_sizing_oracle.js";

const router = Router();

router.get("/api/position-sizing/snapshot", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, snapshot: getSizingOracleSnapshot() }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/position-sizing/calculate", async (req: Request, res: Response) => {
  try {
    const { equity, riskPct, entryPrice, stopLoss, winRate, avgWinLossRatio, atr, regime, contextScore, method } = req.body;
    if (!equity || !entryPrice || !stopLoss) { res.status(400).json({ ok: false, error: "equity, entryPrice, stopLoss required" }); return; }
    const result = calculatePositionSize({
      equity, riskPct: riskPct ?? 0.02, entryPrice, stopLoss,
      winRate, avgWinLossRatio, atr, regime, contextScore, method,
    });
    res.json({ ok: true, result });
  } catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/position-sizing/reset", async (_req: Request, res: Response) => {
  try { resetSizingOracle(); res.json({ ok: true, message: "Sizing oracle reset" }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

export default router;
