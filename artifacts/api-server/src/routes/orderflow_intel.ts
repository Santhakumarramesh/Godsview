import { Router, type Request, type Response } from "express";
import {
  generateSnapshot,
  generateImbalanceCandles,
  generateHeatmap,
  computeConfluence,
  getMultiSymbolSnapshot,
  getMultiSymbolConfluence,
  getSnapshotHistory,
  getConfluenceHistory,
  getTrackedSymbols,
  getOrderFlowSummary,
} from "../lib/orderflow_intelligence";

const router = Router();

// GET /snapshot/:symbol — live order flow snapshot for a symbol
router.get("/snapshot/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const snapshot = generateSnapshot(symbol);
    res.json({ ok: true, snapshot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /history/:symbol — snapshot history for a symbol
router.get("/history/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const limit = parseInt((req.query.limit as string) || "50", 10);
    const history = getSnapshotHistory(symbol, limit);
    res.json({ ok: true, symbol, count: history.length, history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /imbalance/:symbol — imbalance candle data
router.get("/imbalance/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const count = parseInt((req.query.count as string) || "20", 10);
    const candles = generateImbalanceCandles(symbol, count);
    res.json({ ok: true, symbol, count: candles.length, candles });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /heatmap/:symbol — depth heatmap data
router.get("/heatmap/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const levels = parseInt((req.query.levels as string) || "30", 10);
    const periods = parseInt((req.query.periods as string) || "20", 10);
    const cells = generateHeatmap(symbol, levels, periods);
    res.json({ ok: true, symbol, cellCount: cells.length, cells });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /confluence/:symbol — flow + structure confluence
router.get("/confluence/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const confluence = computeConfluence(symbol);
    res.json({ ok: true, confluence });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /confluence-history/:symbol — confluence history
router.get("/confluence-history/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = (req.params.symbol as string).toUpperCase();
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const history = getConfluenceHistory(symbol, limit);
    res.json({ ok: true, symbol, count: history.length, history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multi — multi-symbol snapshots
router.get("/multi", (req: Request, res: Response) => {
  try {
    const symbols = req.query.symbols ? (req.query.symbols as string).split(",").map((s) => s.trim().toUpperCase()) : undefined;
    const snapshots = getMultiSymbolSnapshot(symbols);
    res.json({ ok: true, count: snapshots.length, snapshots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /multi-confluence — multi-symbol confluence
router.get("/multi-confluence", (req: Request, res: Response) => {
  try {
    const symbols = req.query.symbols ? (req.query.symbols as string).split(",").map((s) => s.trim().toUpperCase()) : undefined;
    const confluences = getMultiSymbolConfluence(symbols);
    res.json({ ok: true, count: confluences.length, confluences });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /symbols — list tracked symbols
router.get("/symbols", (_req: Request, res: Response) => {
  try {
    const symbols = getTrackedSymbols();
    res.json({ ok: true, count: symbols.length, symbols });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /summary — order flow summary
router.get("/summary", (_req: Request, res: Response) => {
  try {
    const summary = getOrderFlowSummary();
    res.json({ ok: true, summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /health — health check
router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "orderflow-intelligence", status: "operational", ts: new Date().toISOString() });
});

export default router;
