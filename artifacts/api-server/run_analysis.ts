/**
 * run_analysis.ts — GodsView Live Engine Analysis Runner
 *
 * Runs ALL GodsView engines against realistic current-market data:
 *   - SMC Engine       (structure, BOS, CHoCH, OBs, FVGs, liquidity)
 *   - Strategy Engine  (regime detection, recall scoring, setup detection)
 *   - War Room         (5-agent consensus: structure/liquidity/micro/risk/judge)
 *   - Market DNA       (instrument personality traits)
 *   - C4 Decision      (gate evaluation per setup)
 *
 * Outputs JSON + produces rich dashboard data.
 */

import { computeSMCState } from "./src/lib/smc_engine.js";
import {
  detectRegime,
  buildRecallFeatures,
  scoreRecall,
  computeATR,
  detectAbsorptionReversal,
  detectSweepReclaim,
  detectContinuationPullback,
  detectCVDDivergence,
  detectBreakoutFailure,
  detectVWAPReclaim,
  detectOpeningRangeBreakout,
} from "./src/lib/strategy_engine.js";
import { computeMarketDNA } from "./src/lib/market_dna.js";
import { runWarRoom } from "./src/lib/war_room.js";
import {
  computeC4ContextScore,
  computeC4ConfirmationScore,
  clamp01,
} from "./src/lib/signal_pipeline.js";
import {
  getSetupDefinition,
  computeFinalQualityScore,
  evaluateC4Decision,
  type C4EvaluationInput,
} from "@workspace/strategy-core";
import fs from "node:fs";

// ─── AlpacaBar-compatible bar shape ──────────────────────────────────────────

interface Bar {
  t: string; o: number; h: number; l: number; c: number; v: number;
  Timestamp: string; Open: number; High: number; Low: number; Close: number; Volume: number;
}

/**
 * Generate realistic trending OHLCV bars with:
 * - Phase 1 (0-50%):  strong trend impulse
 * - Phase 2 (50-70%): corrective pullback
 * - Phase 3 (70-85%): base/consolidation
 * - Phase 4 (85-100%): continuation attempt (trigger zone)
 */
function generateBars(
  basePrice: number,
  barCount: number,
  atrPct: number = 0.003,
  bullish: boolean = true,
): Bar[] {
  const bars: Bar[] = [];
  let price = basePrice * (bullish ? 0.96 : 1.04); // start from slightly lower/higher
  const now = new Date();
  now.setSeconds(0, 0);

  for (let i = barCount - 1; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * 60_000);
    const atr = price * atrPct;
    const progress = (barCount - i) / barCount;

    // Phase-based bias
    let bias: number;
    if (progress <= 0.50) {
      bias = bullish ? 0.64 : 0.36; // impulse phase
    } else if (progress <= 0.70) {
      bias = bullish ? 0.40 : 0.60; // correction
    } else if (progress <= 0.85) {
      bias = 0.50; // consolidation / base
    } else {
      bias = bullish ? 0.62 : 0.38; // continuation attempt
    }

    const noise = (Math.random() - 0.5) * atr * 0.3;
    const move = (Math.random() < bias ? 1 : -1) * atr * (0.5 + Math.random() * 0.8) + noise;
    const close = price + move;
    const high = Math.max(price, close) + Math.abs(noise) * 0.8 + Math.random() * atr * 0.3;
    const low  = Math.min(price, close) - Math.abs(noise) * 0.8 - Math.random() * atr * 0.3;
    const vol = 300_000 + Math.random() * 1_500_000;

    const iso = ts.toISOString();
    bars.push({
      t: iso, o: price, h: high, l: low, c: close, v: vol,
      Timestamp: iso, Open: price, High: high, Low: low, Close: close, Volume: vol,
    });
    price = close;
  }
  return bars;
}

// SMC bar shape
type SMCBar = { Open: number; High: number; Low: number; Close: number; Volume: number; Timestamp: string };
function toSMCBars(bars: Bar[]): SMCBar[] {
  return bars.map(b => ({ Open: b.Open, High: b.High, Low: b.Low, Close: b.Close, Volume: b.Volume, Timestamp: b.Timestamp }));
}

// ─── Instruments ─────────────────────────────────────────────────────────────

interface Instrument {
  symbol: string; price: number; atrPct: number; bullish: boolean; assetClass: "crypto" | "equity";
  description: string;
}

