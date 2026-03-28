import { Router, type IRouter } from "express";
import { getBars, getBarsHistorical, getLatestBar, getAccount, getPositions, hasValidTradingKey, isBrokerKey, type AlpacaBar } from "../lib/alpaca";
import {
  buildRecallFeatures,
  detectAbsorptionReversal,
  detectSweepReclaim,
  detectContinuationPullback,
  detectCVDDivergence,
  detectBreakoutFailure,
  scoreRecall,
  computeFinalQuality,
  computeTPSL,
  computeATR,
  checkForwardOutcome,
  applyNoTradeFilters,
  getQualityThreshold,
  detectRegime,
  buildChartOverlay,
  type SetupType,
  type SetupCooldowns,
  type RecallFeatures,
} from "../lib/strategy_engine";
import { db, accuracyResultsTable, marketBarsTable } from "@workspace/db";
import { eq, desc, and, count, sql } from "drizzle-orm";

const router: IRouter = Router();

const SUPPORTED_SYMBOLS: Record<string, string> = {
  MES: "SPY",
  MNQ: "QQQ",
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
};

function toAlpacaSymbol(instrument: string): string {
  return SUPPORTED_SYMBOLS[instrument] ?? instrument;
}

// ─── GET /api/alpaca/account ──────────────────────────────────────────────────
router.get("/alpaca/account", async (req, res) => {
  try {
    const account = await getAccount();
    res.json(account);
  } catch (err) {
    req.log.error({ err }, "Failed to get Alpaca account");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch account" });
  }
});

// ─── GET /api/alpaca/positions ────────────────────────────────────────────────
router.get("/alpaca/positions", async (req, res) => {
  try {
    const positions = await getPositions();
    res.json(positions);
  } catch (err) {
    req.log.error({ err }, "Failed to get Alpaca positions");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch positions" });
  }
});

// ─── GET /api/alpaca/bars ─────────────────────────────────────────────────────
router.get("/alpaca/bars", async (req, res) => {
  try {
    const symbol = String(req.query.symbol ?? "BTCUSD");
    const timeframe = (req.query.timeframe as string) ?? "5Min";
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const bars = await getBars(symbol, timeframe as "1Min" | "5Min" | "15Min" | "1Hour" | "1Day", limit);
    res.json({ symbol, timeframe, bars });
  } catch (err) {
    req.log.error({ err }, "Failed to get bars");
    res.status(500).json({ error: "alpaca_error", message: "Failed to fetch bars" });
  }
});

// ─── POST /api/alpaca/analyze — regime-aware live setup scan ──────────────────
router.post("/alpaca/analyze", async (req, res) => {
  try {
    const instrument = String(req.body.instrument ?? "BTCUSDT");
    const setups: SetupType[] = req.body.setups ?? [
      "absorption_reversal",
      "sweep_reclaim",
      "continuation_pullback",
      "cvd_divergence",
      "breakout_failure",
    ];
    const cooldowns: SetupCooldowns = req.body.cooldowns ?? {};
    const alpacaSymbol = toAlpacaSymbol(instrument);

    const [bars1m, bars5m, bars15m] = await Promise.all([
      getBars(alpacaSymbol, "1Min", 100),
      getBars(alpacaSymbol, "5Min", 60),
      getBars(alpacaSymbol, "15Min", 40),
    ]);

    if (bars1m.length < 20) {
      res.status(400).json({ error: "insufficient_data", message: "Not enough bars. Market may be closed." });
      return;
    }

    const recall = buildRecallFeatures(bars1m, bars5m);
    const lastBar = bars1m[bars1m.length - 1];
    const atr = computeATR(bars1m);
    const entryPrice = Number(lastBar.Close);
    const regime = recall.regime;

    const detectedSetups = [];
    const blockedSetups = [];

    for (const setup of setups) {
      // Apply no-trade filters first
      const noTrade = applyNoTradeFilters(bars1m, recall, setup, cooldowns);
      if (noTrade.blocked) {
        blockedSetups.push({ setup_type: setup, reason: noTrade.reason });
        continue;
      }

      let result: { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number };
      if (setup === "absorption_reversal") {
        result = detectAbsorptionReversal(bars1m, bars5m, recall);
      } else if (setup === "sweep_reclaim") {
        result = detectSweepReclaim(bars1m, bars5m, recall);
      } else if (setup === "cvd_divergence") {
        result = detectCVDDivergence(bars1m, bars5m, recall);
      } else if (setup === "breakout_failure") {
        result = detectBreakoutFailure(bars1m, bars5m, recall);
      } else {
        result = detectContinuationPullback(bars1m, bars5m, recall);
      }

      if (!result.detected) continue;

      const recallScore = scoreRecall(recall, setup, result.direction);
      const finalQuality = computeFinalQuality(result.structure, result.orderFlow, recallScore);
      const threshold = getQualityThreshold(regime, setup);
      const meetsThreshold = finalQuality >= threshold;

      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, result.direction, atr, regime);

      const overlay = buildChartOverlay(
        setup, instrument, result.direction, result.structure, result.orderFlow,
        recall, finalQuality, threshold, entryPrice, stopLoss, takeProfit, lastBar.Timestamp
      );

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
        quality_threshold: threshold,
        meets_threshold: meetsThreshold,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        sk: recall.sk,
        cvd: recall.cvd,
        recall_features: recall,
        overlay,
        last_bar: lastBar,
        atr,
      });
    }

    res.json({
      instrument,
      alpaca_symbol: alpacaSymbol,
      analyzed_at: new Date().toISOString(),
      regime,
      regime_label: regime.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      bars_analyzed: { "1m": bars1m.length, "5m": bars5m.length, "15m": bars15m.length },
      recall_features: recall,
      setups_detected: detectedSetups.length,
      setups_blocked: blockedSetups,
      setups: detectedSetups,
      high_conviction: detectedSetups.filter((s) => s.meets_threshold),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to analyze market");
    res.status(500).json({ error: "analysis_error", message: String(err) });
  }
});

