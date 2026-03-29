import { Router, type Request } from "express";
import { getBars } from "../lib/alpaca";
import { evaluateStrictSweepReclaim, type StrictSweepReclaimOptions } from "../lib/strict_setup_engine";
import { orderBookManager } from "../lib/market/orderbook";
import { normalizeMarketSymbol } from "../lib/market/symbols";
import type { AlpacaBar } from "../lib/alpaca";

const router = Router();

function normalizeStrictSymbol(raw: string): string {
  const symbol = normalizeMarketSymbol(raw, "BTCUSD");
  if (symbol === "BTCUSD" || symbol === "ETHUSD") return symbol;
  return "BTCUSD";
}

function parseBoolean(raw: unknown, fallback: boolean): boolean {
  if (raw === undefined || raw === null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(value)) return true;
  if (["0", "false", "no", "n"].includes(value)) return false;
  return fallback;
}

function parseNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function detectNewsLockoutFromEnv(nowMs: number): boolean {
  const untilRaw = String(process.env.GODSVIEW_NEWS_LOCKOUT_UNTIL ?? "").trim();
  if (!untilRaw) return false;
  const untilMs = Date.parse(untilRaw);
  return Number.isFinite(untilMs) && nowMs < untilMs;
}

function evaluateForwardOutcome(
  direction: "long" | "short",
  stopLoss: number,
  takeProfit: number,
  futureBars: AlpacaBar[],
): { outcome: "win" | "loss" | "open"; barsToOutcome: number | null } {
  for (let i = 0; i < futureBars.length; i++) {
    const bar = futureBars[i]!;
    if (direction === "long") {
      // Conservative tie-breaker: if both are hit in same bar, treat as loss.
      if (bar.Low <= stopLoss) return { outcome: "loss", barsToOutcome: i + 1 };
      if (bar.High >= takeProfit) return { outcome: "win", barsToOutcome: i + 1 };
    } else {
      if (bar.High >= stopLoss) return { outcome: "loss", barsToOutcome: i + 1 };
      if (bar.Low <= takeProfit) return { outcome: "win", barsToOutcome: i + 1 };
    }
  }
  return { outcome: "open", barsToOutcome: null };
}

function buildOptions(req: Request): StrictSweepReclaimOptions {
  const nowMs = Date.now();
  const queryNewsLockout = parseBoolean(req.query.news_lockout, false);
  const envNewsLockout = detectNewsLockoutFromEnv(nowMs);

  return {
    minLookbackBars: parseNumber(req.query.lookback, 20, 12, 80),
    minSweepWickRatio: parseNumber(req.query.min_wick_ratio, 0.35, 0.1, 0.9),
    minTopBookNotionalUsd: parseNumber(req.query.min_top_book_notional, 200_000, 1_000, 100_000_000),
    maxSpreadBps: parseNumber(req.query.max_spread_bps, 15, 0.5, 150),
    rrTarget: parseNumber(req.query.rr_target, 2, 0.5, 8),
    requireOrderbook: parseBoolean(req.query.require_orderbook, true),
    allowAsianSession: parseBoolean(req.query.allow_asian, false),
    newsLockoutActive: queryNewsLockout || envNewsLockout,
  };
}

// ─── GET /api/market/strict-setup ────────────────────────────────────────────
router.get("/market/strict-setup", async (req, res) => {
  const symbol = normalizeStrictSymbol(String(req.query.symbol ?? "BTCUSD"));
  const barsCount = Math.round(parseNumber(req.query.bars, 220, 80, 1000));
  const options = buildOptions(req);

  try {
    const bars = await getBars(symbol, "1Min", barsCount);
    const latestSnapshot = orderBookManager.getSnapshot(symbol);
    const snapshot = latestSnapshot && Date.now() - latestSnapshot.receivedAt < 12_000
      ? latestSnapshot
      : await orderBookManager.fetchSnapshot(symbol).catch(() => null);

    const decision = evaluateStrictSweepReclaim(symbol, bars, snapshot, options);

    res.json({
      ...decision,
      barsUsed: bars.length,
      orderbookTimestamp: snapshot?.timestamp ?? null,
      orderbookReceivedAt: snapshot?.receivedAt ?? null,
    });
  } catch (err) {
    req.log.error({ err, symbol }, "strict setup evaluation failed");
    res.status(500).json({
      error: "strict_setup_failed",
      message: String(err),
    });
  }
});

// ─── GET /api/market/strict-setup/backtest ───────────────────────────────────
router.get("/market/strict-setup/backtest", async (req, res) => {
  const symbol = normalizeStrictSymbol(String(req.query.symbol ?? "BTCUSD"));
  const barsCount = Math.round(parseNumber(req.query.bars, 1200, 240, 5000));
  const forwardBars = Math.round(parseNumber(req.query.forward_bars, 30, 5, 200));
  const options = buildOptions(req);
  options.requireOrderbook = false;

  try {
    const bars = await getBars(symbol, "1Min", barsCount);
    if (bars.length < 120) {
      res.status(400).json({
        error: "insufficient_data",
        message: "Need at least 120 one-minute bars for strict backtest",
      });
      return;
    }

    const rows: Array<{
      timestamp: string;
      direction: "long" | "short";
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      riskReward: number;
      outcome: "win" | "loss" | "open";
      barsToOutcome: number | null;
      blockedReasons: string[];
      session: string;
    }> = [];

    const startIndex = Math.max(40, Math.floor(options.minLookbackBars ?? 20) + 2);
    for (let i = startIndex; i < bars.length - 1; i++) {
      const window = bars.slice(0, i + 1);
      const decision = evaluateStrictSweepReclaim(symbol, window, null, options);
      if (!decision.detected || !decision.direction || !decision.entryPrice || !decision.stopLoss || !decision.takeProfit) {
        continue;
      }

      const future = bars.slice(i + 1, i + 1 + forwardBars);
      const result = evaluateForwardOutcome(
        decision.direction,
        decision.stopLoss,
        decision.takeProfit,
        future,
      );

      rows.push({
        timestamp: decision.timestamp ?? window[window.length - 1]!.Timestamp,
        direction: decision.direction,
        entryPrice: decision.entryPrice,
        stopLoss: decision.stopLoss,
        takeProfit: decision.takeProfit,
        riskReward: decision.riskReward ?? 0,
        outcome: result.outcome,
        barsToOutcome: result.barsToOutcome,
        blockedReasons: decision.blockedReasons,
        session: decision.session,
      });
    }

    const closed = rows.filter((row) => row.outcome !== "open");
    const wins = closed.filter((row) => row.outcome === "win");
    const losses = closed.filter((row) => row.outcome === "loss");
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    res.json({
      setup: "sweep_reclaim_v1",
      symbol,
      barsScanned: bars.length,
      forwardBars,
      totalSignals: rows.length,
      closedSignals: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Number(winRate.toFixed(3)),
      options,
      results: rows,
    });
  } catch (err) {
    req.log.error({ err, symbol }, "strict setup backtest failed");
    res.status(500).json({
      error: "strict_setup_backtest_failed",
      message: String(err),
    });
  }
});

export default router;
