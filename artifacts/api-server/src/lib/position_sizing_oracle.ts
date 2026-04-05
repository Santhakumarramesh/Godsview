/**
 * position_sizing_oracle.ts — Position Sizing Oracle (Phase 56)
 *
 * Intelligent position sizing:
 *   1. Kelly Criterion — optimal fraction based on win rate and R:R
 *   2. Fixed Fractional — standard risk % of equity
 *   3. Volatility-scaled — ATR-based sizing
 *   4. Regime-adjusted — scale down in high-vol regimes
 *   5. Context-aware — integrate fusion score
 */

import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SizingMethod = "KELLY" | "FIXED_FRACTIONAL" | "VOLATILITY_SCALED" | "REGIME_ADJUSTED";

export interface SizingInput {
  equity: number;
  riskPct: number;
  entryPrice: number;
  stopLoss: number;
  winRate?: number;
  avgWinLossRatio?: number;
  atr?: number;
  regime?: string;
  contextScore?: number;
  method?: SizingMethod;
}

export interface SizingResult {
  method: SizingMethod;
  positionSize: number;
  dollarRisk: number;
  shares: number;
  riskPctActual: number;
  kellyFraction?: number;
  adjustments: { factor: string; multiplier: number }[];
  confidence: number;
  calculatedAt: string;
}

export interface SizingOracleSnapshot {
  totalCalculations: number;
  avgPositionSize: number;
  avgRiskPct: number;
  methodDistribution: Record<SizingMethod, number>;
}

// ─── State ────────────────────────────────────────────────────────────────────

let totalCalcs = 0;
let totalSizeSum = 0;
let totalRiskSum = 0;
const methodCounts: Record<SizingMethod, number> = { KELLY: 0, FIXED_FRACTIONAL: 0, VOLATILITY_SCALED: 0, REGIME_ADJUSTED: 0 };

// ─── Core Sizing ──────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

export function calculatePositionSize(input: SizingInput): SizingResult {
  const {
    equity, riskPct, entryPrice, stopLoss,
    winRate = 0.55, avgWinLossRatio = 1.5,
    atr, regime, contextScore,
    method = "FIXED_FRACTIONAL",
  } = input;

  const riskPerShare = Math.abs(entryPrice - stopLoss);
  if (riskPerShare === 0) {
    return makeResult(method, 0, 0, 0, riskPct, [], 0);
  }

  let dollarRisk = equity * riskPct;
  const adjustments: { factor: string; multiplier: number }[] = [];
  let kellyFraction: number | undefined;

  // Kelly Criterion
  if (method === "KELLY" || method === "REGIME_ADJUSTED") {
    const kellyRaw = winRate - ((1 - winRate) / avgWinLossRatio);
    kellyFraction = clamp(kellyRaw, 0, 0.25); // cap at 25%
    const halfKelly = kellyFraction * 0.5; // use half-Kelly for safety
    if (method === "KELLY") {
      dollarRisk = equity * halfKelly;
      adjustments.push({ factor: "kelly_half", multiplier: halfKelly / riskPct });
    }
  }

  // Volatility scaling
  if ((method === "VOLATILITY_SCALED" || method === "REGIME_ADJUSTED") && atr) {
    const volRatio = atr / entryPrice;
    const volMultiplier = clamp(0.02 / volRatio, 0.5, 1.5); // baseline 2% vol
    dollarRisk *= volMultiplier;
    adjustments.push({ factor: "volatility", multiplier: volMultiplier });
  }

  // Regime adjustment
  if (method === "REGIME_ADJUSTED" && regime) {
    const regimeMultipliers: Record<string, number> = {
      TRENDING_UP: 1.1, TRENDING_DOWN: 0.7, RANGING: 0.9,
      HIGH_VOLATILITY: 0.6, LOW_VOLATILITY: 1.0, CRISIS: 0.3,
    };
    const regMult = regimeMultipliers[regime] ?? 1.0;
    dollarRisk *= regMult;
    adjustments.push({ factor: "regime", multiplier: regMult });
  }

  // Context score adjustment
  if (contextScore != null) {
    const ctxMult = clamp(0.5 + contextScore * 0.5, 0.3, 1.2);
    dollarRisk *= ctxMult;
    adjustments.push({ factor: "context", multiplier: ctxMult });
  }

  // Final calculation
  const shares = Math.floor(dollarRisk / riskPerShare);
  const positionSize = shares * entryPrice;
  const riskPctActual = equity > 0 ? (shares * riskPerShare) / equity : 0;
  const confidence = clamp(0.5 + (adjustments.length * 0.1), 0.3, 0.95);

  // Track telemetry
  totalCalcs++;
  totalSizeSum += positionSize;
  totalRiskSum += riskPctActual;
  methodCounts[method]++;

  logger.info({ method, shares, positionSize: positionSize.toFixed(0), riskPctActual: (riskPctActual * 100).toFixed(2) }, "Position sized");
  return makeResult(method, positionSize, dollarRisk, shares, riskPctActual, adjustments, confidence, kellyFraction);
}

function makeResult(
  method: SizingMethod, positionSize: number, dollarRisk: number,
  shares: number, riskPctActual: number,
  adjustments: { factor: string; multiplier: number }[],
  confidence: number, kellyFraction?: number,
): SizingResult {
  return {
    method, positionSize, dollarRisk, shares, riskPctActual,
    kellyFraction, adjustments, confidence,
    calculatedAt: new Date().toISOString(),
  };
}

// ─── Snapshot & Reset ─────────────────────────────────────────────────────────

export function getSizingOracleSnapshot(): SizingOracleSnapshot {
  return {
    totalCalculations: totalCalcs,
    avgPositionSize: totalCalcs > 0 ? totalSizeSum / totalCalcs : 0,
    avgRiskPct: totalCalcs > 0 ? totalRiskSum / totalCalcs : 0,
    methodDistribution: { ...methodCounts },
  };
}

export function resetSizingOracle(): void {
  totalCalcs = 0; totalSizeSum = 0; totalRiskSum = 0;
  methodCounts.KELLY = 0; methodCounts.FIXED_FRACTIONAL = 0;
  methodCounts.VOLATILITY_SCALED = 0; methodCounts.REGIME_ADJUSTED = 0;
  logger.info("Position sizing oracle reset");
}