function runSetupDetector(
  setup: SetupType,
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures
): { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number } {
  if (setup === "absorption_reversal") return detectAbsorptionReversal(bars1m, bars5m, recall);
  if (setup === "sweep_reclaim") return detectSweepReclaim(bars1m, bars5m, recall);
  if (setup === "cvd_divergence") return detectCVDDivergence(bars1m, bars5m, recall);
  if (setup === "breakout_failure") return detectBreakoutFailure(bars1m, bars5m, recall);
  return detectContinuationPullback(bars1m, bars5m, recall);
}

// ─── POST /api/alpaca/backtest — walk-forward on recent bars ──────────────────
router.post("/alpaca/backtest", async (req, res) => {
  try {
    const instrument = String(req.body.instrument ?? "BTCUSDT");
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
      res.status(400).json({ error: "insufficient_data", message: "Not enough historical data." });
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
      // replayMode: true — permissive backtest (no session/cooldown/spread gates, wide ATR cap)
      // Equivalent to RiskConfig replay overrides: max_spread_atr=99, require_session_active=False
      const noTrade = applyNoTradeFilters(window1m, recall, setup, { replayMode: true });
      if (noTrade.blocked) continue;

      const detected = runSetupDetector(setup, window1m, closest5m, recall);

      if (!detected.detected) continue;

      const entryBar = bars1m[i];
      const entryPrice = Number(entryBar.Close);
      const atr = computeATR(window1m);
      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr, recall.regime);

      const forwardBars = bars1m.slice(i, i + FORWARD_BARS);
      const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);

      const recallScore = scoreRecall(recall, setup, detected.direction);
      const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore);
      const threshold = getQualityThreshold(recall.regime, setup);
      const mlProbability = Math.min(1, 0.55 + recallScore * 0.25);

      // Dollar P&L: tick_size derived from price level (crypto: BTC ~$5/tick, ETH ~$1/tick)
      const tickValue = entryPrice > 10000 ? 5 : entryPrice > 1000 ? 1 : 0.25;
      const pnlDollars = outcome.outcome === "win"
        ? tpTicks * tickValue
        : outcome.outcome === "loss"
        ? -(slTicks * tickValue)
        : 0;

      results.push({
        bar_time: entryBar.Timestamp,
        entry_price: entryPrice,
        direction: detected.direction,
        structure_score: detected.structure,
        order_flow_score: detected.orderFlow,
        recall_score: recallScore,
        ml_probability: mlProbability,
        final_quality: finalQuality,
        quality_threshold: threshold,
        meets_threshold: finalQuality >= threshold,
        regime: recall.regime,
        tp: takeProfit,
        sl: stopLoss,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        outcome: outcome.outcome,
        hit_tp: outcome.hitTP,
        bars_to_outcome: outcome.barsChecked,
        pnl_dollars: pnlDollars,
      });
    }

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
    // Dollar P&L summary
    const grossPnlDollars = results.reduce((s, r) => s + r.pnl_dollars, 0);
    const avgWinDollars = wins.length > 0 ? wins.reduce((s, r) => s + r.pnl_dollars, 0) / wins.length : 0;
    const avgLossDollars = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.pnl_dollars, 0) / losses.length) : 0;
    const expectancyDollars = closed.length > 0
      ? (winRate * avgWinDollars) - ((1 - winRate) * avgLossDollars)
      : 0;
    // Equity curve (cumulative P&L per closed trade)
    let cumulativePnl = 0;
    const equityCurve = closed.map((r) => {
      cumulativePnl += r.pnl_dollars;
      return { date: r.bar_time.slice(0, 10), pnl: r.pnl_dollars, equity: Math.round(cumulativePnl * 100) / 100 };
    });

    const hq = results.filter((r) => r.meets_threshold);
    const hqClosed = hq.filter((r) => r.outcome !== "open");
    const hqWins = hqClosed.filter((r) => r.outcome === "win");

    // By regime breakdown
    const byRegime: Record<string, { wins: number; total: number }> = {};
    for (const r of closed) {
      if (!byRegime[r.regime]) byRegime[r.regime] = { wins: 0, total: 0 };
      byRegime[r.regime].total++;
      if (r.outcome === "win") byRegime[r.regime].wins++;
    }

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
      expectancy_dollars: Math.round(expectancyDollars * 100) / 100,
      gross_pnl_dollars: Math.round(grossPnlDollars * 100) / 100,
      avg_win_dollars: Math.round(avgWinDollars * 100) / 100,
      avg_loss_dollars: Math.round(avgLossDollars * 100) / 100,
      avg_final_quality: avgQuality,
      high_conviction_signals: hq.length,
      high_conviction_win_rate: hqClosed.length > 0 ? hqWins.length / hqClosed.length : 0,
      equity_curve: equityCurve,
      by_regime: Object.entries(byRegime).map(([regime, d]) => ({
        regime,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
      })),
      results: results.slice(0, 100),
      saved_to_db: results.length,
    });
  } catch (err) {
    req.log.error({ err }, "Backtest failed");
    res.status(500).json({ error: "backtest_error", message: String(err) });
  }
});

