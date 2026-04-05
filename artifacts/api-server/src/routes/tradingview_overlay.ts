/**
 * tradingview_overlay.ts — TradingView MCP Overlay API (Phase 53)
 */
import { Router, type Request, type Response } from "express";
import {
  generateChartOverlay, getOverlay, getOverlaySnapshot, resetOverlays,
} from "../lib/tradingview_overlay.js";

const router = Router();

router.get("/api/overlay/snapshot", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, snapshot: getOverlaySnapshot() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/overlay/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase();
    const overlay = getOverlay(symbol);
    if (!overlay) { res.status(404).json({ ok: false, error: `No overlay for ${symbol}` }); return; }
    res.json({ ok: true, overlay });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/overlay/generate", async (req: Request, res: Response) => {
  try {
    const { symbol, currentPrice, timeframe, position, signals, structureLevels, orderBlocks } = req.body;
    if (!symbol || !currentPrice) { res.status(400).json({ ok: false, error: "symbol and currentPrice required" }); return; }
    const overlay = generateChartOverlay({ symbol: symbol.toUpperCase(), currentPrice, timeframe, position, signals, structureLevels, orderBlocks });
    res.json({ ok: true, overlay });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/overlay/reset", async (_req: Request, res: Response) => {
  try { resetOverlays(); res.json({ ok: true, message: "Overlay cache reset" }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

export default router;
