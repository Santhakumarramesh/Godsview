import { Router, type Request, type Response } from "express";
import { getBars } from "../lib/alpaca";
import { evaluateStrictSweepReclaim, type StrictSweepReclaimOptions } from "../lib/strict_setup_engine";
import { orderBookManager } from "../lib/market/orderbook";
import { normalizeMarketSymbol } from "../lib/market/symbols";
import type { AlpacaBar } from "../lib/alpaca";
import type { StrictSweepReclaimDecision } from "../lib/strict_setup_engine";

const router = Router();
const strictRouteCache = new Map<string, { data: unknown; ts: number }>();
const strictRouteInflight = new Map<string, Promise<unknown>>();

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

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const STRICT_SETUP_CACHE_TTL_MS = parseEnvInt("STRICT_SETUP_CACHE_TTL_MS", 3_000, 500, 60_000);
const STRICT_BACKTEST_CACHE_TTL_MS = parseEnvInt("STRICT_BACKTEST_CACHE_TTL_MS", 12_000, 1_000, 120_000);
const STRICT_REPORT_CACHE_TTL_MS = parseEnvInt("STRICT_REPORT_CACHE_TTL_MS", 15_000, 1_000, 180_000);
const STRICT_PROMOTION_CACHE_TTL_MS = parseEnvInt("STRICT_PROMOTION_CACHE_TTL_MS", 15_000, 1_000, 180_000);
const STRICT_MATRIX_CACHE_TTL_MS = parseEnvInt("STRICT_MATRIX_CACHE_TTL_MS", 15_000, 1_000, 180_000);

async function serveCachedJson<T>(
  req: Request,
  res: Response,
  keyPrefix: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<void> {
  const cacheKey = `${keyPrefix}:${req.originalUrl}`;
  const cached = strictRouteCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ttlMs) {
    res.setHeader("X-Cache", "HIT");
    res.json(cached.data);
    return;
  }

  const inFlight = strictRouteInflight.get(cacheKey);
  if (inFlight) {
    const data = await inFlight;
    res.setHeader("X-Cache", "INFLIGHT");
    res.json(data);
    return;
  }

  const promise = loader();
  strictRouteInflight.set(cacheKey, promise as Promise<unknown>);
  try {
    const data = await promise;
    strictRouteCache.set(cacheKey, { data, ts: Date.now() });
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } finally {
    strictRouteInflight.delete(cacheKey);
  }
}

type StrictRouteError = {
  statusCode: number;
  error: string;
  message: string;
};

function strictRouteError(statusCode: number, error: string, message: string): StrictRouteError {
  return { statusCode, error, message };
}

function isStrictRouteError(value: unknown): value is StrictRouteError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StrictRouteError>;
  return (
    Number.isFinite(candidate.statusCode) &&
    typeof candidate.error === "string" &&
    typeof candidate.message === "string"
  );
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

type PromotionThresholds = {
  minClosedSignals: number;
  minWinRatePct: number;
  minExpectancyR: number;
  minPassRatePct: number;
  minAvgConfidence: number;
  maxEce: number;
  maxBrier: number;
};