// ─── POST /api/alpaca/recall-build — multi-year historical recall ─────────────
// Fetches paginated historical bars (up to 2 years) and runs full walk-forward
// to build the accuracy recall database.
router.post("/alpaca/recall-build", async (req, res) => {
  try {
    const symbols: string[] = req.body.symbols ?? ["BTCUSD", "ETHUSD"];
    const timeframe = (req.body.timeframe ?? "15Min") as "5Min" | "15Min" | "1Hour";
    const yearsBack = Math.min(Number(req.body.years ?? 1), 2);
    const setupTypes: SetupType[] = [
      "absorption_reversal",
      "sweep_reclaim",
      "continuation_pullback",
      "cvd_divergence",
      "breakout_failure",
    ];

    const end = new Date().toISOString();
    const start = new Date();
    start.setFullYear(start.getFullYear() - yearsBack);
    const startStr = start.toISOString();

    const summary: Record<string, unknown> = {};
    let totalSaved = 0;

    for (const symbol of symbols) {
      req.log.info({ symbol, timeframe, yearsBack }, "Starting recall build");

      const bars = await getBarsHistorical(symbol, timeframe, startStr, end, 50000);

      if (bars.length < 50) {
        summary[symbol] = { error: "insufficient_data", bars: bars.length };
        continue;
      }

      // Use 15-min bars as "fast" and 1-hour equivalent (every 4th) as "slow"
      const slowBars = bars.filter((_, i) => i % 4 === 0);
      const WINDOW = 30;
      const FORWARD = 20;
      const results = [];

      for (let i = WINDOW; i < bars.length - FORWARD; i++) {
        const window = bars.slice(i - WINDOW, i);
        const windowTime = new Date(bars[i].Timestamp).getTime();
        const slowContext = slowBars.filter((b) => new Date(b.Timestamp).getTime() <= windowTime).slice(-20);
        if (slowContext.length < 5) continue;

        const recall = buildRecallFeatures(window, slowContext);
        const atr = computeATR(window);
        const entryBar = bars[i];
        const entryPrice = entryBar.Close;

        for (const setup of setupTypes) {
          // replayMode: true — skip live-only gates (session, cooldown, spread, CVD strict gate)
          const noTrade = applyNoTradeFilters(window, recall, setup, { replayMode: true });
          if (noTrade.blocked) continue;

          const detected = runSetupDetector(setup, window, slowContext, recall);

          if (!detected.detected) continue;

          const recallScore = scoreRecall(recall, setup, detected.direction);
          const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore);
          const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr, recall.regime);
          const forwardBars = bars.slice(i, i + FORWARD);
          const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);

          results.push({
            symbol,
            setup_type: setup,
            timeframe,
            bar_time: new Date(entryBar.Timestamp),
            signal_detected: "true",
            structure_score: String(detected.structure.toFixed(4)),
            order_flow_score: String(detected.orderFlow.toFixed(4)),
            recall_score: String(recallScore.toFixed(4)),
            final_quality: String(finalQuality.toFixed(4)),
            outcome: outcome.outcome,
            tp_ticks: tpTicks,
            sl_ticks: slTicks,
            hit_tp: String(outcome.hitTP),
            forward_bars_checked: outcome.barsChecked,
          });
        }
      }

      // Batch insert in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < results.length; i += CHUNK) {
        await db.insert(accuracyResultsTable).values(results.slice(i, i + CHUNK));
      }

      totalSaved += results.length;

      const closed = results.filter((r) => r.outcome !== "open");
      const wins = closed.filter((r) => r.outcome === "win");
      const bySetup: Record<string, { wins: number; total: number }> = {};
      for (const r of closed) {
        if (!bySetup[r.setup_type]) bySetup[r.setup_type] = { wins: 0, total: 0 };
        bySetup[r.setup_type].total++;
        if (r.outcome === "win") bySetup[r.setup_type].wins++;
      }

      summary[symbol] = {
        bars_fetched: bars.length,
        signals_detected: results.length,
        closed: closed.length,
        wins: wins.length,
        win_rate: closed.length > 0 ? (wins.length / closed.length).toFixed(3) : "0",
        by_setup: Object.entries(bySetup).map(([s, d]) => ({
          setup: s,
          total: d.total,
          wins: d.wins,
          win_rate: d.total > 0 ? (d.wins / d.total).toFixed(3) : "0",
        })),
        date_range: { start: startStr, end },
        timeframe,
      };
    }

    res.json({
      status: "complete",
      symbols_processed: symbols.length,
      total_records_saved: totalSaved,
      years_back: yearsBack,
      summary,
    });
  } catch (err) {
    req.log.error({ err }, "Recall build failed");
    res.status(500).json({ error: "recall_build_error", message: String(err) });
  }
});

