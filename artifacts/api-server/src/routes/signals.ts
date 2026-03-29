/**
 * signals.ts — Signal management routes
 *
 * POST /signals now calls claudeVeto() (Layer 6) to produce a real claude_score
 * and verdict, replacing the hardcoded stub in strategy_engine.ts.
 *
 * The final_quality formula remains:
 *   0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * claude
 * but `claude` is now the live claude_score returned by the API.
 */

import { Router, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, signalsTable } from "@workspace/db";
import { CreateSignalBody, GetSignalsQueryParams } from "@workspace/api-zod";
import { claudeVeto, isClaudeAvailable, type SetupContext } from "../lib/claude";
import {
  applyNoTradeFilters,
  buildRecallFeatures,
  checkForwardOutcome,
  computeATR,
  computeFinalQuality,
  computeTPSL,
  detectAbsorptionReversal,
  detectBreakoutFailure,
  detectContinuationPullback,
  detectCVDDivergence,
  detectSweepReclaim,
  getQualityThreshold,
  scoreRecall,
  type RecallFeatures,
  type SetupType,
} from "../lib/strategy_engine";
import { getBars, getBarsHistorical, type AlpacaBar } from "../lib/alpaca";
import { logger } from "../lib/logger";

export const signalsRouter = Router();

type SignalDirection = "long" | "short";

function toAlpacaSymbol(instrument: string): string {
  const normalized = String(instrument ?? "")
    .trim()
    .toUpperCase()
    .split(":")
    .pop()
    ?.replace(/[^A-Z0-9]/g, "") ?? "";

  if (!normalized) return "BTCUSD";
  if (normalized === "MES1" || normalized === "MES") return "SPY";
  if (normalized === "MNQ1" || normalized === "MNQ") return "QQQ";
  if (normalized.endsWith("USDT")) return `${normalized.slice(0, -4)}USD`;
  return normalized;
}

function toTradingViewSymbol(symbol: string): string {
  const normalized = String(symbol ?? "").toUpperCase();
  if (normalized === "BTCUSD") return "COINBASE:BTCUSD";
  if (normalized === "ETHUSD") return "COINBASE:ETHUSD";
  if (normalized === "SOLUSD") return "COINBASE:SOLUSD";
  if (normalized === "SPY") return "AMEX:SPY";
  if (normalized === "QQQ") return "NASDAQ:QQQ";
  return normalized.includes(":") ? normalized : normalized;
}

function toSetupType(raw: string): SetupType {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "absorption_reversal") return "absorption_reversal";
  if (normalized === "sweep_reclaim") return "sweep_reclaim";
  if (normalized === "continuation_pullback") return "continuation_pullback";
  if (normalized === "cvd_divergence") return "cvd_divergence";
  if (normalized === "breakout_failure") return "breakout_failure";
  return "sweep_reclaim";
}

function runSetupDetector(
  setup: SetupType,
  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  recall: RecallFeatures,
): { detected: boolean; direction: SignalDirection; structure: number; orderFlow: number } {
  if (setup === "absorption_reversal") return detectAbsorptionReversal(bars1m, bars5m, recall);
  if (setup === "sweep_reclaim") return detectSweepReclaim(bars1m, bars5m, recall);
  if (setup === "cvd_divergence") return detectCVDDivergence(bars1m, bars5m, recall);
  if (setup === "breakout_failure") return detectBreakoutFailure(bars1m, bars5m, recall);
  return detectContinuationPullback(bars1m, bars5m, recall);
}

function deriveDirection(signal: {
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
}): SignalDirection {
  const entry = Number(signal.entry_price ?? 0);
  const stop = Number(signal.stop_loss ?? 0);
  const take = Number(signal.take_profit ?? 0);
  if (entry > 0 && take > 0 && take > entry) return "long";
  if (entry > 0 && stop > 0 && stop > entry) return "short";
  return "long";
}

type OrderBlockTrace = {
  time: number;
  ts: string;
  side: "bullish" | "bearish";
  low: number;
  high: number;
  mid: number;
  strength: number;
};

