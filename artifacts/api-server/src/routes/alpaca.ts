import { Router, type IRouter } from "express";
import { getBars, getLatestBar, getAccount, getPositions } from "../lib/alpaca";
import {
  buildRecallFeatures,
  detectAbsorptionReversal,
  detectSweepReclaim,
  detectContinuationPullback,
  scoreRecall,
  computeFinalQuality,
  computeTPSL,
  computeATR,
  checkForwardOutcome,
  type SetupType,
} from "../lib/strategy_engine";
import { db, accuracyResultsTable, marketBarsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";

const router: IRouter = Router();

const SUPPORTED_SYMBOLS: Record<string, string> = {
  MES: "SPY",
  MNQ: "QQQ",
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
};

// Map internal instrument names to Alpaca symbols
function toAlpacaSymbol(instrument: string): string {
  return SUPPORTED_SYMBOLS[instrument] ?? instrument;
}

// GET /api/alpaca/account — account overview
router.get("/alpaca/account", async (req, res) => {
  try {
    const account = await getAccount();
    res.json(account);
  } catch (err) {
    req.log.error({ err }, "Failed to get Alpaca account");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch account" });
  }
});

// GET /api/alpaca/positions — current positions
router.get("/alpaca/positions", async (req, res) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (err) {
    req.log.error({ err }, "Failed to get Alpaca positions");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch positions" });
  }
});

// GET /api/alpaca/bars?symbol=SPY&timeframe=5Min&limit=100
router.get("/alpaca/bars", async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? "SPY");
    const timeframe = (req.query.timeframe as string) ?? "5Min";
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const bars = await getBars(symbol, timeframe as "1Min" | "5Min" | "15Min" | "1Hour" | "1Day", limit);
    res.json({ symbol, timeframe, bars });
  } catch (err) {
    req.log.error({ err }, "Failed to get bars");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch bars" });
  }
});

