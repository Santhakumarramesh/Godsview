/**
 * Phase 95 — Strategy Reinforcement Engine
 *
 * Implements a reinforcement-style learning loop for strategy parameters.
 * Tracks which parameter configurations work best per regime/setup,
 * and gradually moves parameters toward optimal values.
 */

export interface StrategyState {
  strategyId: string;
  symbol: string;
  tier: "SEED" | "LEARNING" | "PROVEN" | "ELITE" | "DEGRADING" | "SUSPENDED";
  version: number;
  parameters: Record<string, number>;
  performanceWindow: TradeResult[];
  lifetimeStats: LifetimeStats;
  regimePerformance: Record<string, RegimeStats>;
  lastUpdated: Date;
}

export interface TradeResult {
  ts: Date;
  pnlR: number;
  outcome: "win" | "loss" | "breakeven";
  regime: string;
  setupFamily: string;
  confidence: number;
}

export interface LifetimeStats {
  totalTrades: number;
  winRate: number;
  avgPnlR: number;
  sharpe: number;
  profitFactor: number;
  maxDrawdownR: number;
  consistency: number; // 0-1, how stable performance is
}

export interface RegimeStats {
  trades: number;
  winRate: number;
  avgPnlR: number;
  profitFactor: number;
}

export interface TierTransition {
  from: string;
  to: string;
  reason: string;
  ts: Date;
}

export interface ReinforcementConfig {
  learningRate: number; // how fast parameters adjust (0.01 - 0.1)
  minTradesForLearning: number;
  minTradesForProven: number;
  minTradesForElite: number;
  degradeAfterLosses: number; // consecutive losses before degrading
  suspendAfterDrawdown: number; // max drawdown R before suspend
  windowSize: number; // rolling window for performance
}

const DEFAULT_CONFIG: ReinforcementConfig = {
  learningRate: 0.05,
  minTradesForLearning: 10,
  minTradesForProven: 30,
  minTradesForElite: 100,
  degradeAfterLosses: 5,
  suspendAfterDrawdown: 10,
  windowSize: 50,
};

export class StrategyReinforcementEngine {
  private strategies: Map<string, StrategyState> = new Map();
  private transitions: TierTransition[] = [];
  private config: ReinforcementConfig;