function detectOrderBlocks(bars: AlpacaBar[]): OrderBlockTrace[] {
  if (bars.length < 8) return [];

  const avgVolume = bars.reduce((sum, bar) => sum + bar.Volume, 0) / bars.length;
  const blocks: OrderBlockTrace[] = [];

  for (let i = 2; i < bars.length - 2; i++) {
    const prev = bars[i - 1];
    const bar = bars[i];
    const next = bars[i + 1];
    const next2 = bars[i + 2];

    const barRange = Math.max(bar.High - bar.Low, 0.000001);
    const bodySize = Math.abs(bar.Close - bar.Open);
    const bodyRatio = bodySize / barRange;
    const volStrength = avgVolume > 0 ? bar.Volume / avgVolume : 1;

    const isBullishBlock =
      bar.Close < bar.Open &&
      next.Close > next.Open &&
      next2.Close > next2.Open &&
      next.Close > bar.High &&
      volStrength > 1.05;

    const isBearishBlock =
      bar.Close > bar.Open &&
      next.Close < next.Open &&
      next2.Close < next2.Open &&
      next.Close < bar.Low &&
      volStrength > 1.05;

    if (!isBullishBlock && !isBearishBlock) continue;

    const low = Math.min(bar.Low, prev.Low);
    const high = Math.max(bar.High, prev.High);
    const strength = Math.min(1, volStrength * 0.5 + (1 - bodyRatio) * 0.5);

    blocks.push({
      time: Math.floor(new Date(bar.Timestamp).getTime() / 1000),
      ts: bar.Timestamp,
      side: isBullishBlock ? "bullish" : "bearish",
      low,
      high,
      mid: (low + high) / 2,
      strength: Math.round(strength * 1000) / 1000,
    });
  }

  return blocks.slice(-100);
}

function detectFakeEntry(
  direction: SignalDirection,
  entryPrice: number,
  atr: number,
  forwardBars: AlpacaBar[],
): { isFakeEntry: boolean; reason: string | null; adverseMovePct: number } {
  if (forwardBars.length === 0 || entryPrice <= 0) {
    return { isFakeEntry: false, reason: null, adverseMovePct: 0 };
  }

  const earlyBars = forwardBars.slice(0, 4);
  const adverseMoves = earlyBars.map((bar) =>
    direction === "long"
      ? Math.max(0, entryPrice - bar.Low)
      : Math.max(0, bar.High - entryPrice),
  );

  const bestFavorable = earlyBars.map((bar) =>
    direction === "long"
      ? Math.max(0, bar.High - entryPrice)
      : Math.max(0, entryPrice - bar.Low),
  );

  const maxAdverse = Math.max(...adverseMoves);
  const maxFavorable = Math.max(...bestFavorable);
  const adversePct = entryPrice > 0 ? (maxAdverse / entryPrice) * 100 : 0;
  const atrRatio = atr > 0 ? maxAdverse / atr : 0;

  if (atrRatio > 0.8 && maxFavorable < maxAdverse * 0.35) {
    return { isFakeEntry: true, reason: "early_adverse_move", adverseMovePct: adversePct };
  }
  if (atrRatio > 0.55 && maxFavorable < maxAdverse * 0.25) {
    return { isFakeEntry: true, reason: "no_follow_through", adverseMovePct: adversePct };
  }

  return { isFakeEntry: false, reason: null, adverseMovePct: adversePct };
}

// ─── GET /signals ────────────────────────────────────────────────────────────

