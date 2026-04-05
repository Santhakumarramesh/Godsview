/**
 * execution_intelligence.ts — Advanced Execution Intelligence
 *
 * Upgrades from "execute signal" to "execute intelligently":
 * 1. Slippage model — estimate expected slippage before order
 * 2. Execution planner — choose limit vs market, timing
 * 3. Exit ladder engine — scale-out targets
 * 4. Dynamic stop engine — trailing/ATR-based stop migration
 * 5. Execution quality report — compare expected vs actual
 *
 * Env:
 *   EXECUTION_INTELLIGENCE_ENABLED       — master switch (default true)
 *   EXECUTION_SLIPPAGE_BASE_BPS          — base slippage in bps (default 5)
 *   EXECUTION_EXIT_LADDER_TARGETS        — default number of targets (default 3)
 *   EXECUTION_DYNAMIC_STOP_ATR_MULT      — ATR multiplier for trailing (default 1.5)
 */

import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlippageEstimate {
  symbol: string;
  direction: "long" | "short";
  estimatedBps: number;
  spreadBps: number;
  volumeImpactBps: number;
  volatilityBps: number;
  confidence: number;
  recommendation: "MARKET" | "LIMIT" | "LIMIT_AGGRESSIVE";
  estimatedAt: string;
}

export interface ExecutionPlan {
  symbol: string;
  direction: "long" | "short";
  orderType: "MARKET" | "LIMIT" | "LIMIT_AGGRESSIVE";
  entryPrice: number;
  limitOffset: number;
  slippageEstimate: SlippageEstimate;
  exitLadder: ExitTarget[];
  stopPlan: StopPlan;
  totalRiskPct: number;
  expectedRR: number;
  planCreatedAt: string;
}

export interface ExitTarget {
  level: number;
  targetPrice: number;
  sizePct: number;
  label: string;
  rMultiple: number;
}

export interface StopPlan {
  initialStop: number;
  trailingEnabled: boolean;
  trailingType: "ATR" | "PERCENTAGE" | "STRUCTURE" | "FIXED";
  atrMultiplier: number;
  currentStop: number;
  migrationHistory: StopMigration[];
}

export interface StopMigration {
  fromPrice: number;
  toPrice: number;
  reason: string;
  migratedAt: string;
}

export interface ExecutionQualityReport {
  tradeId: string;
  symbol: string;
  expectedEntry: number;
  actualEntry: number;
  entrySlippageBps: number;
  expectedExit: number;
  actualExit: number;
  exitSlippageBps: number;
  totalSlippageCost: number;
  fillTimeMs: number;
  orderType: string;
  qualityScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  reportedAt: string;
}

