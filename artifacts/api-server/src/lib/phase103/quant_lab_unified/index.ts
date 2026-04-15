/**
 * Phase 103 — Unified Quant Lab façade
 * =====================================
 * One coherent API over strategy build → backtest → experiment tracking →
 * ranking → promotion. Keeps existing Phase 1 / Phase 55 lab modules
 * usable while presenting a single mental model to operators and the UI.
 */

export type Tier = "experimental" | "paper" | "live";

export interface StrategySpec {
  id: string;
  name: string;
  dsl: string; // pine-like or DSL string
  parameters?: Record<string, number | string | boolean>;
  tags?: string[];
  created_at?: number;
}

export interface BacktestResult {
  strategy_id: string;
  run_id: string;
  started_at: number;
  finished_at: number;
  metrics: {
    trades: number;
    win_rate: number;
    profit_factor: number;
    sharpe: number;
    max_drawdown: number;
    expectancy: number;
    total_pnl: number;
  };
  config?: Record<string, unknown>;
  notes?: string;
}

export interface ExperimentRecord {
  run_id: string;
  strategy_id: string;
  config: Record<string, unknown>;
  metrics: BacktestResult["metrics"];
  ranked_score: number;
  tier: Tier;
  promoted: boolean;
  ts: number;
}

export interface PromotionRule {
  min_trades: number;
  min_sharpe: number;
  min_pf: number;
  max_dd_pct: number;
}

const DEFAULT_RULES: Record<Tier, PromotionRule> = {
  experimental: { min_trades: 30, min_sharpe: 0.5, min_pf: 1.1, max_dd_pct: 0.3 },
  paper: { min_trades: 100, min_sharpe: 1.0, min_pf: 1.3, max_dd_pct: 0.2 },
  live: { min_trades: 200, min_sharpe: 1.5, min_pf: 1.6, max_dd_pct: 0.15 },
};

export class QuantLabUnified {
  private strategies = new Map<string, StrategySpec>();
  private experiments: ExperimentRecord[] = [];
  private tierByStrategy = new Map<string, Tier>();
  private rules = DEFAULT_RULES;

  /** Register a new strategy spec. */
  registerStrategy(spec: StrategySpec): StrategySpec {
    if (!spec.id) throw new Error("strategy.id required");
    spec.created_at ??= Date.now();
    this.strategies.set(spec.id, spec);
    if (!this.tierByStrategy.has(spec.id))
      this.tierByStrategy.set(spec.id, "experimental");
    return spec;
  }

  listStrategies(): StrategySpec[] {
    return Array.from(this.strategies.values());
  }

  getStrategy(id: string): StrategySpec | undefined {
    return this.strategies.get(id);
  }

  /** Record a backtest result and produce a ranked experiment row. */
  recordBacktest(result: BacktestResult): ExperimentRecord {
    if (!this.strategies.has(result.strategy_id)) {
      throw new Error(`Unknown strategy ${result.strategy_id}`);
    }
    const score = this.scoreMetrics(result.metrics);
    const rec: ExperimentRecord = {
      run_id: result.run_id,
      strategy_id: result.strategy_id,
      config: result.config ?? {},
      metrics: result.metrics,
      ranked_score: score,
      tier: this.tierByStrategy.get(result.strategy_id) ?? "experimental",
      promoted: false,
      ts: result.finished_at,
    };
    this.experiments.push(rec);
    return rec;
  }

  experiments_for(strategy_id: string): ExperimentRecord[] {
    return this.experiments.filter((e) => e.strategy_id === strategy_id);
  }

  /** Rank all strategies by best ranked_score. */
  rankStrategies(): Array<{ strategy_id: string; best_score: number; tier: Tier }> {
    const best = new Map<string, number>();
    for (const e of this.experiments) {
      const cur = best.get(e.strategy_id) ?? -Infinity;
      if (e.ranked_score > cur) best.set(e.strategy_id, e.ranked_score);
    }
    return Array.from(best.entries())
      .map(([sid, score]) => ({
        strategy_id: sid,
        best_score: score,
        tier: this.tierByStrategy.get(sid) ?? "experimental",
      }))
      .sort((a, b) => b.best_score - a.best_score);
  }

  /** Evaluate promotion gates. Returns next tier if eligible. */
  evaluatePromotion(strategy_id: string): {
    eligible: boolean;
    current_tier: Tier;
    next_tier?: Tier;
    failed_rules: string[];
  } {
    const tier = this.tierByStrategy.get(strategy_id) ?? "experimental";
    const next = nextTier(tier);
    if (!next) {
      return { eligible: false, current_tier: tier, failed_rules: ["already_live"] };
    }
    const rule = this.rules[next];
    const exps = this.experiments_for(strategy_id);
    const last = exps[exps.length - 1];
    if (!last) {
      return {
        eligible: false,
        current_tier: tier,
        next_tier: next,
        failed_rules: ["no_backtest"],
      };
    }
    const failed: string[] = [];
    if (last.metrics.trades < rule.min_trades) failed.push("min_trades");
    if (last.metrics.sharpe < rule.min_sharpe) failed.push("min_sharpe");
    if (last.metrics.profit_factor < rule.min_pf) failed.push("min_pf");
    if (last.metrics.max_drawdown > rule.max_dd_pct) failed.push("max_dd_pct");
    return {
      eligible: failed.length === 0,
      current_tier: tier,
      next_tier: next,
      failed_rules: failed,
    };
  }

  promote(strategy_id: string): {
    promoted: boolean;
    from: Tier;
    to: Tier;
    failed_rules: string[];
  } {
    const ev = this.evaluatePromotion(strategy_id);
    if (!ev.eligible || !ev.next_tier) {
      return {
        promoted: false,
        from: ev.current_tier,
        to: ev.current_tier,
        failed_rules: ev.failed_rules,
      };
    }
    this.tierByStrategy.set(strategy_id, ev.next_tier);
    const last = this.experiments_for(strategy_id).at(-1);
    if (last) last.promoted = true;
    return {
      promoted: true,
      from: ev.current_tier,
      to: ev.next_tier,
      failed_rules: [],
    };
  }

  reset(): void {
    this.strategies.clear();
    this.experiments = [];
    this.tierByStrategy.clear();
  }

  private scoreMetrics(m: BacktestResult["metrics"]): number {
    // Composite ranking: heavy emphasis on PF and Sharpe with DD penalty.
    return (
      m.profit_factor * 30 +
      m.sharpe * 25 +
      m.win_rate * 20 -
      m.max_drawdown * 60 +
      Math.log10(Math.max(1, m.trades)) * 5
    );
  }
}

function nextTier(t: Tier): Tier | undefined {
  if (t === "experimental") return "paper";
  if (t === "paper") return "live";
  return undefined;
}

let SINGLETON: QuantLabUnified | undefined;
export function getQuantLab(): QuantLabUnified {
  if (!SINGLETON) SINGLETON = new QuantLabUnified();
  return SINGLETON;
}
