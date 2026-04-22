/**
 * adaptive_learning_engine.ts — Adaptive Strategy Learning Lifecycle
 *
 * Provides institutional-grade strategy lifecycle management:
 * 1. Champion/Challenger comparison — incumbent vs candidate strategies
 * 2. Retrain triggers — detect decay and trigger adaptation
 * 3. Post-trade attribution — explain why trades won or lost
 * 4. Regime memory — track performance by market regime
 * 5. Strategy retirement — auto-disable degraded strategies
 *
 * Env:
 *   ADAPTIVE_LEARNING_ENABLED           — master switch (default true)
 *   ADAPTIVE_LEARNING_MIN_TRADES        — min trades for comparison (default 30)
 *   ADAPTIVE_LEARNING_DECAY_THRESHOLD   — Sharpe decay % to trigger retrain (default 0.30)
 *   ADAPTIVE_LEARNING_RETIRE_THRESHOLD  — win rate below which to retire (default 0.35)
 */

import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyPerformanceRecord {
  strategyId: string;
  version: number;
  regime: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  lastTradeAt: string;
  updatedAt: string;
}

export interface ChampionChallengerResult {
  championId: string;
  challengerId: string;
  regime: string;
  champion: StrategyPerformanceRecord;
  challenger: StrategyPerformanceRecord;
  verdict: "CHAMPION_WINS" | "CHALLENGER_WINS" | "INCONCLUSIVE";
  confidence: number;
  reasons: string[];
  evaluatedAt: string;
}

export interface RetrainTrigger {
  strategyId: string;
  triggerType: "SHARPE_DECAY" | "WIN_RATE_DROP" | "REGIME_SHIFT" | "DRAWDOWN_BREACH" | "STALE_MODEL";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  currentValue: number;
  threshold: number;
  message: string;
  triggeredAt: string;
}

export interface PostTradeAttribution {
  tradeId: string;
  strategyId: string;
  symbol: string;
  direction: "long" | "short";
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  pnl: number;
  entryQuality: number;
  exitQuality: number;
  timingScore: number;
  regimeAlignment: number;
  contextAlignment: number;
  factors: AttributionFactor[];
  summary: string;
  attributedAt: string;
}

export interface AttributionFactor {
  name: string;
  impact: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  weight: number;
  description: string;
}

export interface RegimePerformanceEntry {
  regime: string;
  trades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  avgPnl: number;
}

