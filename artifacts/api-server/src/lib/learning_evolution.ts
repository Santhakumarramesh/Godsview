/**
 * learning_evolution.ts — Phase 6: Self-Evolving Learning System
 *
 * GodsView continuously learns from its own decisions:
 *   - Post-trade outcome feedback loops
 *   - Strategy performance drift detection
 *   - Automatic parameter refinement suggestions
 *   - Pattern discovery from trade history
 *   - Confidence calibration (predicted vs actual outcomes)
 *   - Model performance tracking and demotion
 *
 * This is the "brain that gets smarter" layer.
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "learning-evolution" });

// ── Types ────────────────────────────────────────────────────────────────────

export interface TradeOutcome {
  tradeId: string;
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  holdDuration_ms: number;
  predictedConfidence: number;
  actualOutcome: "win" | "loss" | "breakeven";
  regime: string;
  timestamp: string;
}

export interface LearningInsight {
  id: string;
  type: "pattern" | "drift" | "calibration" | "refinement" | "anomaly";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  affectedStrategy?: string;
  affectedSymbol?: string;
  suggestedAction: string;
  confidence: number;
  timestamp: string;
}

export interface ConfidenceCalibration {
  bucket: string;       // e.g. "70-80%"
  predictedAvg: number; // avg predicted confidence
  actualWinRate: number; // actual win rate
  sampleSize: number;
  calibrationError: number; // |predicted - actual|
}

export interface StrategyDrift {
  strategyId: string;
  metric: string;
  baselineValue: number;
  currentValue: number;
  driftPercent: number;
  direction: "improving" | "degrading" | "stable";
  significance: "low" | "medium" | "high";
}

export interface EvolutionCycle {
  id: string;
  cycleNumber: number;
  startedAt: string;
  completedAt?: string;
  outcomesProcessed: number;
  insightsGenerated: number;
  driftsDetected: number;
  refinementsProposed: number;
  status: "running" | "complete" | "failed";
}

// ── Storage ──────────────────────────────────────────────────────────────────

const MAX_OUTCOMES = 1000;
const MAX_INSIGHTS = 200;
const MAX_CYCLES = 50;
const _outcomes: TradeOutcome[] = [];
const _insights: LearningInsight[] = [];
const _cycles: EvolutionCycle[] = [];
let _cycleCounter = 0;

// ── Feedback Ingestion ───────────────────────────────────────────────────────

export function recordOutcome(outcome: TradeOutcome): TradeOutcome {
  _outcomes.push(outcome);
  if (_outcomes.length > MAX_OUTCOMES) _outcomes.splice(0, _outcomes.length - MAX_OUTCOMES);

  logger.info(
    { tradeId: outcome.tradeId, result: outcome.actualOutcome, pnl: outcome.pnl },
    `[learning] Outcome recorded: ${outcome.actualOutcome}`,
  );

  // Auto-trigger analysis every 10 outcomes
  if (_outcomes.length % 10 === 0) {
    runEvolutionCycle();
  }

  return outcome;
}

// ── Confidence Calibration ───────────────────────────────────────────────────

export function computeCalibration(): ConfidenceCalibration[] {
  const buckets: Record<string, { predicted: number[]; wins: number; total: number }> = {};

  for (const o of _outcomes) {
    const bucketKey = `${Math.floor(o.predictedConfidence / 10) * 10}-${Math.floor(o.predictedConfidence / 10) * 10 + 10}%`;
    if (!buckets[bucketKey]) buckets[bucketKey] = { predicted: [], wins: 0, total: 0 };
    buckets[bucketKey].predicted.push(o.predictedConfidence);
    buckets[bucketKey].total++;
    if (o.actualOutcome === "win") buckets[bucketKey].wins++;
  }

  return Object.entries(buckets).map(([bucket, data]) => {
    const predictedAvg = data.predicted.reduce((s, v) => s + v, 0) / data.predicted.length;
    const actualWinRate = data.total > 0 ? (data.wins / data.total) * 100 : 0;
    return {
      bucket,
      predictedAvg: Math.round(predictedAvg * 100) / 100,
      actualWinRate: Math.round(actualWinRate * 100) / 100,
      sampleSize: data.total,
      calibrationError: Math.round(Math.abs(predictedAvg - actualWinRate) * 100) / 100,
    };
  }).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// ── Strategy Drift Detection ─────────────────────────────────────────────────

export function detectDrift(): StrategyDrift[] {
  const strategies = new Map<string, TradeOutcome[]>();
  for (const o of _outcomes) {
    if (!strategies.has(o.strategy)) strategies.set(o.strategy, []);
    strategies.get(o.strategy)!.push(o);
  }

  const drifts: StrategyDrift[] = [];

  for (const [stratId, trades] of strategies) {
    if (trades.length < 10) continue;

    const mid = Math.floor(trades.length / 2);
    const first = trades.slice(0, mid);
    const second = trades.slice(mid);

    // Win rate drift
    const firstWR = first.filter((t) => t.actualOutcome === "win").length / first.length;
    const secondWR = second.filter((t) => t.actualOutcome === "win").length / second.length;
    const wrDrift = secondWR - firstWR;
    const wrDriftPct = firstWR > 0 ? (wrDrift / firstWR) * 100 : 0;

    drifts.push({
      strategyId: stratId,
      metric: "win_rate",
      baselineValue: Math.round(firstWR * 10000) / 100,
      currentValue: Math.round(secondWR * 10000) / 100,
      driftPercent: Math.round(wrDriftPct * 100) / 100,
      direction: wrDrift > 0.02 ? "improving" : wrDrift < -0.02 ? "degrading" : "stable",
      significance: Math.abs(wrDriftPct) > 20 ? "high" : Math.abs(wrDriftPct) > 10 ? "medium" : "low",
    });

    // PnL drift
    const firstPnl = first.reduce((s, t) => s + t.pnl, 0) / first.length;
    const secondPnl = second.reduce((s, t) => s + t.pnl, 0) / second.length;
    const pnlDrift = firstPnl !== 0 ? ((secondPnl - firstPnl) / Math.abs(firstPnl)) * 100 : 0;

    drifts.push({
      strategyId: stratId,
      metric: "avg_pnl",
      baselineValue: Math.round(firstPnl * 100) / 100,
      currentValue: Math.round(secondPnl * 100) / 100,
      driftPercent: Math.round(pnlDrift * 100) / 100,
      direction: pnlDrift > 5 ? "improving" : pnlDrift < -5 ? "degrading" : "stable",
      significance: Math.abs(pnlDrift) > 30 ? "high" : Math.abs(pnlDrift) > 15 ? "medium" : "low",
    });
  }

  return drifts;
}

// ── Pattern Discovery ────────────────────────────────────────────────────────

function discoverPatterns(): LearningInsight[] {
  const insights: LearningInsight[] = [];
  if (_outcomes.length < 5) return insights;

  // Pattern 1: Time-of-day performance
  const hourBuckets: Record<number, { wins: number; total: number }> = {};
  for (const o of _outcomes) {
    const h = new Date(o.timestamp).getHours();
    if (!hourBuckets[h]) hourBuckets[h] = { wins: 0, total: 0 };
    hourBuckets[h].total++;
    if (o.actualOutcome === "win") hourBuckets[h].wins++;
  }

  for (const [hour, data] of Object.entries(hourBuckets)) {
    if (data.total >= 5) {
      const wr = data.wins / data.total;
      if (wr < 0.3) {
        insights.push({
          id: `pat-hour-${hour}-${Date.now()}`,
          type: "pattern",
          severity: "warning",
          title: `Poor performance at hour ${hour}`,
          description: `Win rate of ${Math.round(wr * 100)}% during hour ${hour} (${data.total} trades)`,
          suggestedAction: `Consider filtering out trades during hour ${hour}`,
          confidence: Math.min(90, 50 + data.total * 5),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Pattern 2: Regime performance
  const regimeBuckets: Record<string, { wins: number; total: number; pnl: number }> = {};
  for (const o of _outcomes) {
    if (!regimeBuckets[o.regime]) regimeBuckets[o.regime] = { wins: 0, total: 0, pnl: 0 };
    regimeBuckets[o.regime].total++;
    regimeBuckets[o.regime].pnl += o.pnl;
    if (o.actualOutcome === "win") regimeBuckets[o.regime].wins++;
  }

  for (const [regime, data] of Object.entries(regimeBuckets)) {
    if (data.total >= 5 && data.pnl < 0) {
      insights.push({
        id: `pat-regime-${regime}-${Date.now()}`,
        type: "pattern",
        severity: "warning",
        title: `Negative edge in ${regime} regime`,
        description: `Net PnL of ${Math.round(data.pnl)} across ${data.total} trades in ${regime} regime`,
        suggestedAction: `Reduce position sizing or disable trading in ${regime} regime`,
        confidence: Math.min(85, 40 + data.total * 4),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Pattern 3: Consecutive losses
  let maxConsecLoss = 0;
  let currentStreak = 0;
  for (const o of _outcomes) {
    if (o.actualOutcome === "loss") { currentStreak++; maxConsecLoss = Math.max(maxConsecLoss, currentStreak); }
    else currentStreak = 0;
  }
  if (maxConsecLoss >= 5) {
    insights.push({
      id: `pat-streak-${Date.now()}`,
      type: "anomaly",
      severity: maxConsecLoss >= 8 ? "critical" : "warning",
      title: `${maxConsecLoss} consecutive losses detected`,
      description: `Maximum losing streak of ${maxConsecLoss} trades observed`,
      suggestedAction: "Review strategy parameters, consider pause and reassess",
      confidence: 90,
      timestamp: new Date().toISOString(),
    });
  }

  return insights;
}

// ── Evolution Cycle ──────────────────────────────────────────────────────────

export function runEvolutionCycle(): EvolutionCycle {
  _cycleCounter++;
  const cycle: EvolutionCycle = {
    id: `evo-${_cycleCounter}-${Date.now()}`,
    cycleNumber: _cycleCounter,
    startedAt: new Date().toISOString(),
    outcomesProcessed: _outcomes.length,
    insightsGenerated: 0,
    driftsDetected: 0,
    refinementsProposed: 0,
    status: "running",
  };

  try {
    // Step 1: Detect drift
    const drifts = detectDrift();
    cycle.driftsDetected = drifts.filter((d) => d.significance !== "low").length;

    // Generate drift insights
    for (const d of drifts) {
      if (d.significance === "high") {
        const insight: LearningInsight = {
          id: `drift-${d.strategyId}-${d.metric}-${Date.now()}`,
          type: "drift",
          severity: d.direction === "degrading" ? "critical" : "info",
          title: `${d.metric} drift: ${d.direction} (${d.driftPercent}%)`,
          description: `Strategy ${d.strategyId} ${d.metric} changed from ${d.baselineValue} to ${d.currentValue}`,
          affectedStrategy: d.strategyId,
          suggestedAction: d.direction === "degrading"
            ? `Demote strategy ${d.strategyId} or reduce allocation`
            : `Consider promoting strategy ${d.strategyId}`,
          confidence: 75,
          timestamp: new Date().toISOString(),
        };
        _insights.push(insight);
        cycle.insightsGenerated++;
      }
    }

    // Step 2: Discover patterns
    const patterns = discoverPatterns();
    for (const p of patterns) {
      _insights.push(p);
      cycle.insightsGenerated++;
    }

    // Step 3: Calibration check
    const calibration = computeCalibration();
    const poorlyCalibrated = calibration.filter((c) => c.calibrationError > 15 && c.sampleSize >= 10);
    for (const c of poorlyCalibrated) {
      _insights.push({
        id: `cal-${c.bucket}-${Date.now()}`,
        type: "calibration",
        severity: c.calibrationError > 25 ? "critical" : "warning",
        title: `Confidence miscalibration in ${c.bucket} bucket`,
        description: `Predicted ${c.predictedAvg}% but actual win rate is ${c.actualWinRate}% (${c.sampleSize} trades)`,
        suggestedAction: "Recalibrate confidence model for this range",
        confidence: Math.min(90, 50 + c.sampleSize * 2),
        timestamp: new Date().toISOString(),
      });
      cycle.insightsGenerated++;
      cycle.refinementsProposed++;
    }

    // Trim insights
    if (_insights.length > MAX_INSIGHTS) _insights.splice(0, _insights.length - MAX_INSIGHTS);

    cycle.status = "complete";
    cycle.completedAt = new Date().toISOString();

    logger.info(
      { cycleId: cycle.id, insights: cycle.insightsGenerated, drifts: cycle.driftsDetected },
      `[learning] Evolution cycle ${_cycleCounter} complete`,
    );
  } catch (err: any) {
    cycle.status = "failed";
    logger.error({ err: err.message }, "[learning] Evolution cycle failed");
  }

  _cycles.push(cycle);
  if (_cycles.length > MAX_CYCLES) _cycles.splice(0, _cycles.length - MAX_CYCLES);

  return cycle;
}

// ── Query Functions ──────────────────────────────────────────────────────────

export function getRecentOutcomes(limit = 50): TradeOutcome[] {
  return _outcomes.slice(-limit).reverse();
}

export function getInsights(limit = 50): LearningInsight[] {
  return _insights.slice(-limit).reverse();
}

export function getInsightsByType(type: LearningInsight["type"]): LearningInsight[] {
  return _insights.filter((i) => i.type === type);
}

export function getCycles(limit = 20): EvolutionCycle[] {
  return _cycles.slice(-limit).reverse();
}

export function getLearningSummary() {
  const outcomes = _outcomes;
  const totalWins = outcomes.filter((o) => o.actualOutcome === "win").length;
  const totalLosses = outcomes.filter((o) => o.actualOutcome === "loss").length;
  const totalPnl = outcomes.reduce((s, o) => s + o.pnl, 0);
  const avgConfidence = outcomes.length > 0
    ? outcomes.reduce((s, o) => s + o.predictedConfidence, 0) / outcomes.length
    : 0;

  const strategies = new Set(outcomes.map((o) => o.strategy));
  const symbols = new Set(outcomes.map((o) => o.symbol));

  const criticalInsights = _insights.filter((i) => i.severity === "critical").length;
  const warningInsights = _insights.filter((i) => i.severity === "warning").length;

  return {
    totalOutcomes: outcomes.length,
    wins: totalWins,
    losses: totalLosses,
    winRate: outcomes.length > 0 ? Math.round((totalWins / outcomes.length) * 10000) / 100 : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    uniqueStrategies: strategies.size,
    uniqueSymbols: symbols.size,
    totalInsights: _insights.length,
    criticalInsights, warningInsights,
    evolutionCycles: _cycles.length,
    lastCycle: _cycles.length > 0 ? _cycles[_cycles.length - 1] : null,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// NEWS / SENTIMENT ENGINE
// ══════════════════════════════════════════════════════════════════════════════

export interface SentimentSignal {
  id: string;
  symbol: string;
  source: "news" | "social" | "macro" | "earnings" | "insider" | "analyst";
  headline: string;
  sentiment: "bullish" | "bearish" | "neutral";
  score: number;          // -100 to 100
  impact: "low" | "medium" | "high" | "critical";
  confidence: number;     // 0 to 100
  category: string;
  timestamp: string;
  expiresAt?: string;
}

export interface SentimentSnapshot {
  symbol: string;
  timestamp: string;
  overallSentiment: "bullish" | "bearish" | "neutral";
  overallScore: number;
  signalCount: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  topSignals: SentimentSignal[];
  momentum: "improving" | "declining" | "stable";
}

const MAX_SIGNALS = 500;
const _sentimentSignals: Map<string, SentimentSignal[]> = new Map();

// Simulated news headlines by symbol category
const NEWS_TEMPLATES: Record<string, Array<{ headline: string; sentiment: "bullish" | "bearish" | "neutral"; impact: "low" | "medium" | "high" | "critical" }>> = {
  crypto: [
    { headline: "Institutional adoption accelerates as major bank launches custody", sentiment: "bullish", impact: "high" },
    { headline: "Regulatory clarity expected from upcoming framework proposal", sentiment: "bullish", impact: "medium" },
    { headline: "Network hash rate reaches all-time high", sentiment: "bullish", impact: "low" },
    { headline: "SEC delays ETF decision to next quarter", sentiment: "bearish", impact: "medium" },
    { headline: "Exchange reports unusual withdrawal spike", sentiment: "bearish", impact: "high" },
    { headline: "DeFi protocol hack causes market jitters", sentiment: "bearish", impact: "critical" },
    { headline: "Trading volume remains steady amid consolidation", sentiment: "neutral", impact: "low" },
  ],
  equity: [
    { headline: "Earnings beat expectations by 15%, guidance raised", sentiment: "bullish", impact: "high" },
    { headline: "New product launch drives pre-order surge", sentiment: "bullish", impact: "medium" },
    { headline: "Analyst upgrades to outperform with higher PT", sentiment: "bullish", impact: "medium" },
    { headline: "Revenue miss triggers after-hours selloff", sentiment: "bearish", impact: "high" },
    { headline: "CFO departure announced, interim replacement named", sentiment: "bearish", impact: "medium" },
    { headline: "Antitrust investigation broadened to new markets", sentiment: "bearish", impact: "critical" },
    { headline: "Company maintains dividend, no changes to buyback", sentiment: "neutral", impact: "low" },
  ],
  macro: [
    { headline: "Fed signals patience on rate cuts, data dependent", sentiment: "neutral", impact: "high" },
    { headline: "Jobs report stronger than expected, unemployment down", sentiment: "bullish", impact: "high" },
    { headline: "CPI comes in below estimates, disinflation trend continues", sentiment: "bullish", impact: "critical" },
    { headline: "Yield curve steepens as long-end sells off", sentiment: "bearish", impact: "medium" },
    { headline: "Geopolitical tensions escalate, safe haven bid emerges", sentiment: "bearish", impact: "high" },
    { headline: "PMI data mixed, manufacturing contracts for third month", sentiment: "bearish", impact: "medium" },
  ],
};

function makeRng(seed: string) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s & 0x7fffffff) / 0x7fffffff; };
}

function getNewsCategory(symbol: string): string {
  if (symbol.includes("BTC") || symbol.includes("ETH") || symbol.includes("SOL")) return "crypto";
  return "equity";
}

export function generateSentimentSignals(symbol: string): SentimentSignal[] {
  const rng = makeRng(`${symbol}-sent-${new Date().getHours()}`);
  const category = getNewsCategory(symbol);
  const templates = NEWS_TEMPLATES[category] || NEWS_TEMPLATES.equity;
  const macroTemplates = NEWS_TEMPLATES.macro;

  const signals: SentimentSignal[] = [];
  const sources: SentimentSignal["source"][] = ["news", "social", "analyst", "macro"];

  // Generate 3-6 signals per symbol
  const count = 3 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const useMacro = rng() > 0.7;
    const pool = useMacro ? macroTemplates : templates;
    const template = pool[Math.floor(rng() * pool.length)];
    const source = sources[Math.floor(rng() * sources.length)];

    const score = template.sentiment === "bullish"
      ? Math.round(30 + rng() * 70)
      : template.sentiment === "bearish"
        ? Math.round(-30 - rng() * 70)
        : Math.round((rng() - 0.5) * 30);

    signals.push({
      id: `sent-${symbol}-${i}-${Date.now()}`,
      symbol, source,
      headline: template.headline,
      sentiment: template.sentiment,
      score,
      impact: template.impact,
      confidence: Math.round(50 + rng() * 45),
      category: useMacro ? "macro" : category,
      timestamp: new Date(Date.now() - rng() * 7200000).toISOString(),
    });
  }

  // Store
  if (!_sentimentSignals.has(symbol)) _sentimentSignals.set(symbol, []);
  const arr = _sentimentSignals.get(symbol)!;
  arr.push(...signals);
  if (arr.length > MAX_SIGNALS) arr.splice(0, arr.length - MAX_SIGNALS);

  return signals;
}

export function getSentimentSnapshot(symbol: string): SentimentSnapshot {
  const signals = generateSentimentSignals(symbol);
  const all = _sentimentSignals.get(symbol) || signals;
  const recent = all.slice(-20);

  const bullish = recent.filter((s) => s.sentiment === "bullish").length;
  const bearish = recent.filter((s) => s.sentiment === "bearish").length;
  const neutral = recent.length - bullish - bearish;
  const avgScore = recent.length > 0
    ? Math.round(recent.reduce((s, sig) => s + sig.score, 0) / recent.length)
    : 0;

  // Momentum: compare first half to second half
  const mid = Math.floor(recent.length / 2);
  const firstAvg = mid > 0 ? recent.slice(0, mid).reduce((s, sig) => s + sig.score, 0) / mid : 0;
  const secondAvg = mid > 0 ? recent.slice(mid).reduce((s, sig) => s + sig.score, 0) / (recent.length - mid) : 0;
  const momentum: "improving" | "declining" | "stable" =
    secondAvg - firstAvg > 10 ? "improving" : secondAvg - firstAvg < -10 ? "declining" : "stable";

  return {
    symbol,
    timestamp: new Date().toISOString(),
    overallSentiment: avgScore > 15 ? "bullish" : avgScore < -15 ? "bearish" : "neutral",
    overallScore: avgScore,
    signalCount: recent.length,
    bullishCount: bullish,
    bearishCount: bearish,
    neutralCount: neutral,
    topSignals: recent.slice(-5).reverse(),
    momentum,
  };
}

export function getMultiSymbolSentiment(symbols?: string[]): SentimentSnapshot[] {
  const syms = symbols && symbols.length > 0 ? symbols : ["BTCUSD", "ETHUSD", "SPY", "AAPL", "TSLA", "NVDA"];
  return syms.map((s) => getSentimentSnapshot(s));
}

export function getSentimentHistory(symbol: string, limit = 30): SentimentSignal[] {
  const arr = _sentimentSignals.get(symbol) || [];
  return arr.slice(-limit).reverse();
}