type PromotionFailure = {
  check: string;
  actual: number;
  required: number;
  comparator: ">=" | "<=";
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

function computeStrictReportMetrics(
  rows: StrictBacktestRow[],
  calibrationBins: number,
): {
  summary: {
    detectedSignals: number;
    eligibleSignals: number;
    blockedSignals: number;
    closedSignals: number;
    wins: number;
    losses: number;
    winRatePct: number;
    avgConfidence: number;
    avgPredictedProbability: number;
    expectancyR: number;
  };
  gateAttribution: {
    passRatePct: number;
    blockedByReason: Array<{ reason: string; count: number; sharePct: number }>;
  };
  attribution: {
    bySession: KeyMetricRow[];
    byRegime: KeyMetricRow[];
    byDirection: KeyMetricRow[];
  };
  calibration: ReturnType<typeof computeCalibration>;
  recentSignals: StrictBacktestRow[];
} {
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

  return {
    summary: {
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
    },
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
  };
}

function parsePromotionThresholds(req: Request): PromotionThresholds {
  return {
    minClosedSignals: Math.round(parseNumber(req.query.min_closed_signals, 120, 20, 10000)),
    minWinRatePct: parseNumber(req.query.min_win_rate_pct, 54, 1, 100),
    minExpectancyR: parseNumber(req.query.min_expectancy_r, 0.12, -1, 10),
    minPassRatePct: parseNumber(req.query.min_pass_rate_pct, 20, 0, 100),
    minAvgConfidence: parseNumber(req.query.min_avg_confidence, 0.5, 0, 1),
    maxEce: parseNumber(req.query.max_ece, 0.12, 0, 1),
    maxBrier: parseNumber(req.query.max_brier, 0.26, 0, 1),
  };
}

function evaluatePromotionReadiness(
  metrics: ReturnType<typeof computeStrictReportMetrics>,
  thresholds: PromotionThresholds,
): { promote: boolean; failedChecks: PromotionFailure[] } {
  const failedChecks: PromotionFailure[] = [];

  const requireMin = (check: string, actual: number, required: number): void => {
    if (actual < required) failedChecks.push({ check, actual, required, comparator: ">=" });
  };
  const requireMax = (check: string, actual: number, required: number): void => {
    if (actual > required) failedChecks.push({ check, actual, required, comparator: "<=" });
  };

  requireMin("closed_signals", metrics.summary.closedSignals, thresholds.minClosedSignals);
  requireMin("win_rate_pct", metrics.summary.winRatePct, thresholds.minWinRatePct);
  requireMin("expectancy_r", metrics.summary.expectancyR, thresholds.minExpectancyR);
  requireMin("pass_rate_pct", metrics.gateAttribution.passRatePct, thresholds.minPassRatePct);
  requireMin("avg_confidence", metrics.summary.avgConfidence, thresholds.minAvgConfidence);
  requireMax("ece", metrics.calibration.expectedCalibrationError, thresholds.maxEce);
  requireMax("brier_score", metrics.calibration.brierScore, thresholds.maxBrier);

  return {
    promote: failedChecks.length === 0,
    failedChecks,
  };
}

function parseStrictSymbols(raw: unknown): string[] {
  const input = String(raw ?? "BTCUSD,ETHUSD");
  const values = input
    .split(",")
    .map((part) => normalizeStrictSymbol(part.trim()))
    .filter(Boolean);
  const unique = Array.from(new Set(values));
  return unique.slice(0, 8);
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
    await serveCachedJson(req, res, "strict_setup", STRICT_SETUP_CACHE_TTL_MS, async () => {
      const bars = await getBars(symbol, "1Min", barsCount);
      const latestSnapshot = orderBookManager.getSnapshot(symbol);
      const snapshot = latestSnapshot && Date.now() - latestSnapshot.receivedAt < 12_000
        ? latestSnapshot
        : await orderBookManager.fetchSnapshot(symbol).catch(() => null);

      const decision = evaluateStrictSweepReclaim(symbol, bars, snapshot, options);

      return {
        ...decision,
        barsUsed: bars.length,
        orderbookTimestamp: snapshot?.timestamp ?? null,
        orderbookReceivedAt: snapshot?.receivedAt ?? null,
      };
    });
  } catch (err) {
    if (isStrictRouteError(err)) {
      res.status(err.statusCode).json({
        error: err.error,
        message: err.message,
      });
      return;
    }
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
    await serveCachedJson(req, res, "strict_setup_backtest", STRICT_BACKTEST_CACHE_TTL_MS, async () => {
      const bars = await getBars(symbol, "1Min", barsCount);
      if (bars.length < 120) {
        throw strictRouteError(
          400,
          "insufficient_data",
          "Need at least 120 one-minute bars for strict backtest",
        );
      }

      const rows = runStrictBacktestRows(symbol, bars, forwardBars, options);
      const eligible = rows.filter((row) => row.tradeAllowed);
      const closed = eligible.filter((row) => row.outcome !== "open");
      const wins = closed.filter((row) => row.outcome === "win");
      const losses = closed.filter((row) => row.outcome === "loss");
      const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

      return {
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
      };
    });
  } catch (err) {
    if (isStrictRouteError(err)) {
      res.status(err.statusCode).json({
        error: err.error,
        message: err.message,
      });
      return;
    }
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
    await serveCachedJson(req, res, "strict_setup_report", STRICT_REPORT_CACHE_TTL_MS, async () => {
      const bars = await getBars(symbol, "1Min", barsCount);
      if (bars.length < 180) {
        throw strictRouteError(
          400,
          "insufficient_data",
          "Need at least 180 one-minute bars for strict report",
        );
      }

      const rows = runStrictBacktestRows(symbol, bars, forwardBars, options);
      const metrics = computeStrictReportMetrics(rows, calibrationBins);

      return {
        setup: "sweep_reclaim_v1",
        symbol,
        barsScanned: bars.length,
        forwardBars,
        options,
        summary: metrics.summary,
        gateAttribution: metrics.gateAttribution,
        attribution: metrics.attribution,
        calibration: metrics.calibration,
        recentSignals: metrics.recentSignals,
        ...(includeRows ? { results: rows } : {}),
      };
    });
  } catch (err) {
    if (isStrictRouteError(err)) {
      res.status(err.statusCode).json({
        error: err.error,
        message: err.message,
      });
      return;
    }
    req.log.error({ err, symbol }, "strict setup report failed");
    res.status(500).json({
      error: "strict_setup_report_failed",
      message: String(err),
    });
  }
});

