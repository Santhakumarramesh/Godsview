/**
 * portfolio_optimizer/index.ts — Phase 86: Portfolio Optimizer
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. EqualWeight             — naive 1/N baseline.
 *   2. RiskParityOptimizer     — equal risk contribution per strategy.
 *   3. KellyOptimizer          — fractional Kelly per strategy.
 *   4. MeanVarianceOptimizer   — efficient frontier, sharpe-max via search.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface StrategyStats {
  strategyId: string;
  expectedReturn: number;     // annualized
  volatility: number;         // annualized standard deviation
  edge?: number;              // win prob - loss prob (Kelly input)
  payoffRatio?: number;       // avg win / avg loss (Kelly input)
}

export interface Allocation {
  strategyId: string;
  weight: number;             // 0-1
}

export interface AllocationResult {
  method: string;
  allocations: Allocation[];
  expectedReturn: number;
  expectedVolatility: number;
  sharpe: number;
  notes: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalize(weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total === 0) return weights.map(() => 0);
  return weights.map((w) => Math.max(0, w) / total);
}

function portfolioReturn(stats: StrategyStats[], weights: number[]): number {
  return stats.reduce((s, st, i) => s + st.expectedReturn * (weights[i] ?? 0), 0);
}

function portfolioVolatility(stats: StrategyStats[], weights: number[]): number {
  // Naive: assumes uncorrelated. Real impl would use covariance matrix.
  let variance = 0;
  for (let i = 0; i < stats.length; i++) {
    const w = weights[i] ?? 0;
    variance += w * w * stats[i]!.volatility * stats[i]!.volatility;
  }
  return Math.sqrt(variance);
}

// ── Equal Weight ──────────────────────────────────────────────────────────

export class EqualWeightOptimizer {
  optimize(stats: StrategyStats[]): AllocationResult {
    if (stats.length === 0) {
      return { method: "equal_weight", allocations: [], expectedReturn: 0, expectedVolatility: 0, sharpe: 0, notes: ["no strategies"] };
    }
    const w = 1 / stats.length;
    const weights = stats.map(() => w);
    const ret = portfolioReturn(stats, weights);
    const vol = portfolioVolatility(stats, weights);
    return {
      method: "equal_weight",
      allocations: stats.map((s) => ({ strategyId: s.strategyId, weight: w })),
      expectedReturn: ret,
      expectedVolatility: vol,
      sharpe: vol > 0 ? ret / vol : 0,
      notes: ["1/N baseline"],
    };
  }
}

// ── Risk Parity ───────────────────────────────────────────────────────────

export class RiskParityOptimizer {
  optimize(stats: StrategyStats[]): AllocationResult {
    if (stats.length === 0) {
      return { method: "risk_parity", allocations: [], expectedReturn: 0, expectedVolatility: 0, sharpe: 0, notes: ["no strategies"] };
    }
    // Inverse volatility weighting: w_i ∝ 1 / σ_i
    const inv = stats.map((s) => (s.volatility > 0 ? 1 / s.volatility : 0));
    const weights = normalize(inv);
    const ret = portfolioReturn(stats, weights);
    const vol = portfolioVolatility(stats, weights);
    return {
      method: "risk_parity",
      allocations: stats.map((s, i) => ({ strategyId: s.strategyId, weight: weights[i] ?? 0 })),
      expectedReturn: ret,
      expectedVolatility: vol,
      sharpe: vol > 0 ? ret / vol : 0,
      notes: ["inverse-vol weighting"],
    };
  }
}

// ── Kelly ─────────────────────────────────────────────────────────────────

export class KellyOptimizer {
  optimize(stats: StrategyStats[], fraction = 0.5): AllocationResult {
    if (stats.length === 0) {
      return { method: "fractional_kelly", allocations: [], expectedReturn: 0, expectedVolatility: 0, sharpe: 0, notes: ["no strategies"] };
    }
    // Kelly fraction per strategy: f = (b*p - q) / b, where b=payoff, p=win prob, q=1-p
    // edge = p - q → p = (1+edge)/2
    const raw: number[] = [];
    for (const s of stats) {
      const p = s.edge !== undefined ? (1 + s.edge) / 2 : 0.5;
      const q = 1 - p;
      const b = s.payoffRatio ?? 1;
      const kelly = b > 0 ? Math.max(0, (b * p - q) / b) : 0;
      raw.push(kelly * fraction);
    }
    const total = raw.reduce((s, v) => s + v, 0);
    const weights = total > 1 ? raw.map((w) => w / total) : raw;
    const ret = portfolioReturn(stats, weights);
    const vol = portfolioVolatility(stats, weights);
    return {
      method: "fractional_kelly",
      allocations: stats.map((s, i) => ({ strategyId: s.strategyId, weight: weights[i] ?? 0 })),
      expectedReturn: ret,
      expectedVolatility: vol,
      sharpe: vol > 0 ? ret / vol : 0,
      notes: [`fraction=${fraction}`, total > 1 ? "scaled to 1.0" : "raw kelly fractions"],
    };
  }
}

// ── Mean-Variance (grid search) ───────────────────────────────────────────

export class MeanVarianceOptimizer {
  /**
   * Grid-search over weights to maximize Sharpe (return / volatility).
   * Naive O(n^N), but acceptable for small N<=10.
   */
  optimize(stats: StrategyStats[], steps = 11): AllocationResult {
    if (stats.length === 0) {
      return { method: "mean_variance", allocations: [], expectedReturn: 0, expectedVolatility: 0, sharpe: 0, notes: ["no strategies"] };
    }
    if (stats.length === 1) {
      return new EqualWeightOptimizer().optimize(stats);
    }
    if (stats.length > 6) {
      // Fall back to risk parity for large sets
      const rp = new RiskParityOptimizer().optimize(stats);
      return { ...rp, method: "mean_variance_fallback_risk_parity", notes: ["grid too large; fell back to risk parity"] };
    }
    let bestSharpe = -Infinity;
    let bestWeights: number[] = [];
    const grid: number[][] = this._enumerateWeights(stats.length, steps);
    for (const weights of grid) {
      const ret = portfolioReturn(stats, weights);
      const vol = portfolioVolatility(stats, weights);
      if (vol === 0) continue;
      const sharpe = ret / vol;
      if (sharpe > bestSharpe) { bestSharpe = sharpe; bestWeights = weights; }
    }
    if (bestWeights.length === 0) {
      const eq = new EqualWeightOptimizer().optimize(stats);
      return { ...eq, method: "mean_variance_fallback_equal", notes: ["grid produced no valid allocation"] };
    }
    const ret = portfolioReturn(stats, bestWeights);
    const vol = portfolioVolatility(stats, bestWeights);
    return {
      method: "mean_variance",
      allocations: stats.map((s, i) => ({ strategyId: s.strategyId, weight: bestWeights[i] ?? 0 })),
      expectedReturn: ret,
      expectedVolatility: vol,
      sharpe: vol > 0 ? ret / vol : 0,
      notes: [`grid steps=${steps}`, `best sharpe=${bestSharpe.toFixed(3)}`],
    };
  }

  private _enumerateWeights(n: number, steps: number): number[][] {
    const out: number[][] = [];
    const recurse = (remaining: number, depth: number, acc: number[]) => {
      if (depth === n - 1) { out.push([...acc, remaining / steps]); return; }
      for (let i = 0; i <= remaining; i++) {
        acc.push(i / steps);
        recurse(remaining - i, depth + 1, acc);
        acc.pop();
      }
    };
    recurse(steps, 0, []);
    return out;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const equalWeightOptimizer = new EqualWeightOptimizer();
export const riskParityOptimizer = new RiskParityOptimizer();
export const kellyOptimizer = new KellyOptimizer();
export const meanVarianceOptimizer = new MeanVarianceOptimizer();

logger.info("[PortfolioOptimizer] Module initialized");