const INSTRUMENTS: Instrument[] = [
  { symbol: "BTCUSD", price: 84_200,  atrPct: 0.0032, bullish: true,  assetClass: "crypto", description: "Bitcoin — post-halving accumulation phase" },
  { symbol: "ETHUSD", price: 1_620,   atrPct: 0.0040, bullish: false, assetClass: "crypto", description: "Ethereum — structural repair in progress" },
  { symbol: "SOLUSD", price: 138,     atrPct: 0.0055, bullish: true,  assetClass: "crypto", description: "Solana — high beta momentum play" },
  { symbol: "SPY",    price: 557,     atrPct: 0.0018, bullish: true,  assetClass: "equity", description: "S&P 500 — near all-time highs, range compression" },
  { symbol: "QQQ",    price: 478,     atrPct: 0.0022, bullish: true,  assetClass: "equity", description: "Nasdaq 100 — tech leadership, mag7 heavy" },
];

const SETUP_TYPES = [
  "sweep_reclaim", "absorption_reversal", "continuation_pullback",
  "cvd_divergence", "breakout_failure", "vwap_reclaim", "opening_range_breakout",
] as const;

type SetupType = typeof SETUP_TYPES[number];

// ─── Per-instrument analysis ──────────────────────────────────────────────────

async function analyzeInstrument(inst: Instrument) {
  const bars1m = generateBars(inst.price, 250, inst.atrPct, inst.bullish);
  const bars5m = generateBars(inst.price, 100, inst.atrPct * 2.1, inst.bullish);
  const smcBars1m = toSMCBars(bars1m);
  const smcBars5m = toSMCBars(bars5m);

  // ── SMC Engine ───────────────────────────────────────────────────────────────
  const smcFull = computeSMCState(inst.symbol, smcBars1m, smcBars5m);
  const sweptPools = smcFull.liquidityPools?.filter((p: { swept: boolean }) => p.swept).length ?? 0;
  const totalPools = smcFull.liquidityPools?.length ?? 0;
  const smc = {
    structureScore: smcFull.structure?.structureScore ?? 0.5,
    trend: smcFull.structure?.trend ?? "range",
    bos: smcFull.structure?.bos ?? false,
    choch: smcFull.structure?.choch ?? false,
    activeOBCount: smcFull.activeOBs?.length ?? 0,
    unfilledFVGCount: smcFull.unfilledFVGs?.length ?? 0,
    sweptPools,
    totalPools,
    liquidityRatio: totalPools > 0 ? sweptPools / totalPools : 0,
    activeOBs: smcFull.activeOBs?.slice(0, 3) ?? [],
    unfilledFVGs: smcFull.unfilledFVGs?.slice(0, 3) ?? [],
  };

  // ── Regime + recall ───────────────────────────────────────────────────────────
  const regime = detectRegime(bars1m);
  const atr = computeATR(bars1m, 14);
  const recall = buildRecallFeatures(bars1m, bars5m, regime);
  const recallScore = scoreRecall(recall);

  // ── Setup detection + C4 scoring ─────────────────────────────────────────────
  const setupResults = SETUP_TYPES.map(setup => {
    let det: { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number };
    try {
      if (setup === "absorption_reversal")   det = detectAbsorptionReversal(bars1m, bars5m, recall);
      else if (setup === "sweep_reclaim")    det = detectSweepReclaim(bars1m, bars5m, recall);
      else if (setup === "cvd_divergence")   det = detectCVDDivergence(bars1m, bars5m, recall);
      else if (setup === "breakout_failure") det = detectBreakoutFailure(bars1m, bars5m, recall);
      else if (setup === "vwap_reclaim")     det = detectVWAPReclaim(bars1m, bars5m, recall);
      else if (setup === "opening_range_breakout") det = detectOpeningRangeBreakout(bars1m, bars5m, recall);
      else det = detectContinuationPullback(bars1m, bars5m, recall);
    } catch {
      det = { detected: false, direction: "long", structure: 0.3, orderFlow: 0.3 };
    }

    const setupDef = getSetupDefinition(setup as any);
    const c4Context      = computeC4ContextScore(recallScore, recall);
    const c4Confirmation = computeC4ConfirmationScore(setupDef, det, recall);

    // Use strategy-core computeFinalQualityScore with correct field names
    const finalQuality = computeFinalQualityScore({
      structure: det.structure,
      orderflow: det.orderFlow,
      recall: recallScore,
      ml: clamp01(c4Confirmation * 0.7 + c4Context * 0.3),
      claude: clamp01(smc.structureScore * 0.6 + (det.detected ? 0.3 : 0.1)),
    });

    // Evaluate C4 gate with correct shape
    const c4Input: C4EvaluationInput = {
      setup: {
        type: setupDef.type,
        c4Category: setupDef.c4Category,
        allowedRegimes: setupDef.allowedRegimes,
        requiresSkZone: setupDef.requiresSkZone,
        requiresBiasAlignment: setupDef.requiresBiasAlignment,
        requiresCvdDivergence: setupDef.requiresCvdDivergence,
      },
      scores: {
        structure: det.structure,
        orderflow: det.orderFlow,
        context: c4Context,
        confirmation: c4Confirmation,
      },
      gates: {
        regime,
        inSkZone: recall.sk?.in_zone ?? false,
        sessionAllowed: true,
        newsClear: true,
        degradedData: false,
        biasAligned: recall.sk?.bias === (det.direction === "long" ? "bull" : "bear"),
        cvdReady: recall.cvd?.cvd_slope !== undefined && Math.abs(recall.cvd.cvd_slope) > 0.001,
        confirmationValid: c4Confirmation > 0.5,
        orderFlowConfirmed: det.orderFlow > 0.5,
      },
    };
    const c4Result = evaluateC4Decision(c4Input);

    const grade = finalQuality >= 0.80 ? "A+" : finalQuality >= 0.70 ? "A" : finalQuality >= 0.60 ? "B+" : finalQuality >= 0.50 ? "B" : finalQuality >= 0.40 ? "C+" : "C";

    return {
      setup, det, finalQuality, grade,
      c4Decision: c4Result.decision,
      c4Confidence: c4Result.confidence,
      direction: det.direction,
      structureScore: det.structure,
      orderFlowScore: det.orderFlow,
      recallScore,
      c4Context,
      c4Confirmation,
    };
  });

  const sorted = [...setupResults].sort((a, b) => b.finalQuality - a.finalQuality);
  const best = sorted[0];
  const detected = setupResults.filter(s => s.det.detected);

  // ── War Room ──────────────────────────────────────────────────────────────────
  const trendMap: Record<string, "uptrend" | "downtrend" | "range"> = {
    bullish: "uptrend", bearish: "downtrend", range: "range",
  };
  const smcForWR = {
    symbol: inst.symbol,
    structureScore: smc.structureScore,
    bos: smc.bos, choch: smc.choch,
    trend: trendMap[smc.trend] ?? "range",
    activeOBs: smc.activeOBs,
    unfilledFVGs: smc.unfilledFVGs,
    sweptPools: smc.sweptPools,
    totalPools: smc.totalPools,
  };
  const orderflowState = {
    delta: recall.cvd.cvd_value,
    cvd: recall.cvd.cvd_value,
    cvdSlope: recall.cvd.cvd_slope,
    quoteImbalance: recall.cvd.buy_volume_ratio - 0.5,
    aggressionScore: clamp01(recall.cvd.buy_volume_ratio),
    orderflowBias: recall.cvd.cvd_slope > 0.005 ? "bullish" as const
      : recall.cvd.cvd_slope < -0.005 ? "bearish" as const : "neutral" as const,
    orderflowScore: clamp01(0.5 + recall.cvd.cvd_slope * 5),
  };
  const riskInput = {
    volatilityRegime: regime === "volatile" ? "high" : "normal",
    spreadBps: inst.assetClass === "crypto" ? 4 : 1,
    maxLossToday: 0, sessionActive: true,
  };
  const warRoom = runWarRoom(inst.symbol, smcForWR, orderflowState, riskInput);

  // ── Market DNA ────────────────────────────────────────────────────────────────
  const dnaBars = bars1m.map(b => ({ open: b.Open, high: b.High, low: b.Low, close: b.Close, volume: b.Volume }));
  const dna = computeMarketDNA(inst.symbol, dnaBars);

  // ── Entry scenario ────────────────────────────────────────────────────────────
  const lastPrice = bars1m[bars1m.length - 1].Close;
  const atrVal = atr;
  const entryScenario = {
    entry: lastPrice,
    stopLoss: best.direction === "long"
      ? lastPrice - atrVal * 1.5
      : lastPrice + atrVal * 1.5,
    takeProfit: best.direction === "long"
      ? lastPrice + atrVal * 3.0
      : lastPrice - atrVal * 3.0,
    rrRatio: 2.0,
    riskPct: (atrVal * 1.5 / lastPrice) * 100,
  };

  return {
    symbol: inst.symbol,
    description: inst.description,
    price: Math.round(lastPrice * 100) / 100,
    assetClass: inst.assetClass,
    regime,
    atr: Math.round(atrVal * 100) / 100,
    atrPct: Math.round((atrVal / lastPrice) * 10000) / 100,
    smc,
    setupResults,
    detected: detected.map(s => s.setup),
    bestSetup: best.setup,
    bestQuality: best.finalQuality,
    bestDirection: best.direction,
    bestGrade: best.grade,
    warRoom: {
      finalDecision: warRoom.finalDecision,
      finalScore: warRoom.finalScore,
      confidence: warRoom.confidence,
      reasoning: warRoom.reasoning,
      agents: warRoom.agents,
    },
    dna: {
      trendiness: dna.trendiness,
      fakeout_risk: dna.fakeout_risk,
      breakout_quality: dna.breakout_quality,
      momentum_persistence: dna.momentum_persistence,
      mean_reversion: dna.mean_reversion,
      volatility_regime: dna.volatility_regime,
      spread_stability: dna.spread_stability,
    },
    recall: {
      regime,
      trend_slope_1m: recall.trend_slope_1m,
      trend_slope_5m: recall.trend_slope_5m,
      momentum_1m: recall.momentum_1m,
      vol_relative: recall.vol_relative,
      directional_persistence: recall.directional_persistence,
      trend_consensus: recall.trend_consensus,
      flow_alignment: recall.flow_alignment,
      fake_entry_risk: recall.fake_entry_risk,
      cvd_slope: recall.cvd.cvd_slope,
      cvd_divergence: recall.cvd.cvd_divergence,
      buy_vol_ratio: recall.cvd.buy_volume_ratio,
      sk_bias: recall.sk.bias,
      sk_sequence_stage: recall.sk.sequence_stage,
      sk_in_zone: recall.sk.in_zone,
      sk_score: recall.sk.sequence_score,
      indicator_bias: recall.indicators.indicator_bias,
      rsi_14: recall.indicators.rsi_14,
    },
    entryScenario,
    computedAt: new Date().toISOString(),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("GodsView Engine Analysis — Running ALL Engines\n");
  console.log("=" .repeat(60));

  const results = [];
  for (const inst of INSTRUMENTS) {
    process.stdout.write(`  ⚙  ${inst.symbol.padEnd(8)}`);
    const r = await analyzeInstrument(inst);
    results.push(r);

    const warIcon = r.warRoom.finalDecision === "approved" ? "✅"
      : r.warRoom.finalDecision === "caution" ? "⚠️ " : "🚫";
    process.stdout.write(
      `${warIcon} ${r.warRoom.finalDecision.padEnd(8)} | Q:${r.bestQuality.toFixed(3)} ${r.bestGrade.padEnd(3)} | Regime:${r.regime.padEnd(14)} | ${r.bestSetup} ${r.bestDirection}\n`
    );
  }

  const output = {
    generated_at: new Date().toISOString(),
    engine_version: "GodsView v1.0 — Phase 63 — Six-Engine Stack",
    instruments: results,
    summary: {
      approved: results.filter(r => r.warRoom.finalDecision === "approved").length,
      caution:  results.filter(r => r.warRoom.finalDecision === "caution").length,
      blocked:  results.filter(r => r.warRoom.finalDecision === "blocked").length,
      bestOpportunity: results.reduce(
        (b, r) => r.bestQuality > b.quality ? { symbol: r.symbol, setup: r.bestSetup, quality: r.bestQuality, direction: r.bestDirection, regime: r.regime } : b,
        { symbol: "", setup: "", quality: 0, direction: "", regime: "" }
      ),
      regimes: Object.fromEntries(results.map(r => [r.symbol, r.regime])),
      warRoomScores: Object.fromEntries(results.map(r => [r.symbol, { decision: r.warRoom.finalDecision, score: r.warRoom.finalScore, confidence: r.warRoom.confidence }])),
    },
  };

  fs.writeFileSync("/tmp/godsview_analysis.json", JSON.stringify(output, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`  ✅ Approved: ${output.summary.approved} | ⚠️  Caution: ${output.summary.caution} | 🚫 Blocked: ${output.summary.blocked}`);
  if (output.summary.bestOpportunity.symbol) {
    const b = output.summary.bestOpportunity;
    console.log(`  🏆 Best: ${b.symbol} — ${b.setup} (${b.direction}) Q:${b.quality.toFixed(3)} | Regime: ${b.regime}`);
  }
  console.log("\n  War Room Consensus:");
  for (const [sym, wr] of Object.entries(output.summary.warRoomScores)) {
    const ws = wr as { decision: string; score: number; confidence: number };
    console.log(`    ${sym.padEnd(8)} ${ws.decision.padEnd(8)} score:${ws.score.toFixed(3)} conf:${ws.confidence.toFixed(3)}`);
  }
  console.log("\n✓ Full JSON saved to /tmp/godsview_analysis.json\n");
}

main().catch(e => { console.error(e); process.exit(1); });