// ─── GET /api/market/strict-setup/promotion-check ────────────────────────────
router.get("/market/strict-setup/promotion-check", async (req, res) => {
  const symbol = normalizeStrictSymbol(String(req.query.symbol ?? "BTCUSD"));
  const barsCount = Math.round(parseNumber(req.query.bars, 5000, 1000, 10000));
  const forwardBars = Math.round(parseNumber(req.query.forward_bars, 30, 5, 200));
  const calibrationBins = Math.round(parseNumber(req.query.calibration_bins, 10, 4, 20));
  const options = buildOptions(req);
  options.requireOrderbook = false;

  const thresholds = parsePromotionThresholds(req);

  try {
    await serveCachedJson(req, res, "strict_setup_promotion", STRICT_PROMOTION_CACHE_TTL_MS, async () => {
      const bars = await getBars(symbol, "1Min", barsCount);
      if (bars.length < 240) {
        throw strictRouteError(
          400,
          "insufficient_data",
          "Need at least 240 one-minute bars for promotion check",
        );
      }

      const rows = runStrictBacktestRows(symbol, bars, forwardBars, options);
      const metrics = computeStrictReportMetrics(rows, calibrationBins);
      const promotion = evaluatePromotionReadiness(metrics, thresholds);
      const promote = promotion.promote;

      return {
        setup: "sweep_reclaim_v1",
        symbol,
        barsScanned: bars.length,
        forwardBars,
        options,
        thresholds,
        promote,
        decision: promote ? "PROMOTE" : "HOLD",
        failedChecks: promotion.failedChecks,
        metrics: {
          summary: metrics.summary,
          gateAttribution: metrics.gateAttribution,
          calibration: metrics.calibration,
        },
        nextActions: promote
          ? [
              "Promote strict setup policy to wider paper-run scope.",
              "Enable incremental risk budget increase under monitoring.",
            ]
          : [
              "Keep setup in hold state and gather more closed signals.",
              "Inspect blocked reasons and session/regime attribution to refine gates.",
            ],
      };
    });
  } catch (err) {
    if (isStrictRouteError(err)) {
      res.status(err.statusCode).json({
        error: err.error,
        message: err.message,
      });
      return;
    }
    req.log.error({ err, symbol }, "strict setup promotion check failed");
    res.status(500).json({
      error: "strict_setup_promotion_check_failed",
      message: String(err),
    });
  }
});