// ─── GET /api/alpaca/accuracy — historical accuracy from DB ──────────────────
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
      .limit(1000);

    const closed = rows.filter((r) => r.outcome !== "open" && r.outcome !== null);
    const wins = closed.filter((r) => r.outcome === "win");
    const losses = closed.filter((r) => r.outcome === "loss");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const grossWin = wins.reduce((s, r) => s + (r.tp_ticks ?? 0), 0);
    const grossLoss = losses.reduce((s, r) => s + (r.sl_ticks ?? 0), 0);
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

    const bySetup: Record<string, { wins: number; total: number; sumQuality: number }> = {};
    for (const r of closed) {
      const k = r.setup_type;
      if (!bySetup[k]) bySetup[k] = { wins: 0, total: 0, sumQuality: 0 };
      bySetup[k].total++;
      bySetup[k].sumQuality += Number(r.final_quality);
      if (r.outcome === "win") bySetup[k].wins++;
    }

    const bySymbol: Record<string, { wins: number; total: number }> = {};
    for (const r of closed) {
      const k = r.symbol;
      if (!bySymbol[k]) bySymbol[k] = { wins: 0, total: 0 };
      bySymbol[k].total++;
      if (r.outcome === "win") bySymbol[k].wins++;
    }

    res.json({
      total_records: rows.length,
      closed: closed.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: winRate,
      profit_factor: profitFactor,
      by_setup: Object.entries(bySetup).map(([setup_type, d]) => ({
        setup_type,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
        avg_quality: d.total > 0 ? d.sumQuality / d.total : 0,
      })),
      by_symbol: Object.entries(bySymbol).map(([sym, d]) => ({
        symbol: sym,
        total: d.total,
        wins: d.wins,
        win_rate: d.total > 0 ? d.wins / d.total : 0,
      })),
      recent: rows.slice(0, 50),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get accuracy");
    res.status(500).json({ error: "accuracy_error", message: String(err) });
  }
});

