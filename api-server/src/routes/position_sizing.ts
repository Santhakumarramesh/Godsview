/**
 * routes/position_sizing.ts — Phase 11C
 *
 * Exposes a rich sizing snapshot for all open brain positions.
 * Used by the PositionSizingPanel on the Brain dashboard.
 *
 * GET /brain/positions/sizing  — full sizing details for all open brain positions
 * GET /brain/account/equity    — account equity snapshot from Alpaca (or configured)
 */

import { Router } from "express";
import { brainPositions } from "../lib/brain_execution_bridge.js";
import { getRealizedPnlToday, getReconciliationSnapshot } from "../lib/fill_reconciler.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Config (mirrors execution bridge env vars) ─────────────────────────────

const ACCOUNT_EQUITY = Number(process.env.BRAIN_ACCOUNT_EQUITY ?? "100000");
const ACCOUNT_RISK_PER_TRADE_PCT = Number(process.env.BRAIN_RISK_PER_TRADE_PCT ?? "1.0");
const MAX_CONCURRENT_POSITIONS = Number(process.env.BRAIN_MAX_POSITIONS ?? "5");

// ── GET /brain/positions/sizing ───────────────────────────────────────────
router.get("/brain/positions/sizing", async (req, res) => {
  try {
    const positions = brainPositions.getAll();
    const realizedPnl = getRealizedPnlToday();
    const reconcileSnap = getReconciliationSnapshot();

    // Fetch live prices for unrealized PnL estimate (best-effort)
    const livePrices: Record<string, number> = {};
    if (process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID) {
      try {
        const { default: alpaca } = await import("../lib/alpaca.js");
        for (const pos of positions) {
          try {
            const bars = await alpaca.getBars(pos.symbol, "1Min", 1);
            if (bars && bars.length > 0) {
              livePrices[pos.symbol] = bars[bars.length - 1].c ?? pos.entryPrice;
            }
          } catch { /* skip symbol if fetch fails */ }
        }
      } catch { /* Alpaca not available */ }
    }

    const positionDetails = positions.map((pos) => {
      const livePrice = livePrices[pos.symbol] ?? pos.entryPrice;
      const slDistance = Math.abs(pos.entryPrice - pos.stopLoss);
      const tpDistance = Math.abs(pos.takeProfit - pos.entryPrice);
      const riskDollars = slDistance * pos.quantity;
      const effectiveRiskPct = ACCOUNT_EQUITY > 0
        ? (riskDollars / ACCOUNT_EQUITY) * 100
        : 0;

      // Unrealized PnL
      const priceDelta = pos.direction === "long"
        ? livePrice - pos.entryPrice
        : pos.entryPrice - livePrice;
      const unrealizedPnl = priceDelta * pos.quantity;
      const unrealizedR = slDistance > 0 ? priceDelta / slDistance : 0;

      // Time in trade
      const ageMs = Date.now() - pos.openedAt;
      const ageMinutes = Math.round(ageMs / 60_000);

      return {
        symbol: pos.symbol,
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
        quantity: pos.quantity,
        strategyId: pos.strategyId,
        orderId: pos.orderId,
        openedAt: new Date(pos.openedAt).toISOString(),
        ageMinutes,

        // Sizing metrics
        slDistance: Number(slDistance.toFixed(4)),
        tpDistance: Number(tpDistance.toFixed(4)),
        riskDollars: Number(riskDollars.toFixed(2)),
        effectiveRiskPct: Number(effectiveRiskPct.toFixed(3)),
        riskRewardRatio: slDistance > 0 ? Number((tpDistance / slDistance).toFixed(2)) : 0,

        // Live PnL
        livePrice,
        unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
        unrealizedR: Number(unrealizedR.toFixed(3)),

        // Entry quality
        winProbAtEntry: pos.winProbAtEntry ?? null,
      };
    });

    // Portfolio-level metrics
    const totalRiskDollars = positionDetails.reduce((s, p) => s + p.riskDollars, 0);
    const totalUnrealizedPnl = positionDetails.reduce((s, p) => s + p.unrealizedPnl, 0);
    const totalPortfolioRiskPct = ACCOUNT_EQUITY > 0
      ? (totalRiskDollars / ACCOUNT_EQUITY) * 100
      : 0;
    const effectiveEquity = ACCOUNT_EQUITY + realizedPnl + totalUnrealizedPnl;

    res.json({
      positions: positionDetails,
      count: positionDetails.length,
      maxPositions: MAX_CONCURRENT_POSITIONS,
      slotsRemaining: Math.max(0, MAX_CONCURRENT_POSITIONS - positionDetails.length),

      // Risk summary
      totalRiskDollars: Number(totalRiskDollars.toFixed(2)),
      totalPortfolioRiskPct: Number(totalPortfolioRiskPct.toFixed(3)),
      maxRiskPerTradePct: ACCOUNT_RISK_PER_TRADE_PCT,

      // PnL summary
      realizedPnlToday: Number(realizedPnl.toFixed(2)),
      unrealizedPnlTotal: Number(totalUnrealizedPnl.toFixed(2)),
      netPnlToday: Number((realizedPnl + totalUnrealizedPnl).toFixed(2)),

      // Equity
      configuredEquity: ACCOUNT_EQUITY,
      effectiveEquity: Number(effectiveEquity.toFixed(2)),
      equityUtilizationPct: ACCOUNT_EQUITY > 0
        ? Number(((totalRiskDollars / ACCOUNT_EQUITY) * 100).toFixed(2))
        : 0,

      // Reconciler health
      reconciler: reconcileSnap,

      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Position sizing snapshot failed");
    res.status(500).json({ error: "Failed to build sizing snapshot" });
  }
});

// ── GET /brain/account/equity ────────────────────────────────────────────
// Returns account equity from Alpaca (live) or from env config
router.get("/brain/account/equity", async (_req, res) => {
  try {
    let equity = ACCOUNT_EQUITY;
    let source = "env_config";
    let buyingPower: number | null = null;
    let portfolioValue: number | null = null;

    if (process.env.ALPACA_API_KEY || process.env.ALPACA_KEY_ID) {
      try {
        const { default: alpaca } = await import("../lib/alpaca.js");
        const account = await alpaca.getAccount();
        if (account) {
          equity = Number(account.equity) || equity;
          buyingPower = Number(account.buying_power) || null;
          portfolioValue = Number(account.portfolio_value) || null;
          source = "alpaca_live";
        }
      } catch { /* fall back to env */ }
    }

    res.json({
      equity,
      buyingPower,
      portfolioValue,
      source,
      maxRiskPerTradePct: ACCOUNT_RISK_PER_TRADE_PCT,
      maxRiskDollars: Number((equity * ACCOUNT_RISK_PER_TRADE_PCT / 100).toFixed(2)),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Account equity fetch failed");
    res.status(500).json({ error: "Failed to fetch account equity" });
  }
});

export default router;