  constructor(config: Partial<ReinforcementConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register a new strategy */
  registerStrategy(strategyId: string, symbol: string, initialParams: Record<string, number>): void {
    this.strategies.set(strategyId, {
      strategyId,
      symbol,
      tier: "SEED",
      version: 1,
      parameters: { ...initialParams },
      performanceWindow: [],
      lifetimeStats: {
        totalTrades: 0, winRate: 0, avgPnlR: 0,
        sharpe: 0, profitFactor: 0, maxDrawdownR: 0, consistency: 0,
      },
      regimePerformance: {},
      lastUpdated: new Date(),
    });
  }

  /** Record a trade result and trigger reinforcement */
  recordTrade(strategyId: string, result: TradeResult): {
    parameterUpdates: Record<string, { old: number; new: number }>;
    tierChange: TierTransition | null;
  } {
    const state = this.strategies.get(strategyId);
    if (!state) return { parameterUpdates: {}, tierChange: null };

    // Add to window
    state.performanceWindow.push(result);
    if (state.performanceWindow.length > this.config.windowSize) {
      state.performanceWindow.shift();
    }

    // Update lifetime stats
    this.updateLifetimeStats(state);

    // Update regime performance
    this.updateRegimePerformance(state, result);

    // Compute parameter adjustments
    const parameterUpdates = this.computeParameterUpdates(state, result);

    // Apply updates
    for (const [param, update] of Object.entries(parameterUpdates)) {
      state.parameters[param] = update.new;
    }

    // Check tier transition
    const tierChange = this.evaluateTier(state);

    state.version++;
    state.lastUpdated = new Date();

    return { parameterUpdates, tierChange };
  }

  /** Compute parameter adjustments based on recent performance */
  private computeParameterUpdates(
    state: StrategyState,
    latestTrade: TradeResult
  ): Record<string, { old: number; new: number }> {
    const updates: Record<string, { old: number; new: number }> = {};
    const lr = this.config.learningRate;

    if (state.performanceWindow.length < this.config.minTradesForLearning) {
      return updates; // Not enough data to learn
    }

    const recentWinRate = state.performanceWindow.filter((t) => t.outcome === "win").length /
      state.performanceWindow.length;

    // Adjust confirmation threshold
    const currentConfThreshold = state.parameters["min_confirmation_score"] ?? 0.65;
    if (recentWinRate < 0.35) {
      // Tighten — require more confirmation
      const newVal = Math.min(0.9, currentConfThreshold + lr);
      updates["min_confirmation_score"] = { old: currentConfThreshold, new: newVal };
    } else if (recentWinRate > 0.6 && state.performanceWindow.length >= 20) {
      // Slightly loosen to capture more trades
      const newVal = Math.max(0.4, currentConfThreshold - lr * 0.5);
      updates["min_confirmation_score"] = { old: currentConfThreshold, new: newVal };
    }

    // Adjust stop ATR multiplier based on MAE patterns
    const stopMultiplier = state.parameters["stop_atr_multiplier"] ?? 1.5;
    const recentLosses = state.performanceWindow.filter((t) => t.outcome === "loss");
    if (recentLosses.length > 5) {
      // If many losses are tight stops (small negative PnL), widen stops
      const avgLossPnlR = recentLosses.reduce((s, t) => s + t.pnlR, 0) / recentLosses.length;
      if (avgLossPnlR > -0.5) {
        updates["stop_atr_multiplier"] = {
          old: stopMultiplier,
          new: Math.min(3.0, stopMultiplier + lr),
        };
      }
    }

    // Adjust sizing based on confidence in current regime
    const regime = latestTrade.regime;
    const regimeStats = state.regimePerformance[regime];
    const sizingMultiplier = state.parameters["sizing_multiplier"] ?? 1.0;
    if (regimeStats && regimeStats.trades >= 10) {
      if (regimeStats.winRate > 0.6 && regimeStats.profitFactor > 1.5) {
        updates["sizing_multiplier"] = {
          old: sizingMultiplier,
          new: Math.min(1.5, sizingMultiplier + lr * 0.3),
        };
      } else if (regimeStats.winRate < 0.35) {
        updates["sizing_multiplier"] = {
          old: sizingMultiplier,
          new: Math.max(0.25, sizingMultiplier - lr),
        };
      }
    }

    return updates;
  }

  /** Evaluate and potentially transition tier */
  private evaluateTier(state: StrategyState): TierTransition | null {
    const stats = state.lifetimeStats;
    const oldTier = state.tier;
    let newTier = oldTier;
    let reason = "";

    // SEED → LEARNING
    if (oldTier === "SEED" && stats.totalTrades >= this.config.minTradesForLearning) {
      newTier = "LEARNING";
      reason = `Reached ${stats.totalTrades} trades, entering learning phase`;
    }

    // LEARNING → PROVEN
    if (oldTier === "LEARNING" &&
        stats.totalTrades >= this.config.minTradesForProven &&
        stats.winRate > 0.45 &&
        stats.profitFactor > 1.0) {
      newTier = "PROVEN";
      reason = `${stats.totalTrades} trades with ${(stats.winRate * 100).toFixed(0)}% win rate and PF ${stats.profitFactor.toFixed(2)}`;
    }

    // PROVEN → ELITE
    if (oldTier === "PROVEN" &&
        stats.totalTrades >= this.config.minTradesForElite &&
        stats.winRate > 0.55 &&
        stats.profitFactor > 1.5 &&
        stats.sharpe > 1.0 &&
        stats.consistency > 0.7) {
      newTier = "ELITE";
      reason = `Elite performance: Sharpe ${stats.sharpe.toFixed(2)}, PF ${stats.profitFactor.toFixed(2)}, Consistency ${(stats.consistency * 100).toFixed(0)}%`;
    }

    // Any → DEGRADING (consecutive losses)
    const recent = state.performanceWindow.slice(-this.config.degradeAfterLosses);
    if (recent.length >= this.config.degradeAfterLosses &&
        recent.every((t) => t.outcome === "loss") &&
        oldTier !== "SUSPENDED") {
      newTier = "DEGRADING";
      reason = `${this.config.degradeAfterLosses} consecutive losses detected`;
    }

    // Any → SUSPENDED (extreme drawdown)
    const drawdown = state.performanceWindow.reduce((s, t) => s + t.pnlR, 0);
    if (drawdown < -this.config.suspendAfterDrawdown) {
      newTier = "SUSPENDED";
      reason = `Drawdown of ${Math.abs(drawdown).toFixed(1)}R exceeds limit of ${this.config.suspendAfterDrawdown}R`;
    }

    // DEGRADING → LEARNING (recovery)
    if (oldTier === "DEGRADING") {
      const recentFive = state.performanceWindow.slice(-5);
      if (recentFive.length >= 5 && recentFive.filter((t) => t.outcome === "win").length >= 3) {
        newTier = "LEARNING";
        reason = "Recovery detected: 3/5 recent trades won";
      }
    }

    if (newTier !== oldTier) {
      state.tier = newTier;
      const transition: TierTransition = { from: oldTier, to: newTier, reason, ts: new Date() };
      this.transitions.push(transition);
      return transition;
    }

    return null;
  }

  /** Update lifetime statistics */
  private updateLifetimeStats(state: StrategyState): void {
    const window = state.performanceWindow;
    if (window.length === 0) return;

    const wins = window.filter((t) => t.outcome === "win");
    const losses = window.filter((t) => t.outcome === "loss");
    const pnlRs = window.map((t) => t.pnlR);

    state.lifetimeStats.totalTrades = window.length;
    state.lifetimeStats.winRate = window.length > 0 ? wins.length / window.length : 0;
    state.lifetimeStats.avgPnlR = pnlRs.reduce((a, b) => a + b, 0) / pnlRs.length;

    // Sharpe
    const mean = state.lifetimeStats.avgPnlR;
    const stdDev = pnlRs.length > 1
      ? Math.sqrt(pnlRs.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnlRs.length - 1))
      : 1;
    state.lifetimeStats.sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    // Profit factor
    const grossProfit = wins.reduce((s, t) => s + t.pnlR, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
    state.lifetimeStats.profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Max drawdown
    let peak = 0;
    let cumPnl = 0;
    let maxDD = 0;
    for (const t of window) {
      cumPnl += t.pnlR;
      peak = Math.max(peak, cumPnl);
      maxDD = Math.max(maxDD, peak - cumPnl);
    }
    state.lifetimeStats.maxDrawdownR = maxDD;

    // Consistency (rolling 10-trade blocks)
    const blockSize = 10;
    const blocks: number[] = [];
    for (let i = 0; i + blockSize <= window.length; i += blockSize) {
      const block = window.slice(i, i + blockSize);
      const blockWinRate = block.filter((t) => t.outcome === "win").length / block.length;
      blocks.push(blockWinRate);
    }
    if (blocks.length >= 2) {
      const blockMean = blocks.reduce((a, b) => a + b, 0) / blocks.length;
      const blockStd = Math.sqrt(blocks.reduce((s, v) => s + (v - blockMean) ** 2, 0) / (blocks.length - 1));
      state.lifetimeStats.consistency = Math.max(0, 1 - blockStd * 2);
    }
  }

  /** Update regime-specific performance */
  private updateRegimePerformance(state: StrategyState, result: TradeResult): void {
    const regime = result.regime;
    const stats = state.regimePerformance[regime] ?? { trades: 0, winRate: 0, avgPnlR: 0, profitFactor: 0 };

    stats.trades++;
    const regimeTrades = state.performanceWindow.filter((t) => t.regime === regime);
    stats.winRate = regimeTrades.filter((t) => t.outcome === "win").length / regimeTrades.length;
    stats.avgPnlR = regimeTrades.reduce((s, t) => s + t.pnlR, 0) / regimeTrades.length;

    const wins = regimeTrades.filter((t) => t.pnlR > 0);
    const losses = regimeTrades.filter((t) => t.pnlR < 0);
    const gp = wins.reduce((s, t) => s + t.pnlR, 0);
    const gl = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
    stats.profitFactor = gl > 0 ? gp / gl : gp > 0 ? Infinity : 0;

    state.regimePerformance[regime] = stats;
  }

  /** Get strategy state */
  getStrategy(strategyId: string): StrategyState | undefined {
    return this.strategies.get(strategyId);
  }

  /** Get all strategies */
  getAllStrategies(): StrategyState[] {
    return Array.from(this.strategies.values());
  }

  /** Get strategies by tier */
  getStrategiesByTier(tier: string): StrategyState[] {
    return Array.from(this.strategies.values()).filter((s) => s.tier === tier);
  }

  /** Get tier transition history */
  getTransitions(): TierTransition[] {
    return [...this.transitions];
  }
}