// ─── GET /api/system/diagnostics ─────────────────────────────────────────────
router.get("/system/diagnostics", async (req, res) => {
  const layers: Record<string, { status: "live" | "degraded" | "offline"; detail: string }> = {};

  // Layer 1: Data Feed (Alpaca crypto — always available)
  try {
    const test = await getBars("BTCUSD", "1Min", 5);
    layers.data_feed = test.length > 0
      ? { status: "live", detail: `Crypto feed active — ${test.length} bars returned` }
      : { status: "degraded", detail: "Feed responded but returned no bars" };
  } catch (e) {
    layers.data_feed = { status: "offline", detail: String(e) };
  }

  // Layer 2: Trading API (stocks)
  layers.trading_api = hasValidTradingKey
    ? { status: "live", detail: "Trading API keys present (PK/AK)" }
    : isBrokerKey
    ? { status: "degraded", detail: "Broker API keys detected — stock data unavailable, use Trading API keys" }
    : { status: "offline", detail: "No API keys configured" };

  // Layer 3: Strategy Engine
  try {
    const testBars = await getBars("BTCUSD", "5Min", 40);
    if (testBars.length >= 20) {
      const recall = buildRecallFeatures(testBars, testBars.slice(-20));
      const regime = detectRegime(testBars);
      layers.strategy_engine = {
        status: "live",
        detail: `Regime detection: ${regime} · Recall features: ${Object.keys(recall).length} features`,
      };
    } else {
      layers.strategy_engine = { status: "degraded", detail: "Not enough bars for full engine" };
    }
  } catch (e) {
    layers.strategy_engine = { status: "offline", detail: String(e) };
  }

  // Layer 4: Database
  try {
    const [accCount] = await db.select({ count: count() }).from(accuracyResultsTable);
    layers.database = { status: "live", detail: `PostgreSQL connected · ${accCount.count} accuracy records` };
  } catch (e) {
    layers.database = { status: "offline", detail: String(e) };
  }

  // Layer 5: Recall / Accuracy DB
  try {
    const recent = await db
      .select()
      .from(accuracyResultsTable)
      .orderBy(desc(accuracyResultsTable.created_at))
      .limit(200);

    const closed = recent.filter((r) => r.outcome !== "open" && r.outcome !== null);
    const wins = closed.filter((r) => r.outcome === "win");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const [total] = await db.select({ count: count() }).from(accuracyResultsTable);

    layers.recall_engine = {
      status: total.count > 0 ? "live" : "degraded",
      detail: total.count > 0
        ? `${total.count} total records · Recent win rate: ${(winRate * 100).toFixed(1)}% (${closed.length} closed)`
        : "No recall data yet — run 'Build Recall' to populate",
    };
  } catch (e) {
    layers.recall_engine = { status: "offline", detail: String(e) };
  }

  // Layer 6: ML Model (stub — Claude reasoning layer)
  layers.ml_model = {
    status: "degraded",
    detail: "ML layer using heuristic scoring — train a model to upgrade",
  };

  layers.claude_reasoning = {
    status: "degraded",
    detail: "Claude layer inactive — integrate Anthropic key to enable contextual veto",
  };

  const allStatuses = Object.values(layers).map((l) => l.status);
  const systemStatus =
    allStatuses.every((s) => s === "live")
      ? "healthy"
      : allStatuses.some((s) => s === "offline")
      ? "degraded"
      : "partial";

  res.json({
    system_status: systemStatus,
    timestamp: new Date().toISOString(),
    layers,
    recommendations: [
      ...(!hasValidTradingKey ? ["Add Trading API keys (PK/AK) from app.alpaca.markets to unlock stock data"] : []),
      ...(layers.recall_engine.status === "degraded" ? ["Run 'Build Recall' to populate accuracy database with historical data"] : []),
      ...(layers.ml_model.status !== "live" ? ["Train ML model on recall data to upgrade scoring from heuristic to learned"] : []),
      ...(layers.claude_reasoning.status !== "live" ? ["Add ANTHROPIC_API_KEY to enable Claude reasoning veto layer"] : []),
    ],
  });
});

export default router;
