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

type StrictBacktestRow = {
  timestamp: string;
  direction: "long" | "short";
  session: string;
  regime: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  confidenceScore: number;
  predictedProbability: number;
  tradeAllowed: boolean;
  blockedReasons: string[];
  outcome: "win" | "loss" | "open";
  barsToOutcome: number | null;
};

type KeyMetricRow = {
  key: string;
  totalSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRiskReward: number;
  expectancyR: number;
};

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0.001, Math.min(0.999, value));
}

function runStrictBacktestRows(
  symbol: string,
  bars: AlpacaBar[],
  forwardBars: number,
  options: StrictSweepReclaimOptions,
): StrictBacktestRow[] {
  const rows: StrictBacktestRow[] = [];
  const startIndex = Math.max(40, Math.floor(options.minLookbackBars ?? 20) + 2);
  for (let i = startIndex; i < bars.length - 1; i++) {
    const window = bars.slice(0, i + 1);
    const windowTsMs = Date.parse(window[window.length - 1]!.Timestamp);
    const decision = evaluateStrictSweepReclaim(symbol, window, null, {
      ...options,
      nowMs: Number.isFinite(windowTsMs) ? windowTsMs : undefined,
    });
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
      session: decision.session,
      regime: decision.diagnostics.regime,
      entryPrice: decision.entryPrice,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      riskReward: decision.riskReward ?? 0,
      confidenceScore: decision.confidenceScore ?? 0,
      predictedProbability: clampProbability(decision.expectedWinProbability ?? 0.5),
      tradeAllowed: decision.tradeAllowed,
      blockedReasons: decision.blockedReasons,
      outcome: result.outcome,
      barsToOutcome: result.barsToOutcome,
    });
  }
  return rows;
}