export interface AdaptiveLearningSnapshot {
  enabled: boolean;
  strategies: Map<string, StrategyPerformanceRecord[]> | Record<string, StrategyPerformanceRecord[]>;
  recentTriggers: RetrainTrigger[];
  recentAttributions: PostTradeAttribution[];
  challengerResults: ChampionChallengerResult[];
  retirementCandidates: string[];
  totalTradesAttributed: number;
  totalRetrainTriggersRaised: number;
  lastEvaluatedAt: string | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ENABLED = (process.env.ADAPTIVE_LEARNING_ENABLED ?? "true") !== "false";
const MIN_TRADES = parseInt(process.env.ADAPTIVE_LEARNING_MIN_TRADES ?? "30", 10);
const DECAY_THRESHOLD = parseFloat(process.env.ADAPTIVE_LEARNING_DECAY_THRESHOLD ?? "0.30");
const RETIRE_THRESHOLD = parseFloat(process.env.ADAPTIVE_LEARNING_RETIRE_THRESHOLD ?? "0.35");

// ─── State ────────────────────────────────────────────────────────────────────

const strategyRecords = new Map<string, StrategyPerformanceRecord[]>();
const recentTriggers: RetrainTrigger[] = [];
const recentAttributions: PostTradeAttribution[] = [];
const challengerResults: ChampionChallengerResult[] = [];
let totalTradesAttributed = 0;
let totalRetrainTriggersRaised = 0;
let lastEvaluatedAt: string | null = null;

const MAX_TRIGGERS = 100;
const MAX_ATTRIBUTIONS = 200;
const MAX_CHALLENGER_RESULTS = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ─── Record Strategy Performance ──────────────────────────────────────────────

export function recordStrategyPerformance(record: StrategyPerformanceRecord): void {
  if (!ENABLED) return;
  const existing = strategyRecords.get(record.strategyId) ?? [];
  // Update or add regime-specific record
  const idx = existing.findIndex(r => r.regime === record.regime && r.version === record.version);
  if (idx >= 0) {
    existing[idx] = record;
  } else {
    existing.push(record);
  }
  strategyRecords.set(record.strategyId, existing);
}

// ─── Champion/Challenger Comparison ───────────────────────────────────────────

export function compareStrategies(
  championId: string,
  challengerId: string,
  regime: string = "ALL",
): ChampionChallengerResult {
  const champRecords = (strategyRecords.get(championId) ?? []).filter(
    r => regime === "ALL" || r.regime === regime,
  );
  const challRecords = (strategyRecords.get(challengerId) ?? []).filter(
    r => regime === "ALL" || r.regime === regime,
  );

  const champAgg = aggregateRecords(champRecords);
  const challAgg = aggregateRecords(challRecords);
  const reasons: string[] = [];

  let champScore = 0;
  let challScore = 0;

  // Compare Sharpe
  if (champAgg.sharpeRatio > challAgg.sharpeRatio + 0.1) {
    champScore += 2;
    reasons.push(`Champion Sharpe ${champAgg.sharpeRatio.toFixed(2)} > Challenger ${challAgg.sharpeRatio.toFixed(2)}`);
  } else if (challAgg.sharpeRatio > champAgg.sharpeRatio + 0.1) {
    challScore += 2;
    reasons.push(`Challenger Sharpe ${challAgg.sharpeRatio.toFixed(2)} > Champion ${champAgg.sharpeRatio.toFixed(2)}`);
  }

  // Compare win rate
  if (champAgg.winRate > challAgg.winRate + 0.03) {
    champScore += 1;
    reasons.push(`Champion win rate ${(champAgg.winRate * 100).toFixed(1)}% > Challenger ${(challAgg.winRate * 100).toFixed(1)}%`);
  } else if (challAgg.winRate > champAgg.winRate + 0.03) {
    challScore += 1;
    reasons.push(`Challenger win rate ${(challAgg.winRate * 100).toFixed(1)}% > Champion ${(champAgg.winRate * 100).toFixed(1)}%`);
  }

  // Compare profit factor
  if (champAgg.profitFactor > challAgg.profitFactor + 0.1) {
    champScore += 1;
    reasons.push(`Champion PF ${champAgg.profitFactor.toFixed(2)} > Challenger ${challAgg.profitFactor.toFixed(2)}`);
  } else if (challAgg.profitFactor > champAgg.profitFactor + 0.1) {
    challScore += 1;
    reasons.push(`Challenger PF ${challAgg.profitFactor.toFixed(2)} > Champion ${champAgg.profitFactor.toFixed(2)}`);
  }

  // Compare max drawdown (lower is better)
  if (champAgg.maxDrawdownPct < challAgg.maxDrawdownPct - 2) {
    champScore += 1;
    reasons.push(`Champion DD ${champAgg.maxDrawdownPct.toFixed(1)}% < Challenger ${challAgg.maxDrawdownPct.toFixed(1)}%`);
  } else if (challAgg.maxDrawdownPct < champAgg.maxDrawdownPct - 2) {
    challScore += 1;
    reasons.push(`Challenger DD ${challAgg.maxDrawdownPct.toFixed(1)}% < Champion ${champAgg.maxDrawdownPct.toFixed(1)}%`);
  }

  const minTrades = Math.min(champAgg.totalTrades, challAgg.totalTrades);
  let verdict: ChampionChallengerResult["verdict"] = "INCONCLUSIVE";
  let confidence = 0;

  if (minTrades < MIN_TRADES) {
    reasons.push(`Insufficient trades (${minTrades} < ${MIN_TRADES})`);
    confidence = 0.2;
  } else if (champScore > challScore + 1) {
    verdict = "CHAMPION_WINS";
    confidence = clamp(0.5 + (champScore - challScore) * 0.1, 0.5, 0.95);
  } else if (challScore > champScore + 1) {
    verdict = "CHALLENGER_WINS";
    confidence = clamp(0.5 + (challScore - champScore) * 0.1, 0.5, 0.95);
  } else {
    confidence = 0.4;
  }

  const result: ChampionChallengerResult = {
    championId,
    challengerId,
    regime,
    champion: champAgg,
    challenger: challAgg,
    verdict,
    confidence,
    reasons,
    evaluatedAt: new Date().toISOString(),
  };

  challengerResults.unshift(result);
  if (challengerResults.length > MAX_CHALLENGER_RESULTS) challengerResults.pop();
  lastEvaluatedAt = result.evaluatedAt;

  logger.info({
    championId, challengerId, regime, verdict, confidence: confidence.toFixed(2),
  }, "Champion/Challenger comparison");

  return result;
}

function aggregateRecords(records: StrategyPerformanceRecord[]): StrategyPerformanceRecord {
  if (records.length === 0) {
    return {
      strategyId: "", version: 0, regime: "ALL", totalTrades: 0,
      winRate: 0, profitFactor: 0, sharpeRatio: 0, maxDrawdownPct: 0,
      expectancy: 0, avgWin: 0, avgLoss: 0,
      lastTradeAt: "", updatedAt: new Date().toISOString(),
    };
  }

  const total = records.reduce((s, r) => s + r.totalTrades, 0);
  if (total === 0) return { ...records[0], totalTrades: 0 };

  return {
    strategyId: records[0].strategyId,
    version: records[0].version,
    regime: "ALL",
    totalTrades: total,
    winRate: records.reduce((s, r) => s + r.winRate * r.totalTrades, 0) / total,
    profitFactor: records.reduce((s, r) => s + r.profitFactor * r.totalTrades, 0) / total,
    sharpeRatio: records.reduce((s, r) => s + r.sharpeRatio * r.totalTrades, 0) / total,
    maxDrawdownPct: Math.max(...records.map(r => r.maxDrawdownPct)),
    expectancy: records.reduce((s, r) => s + r.expectancy * r.totalTrades, 0) / total,
    avgWin: records.reduce((s, r) => s + r.avgWin * r.totalTrades, 0) / total,
    avgLoss: records.reduce((s, r) => s + r.avgLoss * r.totalTrades, 0) / total,
    lastTradeAt: records.sort((a, b) => b.lastTradeAt.localeCompare(a.lastTradeAt))[0].lastTradeAt,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Retrain Trigger Detection ────────────────────────────────────────────────

export function evaluateRetrainTriggers(strategyId: string, baseline?: StrategyPerformanceRecord): RetrainTrigger[] {
  if (!ENABLED) return [];

  const records = strategyRecords.get(strategyId) ?? [];
  const current = aggregateRecords(records);
  const triggers: RetrainTrigger[] = [];

  if (current.totalTrades < 10) return triggers;

  // Sharpe decay
  if (baseline && baseline.sharpeRatio > 0) {
    const decay = 1 - (current.sharpeRatio / baseline.sharpeRatio);
    if (decay > DECAY_THRESHOLD) {
      triggers.push({
        strategyId, triggerType: "SHARPE_DECAY",
        severity: decay > 0.5 ? "CRITICAL" : "HIGH",
        currentValue: current.sharpeRatio, threshold: baseline.sharpeRatio * (1 - DECAY_THRESHOLD),
        message: `Sharpe decayed ${(decay * 100).toFixed(0)}% from baseline ${baseline.sharpeRatio.toFixed(2)}`,
        triggeredAt: new Date().toISOString(),
      });
    }
  }

  // Win rate drop
  if (current.winRate < RETIRE_THRESHOLD) {
    triggers.push({
      strategyId, triggerType: "WIN_RATE_DROP",
      severity: current.winRate < 0.25 ? "CRITICAL" : "HIGH",
      currentValue: current.winRate, threshold: RETIRE_THRESHOLD,
      message: `Win rate ${(current.winRate * 100).toFixed(1)}% below retirement threshold ${(RETIRE_THRESHOLD * 100).toFixed(0)}%`,
      triggeredAt: new Date().toISOString(),
    });
  }

  // Max drawdown breach
  if (current.maxDrawdownPct > 15) {
    triggers.push({
      strategyId, triggerType: "DRAWDOWN_BREACH",
      severity: current.maxDrawdownPct > 25 ? "CRITICAL" : "MEDIUM",
      currentValue: current.maxDrawdownPct, threshold: 15,
      message: `Max drawdown ${current.maxDrawdownPct.toFixed(1)}% exceeds 15% threshold`,
      triggeredAt: new Date().toISOString(),
    });
  }

  // Stale model
  if (current.lastTradeAt) {
    const staleMs = Date.now() - new Date(current.lastTradeAt).getTime();
    const staleDays = staleMs / (1000 * 60 * 60 * 24);
    if (staleDays > 14) {
      triggers.push({
        strategyId, triggerType: "STALE_MODEL",
        severity: staleDays > 30 ? "HIGH" : "LOW",
        currentValue: staleDays, threshold: 14,
        message: `No trades for ${Math.round(staleDays)} days — model may be stale`,
        triggeredAt: new Date().toISOString(),
      });
    }
  }

  for (const t of triggers) {
    recentTriggers.unshift(t);
    totalRetrainTriggersRaised++;
  }
  while (recentTriggers.length > MAX_TRIGGERS) recentTriggers.pop();

  if (triggers.length > 0) {
    logger.info({ strategyId, count: triggers.length, types: triggers.map(t => t.triggerType) }, "Retrain triggers raised");
  }

  return triggers;
}

// ─── Post-Trade Attribution ───────────────────────────────────────────────────

export function attributeTrade(params: {
  tradeId: string;
  strategyId: string;
  symbol: string;
  direction: "long" | "short";
  pnl: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: string;
  exitTime: string;
  regime: string;
  structureScore?: number;
  orderFlowScore?: number;
  contextFusionScore?: number;
  macroBiasAligned?: boolean;
  sentimentAligned?: boolean;
}): PostTradeAttribution {
  const {
    tradeId, strategyId, symbol, direction, pnl,
    entryPrice, exitPrice, regime,
    structureScore = 0.5, orderFlowScore = 0.5, contextFusionScore = 0.5,
    macroBiasAligned = true, sentimentAligned = true,
  } = params;

  const outcome: PostTradeAttribution["outcome"] =
    pnl > 0.01 ? "WIN" : pnl < -0.01 ? "LOSS" : "BREAKEVEN";

  const factors: AttributionFactor[] = [];

  // Entry quality
  const entryQuality = clamp((structureScore + orderFlowScore) / 2, 0, 1);
  factors.push({
    name: "entry_quality",
    impact: entryQuality > 0.6 ? "POSITIVE" : entryQuality < 0.4 ? "NEGATIVE" : "NEUTRAL",
    weight: 0.25,
    description: `Entry quality ${(entryQuality * 100).toFixed(0)}% (structure+orderflow)`,
  });

  // Exit quality
  const priceMove = direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice;
  const exitQuality = clamp(pnl > 0 ? 0.7 : 0.3, 0, 1);
  factors.push({
    name: "exit_quality",
    impact: pnl > 0 ? "POSITIVE" : "NEGATIVE",
    weight: 0.20,
    description: `Exit ${pnl > 0 ? "captured" : "missed"} ${Math.abs(priceMove).toFixed(2)} move`,
  });

  // Timing
  const timingScore = clamp(contextFusionScore, 0, 1);
  factors.push({
    name: "timing",
    impact: timingScore > 0.6 ? "POSITIVE" : timingScore < 0.4 ? "NEGATIVE" : "NEUTRAL",
    weight: 0.20,
    description: `Context fusion timing score ${(timingScore * 100).toFixed(0)}%`,
  });

  // Regime alignment
  const regimeAlignment = clamp(
    ["TRENDING", "HIGH_MOMENTUM", "BREAKOUT", "UPTREND"].includes(regime.toUpperCase()) ? 0.85 :
    ["CHOPPY", "UNCERTAIN", "VOLATILE"].includes(regime.toUpperCase()) ? 0.30 : 0.55,
    0, 1,
  );
  factors.push({
    name: "regime_alignment",
    impact: regimeAlignment > 0.6 ? "POSITIVE" : regimeAlignment < 0.4 ? "NEGATIVE" : "NEUTRAL",
    weight: 0.20,
    description: `Regime ${regime} alignment ${(regimeAlignment * 100).toFixed(0)}%`,
  });

  // Context alignment
  const contextAlignment = (macroBiasAligned ? 0.6 : 0.3) + (sentimentAligned ? 0.3 : 0.1);
  factors.push({
    name: "context_alignment",
    impact: contextAlignment > 0.6 ? "POSITIVE" : "NEGATIVE",
    weight: 0.15,
    description: `Macro ${macroBiasAligned ? "aligned" : "headwind"}, Sentiment ${sentimentAligned ? "aligned" : "contrarian"}`,
  });

  const summaryParts = factors
    .filter(f => f.impact !== "NEUTRAL")
    .map(f => `${f.impact === "POSITIVE" ? "+" : "-"} ${f.name}: ${f.description}`);

  const attribution: PostTradeAttribution = {
    tradeId,
    strategyId,
    symbol,
    direction,
    outcome,
    pnl,
    entryQuality,
    exitQuality,
    timingScore,
    regimeAlignment,
    contextAlignment,
    factors,
    summary: `${outcome} trade: ${summaryParts.join("; ")}`,
    attributedAt: new Date().toISOString(),
  };

  recentAttributions.unshift(attribution);
  totalTradesAttributed++;
  while (recentAttributions.length > MAX_ATTRIBUTIONS) recentAttributions.pop();

  logger.info({ tradeId, strategyId, symbol, outcome, pnl: pnl.toFixed(2) }, "Post-trade attribution");

  return attribution;
}

// ─── Regime Performance ───────────────────────────────────────────────────────

export function getRegimePerformance(strategyId: string): RegimePerformanceEntry[] {
  const records = strategyRecords.get(strategyId) ?? [];
  return records.map(r => ({
    regime: r.regime,
    trades: r.totalTrades,
    winRate: r.winRate,
    profitFactor: r.profitFactor,
    sharpeRatio: r.sharpeRatio,
    avgPnl: r.expectancy,
  }));
}

// ─── Retirement Candidates ────────────────────────────────────────────────────

export function getRetirementCandidates(): string[] {
  const candidates: string[] = [];
  for (const [id, records] of strategyRecords.entries()) {
    const agg = aggregateRecords(records);
    if (agg.totalTrades >= MIN_TRADES && agg.winRate < RETIRE_THRESHOLD) {
      candidates.push(id);
    }
  }
  return candidates;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export function getAdaptiveLearningSnapshot(): AdaptiveLearningSnapshot {
  const strats: Record<string, StrategyPerformanceRecord[]> = {};
  for (const [k, v] of strategyRecords.entries()) {
    strats[k] = v;
  }
  return {
    enabled: ENABLED,
    strategies: strats,
    recentTriggers: recentTriggers.slice(0, 20),
    recentAttributions: recentAttributions.slice(0, 20),
    challengerResults: challengerResults.slice(0, 10),
    retirementCandidates: getRetirementCandidates(),
    totalTradesAttributed,
    totalRetrainTriggersRaised,
    lastEvaluatedAt,
  };
}

export function resetAdaptiveLearning(): void {
  strategyRecords.clear();
  recentTriggers.length = 0;
  recentAttributions.length = 0;
  challengerResults.length = 0;
  totalTradesAttributed = 0;
  totalRetrainTriggersRaised = 0;
  lastEvaluatedAt = null;
  logger.info("Adaptive learning state reset");
}