// POST /api/alpaca/analyze — run strategy engine on live bars and detect setups
router.post("/alpaca/analyze", async (req, res) => {
  try {
    const instrument = String(req.body.instrument ?? "MES");
    const setups: SetupType[] = req.body.setups ?? ["absorption_reversal", "sweep_reclaim", "continuation_pullback"];
    const alpacaSymbol = toAlpacaSymbol(instrument);

    // Fetch multi-timeframe bars
    const [bars1m, bars5m, bars15m] = await Promise.all([
      getBars(alpacaSymbol, "1Min", 100),
      getBars(alpacaSymbol, "5Min", 60),
      getBars(alpacaSymbol, "15Min", 40),
    ]);

    if (bars1m.length < 20) {
      res.status(400).json({ error: "insufficient_data", message: "Not enough bars to analyze. Market may be closed." });
      return;
    }

    // Build recall context
    const recall = buildRecallFeatures(bars1m, bars5m);
    const lastBar = bars1m[bars1m.length - 1];
    const atr = computeATR(bars1m);
    const entryPrice = Number(lastBar.Close);

    const detectedSetups = [];

    for (const setup of setups) {
      let result: { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number };

      if (setup === "absorption_reversal") {
        result = detectAbsorptionReversal(bars1m, bars5m, recall);
      } else if (setup === "sweep_reclaim") {
        result = detectSweepReclaim(bars1m, bars5m, recall);
      } else {
        result = detectContinuationPullback(bars1m, bars5m, recall);
      }

      if (!result.detected) continue;

      const recallScore = scoreRecall(recall, setup, result.direction);
      const finalQuality = computeFinalQuality(result.structure, result.orderFlow, recallScore);
      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, result.direction, atr);

      detectedSetups.push({
        instrument,
        alpaca_symbol: alpacaSymbol,
        setup_type: setup,
        bar_time: lastBar.Timestamp,
        direction: result.direction,
        structure_score: result.structure,
        order_flow_score: result.orderFlow,
        recall_score: recallScore,
        final_quality: finalQuality,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        recall_features: recall,
        last_bar: lastBar,
        atr,
      });
    }

    res.json({
      instrument,
      alpaca_symbol: alpacaSymbol,
      analyzed_at: new Date().toISOString(),
      bars_analyzed: { "1m": bars1m.length, "5m": bars5m.length, "15m": bars15m.length },
      recall_features: recall,
      setups_detected: detectedSetups.length,
      setups: detectedSetups,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to analyze market");
    res.status(500).json({ error: "analysis_error", message: String(err) });
  }
});

// POST /api/alpaca/backtest — run walk-forward accuracy scan over historical bars
router.post("/alpaca/backtest", async (req, res) => {
  try {
    const instrument = String(req.body.instrument ?? "MES");
    const setup: SetupType = req.body.setup_type ?? "absorption_reversal";
    const days = Math.min(Number(req.body.days ?? 5), 30);
    const alpacaSymbol = toAlpacaSymbol(instrument);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [bars1m, bars5m] = await Promise.all([
      getBars(alpacaSymbol, "1Min", Math.min(days * 390, 1000), startDate.toISOString()),
      getBars(alpacaSymbol, "5Min", Math.min(days * 78, 1000), startDate.toISOString()),
    ]);

    if (bars1m.length < 40) {
      res.status(400).json({ error: "insufficient_data", message: "Not enough historical data. Market may not have enough bars." });
      return;
    }

    const results = [];
    const WINDOW_1M = 30;
    const FORWARD_BARS = 20;

    for (let i = WINDOW_1M; i < bars1m.length - FORWARD_BARS; i++) {
      const window1m = bars1m.slice(i - WINDOW_1M, i);
      const windowTime = new Date(bars1m[i].Timestamp).getTime();

      const closest5m = bars5m.filter((b) => new Date(b.Timestamp).getTime() <= windowTime).slice(-20);
      if (closest5m.length < 5) continue;

      const recall = buildRecallFeatures(window1m, closest5m);

      let detected: { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number };
      if (setup === "absorption_reversal") {
        detected = detectAbsorptionReversal(window1m, closest5m, recall);
      } else if (setup === "sweep_reclaim") {
        detected = detectSweepReclaim(window1m, closest5m, recall);
      } else {
        detected = detectContinuationPullback(window1m, closest5m, recall);
      }

      if (!detected.detected) continue;

      const entryBar = bars1m[i];
      const entryPrice = Number(entryBar.Close);
      const atr = computeATR(window1m);
      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr);

      const forwardBars = bars1m.slice(i, i + FORWARD_BARS);
      const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);

      const recallScore = scoreRecall(recall, setup, detected.direction);
      const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore);

      results.push({
        bar_time: entryBar.Timestamp,
        entry_price: entryPrice,
        direction: detected.direction,
        structure_score: detected.structure,
        order_flow_score: detected.orderFlow,
        recall_score: recallScore,
        final_quality: finalQuality,
        tp: takeProfit,
        sl: stopLoss,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        outcome: outcome.outcome,
        hit_tp: outcome.hitTP,
        bars_to_outcome: outcome.barsChecked,
      });
    }

    // Save results to DB
    if (results.length > 0) {
      await db.insert(accuracyResultsTable).values(
        results.map((r) => ({
          symbol: alpacaSymbol,
          setup_type: setup,
          timeframe: "1Min",
          bar_time: new Date(r.bar_time),
          signal_detected: "true",
          structure_score: String(r.structure_score.toFixed(4)),
          order_flow_score: String(r.order_flow_score.toFixed(4)),
          recall_score: String(r.recall_score.toFixed(4)),
          final_quality: String(r.final_quality.toFixed(4)),
          outcome: r.outcome,
          tp_ticks: r.tp_ticks,
          sl_ticks: r.sl_ticks,
          hit_tp: String(r.hit_tp),
          forward_bars_checked: r.bars_to_outcome,
        }))
      );
    }

    // Compute summary stats
    const closed = results.filter((r) => r.outcome !== "open");
    const wins = closed.filter((r) => r.outcome === "win");
    const losses = closed.filter((r) => r.outcome === "loss");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const avgQuality = results.length > 0 ? results.reduce((s, r) => s + r.final_quality, 0) / results.length : 0;
    const grossWin = wins.reduce((s, r) => s + r.tp_ticks, 0);
    const grossLoss = losses.reduce((s, r) => s + r.sl_ticks, 0);
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
    const expectancy = closed.length > 0
      ? (winRate * (wins.length > 0 ? grossWin / wins.length : 0)) -
        ((1 - winRate) * (losses.length > 0 ? grossLoss / losses.length : 0))
      : 0;

    const highQualityResults = results.filter((r) => r.final_quality >= 0.65);
    const hqClosed = highQualityResults.filter((r) => r.outcome !== "open");
    const hqWins = hqClosed.filter((r) => r.outcome === "win");

    res.json({
      instrument,
      alpaca_symbol: alpacaSymbol,
      setup_type: setup,
      days_analyzed: days,
      bars_scanned: bars1m.length,
      total_signals: results.length,
      closed_signals: closed.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: winRate,
      profit_factor: profitFactor,
      expectancy_ticks: expectancy,
      avg_final_quality: avgQuality,
      high_quality_signals: highQualityResults.length,
      high_quality_win_rate: hqClosed.length > 0 ? hqWins.length / hqClosed.length : 0,
      results: results.slice(0, 50),
      saved_to_db: results.length,
    });
  } catch (err) {
    req.log.error({ err }, "Backtest failed");
    res.status(500).json({ error: "backtest_error", message: String(err) });
  }
});

// GET /api/alpaca/accuracy — historical accuracy from DB
router.get("/alpaca/accuracy", async (req, res) => {
  try {
    const symbol = req.query.symbol as string | undefined;
    const setup = req.query.setup_type as string | undefined;

    const conditions = [];
    if (symbol) conditions.push(eq(accuracyResultsTable.symbol, symbol));
    if (setup) conditions.push(eq(accuracyResultsTable.setup_type, setup));

    const rows = await db
      .select()
      .from(accuracyResultsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(500);

    const closed = rows.filter((r) => r.outcome !== "open" && r.outcome !== null);
    const wins = closed.filter((r) => r.outcome === "win");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;

    // By setup breakdown
    const bySetup: Record<string, { wins: number; total: number; sumQuality: number }> = {};
    for (const r of closed) {
      const k = r.setup_type;
      if (!bySetup[k]) bySetup[k] = { wins: 0, total: 0, sumQuality: 0 };
      bySetup[k].total++;
      bySetup[k].sumQuality += Number(r.final_quality);
      if (r.outcome === "win") bySetup[k].wins++;
    }

    res.json({
      total_records: rows.length,
      closed: closed.length,
      wins: wins.length,
      win_rate: winRate,
      by_setup: Object.entries(bySetup).map(([setup_type, d]) => ({
        setup_type,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
        avg_quality: d.total > 0 ? d.sumQuality / d.total : 0,
      })),
      recent: rows.slice(0, 20),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get accuracy");
    res.status(500).json({ error: "accuracy_error", message: String(err) });
  }
});

export default router;