// ─── GET /api/market/strict-setup/matrix ─────────────────────────────────────
router.get("/market/strict-setup/matrix", async (req, res) => {
  const symbols = parseStrictSymbols(req.query.symbols);
  const barsCount = Math.round(parseNumber(req.query.bars, 1600, 400, 10000));
  const forwardBars = Math.round(parseNumber(req.query.forward_bars, 30, 5, 200));
  const calibrationBins = Math.round(parseNumber(req.query.calibration_bins, 10, 4, 20));
  const includeRows = parseBoolean(req.query.include_rows, false);

  const decisionOptions = buildOptions(req);
  const backtestOptions = buildOptions(req);
  backtestOptions.requireOrderbook = false;

  const thresholds = parsePromotionThresholds(req);

  try {
    await serveCachedJson(req, res, "strict_setup_matrix", STRICT_MATRIX_CACHE_TTL_MS, async () => {
      const matrixRows: Array<{
        symbol: string;
        liveDecision: StrictSweepReclaimDecision;
        metrics: ReturnType<typeof computeStrictReportMetrics>;
        promotion: ReturnType<typeof evaluatePromotionReadiness>;
        barsScanned: number;
        orderbookTimestamp: string | null;
        orderbookReceivedAt: number | null;
        rows?: StrictBacktestRow[];
      }> = [];

      for (const symbol of symbols) {
        const bars = await getBars(symbol, "1Min", barsCount);
        const latestSnapshot = orderBookManager.getSnapshot(symbol);
        const snapshot = latestSnapshot && Date.now() - latestSnapshot.receivedAt < 12_000
          ? latestSnapshot
          : await orderBookManager.fetchSnapshot(symbol).catch(() => null);

        const liveDecision = evaluateStrictSweepReclaim(symbol, bars, snapshot, decisionOptions);
        const rows = runStrictBacktestRows(symbol, bars, forwardBars, backtestOptions);
        const metrics = computeStrictReportMetrics(rows, calibrationBins);
        const promotion = evaluatePromotionReadiness(metrics, thresholds);

        matrixRows.push({
          symbol,
          liveDecision,
          metrics,
          promotion,
          barsScanned: bars.length,
          orderbookTimestamp: snapshot?.timestamp ?? null,
          orderbookReceivedAt: snapshot?.receivedAt ?? null,
          ...(includeRows ? { rows } : {}),
        });
      }

      const ranked = [...matrixRows]
        .sort((a, b) => {
          const aScore =
            (a.liveDecision.tradeAllowed ? 1 : 0) * 2 +
            (a.liveDecision.confidenceScore ?? 0) * 1.5 +
            a.metrics.summary.expectancyR * 0.7 +
            (a.promotion.promote ? 1 : 0);
          const bScore =
            (b.liveDecision.tradeAllowed ? 1 : 0) * 2 +
            (b.liveDecision.confidenceScore ?? 0) * 1.5 +
            b.metrics.summary.expectancyR * 0.7 +
            (b.promotion.promote ? 1 : 0);
          return bScore - aScore;
        })
        .map((row) => ({
          symbol: row.symbol,
          liveTradeAllowed: row.liveDecision.tradeAllowed,
          direction: row.liveDecision.direction,
          confidenceScore: row.liveDecision.confidenceScore,
          expectedWinProbability: row.liveDecision.expectedWinProbability,
          blockedReasons: row.liveDecision.blockedReasons,
          promotionDecision: row.promotion.promote ? "PROMOTE" : "HOLD",
          winRatePct: row.metrics.summary.winRatePct,
          expectancyR: row.metrics.summary.expectancyR,
          closedSignals: row.metrics.summary.closedSignals,
        }));

      return {
        setup: "sweep_reclaim_v1",
        symbols,
        barsRequested: barsCount,
        forwardBars,
        options: {
          decision: decisionOptions,
          backtest: backtestOptions,
        },
        thresholds,
        ranked,
        results: matrixRows.map((row) => ({
          symbol: row.symbol,
          barsScanned: row.barsScanned,
          orderbookTimestamp: row.orderbookTimestamp,
          orderbookReceivedAt: row.orderbookReceivedAt,
          liveDecision: row.liveDecision,
          summary: row.metrics.summary,
          gateAttribution: row.metrics.gateAttribution,
          calibration: row.metrics.calibration,
          promotion: {
            promote: row.promotion.promote,
            decision: row.promotion.promote ? "PROMOTE" : "HOLD",
            failedChecks: row.promotion.failedChecks,
          },
          attribution: row.metrics.attribution,
          ...(includeRows ? { rows: row.rows ?? [] } : {}),
        })),
      };
    });
  } catch (err) {
    if (isStrictRouteError(err)) {
      res.status(err.statusCode).json({
        error: err.error,
        message: err.message,
      });
      return;
    }
    req.log.error({ err, symbols }, "strict setup matrix failed");
    res.status(500).json({
      error: "strict_setup_matrix_failed",
      message: String(err),
    });
  }
});

export default router;