signalsRouter.get("/signals", async (req: Request, res: Response) => {
  try {
    const query = GetSignalsQueryParams.parse(req.query);

    const conditions = [];
    if (query.setup_type) conditions.push(eq(signalsTable.setup_type, query.setup_type));
    if (query.instrument) conditions.push(eq(signalsTable.instrument, query.instrument));
    if (query.status)     conditions.push(eq(signalsTable.status, query.status));

    const rows = await db
      .select()
      .from(signalsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(signalsTable.created_at))
      .limit(query.limit ?? 50);

    res.json({ signals: rows, count: rows.length });
  } catch (err) {
    logger.error({ err }, "[signals] GET / error");
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

// ─── POST /signals ───────────────────────────────────────────────────────────

signalsRouter.post("/signals", async (req: Request, res: Response) => {
  try {
    const body = CreateSignalBody.parse(req.body) as any;

    const structure  = Number(body.structure_score   ?? 0);
    const orderFlow  = Number(body.order_flow_score  ?? 0);
    const recall     = Number(body.recall_score      ?? 0);
    const ml         = Number(body.ml_probability    ?? 0.52);
    const threshold  = Number(body.quality_threshold ?? 0.65);

    // ── Layer 6: Claude Reasoning Veto ───────────────────────────────────────
    const setupCtx: SetupContext = {
      instrument:              body.instrument          ?? "UNKNOWN",
      setup_type:              body.setup_type          ?? "unknown",
      direction:               (body.direction as "long" | "short") ?? "long",
      structure_score:         structure,
      order_flow_score:        orderFlow,
      recall_score:            recall,
      final_quality:           0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * 0.52,
      quality_threshold:       threshold,
      entry_price:             Number(body.entry_price  ?? 0),
      stop_loss:               Number(body.stop_loss    ?? 0),
      take_profit:             Number(body.take_profit  ?? 0),
      regime:                  body.regime              ?? "unknown",
      sk_bias:                 body.sk_bias             ?? "neutral",
      sk_in_zone:              Boolean(body.sk_in_zone),
      sk_sequence_stage:       body.sk_sequence_stage   ?? "unknown",
      sk_correction_complete:  Boolean(body.sk_correction_complete),
      cvd_slope:               Number(body.cvd_slope    ?? 0),
      cvd_divergence:          Boolean(body.cvd_divergence),
      buy_volume_ratio:        Number(body.buy_volume_ratio ?? 0.5),
      wick_ratio:              Number(body.wick_ratio   ?? 0),
      momentum_1m:             Number(body.momentum_1m  ?? 0),
      trend_slope_5m:          Number(body.trend_slope_5m ?? 0),
      atr_pct:                 Number(body.atr_pct      ?? 0),
      consec_bullish:          Number(body.consec_bullish ?? 0),
      consec_bearish:          Number(body.consec_bearish ?? 0),
    };

    const vetoResult = await claudeVeto(setupCtx);

    logger.info(
      {
        instrument:       setupCtx.instrument,
        setup_type:       setupCtx.setup_type,
        verdict:          vetoResult.verdict,
        confidence:       vetoResult.confidence,
        latency_ms:       vetoResult.latency_ms,
        claude_available: isClaudeAvailable(),
      },
      "[claude-veto] verdict issued"
    );

    const claudeScore   = vetoResult.claude_score;
    const final_quality =
      0.30 * structure +
      0.25 * orderFlow +
      0.20 * recall    +
      0.15 * ml        +
      0.10 * claudeScore;

    const status =
      vetoResult.verdict === "VETOED" ? "rejected" : "pending";

    const [created] = await db
      .insert(signalsTable)
      .values({
        ...body,
        ml_probability:   ml,
        claude_score:     String(claudeScore),
        claude_verdict:   vetoResult.verdict,
        claude_reasoning: vetoResult.reasoning,
        final_quality:    String(final_quality),
        status,
      })
      .returning();

    res.status(201).json({
      signal: created,
      claude: {
        verdict:      vetoResult.verdict,
        confidence:   vetoResult.confidence,
        claude_score: vetoResult.claude_score,
        reasoning:    vetoResult.reasoning,
        key_factors:  vetoResult.key_factors,
        latency_ms:   vetoResult.latency_ms,
        available:    isClaudeAvailable(),
      },
    });
  } catch (err) {
    logger.error({ err }, "[signals] POST / error");
    res.status(500).json({ error: "Failed to create signal" });
  }
});

// ─── GET /signals/:id ────────────────────────────────────────────────────────

signalsRouter.get("/signals/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [signal] = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.id, Number(id)))
      .limit(1);

    if (!signal) {
      return res.status(404).json({ error: "Signal not found" });
    }

    return res.json({ signal });
  } catch (err) {
    logger.error({ err }, "[signals] GET /:id error");
    return res.status(500).json({ error: "Failed to fetch signal" });
  }
});

// ─── GET /signals/:id/plot — chart + orderblock + position payload ──────────
signalsRouter.get("/signals/:id/plot", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid signal id" });
    }

    const [signal] = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.id, id))
      .limit(1);

    if (!signal) {
      return res.status(404).json({ error: "Signal not found" });
    }

    const alpacaSymbol = toAlpacaSymbol(signal.instrument);
    const bars = await getBars(alpacaSymbol, "5Min", 240);
    const orderBlocks = detectOrderBlocks(bars);
    const direction = deriveDirection(signal);
    const entry = Number(signal.entry_price ?? 0);
    const stop = Number(signal.stop_loss ?? 0);
    const take = Number(signal.take_profit ?? 0);
    const rr =
      entry > 0 && stop > 0 && take > 0
        ? Math.abs((take - entry) / Math.max(Math.abs(entry - stop), 0.000001))
        : null;

    const candles = bars.map((bar) => ({
      time: Math.floor(new Date(bar.Timestamp).getTime() / 1000),
      open: Number(bar.Open),
      high: Number(bar.High),
      low: Number(bar.Low),
      close: Number(bar.Close),
      volume: Number(bar.Volume),
    }));

    return res.json({
      signal,
      chart: {
        symbol: alpacaSymbol,
        tradingview_symbol: toTradingViewSymbol(alpacaSymbol),
        timeframe: "5Min",
        live_stream: `/api/alpaca/stream?symbol=${alpacaSymbol}&timeframe=5Min`,
      },
      position: {
        direction,
        entry_price: entry || null,
        stop_loss: stop || null,
        take_profit: take || null,
        risk_reward: rr,
      },
      order_blocks: orderBlocks,
      candles,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[signals] GET /:id/plot error");
    return res.status(500).json({ error: "Failed to build signal plot payload" });
  }
});

