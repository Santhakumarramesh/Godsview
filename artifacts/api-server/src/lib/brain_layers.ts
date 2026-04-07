/**
 * brain_layers.ts — GodsView 6-Layer Intelligence Agents
 *
 * Each layer is an independent agent that runs its own engines,
 * produces a typed AgentReport, and reports back to the Brain.
 *
 * Architecture:
 *   ┌─────────────┐
 *   │  L1 PERCEPT  │ ← raw market data: orderflow, bars, spreads
 *   │  L2 STRUCT   │ ← structure: SMC, regime, MTF, setups          } parallel
 *   │  L3 CONTEXT  │ ← context: macro, sentiment, stress, news
 *   │  L4 MEMORY   │ ← recall: setup memory, DNA, trade journal
 *   └──────┬───────┘
 *          ↓ (all 4 feed into →)
 *   ┌──────┴───────┐
 *   │  L5 INTEL    │ ← decision: ML model, reasoning, risk, sizing
 *   └──────┬───────┘
 *          ↓
 *   ┌──────┴───────┐
 *   │  L6 EVOLVE   │ ← learning: attribution, decay, adaptation
 *   └──────────────┘
 *
 * Layers 1-4 run in PARALLEL (no dependencies).
 * Layer 5 depends on L1-L4 outputs.
 * Layer 6 runs after L5's decision.
 */

import {
  brainEventBus,
  type AgentId,
  type AgentReport,
  type AgentFlag,
  type LayerAgentId,
} from "./brain_event_bus";

// ── Shared Types ───────────────────────────────────────────────────────────

export interface LayerInput {
  symbol: string;
  bars1m: any[];
  bars5m: any[];
  orderbook?: any;
  marketStress?: any;
  dna?: any;
}

/** Output from Layer 1 → feeds other layers */
export interface PerceptionOutput {
  orderflow: any;
  liquidity: any;
  candlePackets: any;
  spreadBps: number;
  lastPrice: number;
  bidDepth: number;
  askDepth: number;
}

/** Output from Layer 2 → feeds Layer 5 */
export interface StructureOutput {
  smc: any;
  regime: any;
  mtfScores: any;
  trend: string;
  regimeLabel: string;
  structureScore: number;
  regimeScore: number;
}

/** Output from Layer 3 → feeds Layer 5 */
export interface ContextOutput {
  macroBias: any;
  sentiment: any;
  volatility: any;
  marketStress: any;
  macroScore: number;
  sentimentScore: number;
  stressScore: number;
}

/** Output from Layer 4 → feeds Layer 5 */
export interface MemoryOutput {
  setupMemory: any;
  marketDna: any;
  winRate: number;
  profitFactor: number;
  decayDetected: boolean;
  similarSetups: number;
}

/** Output from Layer 5 → feeds Layer 6 + Brain */
export interface IntelligenceOutput {
  mlPrediction: any;
  riskSnapshot: any;
  circuitBreaker: any;
  winProbability: number;
  kellyFraction: number;
  riskGate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK";
  blocked: boolean;
  blockReason: string;
}

// ── Generic Agent Runner ───────────────────────────────────────────────────

function runSubAgent(
  agentId: AgentId,
  layer: LayerAgentId,
  symbol: string,
  fn: () => { score: number; confidence: number; verdict: string; data: Record<string, unknown>; flags?: AgentFlag[] },
): AgentReport {
  const start = Date.now();
  try {
    const result = fn();
    return {
      agentId,
      layer,
      symbol,
      status: "done",
      confidence: result.confidence,
      score: result.score,
      verdict: result.verdict,
      data: result.data,
      flags: result.flags ?? [],
      timestamp: Date.now(),
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      agentId,
      layer,
      symbol,
      status: "error",
      confidence: 0,
      score: 0.5,
      verdict: `Error: ${errorMsg}`,
      data: { error: errorMsg },
      flags: [{ level: "warning", code: "SUB_AGENT_ERROR", message: `${agentId}: ${errorMsg}` }],
      timestamp: Date.now(),
      latencyMs: Date.now() - start,
    };
  }
}