export interface ExecutionIntelligenceSnapshot {
  enabled: boolean;
  totalPlansCreated: number;
  totalQualityReports: number;
  avgSlippageBps: number;
  avgQualityScore: number;
  recentPlans: ExecutionPlan[];
  recentReports: ExecutionQualityReport[];
  stopMigrations: number;
  lastPlanAt: string | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ENABLED = (process.env.EXECUTION_INTELLIGENCE_ENABLED ?? "true") !== "false";
const BASE_SLIPPAGE_BPS = parseFloat(process.env.EXECUTION_SLIPPAGE_BASE_BPS ?? "5");
const DEFAULT_LADDER_TARGETS = parseInt(process.env.EXECUTION_EXIT_LADDER_TARGETS ?? "3", 10);
const DYNAMIC_STOP_ATR_MULT = parseFloat(process.env.EXECUTION_DYNAMIC_STOP_ATR_MULT ?? "1.5");

// ─── State ────────────────────────────────────────────────────────────────────

let totalPlansCreated = 0;
let totalQualityReports = 0;
let totalSlippageBpsSum = 0;
let totalQualityScoreSum = 0;
let totalStopMigrations = 0;
const recentPlans: ExecutionPlan[] = [];
const recentReports: ExecutionQualityReport[] = [];
let lastPlanAt: string | null = null;

const MAX_RECENT = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

// ─── Slippage Model ───────────────────────────────────────────────────────────

export function estimateSlippage(params: {
  symbol: string;
  direction: "long" | "short";
  spread?: number;
  price?: number;
  volume?: number;
  atr?: number;
  orderSizeUsd?: number;
}): SlippageEstimate {
  const { symbol, direction, spread = 0.02, price = 100, volume = 1000000, atr = 1.0, orderSizeUsd = 5000 } = params;

  // Spread component
  const spreadBps = (spread / price) * 10000;

  // Volume impact — larger orders relative to volume get more slippage
  const volumeRatio = orderSizeUsd / (volume * price * 0.01); // fraction of 1% ADV
  const volumeImpactBps = clamp(volumeRatio * 50, 0, 30);

  // Volatility component
  const volatilityBps = clamp((atr / price) * 10000 * 0.1, 0, 20);

  const estimatedBps = BASE_SLIPPAGE_BPS + spreadBps + volumeImpactBps + volatilityBps;
  const confidence = clamp(1 - volumeRatio * 2, 0.3, 0.95);

  // Recommendation
  let recommendation: SlippageEstimate["recommendation"] = "MARKET";
  if (estimatedBps > 15) recommendation = "LIMIT";
  else if (estimatedBps > 8) recommendation = "LIMIT_AGGRESSIVE";

  return {
    symbol, direction, estimatedBps, spreadBps, volumeImpactBps, volatilityBps,
    confidence, recommendation,
    estimatedAt: new Date().toISOString(),
  };
}

// ─── Exit Ladder Engine ───────────────────────────────────────────────────────

export function buildExitLadder(params: {
  entryPrice: number;
  stopLoss: number;
  direction: "long" | "short";
  targets?: number;
  riskReward?: number;
}): ExitTarget[] {
  const { entryPrice, stopLoss, direction, targets = DEFAULT_LADDER_TARGETS, riskReward = 3 } = params;

  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return [];

  const ladder: ExitTarget[] = [];
  const dirMult = direction === "long" ? 1 : -1;

  // Standard ladder: 1R (40%), 2R (35%), 3R (25%) or custom RR
  const rLevels = targets === 2
    ? [{ r: 1.5, pct: 0.50 }, { r: riskReward, pct: 0.50 }]
    : targets === 3
      ? [{ r: 1, pct: 0.40 }, { r: 2, pct: 0.35 }, { r: riskReward, pct: 0.25 }]
      : Array.from({ length: targets }, (_, i) => ({
          r: (i + 1) * (riskReward / targets),
          pct: i === targets - 1 ? 1 - (targets - 1) * (1 / targets) : 1 / targets,
        }));

  for (let i = 0; i < rLevels.length; i++) {
    const { r, pct } = rLevels[i];
    ladder.push({
      level: i + 1,
      targetPrice: entryPrice + dirMult * risk * r,
      sizePct: pct,
      label: `TP${i + 1} (${r.toFixed(1)}R)`,
      rMultiple: r,
    });
  }

  return ladder;
}

// ─── Dynamic Stop Engine ──────────────────────────────────────────────────────

export function computeDynamicStop(params: {
  entryPrice: number;
  currentPrice: number;
  initialStop: number;
  currentStop: number;
  direction: "long" | "short";
  atr: number;
  atrMultiplier?: number;
  highSinceEntry?: number;
  lowSinceEntry?: number;
}): { newStop: number; migrated: boolean; reason: string } {
  const {
    entryPrice, currentPrice, initialStop, currentStop,
    direction, atr, atrMultiplier = DYNAMIC_STOP_ATR_MULT,
    highSinceEntry, lowSinceEntry,
  } = params;

  const trailingDistance = atr * atrMultiplier;

  let candidateStop: number;
  let reason = "";

  if (direction === "long") {
    const extremePrice = highSinceEntry ?? currentPrice;
    candidateStop = extremePrice - trailingDistance;
    // Never move stop down
    if (candidateStop <= currentStop) {
      return { newStop: currentStop, migrated: false, reason: "no_improvement" };
    }
    // Don't move stop above entry until we have at least 1R profit
    const risk = entryPrice - initialStop;
    if (currentPrice < entryPrice + risk && candidateStop > entryPrice) {
      candidateStop = Math.min(candidateStop, entryPrice);
    }
    reason = `trail_long: high=${extremePrice.toFixed(2)} - ${atrMultiplier}×ATR(${atr.toFixed(2)}) = ${candidateStop.toFixed(2)}`;
  } else {
    const extremePrice = lowSinceEntry ?? currentPrice;
    candidateStop = extremePrice + trailingDistance;
    if (candidateStop >= currentStop) {
      return { newStop: currentStop, migrated: false, reason: "no_improvement" };
    }
    const risk = initialStop - entryPrice;
    if (currentPrice > entryPrice - risk && candidateStop < entryPrice) {
      candidateStop = Math.max(candidateStop, entryPrice);
    }
    reason = `trail_short: low=${extremePrice.toFixed(2)} + ${atrMultiplier}×ATR(${atr.toFixed(2)}) = ${candidateStop.toFixed(2)}`;
  }

  return { newStop: candidateStop, migrated: true, reason };
}

// ─── Execution Planner ────────────────────────────────────────────────────────

export function createExecutionPlan(params: {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  atr: number;
  spread?: number;
  volume?: number;
  equity?: number;
  riskPct?: number;
  riskReward?: number;
}): ExecutionPlan {
  const {
    symbol, direction, entryPrice, stopLoss, atr,
    spread, volume, equity = 10000, riskPct = 0.02, riskReward = 3,
  } = params;

  const slippageEstimate = estimateSlippage({
    symbol, direction, spread, price: entryPrice, volume, atr,
    orderSizeUsd: equity * riskPct,
  });

  const limitOffset = slippageEstimate.recommendation === "MARKET"
    ? 0
    : slippageEstimate.estimatedBps * entryPrice / 10000;

  const exitLadder = buildExitLadder({ entryPrice, stopLoss, direction, riskReward });

  const risk = Math.abs(entryPrice - stopLoss);
  const totalRiskPct = equity > 0 ? (risk / entryPrice) * 100 : 0;
  const expectedRR = exitLadder.length > 0
    ? exitLadder.reduce((s, t) => s + t.rMultiple * t.sizePct, 0)
    : riskReward;

  const plan: ExecutionPlan = {
    symbol,
    direction,
    orderType: slippageEstimate.recommendation,
    entryPrice,
    limitOffset,
    slippageEstimate,
    exitLadder,
    stopPlan: {
      initialStop: stopLoss,
      trailingEnabled: true,
      trailingType: "ATR",
      atrMultiplier: DYNAMIC_STOP_ATR_MULT,
      currentStop: stopLoss,
      migrationHistory: [],
    },
    totalRiskPct,
    expectedRR,
    planCreatedAt: new Date().toISOString(),
  };

  recentPlans.unshift(plan);
  if (recentPlans.length > MAX_RECENT) recentPlans.pop();
  totalPlansCreated++;
  lastPlanAt = plan.planCreatedAt;

  logger.info({
    symbol, direction, orderType: plan.orderType,
    slippageBps: slippageEstimate.estimatedBps.toFixed(1),
    exitTargets: exitLadder.length,
  }, "Execution plan created");

  return plan;
}

// ─── Execution Quality Report ─────────────────────────────────────────────────

export function reportExecutionQuality(params: {
  tradeId: string;
  symbol: string;
  expectedEntry: number;
  actualEntry: number;
  expectedExit: number;
  actualExit: number;
  fillTimeMs: number;
  orderType: string;
}): ExecutionQualityReport {
  const { tradeId, symbol, expectedEntry, actualEntry, expectedExit, actualExit, fillTimeMs, orderType } = params;

  const entrySlippageBps = Math.abs(actualEntry - expectedEntry) / expectedEntry * 10000;
  const exitSlippageBps = Math.abs(actualExit - expectedExit) / expectedExit * 10000;
  const totalSlippageCost = Math.abs(actualEntry - expectedEntry) + Math.abs(actualExit - expectedExit);

  // Quality score: 0-100
  let qualityScore = 100;
  qualityScore -= Math.min(entrySlippageBps * 2, 30);
  qualityScore -= Math.min(exitSlippageBps * 2, 30);
  qualityScore -= fillTimeMs > 5000 ? 15 : fillTimeMs > 2000 ? 8 : fillTimeMs > 500 ? 3 : 0;
  qualityScore = clamp(qualityScore, 0, 100);

  const grade: ExecutionQualityReport["grade"] =
    qualityScore >= 90 ? "A" :
    qualityScore >= 75 ? "B" :
    qualityScore >= 60 ? "C" :
    qualityScore >= 40 ? "D" : "F";

  const report: ExecutionQualityReport = {
    tradeId, symbol, expectedEntry, actualEntry, entrySlippageBps,
    expectedExit, actualExit, exitSlippageBps,
    totalSlippageCost, fillTimeMs, orderType, qualityScore, grade,
    reportedAt: new Date().toISOString(),
  };

  recentReports.unshift(report);
  if (recentReports.length > MAX_RECENT) recentReports.pop();
  totalQualityReports++;
  totalSlippageBpsSum += entrySlippageBps + exitSlippageBps;
  totalQualityScoreSum += qualityScore;

  logger.info({
    tradeId, symbol, grade, qualityScore,
    entrySlippage: entrySlippageBps.toFixed(1),
    exitSlippage: exitSlippageBps.toFixed(1),
  }, "Execution quality report");

  return report;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export function getExecutionIntelligenceSnapshot(): ExecutionIntelligenceSnapshot {
  return {
    enabled: ENABLED,
    totalPlansCreated,
    totalQualityReports,
    avgSlippageBps: totalQualityReports > 0 ? totalSlippageBpsSum / (totalQualityReports * 2) : 0,
    avgQualityScore: totalQualityReports > 0 ? totalQualityScoreSum / totalQualityReports : 0,
    recentPlans: recentPlans.slice(0, 10),
    recentReports: recentReports.slice(0, 10),
    stopMigrations: totalStopMigrations,
    lastPlanAt,
  };
}

export function resetExecutionIntelligence(): void {
  totalPlansCreated = 0;
  totalQualityReports = 0;
  totalSlippageBpsSum = 0;
  totalQualityScoreSum = 0;
  totalStopMigrations = 0;
  recentPlans.length = 0;
  recentReports.length = 0;
  lastPlanAt = null;
  logger.info("Execution intelligence state reset");
}