// ─── POST /signals/:id/autobacktest — historical + Claude learning ──────────
signalsRouter.post("/signals/:id/autobacktest", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid signal id" });
    }

    const [signal] = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.id, id))
      .limit(1);

    if (!signal) {
      return res.status(404).json({ error: "Signal not found" });
    }

    const setup = toSetupType(signal.setup_type);
    const instrument = signal.instrument;
    const alpacaSymbol = toAlpacaSymbol(instrument);
    const days = Math.min(Math.max(Number(req.body?.days ?? 7), 2), 45);
    const forwardBarsSetting = Math.min(Math.max(Number(req.body?.forward_bars ?? 20), 10), 80);
    const includeClaude = String(req.body?.include_claude ?? "true").toLowerCase() !== "false";
    const claudeSample = Math.min(Math.max(Number(req.body?.claude_sample ?? 12), 0), 50);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startIso = startDate.toISOString();
    const endIso = new Date().toISOString();

    const [bars1mRaw, bars5mRaw] = await Promise.all([
      getBarsHistorical(alpacaSymbol, "1Min", startIso, endIso, Math.min(Math.max(days * 24 * 60 + 500, 2000), 50000)),
      getBarsHistorical(alpacaSymbol, "5Min", startIso, endIso, Math.min(Math.max(days * 24 * 12 + 200, 600), 20000)),
    ]);
    const bars1m = [...bars1mRaw].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
    const bars5m = [...bars5mRaw].sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());

    if (bars1m.length < 40 || bars5m.length < 8) {
      return res.status(400).json({
        error: "insufficient_data",
        message: "Not enough historical bars to run auto backtest.",
        bars: { "1m": bars1m.length, "5m": bars5m.length },
      });
    }

    const bars1mTimes = bars1m.map((bar) => new Date(bar.Timestamp).getTime());
    const bars5mTimes = bars5m.map((bar) => new Date(bar.Timestamp).getTime());
    const WINDOW_1M = 30;
    const results: Array<{
      entry_time: string;
      direction: SignalDirection;
      final_quality: number;
      outcome: "win" | "loss" | "open";
      tp_ticks: number;
      sl_ticks: number;
      pnl_dollars: number;
      is_fake_entry: boolean;
      fake_entry_reason: string | null;
      regime: string;
      recall_score: number;
      structure_score: number;
      order_flow_score: number;
      threshold: number;
      claude_verdict?: "APPROVED" | "VETOED" | "CAUTION";
      claude_score?: number;
      claude_confidence?: number;
      final_quality_with_claude?: number;
    }> = [];
    const claudeCandidates: Array<{ rank: number; idx: number; context: SetupContext }> = [];

    let bars5mCursor = -1;
    for (let i = WINDOW_1M; i < bars1m.length - forwardBarsSetting; i++) {
      const window1m = bars1m.slice(i - WINDOW_1M, i);
      const windowTime = bars1mTimes[i];
      while (bars5mCursor + 1 < bars5mTimes.length && bars5mTimes[bars5mCursor + 1] <= windowTime) {
        bars5mCursor++;
      }
      if (bars5mCursor < 4) continue;

      const start5m = Math.max(0, bars5mCursor - 19);
      const window5m = bars5m.slice(start5m, bars5mCursor + 1);
      if (window5m.length < 5) continue;

      const recall = buildRecallFeatures(window1m, window5m, []);
      const noTrade = applyNoTradeFilters(window1m, recall, setup, { replayMode: true });
      if (noTrade.blocked) continue;

      const detected = runSetupDetector(setup, window1m, window5m, recall);
      if (!detected.detected) continue;

      const entryBar = bars1m[i];
      const entryPrice = Number(entryBar.Close);
      const atr = computeATR(window1m);
      const { takeProfit, stopLoss, tpTicks, slTicks } = computeTPSL(entryPrice, detected.direction, atr, recall.regime);
      const forwardBars = bars1m.slice(i + 1, i + 1 + forwardBarsSetting);
      const outcome = checkForwardOutcome(entryPrice, detected.direction, takeProfit, stopLoss, forwardBars);
      const fakeEntry = detectFakeEntry(detected.direction, entryPrice, atr, forwardBars);
      const recallScore = scoreRecall(recall, setup, detected.direction);
      const finalQuality = computeFinalQuality(detected.structure, detected.orderFlow, recallScore, {
        recall,
        direction: detected.direction,
        setup_type: setup,
      });
      const threshold = getQualityThreshold(recall.regime, setup);
      const tickValue = entryPrice > 10000 ? 5 : entryPrice > 1000 ? 1 : 0.25;
      const pnlDollars =
        outcome.outcome === "win"
          ? tpTicks * tickValue
          : outcome.outcome === "loss"
          ? -(slTicks * tickValue)
          : 0;

      const resultIdx = results.push({
        entry_time: entryBar.Timestamp,
        direction: detected.direction,
        final_quality: finalQuality,
        outcome: outcome.outcome,
        tp_ticks: tpTicks,
        sl_ticks: slTicks,
        pnl_dollars: pnlDollars,
        is_fake_entry: fakeEntry.isFakeEntry,
        fake_entry_reason: fakeEntry.reason,
        regime: recall.regime,
        recall_score: recallScore,
        structure_score: detected.structure,
        order_flow_score: detected.orderFlow,
        threshold,
      }) - 1;

      if (includeClaude) {
        claudeCandidates.push({
          idx: resultIdx,
          rank:
            finalQuality * 0.55 +
            (1 - recall.fake_entry_risk) * 0.25 +
            (1 - Math.min(fakeEntry.adverseMovePct / 2.5, 1)) * 0.2,
          context: {
            instrument,
            setup_type: setup,
            direction: detected.direction,
            structure_score: detected.structure,
            order_flow_score: detected.orderFlow,
            recall_score: recallScore,
            final_quality: finalQuality,
            quality_threshold: threshold,
            entry_price: entryPrice,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            regime: recall.regime,
            sk_bias: recall.sk.bias,
            sk_in_zone: recall.sk.in_zone,
            sk_sequence_stage: recall.sk.sequence_stage,
            sk_correction_complete: recall.sk.correction_complete,
            cvd_slope: recall.cvd.cvd_slope,
            cvd_divergence: recall.cvd.cvd_divergence,
            buy_volume_ratio: recall.cvd.buy_volume_ratio,
            wick_ratio: recall.wick_ratio_5m,
            momentum_1m: recall.momentum_1m,
            trend_slope_5m: recall.trend_slope_5m,
            atr_pct: recall.atr_pct,
            consec_bullish: recall.consec_bullish,
            consec_bearish: recall.consec_bearish,
          },
        });
      }
    }

    if (includeClaude && claudeSample > 0 && claudeCandidates.length > 0) {
      const reviewTargets = [...claudeCandidates]
        .sort((a, b) => b.rank - a.rank)
        .slice(0, claudeSample);
      const reviews = await Promise.all(reviewTargets.map((target) => claudeVeto(target.context)));
      for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        const target = reviewTargets[i];
        const row = results[target.idx];
        if (!row) continue;
        row.claude_verdict = review.verdict;
        row.claude_score = review.claude_score;
        row.claude_confidence = review.confidence;
        row.final_quality_with_claude = Math.min(0.9999, row.final_quality * 0.9 + review.claude_score * 0.1);
      }
    }

    const closed = results.filter((row) => row.outcome !== "open");
    const wins = closed.filter((row) => row.outcome === "win");
    const losses = closed.filter((row) => row.outcome === "loss");
    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const grossWinTicks = wins.reduce((sum, row) => sum + row.tp_ticks, 0);
    const grossLossTicks = losses.reduce((sum, row) => sum + row.sl_ticks, 0);
    const profitFactor = grossLossTicks > 0 ? grossWinTicks / grossLossTicks : grossWinTicks > 0 ? 999 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((sum, row) => sum + row.pnl_dollars, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, row) => sum + row.pnl_dollars, 0) / losses.length) : 0;
    const expectancy = closed.length > 0 ? winRate * avgWin - (1 - winRate) * avgLoss : 0;
    const fakeEntries = results.filter((row) => row.is_fake_entry);
    const claudeRows = results.filter((row) => row.claude_verdict);
    const claudeApproved = claudeRows.filter((row) => row.claude_verdict === "APPROVED" || row.claude_verdict === "CAUTION");

    const recommendations: string[] = [];
    if (results.length < 25) recommendations.push("Increase backtest range to gather at least 25+ setup samples.");
    if (winRate < 0.5) recommendations.push("Win rate is weak; tighten entry timing after reclaim/absorption confirmation.");
    if (profitFactor < 1) recommendations.push("Profit factor below 1; reduce low-quality trades using stricter quality thresholds.");
    if (fakeEntries.length > 0 && fakeEntries.length / Math.max(results.length, 1) > 0.28) {
      recommendations.push("Fake-entry rate is elevated; require stronger order-flow confirmation before entry.");
    }
    if (claudeRows.length > 0 && claudeApproved.length / claudeRows.length < 0.55) {
      recommendations.push("Claude approvals are low; current context often looks conflicted or late.");
    }
    if (recommendations.length === 0) {
      recommendations.push("Setup quality is stable; continue collecting samples and monitor regime drift.");
    }

    return res.json({
      signal_id: id,
      instrument,
      alpaca_symbol: alpacaSymbol,
      setup_type: setup,
      days_analyzed: days,
      forward_bars: forwardBarsSetting,
      bars_analyzed: { "1m": bars1m.length, "5m": bars5m.length },
      summary: {
        total_signals: results.length,
        closed_signals: closed.length,
        wins: wins.length,
        losses: losses.length,
        win_rate: winRate,
        profit_factor: profitFactor,
        expectancy_dollars: expectancy,
        gross_pnl_dollars: results.reduce((sum, row) => sum + row.pnl_dollars, 0),
        fake_entry_rate: results.length > 0 ? fakeEntries.length / results.length : 0,
        claude_reviewed_signals: claudeRows.length,
        claude_approved_rate: claudeRows.length > 0 ? claudeApproved.length / claudeRows.length : 0,
      },
      order_blocks: detectOrderBlocks(bars5m),
      recommendations,
      recent_results: results.slice(-25),
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[signals] POST /:id/autobacktest error");
    return res.status(500).json({ error: "Failed to run auto backtest" });
  }
});

export default signalsRouter;
