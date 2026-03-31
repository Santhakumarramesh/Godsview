/**
 * war_room.ts — War Room routes for multi-agent consensus
 */
import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  runWarRoom,
  clearWarRoomCache,
  getWarRoomCacheStats,
  type SMCState as WarRoomSMCState,
  type OrderflowState,
  type RiskInput,
} from "../lib/war_room";
import { computeSMCState, type SMCBar } from "../lib/smc_engine";
import { getBars, type AlpacaBar } from "../lib/alpaca";

const router = Router();

function toSMCBar(bar: AlpacaBar): SMCBar {
  return {
    Open: bar.o, High: bar.h, Low: bar.l,
    Close: bar.c, Volume: bar.v, Timestamp: bar.t,
  };
}

function buildDefaultOrderflowState(): OrderflowState {
  return {
    delta: 0, cvd: 0, cvdSlope: 0, quoteImbalance: 0,    aggressionScore: 0.5, orderflowBias: "neutral", orderflowScore: 0.5,
  };
}

function buildDefaultRiskInput(): RiskInput {
  return { volatilityRegime: "normal", spreadBps: 2, maxLossToday: 0, sessionActive: true };
}

function defaultSMC(sym: string): WarRoomSMCState {
  return {
    symbol: sym, structureScore: 0.5, bos: false, choch: false,
    trend: "range", activeOBs: [], unfilledFVGs: [], sweptPools: 0, totalPools: 0,
  };
}

// POST /war-room/analyze/:symbol
router.post("/analyze/:symbol", async (req: Request, res: Response): Promise<void> => {
  try {
    const sym = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!sym) { res.status(400).json({ error: "Missing symbol" }); return; }

    let smcState = defaultSMC(sym);
    try {
      const bars = await getBars(sym, "1Min", 100);
      if (bars.length > 0) {
        const smcBars = bars.map(toSMCBar);
        const full = computeSMCState(sym, smcBars, smcBars);
        const trendMap: Record<string, "uptrend" | "downtrend" | "range"> = { bullish: "uptrend", bearish: "downtrend", range: "range" };
        smcState = {
          symbol: sym,
          structureScore: full.structure?.structureScore ?? 0.5,
          bos: full.structure?.bos ?? false,          choch: full.structure?.choch ?? false,
          trend: trendMap[full.structure?.trend ?? "range"] ?? "range",
          activeOBs: full.activeOBs ?? [],
          unfilledFVGs: full.unfilledFVGs ?? [],
          sweptPools: full.liquidityPools?.filter((p: { swept: boolean }) => p.swept).length ?? 0,
          totalPools: full.liquidityPools?.length ?? 0,
        };
      }
    } catch (e: unknown) {
      logger.warn(`[War Room] Bar/SMC failed for ${sym}: ${e instanceof Error ? e.message : "unknown"}`);
    }

    const verdict = runWarRoom(sym, smcState, buildDefaultOrderflowState(), buildDefaultRiskInput());
    res.status(200).json(verdict);
  } catch (error: unknown) {
    logger.error(`[War Room POST] ${error instanceof Error ? error.message : "unknown"}`);
    res.status(500).json({ error: "War Room analysis failed", message: error instanceof Error ? error.message : "Unknown" });
  }
});

// GET /war-room/cache/stats
router.get("/cache/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json(getWarRoomCacheStats());
  } catch (error: unknown) {
    logger.error(`[War Room Cache Stats] ${error instanceof Error ? error.message : "unknown"}`);
    res.status(500).json({ error: "Cache stats failed" });
  }
});
// POST /war-room/cache/clear
router.post("/cache/clear", async (req: Request, res: Response): Promise<void> => {
  try {
    const { symbol } = req.body as { symbol?: string };
    if (symbol) { clearWarRoomCache(symbol); } else { clearWarRoomCache(); }
    res.status(200).json({ message: symbol ? `Cache cleared for ${symbol}` : "All cache cleared" });
  } catch (error: unknown) {
    logger.error(`[War Room Cache Clear] ${error instanceof Error ? error.message : "unknown"}`);
    res.status(500).json({ error: "Cache clear failed" });
  }
});

// GET /war-room/:symbol
router.get("/:symbol", async (req: Request, res: Response): Promise<void> => {
  try {
    const sym = String(req.params.symbol ?? "").toUpperCase().trim();
    if (!sym) { res.status(400).json({ error: "Missing symbol" }); return; }
    const stats = getWarRoomCacheStats();
    if (!stats.entries.includes(sym)) {
      res.status(404).json({ error: "No cached verdict", message: "POST /war-room/analyze/:symbol first" });
      return;
    }
    const verdict = runWarRoom(sym, defaultSMC(sym), buildDefaultOrderflowState(), buildDefaultRiskInput());
    res.status(200).json(verdict);
  } catch (error: unknown) {
    logger.error(`[War Room GET] ${error instanceof Error ? error.message : "unknown"}`);
    res.status(500).json({ error: "War Room retrieval failed" });
  }
});

export default router;