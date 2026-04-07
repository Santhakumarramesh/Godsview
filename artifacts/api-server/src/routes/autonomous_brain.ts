/**
 * autonomous_brain.ts — Phase 147: Autonomous Brain API Routes
 *
 * REST + SSE endpoints for the per-symbol autonomous brain engine.
 */

import { Router, type Request, type Response } from "express";
import { autonomousBrainEngine, type Timeframe } from "../lib/autonomous_symbol_brain.js";

const router = Router();

// Default symbols to activate on startup
const DEFAULT_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META",
  "SPY", "QQQ", "AMD", "NFLX", "JPM", "V", "BTCUSD", "ETHUSD",
];

// Activate default brains on import
for (const sym of DEFAULT_SYMBOLS) {
  autonomousBrainEngine.activate(sym);
}
autonomousBrainEngine.startAutoRefresh(5000);

// GET /autonomous/brains — all active brain nodes
router.get("/brains", (_req: Request, res: Response) => {
  const brains = autonomousBrainEngine.getAll().map(b => ({
    symbol: b.symbol, isActive: b.isActive, compositeScore: b.compositeScore,
    compositeBias: b.compositeBias, compositeDecision: b.compositeDecision,
    winRate: b.winRate, totalTrades: b.totalTrades, pnl: b.pnl, sharpe: b.sharpe,
    lastUpdate: b.lastUpdate, personality: b.personality,
  }));
  res.json({ brains, count: brains.length });
});

// GET /autonomous/brain/:symbol — full brain state for one symbol
router.get("/brain/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const brain = autonomousBrainEngine.get(String(symbol).toUpperCase());
  if (!brain) {
    res.status(404).json({ error: `No brain node for ${symbol}` });
    return;
  }
  res.json(brain);
});

// GET /autonomous/brain/:symbol/:timeframe — decision for specific TF
router.get("/brain/:symbol/:timeframe", (req: Request, res: Response) => {
  const { symbol, timeframe } = req.params;
  const decision = autonomousBrainEngine.getDecision(String(symbol).toUpperCase(), timeframe as Timeframe);
  if (!decision) {
    res.status(404).json({ error: `No decision for ${symbol}/${timeframe}` });
    return;
  }
  res.json(decision);
});

// POST /autonomous/activate — activate a new symbol brain
router.post("/activate", (req: Request, res: Response) => {
  const { symbol } = req.body ?? {};
  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "symbol required" });
    return;
  }
  const state = autonomousBrainEngine.activate(String(symbol).toUpperCase());
  res.json({ activated: true, symbol: state.symbol, compositeScore: state.compositeScore });
});

// POST /autonomous/deactivate — deactivate a symbol brain
router.post("/deactivate", (req: Request, res: Response) => {
  const { symbol } = req.body ?? {};
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }
  autonomousBrainEngine.deactivate(String(symbol).toUpperCase());
  res.json({ deactivated: true, symbol: String(symbol).toUpperCase() });
});

// GET /autonomous/opportunities — top ranked opportunities
router.get("/opportunities", (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  res.json(autonomousBrainEngine.getTopOpportunities(limit));
});

// GET /autonomous/stream — SSE stream of brain updates
router.get("/stream", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");

  const interval = setInterval(() => {
    const brains = autonomousBrainEngine.getActive().map(b => ({
      symbol: b.symbol, score: b.compositeScore, bias: b.compositeBias,
      decision: b.compositeDecision, winRate: b.winRate, pnl: b.pnl,
      sharpe: b.sharpe, lastUpdate: b.lastUpdate,
    }));
    res.write(`data: ${JSON.stringify({ type: "update", brains, ts: Date.now() })}\n\n`);
  }, 3000);

  req.on("close", () => clearInterval(interval));
});

export default router;