function computeKeyMetrics(rows: StrictBacktestRow[], keySelector: (row: StrictBacktestRow) => string): KeyMetricRow[] {
  const groups = new Map<string, StrictBacktestRow[]>();
  for (const row of rows) {
    const key = keySelector(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: KeyMetricRow[] = [];
  for (const [key, groupRows] of groups.entries()) {
    const closed = groupRows.filter((row) => row.tradeAllowed && row.outcome !== "open");
    const wins = closed.filter((row) => row.outcome === "win");
    const losses = closed.filter((row) => row.outcome === "loss");
    const avgRiskReward = closed.length > 0
      ? closed.reduce((sum, row) => sum + row.riskReward, 0) / closed.length
      : 0;
    const expectancyR = closed.length > 0
      ? closed.reduce((sum, row) => sum + (row.outcome === "win" ? row.riskReward : row.outcome === "loss" ? -1 : 0), 0) / closed.length
      : 0;
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;

    result.push({
      key,
      totalSignals: groupRows.length,
      closedSignals: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Number((winRate * 100).toFixed(3)),
      avgRiskReward: Number(avgRiskReward.toFixed(4)),
      expectancyR: Number(expectancyR.toFixed(4)),
    });
  }

  return result.sort((a, b) => b.closedSignals - a.closedSignals);
}

function computeBlockedReasonStats(rows: StrictBacktestRow[]): Array<{ reason: string; count: number; sharePct: number }> {
  const blocked = rows.filter((row) => !row.tradeAllowed);
  const counts = new Map<string, number>();
  for (const row of blocked) {
    for (const reason of row.blockedReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }

  const totalBlocked = Math.max(blocked.length, 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      sharePct: Number(((count / totalBlocked) * 100).toFixed(3)),
    }))
    .sort((a, b) => b.count - a.count);
}

function computeCalibration(rows: StrictBacktestRow[], binCount: number): {
  sampleSize: number;
  brierScore: number;
  expectedCalibrationError: number;
  bins: Array<{
    bin: number;
    from: number;
    to: number;
    count: number;
    avgPredicted: number;
    observedWinRate: number;
    gap: number;
  }>;
} {
  const closed = rows.filter((row) => row.tradeAllowed && row.outcome !== "open");
  const cappedBinCount = Math.max(4, Math.min(binCount, 20));
  if (closed.length === 0) {
    return {
      sampleSize: 0,
      brierScore: 0,
      expectedCalibrationError: 0,
      bins: [],
    };
  }

  const bins = Array.from({ length: cappedBinCount }, (_, idx) => ({
    idx,
    from: idx / cappedBinCount,
    to: (idx + 1) / cappedBinCount,
    count: 0,
    predictedSum: 0,
    observedSum: 0,
  }));

  let brierSum = 0;
  for (const row of closed) {
    const predicted = clampProbability(row.predictedProbability);
    const observed = row.outcome === "win" ? 1 : 0;
    const idx = Math.min(cappedBinCount - 1, Math.floor(predicted * cappedBinCount));
    const bin = bins[idx]!;
    bin.count += 1;
    bin.predictedSum += predicted;
    bin.observedSum += observed;
    brierSum += (predicted - observed) ** 2;
  }

  const calibrationBins = bins
    .filter((bin) => bin.count > 0)
    .map((bin) => {
      const avgPredicted = bin.predictedSum / bin.count;
      const observedWinRate = bin.observedSum / bin.count;
      return {
        bin: bin.idx,
        from: Number(bin.from.toFixed(4)),
        to: Number(bin.to.toFixed(4)),
        count: bin.count,
        avgPredicted: Number(avgPredicted.toFixed(4)),
        observedWinRate: Number(observedWinRate.toFixed(4)),
        gap: Number((observedWinRate - avgPredicted).toFixed(4)),
      };
    });

  const ece = calibrationBins.reduce(
    (sum, bin) => sum + (bin.count / closed.length) * Math.abs(bin.gap),
    0,
  );

  return {
    sampleSize: closed.length,
    brierScore: Number((brierSum / closed.length).toFixed(6)),
    expectedCalibrationError: Number(ece.toFixed(6)),
    bins: calibrationBins,
  };
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
    maxBarAgeMs: parseNumber(req.query.max_bar_age_ms, 3 * 60_000, 30_000, 30 * 60_000),
    maxOrderbookAgeMs: parseNumber(req.query.max_orderbook_age_ms, 10_000, 2_000, 120_000),
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

    const rows = runStrictBacktestRows(symbol, bars, forwardBars, options);
    const eligible = rows.filter((row) => row.tradeAllowed);
    const closed = eligible.filter((row) => row.outcome !== "open");
    const wins = closed.filter((row) => row.outcome === "win");
    const losses = closed.filter((row) => row.outcome === "loss");
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    res.json({
      setup: "sweep_reclaim_v1",
      symbol,
      barsScanned: bars.length,
      forwardBars,
      totalSignals: rows.length,
      eligibleSignals: eligible.length,
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

// ─── GET /api/market/strict-setup/report ─────────────────────────────────────
router.get("/market/strict-setup/report", async (req, res) => {
  const symbol = normalizeStrictSymbol(String(req.query.symbol ?? "BTCUSD"));
  const barsCount = Math.round(parseNumber(req.query.bars, 3000, 600, 8000));
  const forwardBars = Math.round(parseNumber(req.query.forward_bars, 30, 5, 200));
  const calibrationBins = Math.round(parseNumber(req.query.calibration_bins, 10, 4, 20));
  const includeRows = parseBoolean(req.query.include_rows, false);
  const options = buildOptions(req);
  options.requireOrderbook = false;

  try {
    const bars = await getBars(symbol, "1Min", barsCount);
    if (bars.length < 180) {
      res.status(400).json({
        error: "insufficient_data",
        message: "Need at least 180 one-minute bars for strict report",
      });
      return;
    }

    const rows = runStrictBacktestRows(symbol, bars, forwardBars, options);
    const eligible = rows.filter((row) => row.tradeAllowed);
    const closed = eligible.filter((row) => row.outcome !== "open");
    const wins = closed.filter((row) => row.outcome === "win");
    const losses = closed.filter((row) => row.outcome === "loss");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const avgConfidence = eligible.length > 0
      ? eligible.reduce((sum, row) => sum + row.confidenceScore, 0) / eligible.length
      : 0;
    const avgPredicted = closed.length > 0
      ? closed.reduce((sum, row) => sum + row.predictedProbability, 0) / closed.length
      : 0;
    const expectancyR = closed.length > 0
      ? closed.reduce((sum, row) => sum + (row.outcome === "win" ? row.riskReward : row.outcome === "loss" ? -1 : 0), 0) / closed.length
      : 0;

    const summary = {
      detectedSignals: rows.length,
      eligibleSignals: eligible.length,
      blockedSignals: rows.length - eligible.length,
      closedSignals: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRatePct: Number((winRate * 100).toFixed(3)),
      avgConfidence: Number(avgConfidence.toFixed(4)),
      avgPredictedProbability: Number(avgPredicted.toFixed(4)),
      expectancyR: Number(expectancyR.toFixed(4)),
    };

    const response = {
      setup: "sweep_reclaim_v1",
      symbol,
      barsScanned: bars.length,
      forwardBars,
      options,
      summary,
      gateAttribution: {
        passRatePct: Number((rows.length > 0 ? (eligible.length / rows.length) * 100 : 0).toFixed(3)),
        blockedByReason: computeBlockedReasonStats(rows),
      },
      attribution: {
        bySession: computeKeyMetrics(rows, (row) => row.session),
        byRegime: computeKeyMetrics(rows, (row) => row.regime),
        byDirection: computeKeyMetrics(rows, (row) => row.direction),
      },
      calibration: computeCalibration(rows, calibrationBins),
      recentSignals: rows.slice(-200),
      ...(includeRows ? { results: rows } : {}),
    };

    res.json(response);
  } catch (err) {
    req.log.error({ err, symbol }, "strict setup report failed");
    res.status(500).json({
      error: "strict_setup_report_failed",
      message: String(err),
    });
  }
});

export default router;
