/**
 * risk_analytics/index.ts — Phase 73: Advanced Risk Analytics
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. VaREngine           — historical + parametric Value-at-Risk.
 *   2. CVaREngine          — Conditional Value-at-Risk (Expected Shortfall).
 *   3. StressTestEngine    — scenario + factor shock stress tests.
 *   4. CorrelationMatrix   — rolling pairwise correlations + concentration.
 *   5. RiskLimitRegistry   — configurable risk limits with breach tracking.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Utility Math ───────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * q)));
  return sorted[idx]!;
}

// ── VaR ────────────────────────────────────────────────────────────────────

export type VaRMethod = "historical" | "parametric";

export interface VaRReport {
  method: VaRMethod;
  confidence: number;  // 0.95 or 0.99
  horizonDays: number;
  samples: number;
  varValue: number;        // positive number = potential loss
  meanReturn: number;
  stddev: number;
}

export class VaREngine {
  compute(returns: number[], confidence = 0.95, horizonDays = 1, method: VaRMethod = "historical"): VaRReport {
    const samples = returns.length;
    if (samples === 0) {
      return { method, confidence, horizonDays, samples: 0, varValue: 0, meanReturn: 0, stddev: 0 };
    }
    const m = mean(returns);
    const sd = stddev(returns);
    let varValue = 0;
    if (method === "historical") {
      varValue = -quantile(returns, 1 - confidence);
    } else {
      // parametric (Gaussian assumption): z-score for 95% ≈ 1.645, 99% ≈ 2.326
      const z = confidence >= 0.99 ? 2.326 : confidence >= 0.975 ? 1.96 : 1.645;
      varValue = -(m - z * sd);
    }
    const scaled = varValue * Math.sqrt(horizonDays);
    return {
      method, confidence, horizonDays, samples,
      varValue: Math.max(0, scaled),
      meanReturn: m, stddev: sd,
    };
  }
}

// ── CVaR ───────────────────────────────────────────────────────────────────

export interface CVaRReport {
  confidence: number;
  horizonDays: number;
  samples: number;
  cvarValue: number;       // expected loss beyond VaR
  varValue: number;
}

export class CVaREngine {
  constructor(private readonly varEngine: VaREngine) {}

  compute(returns: number[], confidence = 0.95, horizonDays = 1): CVaRReport {
    const samples = returns.length;
    if (samples === 0) return { confidence, horizonDays, samples: 0, cvarValue: 0, varValue: 0 };
    const varReport = this.varEngine.compute(returns, confidence, horizonDays, "historical");
    const threshold = -varReport.varValue;
    const tail = returns.filter((r) => r <= threshold);
    const cvarValue = tail.length > 0 ? -mean(tail) * Math.sqrt(horizonDays) : varReport.varValue;
    return { confidence, horizonDays, samples, cvarValue: Math.max(0, cvarValue), varValue: varReport.varValue };
  }
}

// ── Stress Tests ───────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  description: string;
  shocks: Record<string, number>; // factor → shock in decimal (e.g. -0.1 = -10%)
  createdAt: number;
}

export interface StressResult {
  scenarioId: string;
  portfolioValueBefore: number;
  portfolioValueAfter: number;
  pnl: number;
  pnlPct: number;
  factorContributions: Record<string, number>;
}

export class StressTestEngine {
  private readonly scenarios = new Map<string, Scenario>();

  register(params: Omit<Scenario, "id" | "createdAt">): Scenario {
    const id = `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const scenario: Scenario = { id, createdAt: Date.now(), ...params };
    this.scenarios.set(id, scenario);
    return scenario;
  }

  list(): Scenario[] {
    return Array.from(this.scenarios.values());
  }

  get(id: string): Scenario | null {
    return this.scenarios.get(id) ?? null;
  }

  run(params: {
    scenarioId: string;
    portfolio: Record<string, { value: number; factorExposures: Record<string, number> }>;
  }): StressResult | null {
    const scenario = this.scenarios.get(params.scenarioId);
    if (!scenario) return null;
    let before = 0;
    let after = 0;
    const factorContributions: Record<string, number> = {};
    for (const [, pos] of Object.entries(params.portfolio)) {
      before += pos.value;
      let posPnl = 0;
      for (const [factor, exposure] of Object.entries(pos.factorExposures)) {
        const shock = scenario.shocks[factor] ?? 0;
        const contribution = pos.value * exposure * shock;
        posPnl += contribution;
        factorContributions[factor] = (factorContributions[factor] ?? 0) + contribution;
      }
      after += pos.value + posPnl;
    }
    const pnl = after - before;
    return {
      scenarioId: scenario.id,
      portfolioValueBefore: before,
      portfolioValueAfter: after,
      pnl,
      pnlPct: before > 0 ? (pnl / before) * 100 : 0,
      factorContributions,
    };
  }
}

// ── Correlation Matrix ─────────────────────────────────────────────────────

export interface CorrelationPair {
  a: string;
  b: string;
  correlation: number;
}

export class CorrelationMatrix {
  compute(returnSeries: Record<string, number[]>): CorrelationPair[] {
    const symbols = Object.keys(returnSeries);
    const out: CorrelationPair[] = [];
    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const a = symbols[i]!, b = symbols[j]!;
        const seriesA = returnSeries[a]!;
        const seriesB = returnSeries[b]!;
        const n = Math.min(seriesA.length, seriesB.length);
        if (n < 2) { out.push({ a, b, correlation: 0 }); continue; }
        const aSlice = seriesA.slice(-n);
        const bSlice = seriesB.slice(-n);
        const mA = mean(aSlice);
        const mB = mean(bSlice);
        let num = 0, denA = 0, denB = 0;
        for (let k = 0; k < n; k++) {
          const dA = aSlice[k]! - mA;
          const dB = bSlice[k]! - mB;
          num += dA * dB;
          denA += dA * dA;
          denB += dB * dB;
        }
        const denom = Math.sqrt(denA * denB);
        out.push({ a, b, correlation: denom === 0 ? 0 : num / denom });
      }
    }
    return out;
  }

  concentration(exposures: Record<string, number>): { herfindahl: number; topWeight: number; effectiveN: number } {
    const total = Object.values(exposures).reduce((s, v) => s + Math.abs(v), 0);
    if (total === 0) return { herfindahl: 0, topWeight: 0, effectiveN: 0 };
    let herfindahl = 0;
    let topWeight = 0;
    for (const v of Object.values(exposures)) {
      const w = Math.abs(v) / total;
      herfindahl += w * w;
      if (w > topWeight) topWeight = w;
    }
    const effectiveN = herfindahl > 0 ? 1 / herfindahl : 0;
    return { herfindahl, topWeight, effectiveN };
  }
}

// ── Risk Limit Registry ────────────────────────────────────────────────────

export type RiskLimitKind =
  | "var_95" | "var_99" | "cvar_95" | "position_concentration"
  | "leverage" | "drawdown" | "daily_loss" | "gross_exposure";

export interface RiskLimit {
  id: string;
  name: string;
  kind: RiskLimitKind;
  threshold: number;
  severity: "warn" | "halt";
  active: boolean;
  createdAt: number;
}

export interface LimitBreach {
  id: string;
  limitId: string;
  limitName: string;
  observed: number;
  threshold: number;
  severity: "warn" | "halt";
  at: number;
  resolved: boolean;
  resolvedAt?: number;
}

export class RiskLimitRegistry {
  private readonly limits = new Map<string, RiskLimit>();
  private readonly breaches: LimitBreach[] = [];

  register(params: Omit<RiskLimit, "id" | "createdAt" | "active">): RiskLimit {
    const id = `rl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const limit: RiskLimit = { id, createdAt: Date.now(), active: true, ...params };
    this.limits.set(id, limit);
    return limit;
  }

  check(kind: RiskLimitKind, observed: number): LimitBreach[] {
    const active = Array.from(this.limits.values()).filter((l) => l.active && l.kind === kind);
    const fired: LimitBreach[] = [];
    for (const limit of active) {
      if (observed > limit.threshold) {
        const breach: LimitBreach = {
          id: `brc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          limitId: limit.id,
          limitName: limit.name,
          observed,
          threshold: limit.threshold,
          severity: limit.severity,
          at: Date.now(),
          resolved: false,
        };
        this.breaches.push(breach);
        fired.push(breach);
        logger.warn({ limit: limit.name, observed, threshold: limit.threshold }, "[Risk] Limit breached");
      }
    }
    if (this.breaches.length > 10_000) this.breaches.splice(0, this.breaches.length - 10_000);
    return fired;
  }

  resolve(id: string): LimitBreach | null {
    const b = this.breaches.find((x) => x.id === id);
    if (!b) return null;
    b.resolved = true;
    b.resolvedAt = Date.now();
    return b;
  }

  listLimits(): RiskLimit[] {
    return Array.from(this.limits.values());
  }

  openBreaches(): LimitBreach[] {
    return this.breaches.filter((b) => !b.resolved).reverse();
  }

  recentBreaches(limit = 100): LimitBreach[] {
    return this.breaches.slice(-limit).reverse();
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const varEngine = new VaREngine();
export const cvarEngine = new CVaREngine(varEngine);
export const stressTestEngine = new StressTestEngine();
export const correlationMatrix = new CorrelationMatrix();
export const riskLimitRegistry = new RiskLimitRegistry();
