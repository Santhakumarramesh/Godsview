/**
 * backtest_v2/results_store.ts — In-memory registry of completed runs.
 *
 * Phase 2: replaces the hardcoded BACKTESTS/CREDIBILITY/OVERFIT/etc.
 * fixtures that lived inside `routes/backtest_v2.ts`. The route reads
 * from this store instead. Completed runs written by
 * `EventDrivenBacktester` / `OverfitDetector` register their outputs
 * here and surface to the API.
 *
 * The store is intentionally ephemeral (process-memory). Persisting to
 * Postgres is a later phase — what matters for Phase 2 is that no
 * pre-baked rows are served in production.
 */
import { demoDataAllowed } from "../demo_mode";

export interface BacktestResultRow {
  id: string;
  strategy: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  initialCapital: number;
  metrics: Record<string, number>;
  fees: Record<string, number>;
  slippage: Record<string, unknown>;
  latencyMs: number;
  partialFills: boolean;
  sessionBoundaries: boolean;
  equityCurve: Array<{ date: string; equity: number; drawdown: number }>;
  benchmark: Record<string, number>;
  assumptions: string[];
  warnings: string[];
  credibilityGrade: string;
  overfitRisk: "low" | "moderate" | "high";
  promotable: boolean;
}

export interface CredibilityReport {
  backtestId: string;
  strategy: string;
  credibilityScore: number;
  grade: string;
  promotable: boolean;
  gatingIssues: string[];
  assumptions: Array<Record<string, unknown>>;
  warnings: string[];
}

export interface OverfitReport {
  backtestId: string;
  strategy: string;
  overfitScore: number;
  riskLevel: "low" | "moderate" | "high";
  tests: Array<Record<string, unknown>>;
  recommendation: string;
}

export interface LeakageReport {
  backtestId: string;
  hasLeakage: boolean;
  severity: "none" | "minor" | "major";
  features: Array<Record<string, unknown>>;
}

export interface WalkForwardReport {
  backtestId: string;
  windows: number;
  inSamplePct: number;
  outSamplePct: number;
  results: Array<Record<string, number>>;
  avgDivergence: number;
  overfitFlag: boolean;
  summary: string;
}

export interface ComparisonReport {
  backtestId: string;
  metrics: Array<Record<string, unknown>>;
  overallDeviation: number;
  acceptable: boolean;
  summary: string;
}

class BacktestResultsStore {
  private results = new Map<string, BacktestResultRow>();
  private credibility = new Map<string, CredibilityReport>();
  private overfit = new Map<string, OverfitReport>();
  private leakage = new Map<string, LeakageReport>();
  private walkForward = new Map<string, WalkForwardReport>();
  private comparison = new Map<string, ComparisonReport>();

  listResults(): BacktestResultRow[] {
    return [...this.results.values()];
  }

  getResult(id: string): BacktestResultRow | undefined {
    return this.results.get(id);
  }

  registerResult(row: BacktestResultRow): void {
    this.results.set(row.id, row);
  }

  getCredibility(id: string): CredibilityReport | undefined {
    return this.credibility.get(id);
  }
  registerCredibility(r: CredibilityReport): void {
    this.credibility.set(r.backtestId, r);
  }

  getOverfit(id: string): OverfitReport | undefined {
    return this.overfit.get(id);
  }
  registerOverfit(r: OverfitReport): void {
    this.overfit.set(r.backtestId, r);
  }

  getLeakage(id: string): LeakageReport | undefined {
    return this.leakage.get(id);
  }
  registerLeakage(r: LeakageReport): void {
    this.leakage.set(r.backtestId, r);
  }

  getWalkForward(id: string): WalkForwardReport | undefined {
    return this.walkForward.get(id);
  }
  registerWalkForward(r: WalkForwardReport): void {
    this.walkForward.set(r.backtestId, r);
  }

  getComparison(id: string): ComparisonReport | undefined {
    return this.comparison.get(id);
  }
  registerComparison(r: ComparisonReport): void {
    this.comparison.set(r.backtestId, r);
  }

  /**
   * Seed with demo data (dev/test only). Production never calls this.
   */
  seedDemoData(): void {
    if (!demoDataAllowed()) return;
    if (this.results.size > 0) return; // idempotent
    // Small, representative demo set so the UI renders in dev.
    const demo: BacktestResultRow[] = [
      {
        id: "bt-demo-001",
        strategy: "Mean Reversion v2 (demo)",
        symbols: ["AAPL", "MSFT", "GOOGL"],
        startDate: "2024-01-02",
        endDate: "2025-12-31",
        initialCapital: 100000,
        metrics: {
          totalReturn: 18.4,
          annualReturn: 9.1,
          sharpe: 1.42,
          sortino: 1.87,
          maxDrawdown: -8.3,
          profitFactor: 1.65,
          winRate: 58.2,
          expectancy: 42.5,
          trades: 347,
          avgHoldingPeriodHrs: 28.5,
        },
        fees: {
          perShare: 0.005,
          perTrade: 1.0,
          platformFee: 0.001,
          ecnRebate: -0.002,
        },
        slippage: {
          type: "realistic",
          fixedBps: 5,
          volMultiplier: 1.2,
          impactCoeff: 0.1,
        },
        latencyMs: 50,
        partialFills: true,
        sessionBoundaries: true,
        equityCurve: [],
        benchmark: {
          buyHold: 12.1,
          randomBaseline: 1.8,
          riskFree: 5.2,
          alpha: 6.3,
        },
        assumptions: [
          "Realistic slippage model",
          "Session boundaries enforced",
          "Partial fills enabled",
          "50ms latency modeled",
        ],
        warnings: [],
        credibilityGrade: "A",
        overfitRisk: "low",
        promotable: true,
      },
    ];
    for (const row of demo) this.registerResult(row);
  }
}

export const backtestResultsStore = new BacktestResultsStore();