function runLayerAgent(
  layerId: LayerAgentId,
  symbol: string,
  subReports: AgentReport[],
  synthesis: { score: number; confidence: number; verdict: string; data: Record<string, unknown>; flags?: AgentFlag[] },
): AgentReport {
  const start = Math.min(...subReports.map((r) => r.timestamp - r.latencyMs), Date.now());
  const end = Date.now();
  const allFlags = [
    ...(synthesis.flags ?? []),
    ...subReports.flatMap((r) => r.flags),
  ];

  const report: AgentReport = {
    agentId: layerId,
    layer: layerId,
    symbol,
    status: subReports.some((r) => r.status === "error") ? "done" : "done",
    confidence: synthesis.confidence,
    score: synthesis.score,
    verdict: synthesis.verdict,
    data: synthesis.data,
    flags: allFlags,
    subReports,
    timestamp: end,
    latencyMs: end - start,
  };

  brainEventBus.agentStart(layerId, symbol);
  brainEventBus.agentReport(report);
  return report;
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 1: PERCEPTION — Raw Market Data Intake
// Engines: orderflow_engine, liquidity map
// ════════════════════════════════════════════════════════════════════════════

export function runPerceptionLayer(input: LayerInput): { report: AgentReport; output: PerceptionOutput } {
  const { symbol, bars1m, orderbook } = input;

  // Sub-agent 1: Orderflow
  let orderflowState: any = { orderflowBias: "neutral", delta: 0, cvd: 0, cvdSlope: 0, aggressionScore: 0, buyVolumeRatio: 0.5, divergence: false, largeDeltaBar: false, spreadBps: 0, orderflowScore: 0.5 };
  const ofReport = runSubAgent("orderflow", "L1_perception", symbol, () => {
    const { computeOrderflowState } = require("./orderflow_engine");
    orderflowState = computeOrderflowState(bars1m, orderbook);
    return {
      score: Math.min(1, 0.4 + orderflowState.orderflowScore * 0.6),
      confidence: Math.min(1, 0.4 + orderflowState.orderflowScore * 0.6),
      verdict: `${orderflowState.orderflowBias} flow | Delta: ${orderflowState.delta.toFixed(0)} | CVD slope: ${orderflowState.cvdSlope > 0 ? "+" : ""}${orderflowState.cvdSlope.toFixed(2)}`,
      data: { bias: orderflowState.orderflowBias, delta: orderflowState.delta, cvd: orderflowState.cvd, cvdSlope: orderflowState.cvdSlope, aggressionScore: orderflowState.aggressionScore, divergence: orderflowState.divergence, largeDeltaBar: orderflowState.largeDeltaBar, spreadBps: orderflowState.spreadBps },
      flags: [
        ...(orderflowState.divergence ? [{ level: "warning" as const, code: "DIVERGENCE", message: "Price-CVD divergence detected" }] : []),
        ...(orderflowState.largeDeltaBar ? [{ level: "info" as const, code: "LARGE_DELTA", message: "Large delta bar — strong conviction" }] : []),
      ],
    };
  });

  // Sub-agent 2: Liquidity
  let liquidityState: any = { liquidityScore: 0.5, liquidityAbove: 0, liquidityBelow: 0, thinZoneDetected: false, strongestBidLevel: 0, strongestAskLevel: 0 };
  const liqReport = runSubAgent("liquidity", "L1_perception", symbol, () => {
    const { computeLiquidityMapState } = require("./orderflow_engine");
    liquidityState = computeLiquidityMapState(orderbook);
    return {
      score: liquidityState.liquidityScore,
      confidence: 0.65,
      verdict: `Liquidity: ${(liquidityState.liquidityScore * 100).toFixed(0)}% | Bid: ${liquidityState.liquidityBelow.toFixed(0)} | Ask: ${liquidityState.liquidityAbove.toFixed(0)}${liquidityState.thinZoneDetected ? " | THIN" : ""}`,
      data: { ...liquidityState },
      flags: liquidityState.thinZoneDetected ? [{ level: "warning" as const, code: "THIN_ZONE", message: "Thin liquidity — slippage risk" }] : [],
    };
  });

  // Layer synthesis
  const perceptionScore = clamp(ofReport.score * 0.6 + liqReport.score * 0.4);
  const perceptionConf = clamp(ofReport.confidence * 0.6 + liqReport.confidence * 0.4);
  const lastBar = bars1m.length > 0 ? bars1m[bars1m.length - 1] : null;

  const output: PerceptionOutput = {
    orderflow: orderflowState,
    liquidity: liquidityState,
    candlePackets: null,
    spreadBps: orderflowState.spreadBps ?? 0,
    lastPrice: lastBar ? Number(lastBar.Close ?? lastBar.close ?? 0) : 0,
    bidDepth: liquidityState.liquidityBelow ?? 0,
    askDepth: liquidityState.liquidityAbove ?? 0,
  };

  const report = runLayerAgent("L1_perception", symbol, [ofReport, liqReport], {
    score: perceptionScore,
    confidence: perceptionConf,
    verdict: `Perception: ${orderflowState.orderflowBias} flow, ${(perceptionScore * 100).toFixed(0)}% readiness | spread ${orderflowState.spreadBps?.toFixed(1) ?? "?"}bps`,
    data: { orderflowBias: orderflowState.orderflowBias, perceptionScore, spreadBps: orderflowState.spreadBps, liquidityScore: liquidityState.liquidityScore },
  });

  return { report, output };
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 2: STRUCTURE — SMC, Regime, MTF, Setups
// Engines: smc_engine, regime_engine, mtf_scores
// ════════════════════════════════════════════════════════════════════════════

export function runStructureLayer(input: LayerInput): { report: AgentReport; output: StructureOutput } {
  const { symbol, bars1m, bars5m } = input;

  // Sub-agent 1: SMC
  let smcState: any = { structure: { trend: "neutral", pattern: "unknown", bos: false, choch: false, bosDirection: "none", structureScore: 0.5 }, activeOBs: [], unfilledFVGs: [], confluenceScore: 0.5 };
  const smcReport = runSubAgent("structure", "L2_structure", symbol, () => {
    const { computeSMCState } = require("./smc_engine");
    smcState = computeSMCState(symbol, bars1m, bars5m);
    const flags: AgentFlag[] = [];
    if (smcState.structure.bos) flags.push({ level: "info", code: "BOS", message: `Break of structure ${smcState.structure.bosDirection}` });
    if (smcState.structure.choch) flags.push({ level: "warning", code: "CHOCH", message: "Character change — potential reversal" });
    return {
      score: smcState.structure.structureScore,
      confidence: Math.min(1, 0.5 + smcState.structure.structureScore * 0.5),
      verdict: `${smcState.structure.trend} | ${smcState.structure.pattern} | ${smcState.activeOBs.length} OBs, ${smcState.unfilledFVGs.length} FVGs`,
      data: { trend: smcState.structure.trend, pattern: smcState.structure.pattern, bos: smcState.structure.bos, choch: smcState.structure.choch, activeOBs: smcState.activeOBs.length, unfilledFVGs: smcState.unfilledFVGs.length, confluenceScore: smcState.confluenceScore },
      flags,
    };
  });

  // Sub-agent 2: Regime
  let regimeState: any = { basic: { regime: "unknown", trendStrength: 0, confidence: 0.5 }, spectral: { regimeLabel: "unknown", dominantCycleLength: 0 }, label: "unknown" };
  const regimeReport = runSubAgent("regime", "L2_structure", symbol, () => {
    const { computeFullRegime } = require("./regime_engine");
    const bars = bars5m.length > 10 ? bars5m : bars1m;
    regimeState = computeFullRegime(bars);
    const flags: AgentFlag[] = [];
    if (regimeState.basic.regime === "chaotic") flags.push({ level: "critical", code: "CHAOTIC", message: "Chaotic regime — avoid trading" });
    if (regimeState.spectral.regimeLabel === "transition") flags.push({ level: "warning", code: "TRANSITION", message: "Regime in transition" });
    return {
      score: regimeState.basic.confidence,
      confidence: regimeState.basic.confidence,
      verdict: `${regimeState.label} | Trend: ${(regimeState.basic.trendStrength * 100).toFixed(0)}% | Cycle: ${regimeState.spectral.dominantCycleLength}`,
      data: { regime: regimeState.basic.regime, label: regimeState.label, trendStrength: regimeState.basic.trendStrength, spectralRegime: regimeState.spectral.regimeLabel, dominantCycle: regimeState.spectral.dominantCycleLength },
      flags,
    };
  });

  // Sub-agent 3: MTF Scores
  let mtfScores: any = { bias1m: 0, bias5m: 0, bias15m: 0, aligned: false };
  const mtfReport = runSubAgent("mtf", "L2_structure", symbol, () => {
    try {
      const { computeMTFScores } = require("./mtf_scores");
      mtfScores = computeMTFScores(bars1m, bars5m);
      const aligned = Math.sign(mtfScores.bias1m) === Math.sign(mtfScores.bias5m) && mtfScores.bias5m !== 0;
      mtfScores.aligned = aligned;
      return {
        score: aligned ? 0.8 : 0.4,
        confidence: 0.6,
        verdict: `MTF ${aligned ? "ALIGNED" : "DIVERGENT"} | 1m: ${mtfScores.bias1m > 0 ? "+" : ""}${(mtfScores.bias1m * 100).toFixed(0)}% | 5m: ${mtfScores.bias5m > 0 ? "+" : ""}${(mtfScores.bias5m * 100).toFixed(0)}%`,
        data: { ...mtfScores, aligned },
      };
    } catch {
      return { score: 0.5, confidence: 0.3, verdict: "MTF data unavailable", data: {} };
    }
  });

  // Layer synthesis
  const structureScore = clamp(smcReport.score * 0.45 + regimeReport.score * 0.35 + mtfReport.score * 0.20);
  const regimeScore = regimeReport.score;

  const output: StructureOutput = {
    smc: smcState,
    regime: regimeState,
    mtfScores,
    trend: smcState.structure.trend,
    regimeLabel: regimeState.label,
    structureScore,
    regimeScore,
  };

  const report = runLayerAgent("L2_structure", symbol, [smcReport, regimeReport, mtfReport], {
    score: structureScore,
    confidence: clamp(smcReport.confidence * 0.4 + regimeReport.confidence * 0.4 + mtfReport.confidence * 0.2),
    verdict: `Structure: ${smcState.structure.trend} ${regimeState.label} | MTF ${mtfScores.aligned ? "ALIGNED" : "DIVERGENT"} | ${(structureScore * 100).toFixed(0)}%`,
    data: { trend: smcState.structure.trend, regime: regimeState.label, structureScore, regimeScore, mtfAligned: mtfScores.aligned },
  });

  return { report, output };
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 3: CONTEXT — Macro, Sentiment, Stress
// Engines: macro_bias_engine, sentiment_engine, stress_engine
// ════════════════════════════════════════════════════════════════════════════

export function runContextLayer(input: LayerInput): { report: AgentReport; output: ContextOutput } {
  const { symbol, bars1m, bars5m, marketStress } = input;

  // Sub-agent 1: Volatility / Stress
  let volState: any = { volRegime: "normal", atr: 0, atrPct: 0, jumpScore: 0 };
  const volReport = runSubAgent("volatility", "L3_context", symbol, () => {
    const { computeVolatilityState } = require("./stress_engine");
    const bars = bars1m.length > 10 ? bars1m : bars5m;
    volState = computeVolatilityState(symbol, bars);
    const flags: AgentFlag[] = [];
    if (volState.volRegime === "extreme") flags.push({ level: "critical", code: "EXTREME_VOL", message: "Extreme volatility — reduce size or avoid" });
    if (volState.jumpScore > 3) flags.push({ level: "warning", code: "HIGH_JUMP", message: `Jump score ${volState.jumpScore.toFixed(1)}` });
    return {
      score: volState.volRegime === "extreme" ? 0.15 : volState.volRegime === "high" ? 0.4 : volState.volRegime === "low" ? 0.7 : 0.6,
      confidence: 0.7,
      verdict: `${volState.volRegime} vol | ATR: ${volState.atr.toFixed(2)} (${(volState.atrPct * 100).toFixed(2)}%)`,
      data: { volRegime: volState.volRegime, atr: volState.atr, atrPct: volState.atrPct, jumpScore: volState.jumpScore },
      flags,
    };
  });

  // Sub-agent 2: Macro Bias
  let macroBias: any = { score: 0.5, direction: "flat", conviction: "low", blockedDirections: [] };
  const macroReport = runSubAgent("macro", "L3_context", symbol, () => {
    try {
      const { neutralMacroBias } = require("./macro_bias_engine");
      macroBias = neutralMacroBias(); // Use neutral if no live data
      return {
        score: macroBias.score,
        confidence: macroBias.conviction === "high" ? 0.85 : macroBias.conviction === "medium" ? 0.6 : 0.4,
        verdict: `Macro: ${macroBias.direction} (${macroBias.conviction}) | Score: ${(macroBias.score * 100).toFixed(0)}%`,
        data: { direction: macroBias.direction, conviction: macroBias.conviction, score: macroBias.score, blockedDirections: macroBias.blockedDirections },
      };
    } catch {
      return { score: 0.5, confidence: 0.3, verdict: "Macro data unavailable", data: {} };
    }
  });

  // Sub-agent 3: Sentiment
  let sentimentResult: any = { retailBias: "balanced", institutionalEdge: "none", crowdingLevel: "low", compositeScore: 0.5 };
  const sentReport = runSubAgent("sentiment", "L3_context", symbol, () => {
    try {
      const { neutralSentiment } = require("./sentiment_engine");
      sentimentResult = neutralSentiment();
      return {
        score: sentimentResult.compositeScore,
        confidence: sentimentResult.crowdingLevel === "extreme" ? 0.85 : sentimentResult.crowdingLevel === "high" ? 0.65 : 0.4,
        verdict: `Sentiment: ${sentimentResult.retailBias} | Edge: ${sentimentResult.institutionalEdge} | Crowd: ${sentimentResult.crowdingLevel}`,
        data: { retailBias: sentimentResult.retailBias, institutionalEdge: sentimentResult.institutionalEdge, crowdingLevel: sentimentResult.crowdingLevel },
      };
    } catch {
      return { score: 0.5, confidence: 0.3, verdict: "Sentiment data unavailable", data: {} };
    }
  });

  // Sub-agent 4: Market Stress
  let stressData = marketStress;
  const stressReport = runSubAgent("stress", "L3_context", symbol, () => {
    if (!stressData) {
      return {
        score: 0.7,
        confidence: 0.3,
        verdict: "No cross-symbol stress data",
        data: { available: false },
        flags: [{ level: "info" as const, code: "NO_STRESS", message: "Market stress unavailable" }],
      };
    }
    const flags: AgentFlag[] = [];
    if (stressData.systemicStressScore > 0.7) flags.push({ level: "critical", code: "HIGH_STRESS", message: `Systemic stress ${(stressData.systemicStressScore * 100).toFixed(0)}%` });
    if (stressData.correlationSpikeCount > 3) flags.push({ level: "warning", code: "CORR_SPIKE", message: `${stressData.correlationSpikeCount} correlation spikes` });
    return {
      score: clamp(1 - stressData.systemicStressScore),
      confidence: 0.75,
      verdict: `Stress: ${stressData.stressRegime} (${(stressData.systemicStressScore * 100).toFixed(0)}%) | Avg corr: ${stressData.avgCorrelation.toFixed(2)}`,
      data: { stressRegime: stressData.stressRegime, systemicStressScore: stressData.systemicStressScore, avgCorrelation: stressData.avgCorrelation },
      flags,
    };
  });

  // Layer synthesis
  const contextScore = clamp(volReport.score * 0.30 + macroReport.score * 0.25 + sentReport.score * 0.20 + stressReport.score * 0.25);

  const output: ContextOutput = {
    macroBias,
    sentiment: sentimentResult,
    volatility: volState,
    marketStress: stressData,
    macroScore: macroReport.score,
    sentimentScore: sentReport.score,
    stressScore: stressReport.score,
  };

  const report = runLayerAgent("L3_context", symbol, [volReport, macroReport, sentReport, stressReport], {
    score: contextScore,
    confidence: clamp(volReport.confidence * 0.3 + macroReport.confidence * 0.25 + sentReport.confidence * 0.2 + stressReport.confidence * 0.25),
    verdict: `Context: ${volState.volRegime} vol | ${macroBias.direction} macro | ${stressData?.stressRegime ?? "no"} stress | ${(contextScore * 100).toFixed(0)}%`,
    data: { contextScore, volRegime: volState.volRegime, macroDirection: macroBias.direction, stressRegime: stressData?.stressRegime },
  });

  return { report, output };
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 4: MEMORY — Setup Memory, Market DNA, Recall
// Engines: setup_memory, market_dna
// ════════════════════════════════════════════════════════════════════════════

export async function runMemoryLayer(input: LayerInput): Promise<{ report: AgentReport; output: MemoryOutput }> {
  const { symbol, bars1m, dna } = input;

  // Sub-agent 1: Setup Memory (async — DB query)
  let memoryData: any = { similar_setups: 0, win_rate: 0.5, profit_factor: 1.0, avg_confidence: 0.5, decay_detected: false };
  const memReport = runSubAgent("memory", "L4_memory", symbol, () => {
    // Will be populated below since it's async
    return { score: 0.5, confidence: 0.3, verdict: "Loading...", data: {} };
  });

  // Try async memory query
  try {
    const _sm = "./setup_memory"; const { getSetupMemory } = require(_sm);
    memoryData = await getSetupMemory(symbol);
    memReport.score = memoryData.win_rate ?? 0.5;
    memReport.confidence = memoryData.similar_setups > 10 ? 0.8 : memoryData.similar_setups > 3 ? 0.5 : 0.3;
    memReport.verdict = `${memoryData.similar_setups} similar setups | WR: ${((memoryData.win_rate ?? 0.5) * 100).toFixed(0)}% | PF: ${(memoryData.profit_factor ?? 1).toFixed(2)}${memoryData.decay_detected ? " | DECAY" : ""}`;
    memReport.data = { similarSetups: memoryData.similar_setups, winRate: memoryData.win_rate, profitFactor: memoryData.profit_factor, decayDetected: memoryData.decay_detected };
    memReport.status = "done";
    if (memoryData.decay_detected) {
      memReport.flags.push({ level: "warning", code: "SETUP_DECAY", message: "Setup win rate declining — approach with caution" });
    }
  } catch {
    memReport.verdict = "Setup memory unavailable";
    memReport.status = "done";
  }

  // Sub-agent 2: Market DNA
  let dnaData: any = dna ?? { trendiness: 50, fakeout_risk: 50, breakout_quality: 50, spread_stability: 50, news_sensitivity: 50, momentum_persistence: 50, mean_reversion: 50 };
  const dnaReport = runSubAgent("dna", "L4_memory", symbol, () => {
    if (!dna) {
      try {
        const _md = "./market_dna"; const { computeMarketDNA } = require(_md);
        const dnaBars = bars1m.map((b: any) => ({ open: b.Open ?? b.open ?? 0, high: b.High ?? b.high ?? 0, low: b.Low ?? b.low ?? 0, close: b.Close ?? b.close ?? 0, volume: b.Volume ?? b.volume ?? 0 }));
        dnaData = computeMarketDNA(symbol, dnaBars);
      } catch { /* use defaults */ }
    }
    const tradeability = clamp(((dnaData.trendiness ?? 50) + (dnaData.breakout_quality ?? 50) + (100 - (dnaData.fakeout_risk ?? 50)) + (dnaData.spread_stability ?? 50)) / 400);
    return {
      score: tradeability,
      confidence: 0.6,
      verdict: `DNA: trend ${dnaData.trendiness ?? "?"}% | fakeout ${dnaData.fakeout_risk ?? "?"}% | breakout ${dnaData.breakout_quality ?? "?"}%`,
      data: { ...dnaData, tradeability },
    };
  });

  // Layer synthesis
  const memoryScore = clamp(memReport.score * 0.55 + dnaReport.score * 0.45);

  const output: MemoryOutput = {
    setupMemory: memoryData,
    marketDna: dnaData,
    winRate: memoryData.win_rate ?? 0.5,
    profitFactor: memoryData.profit_factor ?? 1.0,
    decayDetected: memoryData.decay_detected ?? false,
    similarSetups: memoryData.similar_setups ?? 0,
  };

  const report = runLayerAgent("L4_memory", symbol, [memReport, dnaReport], {
    score: memoryScore,
    confidence: clamp(memReport.confidence * 0.55 + dnaReport.confidence * 0.45),
    verdict: `Memory: ${memoryData.similar_setups ?? 0} setups, WR ${((memoryData.win_rate ?? 0.5) * 100).toFixed(0)}% | DNA tradeability ${(dnaReport.score * 100).toFixed(0)}%`,
    data: { memoryScore, winRate: memoryData.win_rate, similarSetups: memoryData.similar_setups, decayDetected: memoryData.decay_detected },
  });

  return { report, output };
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 5: INTELLIGENCE — ML, Reasoning, Risk, Sizing
// Engines: ml_model, reasoning_engine, risk_engine, circuit_breaker
// ════════════════════════════════════════════════════════════════════════════

export function runIntelligenceLayer(
  input: LayerInput,
  l2: StructureOutput,
  l3: ContextOutput,
  l4: MemoryOutput,
): { report: AgentReport; output: IntelligenceOutput } {
  const { symbol } = input;

  // Sub-agent 1: ML Model
  let mlPrediction: any = { probability: 0.5, confidence: 0.3, source: "heuristic" };
  const mlReport = runSubAgent("ml_model", "L5_intelligence", symbol, () => {
    try {
      const _ml = "./ml_model"; const { predictWinProbability } = require(_ml);
      mlPrediction = predictWinProbability({
        structureScore: l2.structureScore,
        orderFlowScore: 0.5,
        recallScore: l4.winRate,
        regime: l2.regimeLabel,
        setupType: "unknown",
        finalQuality: l2.structureScore * 0.5 + l4.winRate * 0.5,
      });
      return {
        score: mlPrediction.probability,
        confidence: mlPrediction.confidence ?? 0.5,
        verdict: `ML: ${(mlPrediction.probability * 100).toFixed(1)}% win prob (${mlPrediction.source})`,
        data: { probability: mlPrediction.probability, confidence: mlPrediction.confidence, source: mlPrediction.source },
      };
    } catch {
      return { score: 0.5, confidence: 0.2, verdict: "ML model unavailable — heuristic fallback", data: { source: "fallback" } };
    }
  });

  // Sub-agent 2: Risk Engine
  let riskSnapshot: any = { withinLimits: true, riskGate: "ALLOW" };
  const riskReport = runSubAgent("risk", "L5_intelligence", symbol, () => {
    try {
      const { getRiskEngineSnapshot } = require("./risk_engine");
      riskSnapshot = getRiskEngineSnapshot();
      const isOk = !riskSnapshot.killSwitchActive && riskSnapshot.withinDailyLimit;
      return {
        score: isOk ? 0.85 : 0.1,
        confidence: 0.9,
        verdict: `Risk: ${isOk ? "WITHIN LIMITS" : "LIMIT BREACH"}${riskSnapshot.killSwitchActive ? " | KILL SWITCH ACTIVE" : ""}`,
        data: { killSwitch: riskSnapshot.killSwitchActive, withinDailyLimit: riskSnapshot.withinDailyLimit, openPositions: riskSnapshot.openPositions, dailyPnl: riskSnapshot.dailyPnl },
        flags: riskSnapshot.killSwitchActive ? [{ level: "critical" as const, code: "KILL_SWITCH", message: "Kill switch is active — all trading blocked" }] : [],
      };
    } catch {
      return { score: 0.5, confidence: 0.3, verdict: "Risk engine unavailable", data: {} };
    }
  });

  // Sub-agent 3: Circuit Breaker
  let breakerStatus: any = { tripped: false };
  const breakerReport = runSubAgent("circuit_breaker", "L5_intelligence", symbol, () => {
    try {
      const { checkCircuitBreaker } = require("./circuit_breaker");
      breakerStatus = checkCircuitBreaker();
      return {
        score: breakerStatus.tripped ? 0.0 : 0.9,
        confidence: 0.95,
        verdict: breakerStatus.tripped ? `BREAKER TRIPPED: ${breakerStatus.reason}` : "Circuit breaker OK",
        data: { tripped: breakerStatus.tripped, reason: breakerStatus.reason },
        flags: breakerStatus.tripped ? [{ level: "critical" as const, code: "CIRCUIT_BREAKER", message: `Breaker tripped: ${breakerStatus.reason}` }] : [],
      };
    } catch {
      return { score: 0.8, confidence: 0.3, verdict: "Circuit breaker unavailable", data: {} };
    }
  });

  // Determine risk gate
  const criticalFlags = [mlReport, riskReport, breakerReport].flatMap((r) => r.flags.filter((f) => f.level === "critical"));
  const blocked = criticalFlags.length > 0 || breakerStatus.tripped;
  const riskGate: "ALLOW" | "WATCH" | "REDUCE" | "BLOCK" = blocked ? "BLOCK"
    : mlPrediction.probability < 0.45 ? "REDUCE"
    : mlPrediction.probability < 0.55 ? "WATCH"
    : "ALLOW";

  // Kelly fraction
  const kellyFraction = mlPrediction.probability > 0.5
    ? clamp((mlPrediction.probability - (1 - mlPrediction.probability)) / 1) * 0.25 // quarter-Kelly
    : 0;

  const intelScore = clamp(mlReport.score * 0.45 + riskReport.score * 0.30 + breakerReport.score * 0.25);

  const output: IntelligenceOutput = {
    mlPrediction,
    riskSnapshot,
    circuitBreaker: breakerStatus,
    winProbability: mlPrediction.probability,
    kellyFraction,
    riskGate,
    blocked,
    blockReason: blocked ? criticalFlags.map((f) => f.message).join("; ") : "",
  };

  const report = runLayerAgent("L5_intelligence", symbol, [mlReport, riskReport, breakerReport], {
    score: intelScore,
    confidence: clamp(mlReport.confidence * 0.45 + riskReport.confidence * 0.35 + breakerReport.confidence * 0.20),
    verdict: `Intel: ${(mlPrediction.probability * 100).toFixed(0)}% win | Kelly ${(kellyFraction * 100).toFixed(1)}% | Risk: ${riskGate}${blocked ? " | BLOCKED" : ""}`,
    data: { winProbability: mlPrediction.probability, kellyFraction, riskGate, blocked, blockReason: output.blockReason },
    flags: blocked ? [{ level: "critical" as const, code: "BLOCKED", message: output.blockReason }] : [],
  });

  return { report, output };
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 6: EVOLUTION — Attribution, Decay Detection, Adaptation
// Engines: attribution_engine, setup_memory (decay), market_dna (drift)
// ════════════════════════════════════════════════════════════════════════════

export function runEvolutionLayer(
  input: LayerInput,
  l4: MemoryOutput,
  l5: IntelligenceOutput,
): { report: AgentReport } {
  const { symbol } = input;

  // Sub-agent 1: Attribution
  const attrReport = runSubAgent("attribution", "L6_evolution", symbol, () => {
    try {
      const { generateAttributionReport } = require("./attribution_engine");
      const attribution = generateAttributionReport({ lookbackDays: 30 });
      const gateEffectiveness = attribution?.overallGateValue ?? 0.5;
      return {
        score: gateEffectiveness,
        confidence: attribution?.sampleSize > 20 ? 0.75 : 0.35,
        verdict: `Attribution: gates ${gateEffectiveness > 0.5 ? "adding" : "not adding"} value | ${attribution?.sampleSize ?? 0} samples`,
        data: { gateEffectiveness, sampleSize: attribution?.sampleSize },
      };
    } catch {
      return { score: 0.5, confidence: 0.2, verdict: "Attribution unavailable", data: {} };
    }
  });

  // Sub-agent 2: Decay Detection (from L4 output)
  const decayReport = runSubAgent("memory", "L6_evolution", symbol, () => {
    const decayDetected = l4.decayDetected;
    const winRateTrend = l4.winRate > 0.55 ? "healthy" : l4.winRate > 0.45 ? "marginal" : "degraded";
    return {
      score: decayDetected ? 0.25 : 0.8,
      confidence: l4.similarSetups > 10 ? 0.7 : 0.3,
      verdict: `Performance: ${winRateTrend} (WR ${(l4.winRate * 100).toFixed(0)}%)${decayDetected ? " | DECAY DETECTED" : ""}`,
      data: { winRateTrend, decayDetected, winRate: l4.winRate, profitFactor: l4.profitFactor },
      flags: decayDetected ? [{ level: "warning" as const, code: "DECAY", message: "Setup performance decaying — consider reducing exposure" }] : [],
    };
  });

  // Sub-agent 3: Adaptation recommendations
  const adaptReport = runSubAgent("dna", "L6_evolution", symbol, () => {
    const needsAdaptation = l4.decayDetected || l5.winProbability < 0.45;
    const recommendations: string[] = [];
    if (l4.decayDetected) recommendations.push("Retrain ML model on recent data");
    if (l5.winProbability < 0.45) recommendations.push("Tighten quality thresholds");
    if (l4.profitFactor < 1.0) recommendations.push("Review position sizing");

    return {
      score: needsAdaptation ? 0.4 : 0.85,
      confidence: 0.6,
      verdict: needsAdaptation ? `Adaptation needed: ${recommendations.join(", ")}` : "System performing within parameters",
      data: { needsAdaptation, recommendations },
    };
  });

  const evolScore = clamp(attrReport.score * 0.35 + decayReport.score * 0.35 + adaptReport.score * 0.30);

  const report = runLayerAgent("L6_evolution", symbol, [attrReport, decayReport, adaptReport], {
    score: evolScore,
    confidence: clamp(attrReport.confidence * 0.35 + decayReport.confidence * 0.35 + adaptReport.confidence * 0.30),
    verdict: `Evolution: ${l4.decayDetected ? "DECAY ACTIVE" : "stable"} | Attribution ${(attrReport.score * 100).toFixed(0)}% | ${(evolScore * 100).toFixed(0)}% health`,
    data: { evolScore, decayDetected: l4.decayDetected, gateEffectiveness: attrReport.data.gateEffectiveness },
  });

  return { report };
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 7: BACKTEST — Walk-Forward Quant Backtesting Agent
// Runs the full historical walk-forward engine on demand.
// Produces: metrics, confirmations with timestamps, empirical rulebook.
// Unlike L1-L6 (real-time cycle), L7 is triggered explicitly or on schedule.
// ════════════════════════════════════════════════════════════════════════════

export interface BacktestOutput {
  winRate: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownR: number;
  totalTrades: number;
  confirmationCount: number;
  rulebook: Array<{ rule: string; evidence: number; impact: number; reliability: number }>;
  bestRegime: string;
  worstRegime: string;
  mtfAlignedWR: number;
  mtfDivergentWR: number;
  latencyMs: number;
}

export async function runBacktestLayer(
  input: LayerInput,
  lookbackBars = 2000,
): Promise<{ report: AgentReport; output: BacktestOutput }> {
  const { symbol, bars1m } = input;
  const start = Date.now();

  brainEventBus.agentStart("L7_backtest", symbol);

  const defaultOutput: BacktestOutput = {
    winRate: 0.5, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
    profitFactor: 1, expectancy: 0, maxDrawdownR: 0,
    totalTrades: 0, confirmationCount: 0,
    rulebook: [],
    bestRegime: "unknown", worstRegime: "unknown",
    mtfAlignedWR: 0.5, mtfDivergentWR: 0.5,
    latencyMs: 0,
  };

  try {
    const { runBacktest } = require("./backtest_engine");

    const barsForBacktest = bars1m.slice(-Math.min(lookbackBars, bars1m.length));

    const result = await Promise.resolve(
      runBacktest({ symbol, bars: barsForBacktest, minConfirmationScore: 0.55 })
    );

    const metrics = result.metrics;
    const regimes = Object.entries(metrics.winRateByRegime ?? {}) as [string, number][];
    const bestEntry = regimes.sort((a, b) => b[1] - a[1])[0];
    const worstEntry = regimes.sort((a, b) => a[1] - b[1])[0];

    const output: BacktestOutput = {
      winRate: metrics.winRate ?? 0.5,
      sharpeRatio: metrics.sharpeRatio ?? 0,
      sortinoRatio: metrics.sortinoRatio ?? 0,
      calmarRatio: metrics.calmarRatio ?? 0,
      profitFactor: metrics.profitFactor ?? 1,
      expectancy: metrics.expectancy ?? 0,
      maxDrawdownR: metrics.maxDrawdownR ?? 0,
      totalTrades: result.outcomes?.length ?? 0,
      confirmationCount: result.confirmations?.length ?? 0,
      rulebook: (metrics.rulebook ?? []).slice(0, 10),
      bestRegime: bestEntry?.[0] ?? "unknown",
      worstRegime: worstEntry?.[0] ?? "unknown",
      mtfAlignedWR: metrics.mtfAlignedWR ?? 0.5,
      mtfDivergentWR: metrics.mtfDivergentWR ?? 0.5,
      latencyMs: Date.now() - start,
    };

    // Scores: Sharpe > 1.5 = excellent, WR > 60% = great, Calmar > 1 = solid
    const sharpeScore = clamp(output.sharpeRatio / 3);
    const wrScore = clamp((output.winRate - 0.4) / 0.4);
    const calmarScore = clamp(output.calmarRatio / 2);
    const score = clamp(sharpeScore * 0.4 + wrScore * 0.35 + calmarScore * 0.25);

    const verdict = [
      `WR: ${(output.winRate * 100).toFixed(1)}%`,
      `Sharpe: ${output.sharpeRatio.toFixed(2)}`,
      `Calmar: ${output.calmarRatio.toFixed(2)}`,
      `${output.totalTrades} trades`,
      output.rulebook.length > 0 ? `${output.rulebook.length} rules` : "no rules yet",
    ].join(" | ");

    const flags: AgentFlag[] = [];
    if (output.sharpeRatio < 0.5 && output.totalTrades > 10) {
      flags.push({ level: "warning", code: "LOW_SHARPE", message: `Sharpe ${output.sharpeRatio.toFixed(2)} below 0.5 — review setup quality` });
    }
    if (output.winRate < 0.35 && output.totalTrades > 10) {
      flags.push({ level: "critical", code: "LOW_WIN_RATE", message: `Win rate ${(output.winRate * 100).toFixed(0)}% very low` });
    }
    if (output.maxDrawdownR > 5) {
      flags.push({ level: "warning", code: "HIGH_DRAWDOWN", message: `Max drawdown ${output.maxDrawdownR.toFixed(1)}R — reduce size` });
    }

    const report = runLayerAgent("L7_backtest", symbol, [], {
      score,
      confidence: clamp(output.totalTrades / 100), // confidence grows with sample size
      verdict: `[L7 Backtest] ${verdict}`,
      data: output as unknown as Record<string, unknown>,
      flags,
    });

    brainEventBus.agentReport(report);
    brainEventBus.backtestComplete(symbol, output as unknown as Record<string, unknown>);

    return { report, output };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const report = runLayerAgent("L7_backtest", symbol, [], {
      score: 0.5,
      confidence: 0,
      verdict: `[L7 Backtest] Error: ${errorMsg}`,
      data: { error: errorMsg },
      flags: [{ level: "warning", code: "BACKTEST_ERROR", message: errorMsg }],
    });
    brainEventBus.agentReport(report);
    return { report, output: { ...defaultOutput, latencyMs: Date.now() - start } };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LAYER 8: CHART PLOT — Annotated Setup Snapshot Agent
// Triggered after L7 produces confirmations.
// Generates an annotated SVG chart for each high-quality confirmation.
// Stores the visual "memory" of what the brain saw at each decision point.
// ════════════════════════════════════════════════════════════════════════════

export interface ChartPlotOutput {
  snapshotsGenerated: number;
  topConfirmationId: string;
  topConfirmationScore: number;
  topSnapshotSvg: string;         // SVG of the highest-quality setup
  allSnapshotIds: string[];        // All confirmation IDs with charts
  latencyMs: number;
}

export async function runChartPlotLayer(
  input: LayerInput,
  confirmations: Array<{ id: string; barIndex: number; confirmationScore: number; direction: "long" | "short"; [key: string]: unknown }>,
): Promise<{ report: AgentReport; output: ChartPlotOutput }> {
  const { symbol, bars1m } = input;
  const start = Date.now();

  brainEventBus.agentStart("L8_chartplot", symbol);

  const defaultOutput: ChartPlotOutput = {
    snapshotsGenerated: 0,
    topConfirmationId: "",
    topConfirmationScore: 0,
    topSnapshotSvg: "",
    allSnapshotIds: [],
    latencyMs: 0,
  };

  if (!confirmations || confirmations.length === 0) {
    const report = runLayerAgent("L8_chartplot", symbol, [], {
      score: 0.5,
      confidence: 0.1,
      verdict: "[L8 ChartPlot] No confirmations to chart",
      data: defaultOutput as unknown as Record<string, unknown>,
    });
    brainEventBus.agentReport(report);
    return { report, output: defaultOutput };
  }

  try {
    const { generateChartBatch } = require("./chart_engine");

    // Cast to SetupConfirmation shape — backtest_engine provides this
    const result = generateChartBatch(confirmations, bars1m, symbol, 20);

    const snapshots = result.snapshots ?? [];
    const top = snapshots[0];

    const output: ChartPlotOutput = {
      snapshotsGenerated: snapshots.length,
      topConfirmationId: top?.confirmationId ?? "",
      topConfirmationScore: top?.confirmationScore ?? 0,
      topSnapshotSvg: top?.svgChart ?? "",
      allSnapshotIds: snapshots.map((s: { confirmationId: string }) => s.confirmationId),
      latencyMs: Date.now() - start,
    };

    // Publish each snapshot to the event bus
    for (const snap of snapshots) {
      brainEventBus.chartSnapshot(symbol, snap.confirmationId, {
        direction: snap.direction,
        regime: snap.regime,
        score: snap.confirmationScore,
        svgSize: snap.svgChart?.length ?? 0,
      });
    }

    const score = clamp(snapshots.length / Math.max(1, confirmations.length));

    const report = runLayerAgent("L8_chartplot", symbol, [], {
      score,
      confidence: snapshots.length > 0 ? 0.9 : 0.1,
      verdict: `[L8 ChartPlot] ${snapshots.length} snapshots | Top: ${(output.topConfirmationScore * 100).toFixed(0)}% score`,
      data: {
        snapshotsGenerated: output.snapshotsGenerated,
        topConfirmationId: output.topConfirmationId,
        topConfirmationScore: output.topConfirmationScore,
        allSnapshotIds: output.allSnapshotIds,
        latencyMs: output.latencyMs,
      },
    });

    brainEventBus.agentReport(report);

    return { report, output };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const report = runLayerAgent("L8_chartplot", symbol, [], {
      score: 0.5,
      confidence: 0,
      verdict: `[L8 ChartPlot] Error: ${errorMsg}`,
      data: { error: errorMsg },
      flags: [{ level: "warning", code: "CHART_ERROR", message: errorMsg }],
    });
    brainEventBus.agentReport(report);
    return { report, output: { ...defaultOutput, latencyMs: Date.now() - start } };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}
