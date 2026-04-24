/**
 * market_structure.ts — Multi-Timeframe Market Structure API (Phase 63)
 *
 * Endpoints:
 *   GET  /api/market-structure/:symbol/analyze     — Full multi-TF structure analysis
 *   GET  /api/market-structure/:symbol/:timeframe   — Single timeframe analysis
 *   GET  /api/market-structure/:symbol/order-blocks  — Active order blocks across TFs
 *   GET  /api/market-structure/:symbol/abcd          — AB=CD patterns across TFs
 *   GET  /api/market-structure/:symbol/probability    — Trade probability for current price
 */
import { Router, type Request, type Response } from "express";
import {
  analyzeTimeframe,
  analyzeMultiTimeframe,
  calculateTradeProbability,
  type Bar,
  type Timeframe,
} from "../engines/market_structure_htf.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIMEFRAMES: Timeframe[] = ["15min", "1H", "4H", "1D", "1W"];

async function fetchBarsForSymbol(
  symbol: string,
  timeframe: Timeframe,
): Promise<Bar[]> {
  // Try to use Alpaca if available
  try {
    const { getBars } = await import("../lib/alpaca.js");
    const tfMap: Record<Timeframe, string> = {
      "15min": "15Min",
      "1H": "1Hour",
      "4H": "1Hour", // fetch 4x more 1H bars and aggregate
      "1D": "1Day",
      "1W": "1Day", // fetch 5x daily bars and aggregate
    };
    const limitMap: Record<Timeframe, number> = {
      "15min": 200,
      "1H": 200,
      "4H": 800,
      "1D": 200,
      "1W": 1000,
    };
    const raw = await getBars(symbol, tfMap[timeframe]! as any, limitMap[timeframe]!);
    if (raw && Array.isArray(raw) && raw.length > 5) {
      const bars: Bar[] = raw.map((b: any) => ({
        t: b.t ?? b.Timestamp ?? "",
        o: Number(b.o ?? b.Open ?? 0),
        h: Number(b.h ?? b.High ?? 0),
        l: Number(b.l ?? b.Low ?? 0),
        c: Number(b.c ?? b.Close ?? 0),
        v: Number(b.v ?? b.Volume ?? 0),
      }));

      // Aggregate for 4H and 1W
      if (timeframe === "4H") return aggregateBars(bars, 4);
      if (timeframe === "1W") return aggregateBars(bars, 5);
      return bars;
    }
  } catch (err) {
    // NO SYNTHETIC FALLBACK — return empty array, callers must handle gracefully
    const { logger } = await import("../lib/logger.js");
    logger.warn({ symbol, timeframe, err }, "Market structure: no real bars available — returning empty");
  }

  return [];
}

function aggregateBars(bars: Bar[], period: number): Bar[] {
  const result: Bar[] = [];
  for (let i = 0; i < bars.length; i += period) {
    const chunk = bars.slice(i, i + period);
    if (chunk.length === 0) continue;
    result.push({
      t: chunk[0]!.t,
      o: chunk[0]!.o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1]!.c,
      v: chunk.reduce((s, b) => s + b.v, 0),
    });
  }
  return result;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/market-structure/:symbol/analyze — Full multi-TF analysis */
router.get("/market-structure/:symbol/analyze", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    const barsByTf: Partial<Record<Timeframe, Bar[]>> = {};

    for (const tf of TIMEFRAMES) {
      barsByTf[tf] = await fetchBarsForSymbol(symbol!, tf);
    }

    const result = analyzeMultiTimeframe(barsByTf as Record<Timeframe, Bar[]>, symbol!);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: "analysis_failed", message: err.message });
  }
});

/** GET /api/market-structure/:symbol/:timeframe — Single TF analysis */
router.get("/market-structure/:symbol/:timeframe", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    const timeframe = String(req.params.timeframe);
    if (!TIMEFRAMES.includes(timeframe as Timeframe)) {
      res.status(400).json({ error: "invalid_timeframe", valid: TIMEFRAMES });
      return;
    }
    const bars = await fetchBarsForSymbol(symbol!, timeframe as Timeframe);
    const result = analyzeTimeframe(bars, timeframe as Timeframe);
    res.json({ symbol, ...result });
  } catch (err: any) {
    res.status(500).json({ error: "analysis_failed", message: err.message });
  }
});

/** GET /api/market-structure/:symbol/order-blocks — All active OBs across TFs */
router.get("/market-structure/:symbol/order-blocks", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    const allBlocks: any[] = [];
    for (const tf of TIMEFRAMES) {
      const bars = await fetchBarsForSymbol(symbol!, tf);
      const analysis = analyzeTimeframe(bars, tf);
      allBlocks.push(...analysis.orderBlocks);
    }
    allBlocks.sort((a, b) => b.score - a.score);
    res.json({ symbol, orderBlocks: allBlocks, count: allBlocks.length });
  } catch (err: any) {
    res.status(500).json({ error: "analysis_failed", message: err.message });
  }
});

/** GET /api/market-structure/:symbol/abcd — AB=CD patterns across TFs */
router.get("/market-structure/:symbol/abcd", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    const allPatterns: any[] = [];
    for (const tf of TIMEFRAMES) {
      const bars = await fetchBarsForSymbol(symbol!, tf);
      const analysis = analyzeTimeframe(bars, tf);
      allPatterns.push(...analysis.abcdPatterns);
    }
    allPatterns.sort((a, b) => b.score - a.score);
    res.json({ symbol, abcdPatterns: allPatterns, count: allPatterns.length });
  } catch (err: any) {
    res.status(500).json({ error: "analysis_failed", message: err.message });
  }
});

/** GET /api/market-structure/:symbol/probability — Trade probability */
router.get("/market-structure/:symbol/probability", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol);
    const currentPrice = Number(req.query.price) || 0;

    const barsByTf: Partial<Record<Timeframe, Bar[]>> = {};
    for (const tf of TIMEFRAMES) {
      barsByTf[tf] = await fetchBarsForSymbol(symbol!, tf);
    }

    const mtf = analyzeMultiTimeframe(barsByTf as Record<Timeframe, Bar[]>, symbol!);
    const price = currentPrice || barsByTf["1H"]?.[barsByTf["1H"]!.length - 1]?.c || 0;
    const prob = calculateTradeProbability(mtf, price);

    res.json({ symbol, currentPrice: price, probability: prob, htfBias: mtf.htfBias });
  } catch (err: any) {
    res.status(500).json({ error: "analysis_failed", message: err.message });
  }
});

export default router;
