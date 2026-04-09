import { randomUUID } from 'crypto';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type BacktestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type BacktestMode = 'standard' | 'walk_forward' | 'monte_carlo' | 'regime_aware' | 'stress_test';

export interface BacktestConfig {
  strategy_id: string;
  symbol: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  commission_bps: number;
  slippage_bps: number;
  mode: BacktestMode;
  params?: Record<string, number>;
}

export interface BacktestTrade {
  id: string;
  backtest_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entry_price: number;
  exit_price: number;
  entry_time: string;
  exit_time: string;
  pnl: number;
  pnl_pct: number;
  commission: number;
  slippage: number;
  hold_duration_hours: number;
}

export interface BacktestMetrics {
  total_return_pct: number;
  annual_return_pct: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown_pct: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  avg_hold_hours: number;
  expectancy: number;
  recovery_factor: number;
  calmar_ratio: number;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  status: BacktestStatus;
  metrics?: BacktestMetrics;
  trades: BacktestTrade[];
  equity_curve: { timestamp: string; equity: number }[];
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;
}

export interface WalkForwardWindow {
  id: string;
  backtest_id: string;
  window_number: number;
  in_sample_start: string;
  in_sample_end: string;
  out_sample_start: string;
  out_sample_end: string;
  in_sample_metrics: BacktestMetrics;
  out_sample_metrics: BacktestMetrics;
  efficiency_ratio: number;
}

export interface WalkForwardResult {
  id: string;
  backtest_id: string;
  windows: WalkForwardWindow[];
  total_windows: number;
  avg_efficiency: number;
  oos_consistency: number;
  degradation_score: number;
  verdict: 'robust' | 'marginal' | 'overfit' | 'insufficient_data';
}

export interface MonteCarloRun {
  id: string;
  backtest_id: string;
  run_number: number;
  total_return_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
}

export interface MonteCarloResult {
  id: string;
  backtest_id: string;
  num_runs: number;
  runs: MonteCarloRun[];
  percentiles: {
    p5: BacktestMetrics;
    p25: BacktestMetrics;
    p50: BacktestMetrics;
    p75: BacktestMetrics;
    p95: BacktestMetrics;
  };
  ruin_probability: number;
  verdict: 'robust' | 'acceptable' | 'fragile';
}

export interface StressScenario {
  id: string;
  name: string;
  description: string;
  price_shock_pct: number;
  volatility_multiplier: number;
  liquidity_reduction_pct: number;
  created_at: string;
}

export interface StressTestResult {
  id: string;
  backtest_id: string;
  scenario: StressScenario;
  original_metrics: BacktestMetrics;
  stressed_metrics: BacktestMetrics;
  impact_score: number;
  survival: boolean;
}

// ============================================================================
// BACKTEST ENGINE V2 CLASS
// ============================================================================

class BacktestEngineV2 {
  private results: Map<string, BacktestResult>;
  private walkForwards: Map<string, WalkForwardResult>;
  private monteCarlo: Map<string, MonteCarloResult>;
  private stressScenarios: Map<string, StressScenario>;
  private stressResults: Map<string, StressTestResult>;

  constructor() {
    this.results = new Map();
    this.walkForwards = new Map();
    this.monteCarlo = new Map();
    this.stressScenarios = new Map();
    this.stressResults = new Map();
  }

  // =========================================================================
  // BACKTEST LIFECYCLE
  // =========================================================================

  createBacktest(config: BacktestConfig): BacktestResult {
    const id = `bt_${randomUUID()}`;
    const result: BacktestResult = {
      id,
      config,
      status: 'pending',
      trades: [],
      equity_curve: [],
      started_at: new Date().toISOString(),
    };
    this.results.set(id, result);
    return result;
  }

  runBacktest(id: string): BacktestResult {
    const backtest = this.results.get(id);
    if (!backtest) {
      throw new Error(`Backtest ${id} not found`);
    }

    backtest.status = 'running';
    const startTime = Date.now();

    try {
      // Generate simulated trades
      const numTrades = Math.floor(Math.random() * 11) + 10; // 10-20 trades
      const trades = this._generateTrades(backtest, numTrades);
      backtest.trades = trades;

      // Build equity curve
      backtest.equity_curve = this._buildEquityCurve(backtest);

      // Compute metrics
      backtest.metrics = this._computeMetrics(backtest);

      backtest.status = 'completed';
      backtest.completed_at = new Date().toISOString();
      backtest.duration_ms = Date.now() - startTime;
    } catch (error) {
      backtest.status = 'failed';
      backtest.error = error instanceof Error ? error.message : 'Unknown error';
      backtest.completed_at = new Date().toISOString();
      backtest.duration_ms = Date.now() - startTime;
    }

    return backtest;
  }

  cancelBacktest(id: string): BacktestResult {
    const backtest = this.results.get(id);
    if (!backtest) {
      throw new Error(`Backtest ${id} not found`);
    }
    backtest.status = 'cancelled';
    backtest.completed_at = new Date().toISOString();
    return backtest;
  }

  getBacktest(id: string): BacktestResult | undefined {
    return this.results.get(id);
  }

  getAllBacktests(limit?: number): BacktestResult[] {
    const all = Array.from(this.results.values());
    return limit ? all.slice(0, limit) : all;
  }

  getBacktestsForStrategy(strategy_id: string): BacktestResult[] {
    return Array.from(this.results.values()).filter(
      (bt) => bt.config.strategy_id === strategy_id
    );
  }

  // =========================================================================
  // WALK-FORWARD ANALYSIS
  // =========================================================================

  runWalkForward(backtest_id: string, num_windows: number): WalkForwardResult {
    const backtest = this.results.get(backtest_id);
    if (!backtest) {
      throw new Error(`Backtest ${backtest_id} not found`);
    }

    const start = new Date(backtest.config.start_date).getTime();
    const end = new Date(backtest.config.end_date).getTime();
    const totalDuration = end - start;
    const windowDuration = totalDuration / num_windows;
    const windowSize = windowDuration / 2; // 50% in-sample, 50% out-sample

    const windows: WalkForwardWindow[] = [];
    let totalEfficiency = 0;

    for (let i = 0; i < num_windows; i++) {
      const windowStart = start + i * windowDuration;
      const inSampleEnd = windowStart + windowSize;
      const outSampleEnd = windowStart + windowDuration;

      const in_sample_start = new Date(windowStart).toISOString().split('T')[0];
      const in_sample_end = new Date(inSampleEnd).toISOString().split('T')[0];
      const out_sample_start = new Date(inSampleEnd).toISOString().split('T')[0];
      const out_sample_end = new Date(outSampleEnd).toISOString().split('T')[0];

      // Generate metrics for in-sample and out-sample
      const in_sample_metrics = this._generateRandomMetrics();
      const out_sample_metrics = this._generateRandomMetrics();

      // Efficiency ratio: |OOS return / IS return| — clamped to [0, 2]
      const efficiency_ratio =
        in_sample_metrics.total_return_pct !== 0
          ? Math.min(Math.abs(out_sample_metrics.total_return_pct / in_sample_metrics.total_return_pct), 2.0)
          : 0.5;

      totalEfficiency += efficiency_ratio;

      const window: WalkForwardWindow = {
        id: `wfw_${randomUUID()}`,
        backtest_id,
        window_number: i + 1,
        in_sample_start,
        in_sample_end,
        out_sample_start,
        out_sample_end,
        in_sample_metrics,
        out_sample_metrics,
        efficiency_ratio,
      };

      windows.push(window);
    }

    const avg_efficiency = totalEfficiency / num_windows;
    const oos_consistency = Math.abs(windows[0].efficiency_ratio - avg_efficiency) < 0.1 ? 0.8 : 0.5;
    const degradation_score = 1 - avg_efficiency;

    let verdict: 'robust' | 'marginal' | 'overfit' | 'insufficient_data';
    if (num_windows < 3) {
      verdict = 'insufficient_data';
    } else if (avg_efficiency >= 0.7) {
      verdict = 'robust';
    } else if (avg_efficiency >= 0.5) {
      verdict = 'marginal';
    } else {
      verdict = 'overfit';
    }

    const result: WalkForwardResult = {
      id: `wf_${randomUUID()}`,
      backtest_id,
      windows,
      total_windows: num_windows,
      avg_efficiency,
      oos_consistency,
      degradation_score,
      verdict,
    };

    this.walkForwards.set(result.id, result);
    return result;
  }

  getWalkForward(id: string): WalkForwardResult | undefined {
    return this.walkForwards.get(id);
  }

  getWalkForwardForBacktest(backtest_id: string): WalkForwardResult | undefined {
    return Array.from(this.walkForwards.values()).find(
      (wf) => wf.backtest_id === backtest_id
    );
  }

  // =========================================================================
  // MONTE CARLO SIMULATION
  // =========================================================================

  runMonteCarlo(backtest_id: string, num_runs: number): MonteCarloResult {
    const backtest = this.results.get(backtest_id);
    if (!backtest) {
      throw new Error(`Backtest ${backtest_id} not found`);
    }

    const runs: MonteCarloRun[] = [];
    const returns: number[] = [];
    const maxDrawdowns: number[] = [];
    const sharpeRatios: number[] = [];

    for (let i = 0; i < num_runs; i++) {
      const total_return_pct = -20 + Math.random() * 60; // -20% to +40%
      const max_drawdown_pct = Math.random() * 40; // 0-40%
      const sharpe_ratio = (Math.random() - 0.3) * 3; // -0.3 to 2.7

      returns.push(total_return_pct);
      maxDrawdowns.push(max_drawdown_pct);
      sharpeRatios.push(sharpe_ratio);

      runs.push({
        id: `mcr_${randomUUID()}`,
        backtest_id,
        run_number: i + 1,
        total_return_pct,
        max_drawdown_pct,
        sharpe_ratio,
      });
    }

    // Calculate percentiles
    const sortReturns = [...returns].sort((a, b) => a - b);
    const sortMaxDD = [...maxDrawdowns].sort((a, b) => a - b);
    const sortSharpe = [...sharpeRatios].sort((a, b) => a - b);

    const percentiles = {
      p5: { ...this._generateRandomMetrics(), total_return_pct: sortReturns[Math.floor(num_runs * 0.05)] },
      p25: { ...this._generateRandomMetrics(), total_return_pct: sortReturns[Math.floor(num_runs * 0.25)] },
      p50: { ...this._generateRandomMetrics(), total_return_pct: sortReturns[Math.floor(num_runs * 0.5)] },
      p75: { ...this._generateRandomMetrics(), total_return_pct: sortReturns[Math.floor(num_runs * 0.75)] },
      p95: { ...this._generateRandomMetrics(), total_return_pct: sortReturns[Math.floor(num_runs * 0.95)] },
    };

    // Ruin probability: runs where max_dd > 50% / total
    const ruined = maxDrawdowns.filter((dd) => dd > 50).length;
    const ruin_probability = ruined / num_runs;

    let verdict: 'robust' | 'acceptable' | 'fragile';
    if (ruin_probability < 0.05) {
      verdict = 'robust';
    } else if (ruin_probability < 0.15) {
      verdict = 'acceptable';
    } else {
      verdict = 'fragile';
    }

    const result: MonteCarloResult = {
      id: `mc_${randomUUID()}`,
      backtest_id,
      num_runs,
      runs,
      percentiles,
      ruin_probability,
      verdict,
    };

    this.monteCarlo.set(result.id, result);
    return result;
  }

  getMonteCarlo(id: string): MonteCarloResult | undefined {
    return this.monteCarlo.get(id);
  }

  getMonteCarloForBacktest(backtest_id: string): MonteCarloResult | undefined {
    return Array.from(this.monteCarlo.values()).find(
      (mc) => mc.backtest_id === backtest_id
    );
  }

  // =========================================================================
  // STRESS TESTING
  // =========================================================================

  addStressScenario(
    name: string,
    description: string,
    price_shock_pct: number,
    volatility_multiplier: number,
    liquidity_reduction_pct: number
  ): StressScenario {
    const scenario: StressScenario = {
      id: `stress_${randomUUID()}`,
      name,
      description,
      price_shock_pct,
      volatility_multiplier,
      liquidity_reduction_pct,
      created_at: new Date().toISOString(),
    };
    this.stressScenarios.set(scenario.id, scenario);
    return scenario;
  }

  getStressScenario(id: string): StressScenario | undefined {
    return this.stressScenarios.get(id);
  }

  getAllStressScenarios(): StressScenario[] {
    return Array.from(this.stressScenarios.values());
  }

  runStressTest(backtest_id: string, scenario_id: string): StressTestResult {
    const backtest = this.results.get(backtest_id);
    const scenario = this.stressScenarios.get(scenario_id);

    if (!backtest) {
      throw new Error(`Backtest ${backtest_id} not found`);
    }
    if (!scenario) {
      throw new Error(`Stress scenario ${scenario_id} not found`);
    }

    const original_metrics = backtest.metrics || this._generateRandomMetrics();

    // Apply stress scenario
    const stressed_metrics: BacktestMetrics = {
      ...original_metrics,
      total_return_pct: original_metrics.total_return_pct * (1 + scenario.price_shock_pct / 100),
      max_drawdown_pct: original_metrics.max_drawdown_pct * scenario.volatility_multiplier,
      sharpe_ratio: original_metrics.sharpe_ratio * (1 - scenario.liquidity_reduction_pct / 100),
    };

    // Impact score
    const impact_score =
      original_metrics.total_return_pct !== 0
        ? Math.abs(original_metrics.total_return_pct - stressed_metrics.total_return_pct) /
          Math.abs(original_metrics.total_return_pct)
        : 0;

    // Survival: stressed max_dd < 50%
    const survival = stressed_metrics.max_drawdown_pct < 50;

    const result: StressTestResult = {
      id: `stresst_${randomUUID()}`,
      backtest_id,
      scenario,
      original_metrics,
      stressed_metrics,
      impact_score,
      survival,
    };

    this.stressResults.set(result.id, result);
    return result;
  }

  getStressTestResult(id: string): StressTestResult | undefined {
    return this.stressResults.get(id);
  }

  getStressTestsForBacktest(backtest_id: string): StressTestResult[] {
    return Array.from(this.stressResults.values()).filter(
      (st) => st.backtest_id === backtest_id
    );
  }

  // =========================================================================
  // STATISTICS
  // =========================================================================

  getBacktestStats(): {
    total_backtests: number;
    by_status: Record<BacktestStatus, number>;
    by_mode: Record<BacktestMode, number>;
    avg_sharpe: number;
    avg_win_rate: number;
  } {
    const all = Array.from(this.results.values());

    const by_status: Record<BacktestStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    const by_mode: Record<BacktestMode, number> = {
      standard: 0,
      walk_forward: 0,
      monte_carlo: 0,
      regime_aware: 0,
      stress_test: 0,
    };

    let totalSharpe = 0;
    let totalWinRate = 0;
    let countMetrics = 0;

    for (const bt of all) {
      by_status[bt.status]++;
      by_mode[bt.config.mode]++;

      if (bt.metrics) {
        totalSharpe += bt.metrics.sharpe_ratio;
        totalWinRate += bt.metrics.win_rate;
        countMetrics++;
      }
    }

    return {
      total_backtests: all.length,
      by_status,
      by_mode,
      avg_sharpe: countMetrics > 0 ? totalSharpe / countMetrics : 0,
      avg_win_rate: countMetrics > 0 ? totalWinRate / countMetrics : 0,
    };
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  _clearBacktestV2(): void {
    this.results.clear();
    this.walkForwards.clear();
    this.monteCarlo.clear();
    this.stressScenarios.clear();
    this.stressResults.clear();
  }

  private _generateTrades(backtest: BacktestResult, count: number): BacktestTrade[] {
    const trades: BacktestTrade[] = [];
    const start = new Date(backtest.config.start_date).getTime();
    const end = new Date(backtest.config.end_date).getTime();
    const timeRange = end - start;

    for (let i = 0; i < count; i++) {
      const entryTime = start + Math.random() * timeRange * 0.9;
      const exitTime = entryTime + Math.random() * 168 * 3600 * 1000; // up to 1 week
      const entryPrice = 100 + (Math.random() - 0.5) * 20;
      const exitPrice = entryPrice * (1 + (Math.random() - 0.5) * 0.1);
      const quantity = Math.floor(Math.random() * 100) + 1;

      const commission = (entryPrice * quantity * backtest.config.commission_bps) / 10000;
      const slippage = (entryPrice * quantity * backtest.config.slippage_bps) / 10000;
      const pnl = (exitPrice - entryPrice) * quantity - commission - slippage;
      const pnl_pct = (pnl / (entryPrice * quantity)) * 100;
      const hold_duration_hours = (exitTime - entryTime) / 3600000;

      trades.push({
        id: `tr_${randomUUID()}`,
        backtest_id: backtest.id,
        symbol: backtest.config.symbol,
        side: Math.random() > 0.5 ? 'buy' : 'sell',
        quantity,
        entry_price: entryPrice,
        exit_price: exitPrice,
        entry_time: new Date(entryTime).toISOString(),
        exit_time: new Date(exitTime).toISOString(),
        pnl,
        pnl_pct,
        commission,
        slippage,
        hold_duration_hours,
      });
    }

    return trades;
  }

  private _buildEquityCurve(
    backtest: BacktestResult
  ): { timestamp: string; equity: number }[] {
    const curve: { timestamp: string; equity: number }[] = [];
    let equity = backtest.config.initial_capital;

    const start = new Date(backtest.config.start_date).getTime();
    const end = new Date(backtest.config.end_date).getTime();
    const step = (end - start) / 50; // 50 points

    for (let i = 0; i <= 50; i++) {
      const timestamp = new Date(start + i * step);
      equity *= 1 + (Math.random() - 0.4) * 0.02; // random walk with positive bias
      curve.push({
        timestamp: timestamp.toISOString(),
        equity: Math.max(equity, backtest.config.initial_capital * 0.5), // floor at -50%
      });
    }

    return curve;
  }

  private _computeMetrics(backtest: BacktestResult): BacktestMetrics {
    const trades = backtest.trades;
    const totalReturn =
      trades.reduce((sum, t) => sum + t.pnl, 0) / backtest.config.initial_capital;
    const totalReturnPct = totalReturn * 100;

    const winningTrades = trades.filter((t) => t.pnl > 0);
    const losingTrades = trades.filter((t) => t.pnl < 0);
    const winRate =
      trades.length > 0 ? winningTrades.length / trades.length : 0;

    const avgWinPct =
      winningTrades.length > 0
        ? (winningTrades.reduce((sum, t) => sum + t.pnl_pct, 0) /
          winningTrades.length)
        : 0;

    const avgLossPct =
      losingTrades.length > 0
        ? (losingTrades.reduce((sum, t) => sum + t.pnl_pct, 0) /
          losingTrades.length)
        : 0;

    const profitFactor =
      losingTrades.length > 0
        ? Math.abs(
          winningTrades.reduce((sum, t) => sum + t.pnl, 0) /
          losingTrades.reduce((sum, t) => sum + t.pnl, 0)
        )
        : 999;

    const curve = backtest.equity_curve;
    let maxDD = 0;
    let peak = curve[0]?.equity || backtest.config.initial_capital;
    for (const point of curve) {
      if (point.equity > peak) peak = point.equity;
      const dd = (peak - point.equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    const maxDrawdownPct = maxDD * 100;

    const avgHoldHours =
      trades.length > 0
        ? trades.reduce((sum, t) => sum + t.hold_duration_hours, 0) /
        trades.length
        : 0;

    const expectancy =
      avgWinPct * winRate - Math.abs(avgLossPct) * (1 - winRate);

    const sharpeRatio = maxDrawdownPct > 0 ? totalReturnPct / (maxDrawdownPct + 0.01) : 0;
    const sortino = sharpeRatio; // simplified
    const recoveryFactor =
      maxDrawdownPct > 0
        ? totalReturnPct / (maxDrawdownPct + 0.01)
        : 0;
    const calmarRatio =
      maxDrawdownPct > 0
        ? totalReturnPct / (maxDrawdownPct + 0.01)
        : 0;

    // Annual return (assuming 252 trading days)
    const days =
      (new Date(backtest.config.end_date).getTime() -
        new Date(backtest.config.start_date).getTime()) /
      (1000 * 60 * 60 * 24);
    const years = days / 365;
    const annualReturnPct = years > 0 ? (totalReturnPct + 100) ** (1 / years) - 100 : totalReturnPct;

    return {
      total_return_pct: totalReturnPct,
      annual_return_pct: annualReturnPct,
      sharpe_ratio: sharpeRatio,
      sortino_ratio: sortino,
      max_drawdown_pct: maxDrawdownPct,
      win_rate: winRate,
      profit_factor: profitFactor,
      total_trades: trades.length,
      winning_trades: winningTrades.length,
      losing_trades: losingTrades.length,
      avg_win_pct: avgWinPct,
      avg_loss_pct: avgLossPct,
      avg_hold_hours: avgHoldHours,
      expectancy,
      recovery_factor: recoveryFactor,
      calmar_ratio: calmarRatio,
    };
  }

  private _generateRandomMetrics(): BacktestMetrics {
    const totalReturn = -10 + Math.random() * 50;
    const winRate = 0.4 + Math.random() * 0.4;
    const avgWin = 2 + Math.random() * 3;
    const avgLoss = -1.5 - Math.random() * 1;
    const expectancy = avgWin * winRate + avgLoss * (1 - winRate);
    const maxDD = Math.random() * 35;

    return {
      total_return_pct: totalReturn,
      annual_return_pct: totalReturn / 3,
      sharpe_ratio: totalReturn / (maxDD + 0.01),
      sortino_ratio: totalReturn / (maxDD * 0.7 + 0.01),
      max_drawdown_pct: maxDD,
      win_rate: winRate,
      profit_factor: winRate > 0 ? Math.abs(avgWin * winRate / (avgLoss * (1 - winRate))) : 1,
      total_trades: Math.floor(10 + Math.random() * 90),
      winning_trades: Math.floor((10 + Math.random() * 90) * winRate),
      losing_trades: Math.floor((10 + Math.random() * 90) * (1 - winRate)),
      avg_win_pct: avgWin,
      avg_loss_pct: avgLoss,
      avg_hold_hours: 1 + Math.random() * 168,
      expectancy,
      recovery_factor: totalReturn / (maxDD + 0.01),
      calmar_ratio: totalReturn / (maxDD + 0.01),
    };
  }
}

// ============================================================================
// SINGLETON & EXPORTS
// ============================================================================

const engine = new BacktestEngineV2();

export function createBacktest(config: BacktestConfig): BacktestResult {
  return engine.createBacktest(config);
}

export function runBacktest(id: string): BacktestResult {
  return engine.runBacktest(id);
}

export function cancelBacktest(id: string): BacktestResult {
  return engine.cancelBacktest(id);
}

export function getBacktest(id: string): BacktestResult | undefined {
  return engine.getBacktest(id);
}

export function getAllBacktests(limit?: number): BacktestResult[] {
  return engine.getAllBacktests(limit);
}

export function getBacktestsForStrategy(strategy_id: string): BacktestResult[] {
  return engine.getBacktestsForStrategy(strategy_id);
}

export function runWalkForward(backtest_id: string, num_windows: number): WalkForwardResult {
  return engine.runWalkForward(backtest_id, num_windows);
}

export function getWalkForward(id: string): WalkForwardResult | undefined {
  return engine.getWalkForward(id);
}

export function getWalkForwardForBacktest(backtest_id: string): WalkForwardResult | undefined {
  return engine.getWalkForwardForBacktest(backtest_id);
}

export function runMonteCarlo(backtest_id: string, num_runs: number): MonteCarloResult {
  return engine.runMonteCarlo(backtest_id, num_runs);
}

export function getMonteCarlo(id: string): MonteCarloResult | undefined {
  return engine.getMonteCarlo(id);
}

export function getMonteCarloForBacktest(backtest_id: string): MonteCarloResult | undefined {
  return engine.getMonteCarloForBacktest(backtest_id);
}

export function addStressScenario(
  name: string,
  description: string,
  price_shock_pct: number,
  volatility_multiplier: number,
  liquidity_reduction_pct: number
): StressScenario {
  return engine.addStressScenario(name, description, price_shock_pct, volatility_multiplier, liquidity_reduction_pct);
}

export function getStressScenario(id: string): StressScenario | undefined {
  return engine.getStressScenario(id);
}

export function getAllStressScenarios(): StressScenario[] {
  return engine.getAllStressScenarios();
}

export function runStressTest(backtest_id: string, scenario_id: string): StressTestResult {
  return engine.runStressTest(backtest_id, scenario_id);
}

export function getStressTestResult(id: string): StressTestResult | undefined {
  return engine.getStressTestResult(id);
}

export function getStressTestsForBacktest(backtest_id: string): StressTestResult[] {
  return engine.getStressTestsForBacktest(backtest_id);
}

export function getBacktestStats(): {
  total_backtests: number;
  by_status: Record<BacktestStatus, number>;
  by_mode: Record<BacktestMode, number>;
  avg_sharpe: number;
  avg_win_rate: number;
} {
  return engine.getBacktestStats();
}

export function _clearBacktestV2(): void {
  engine._clearBacktestV2();
}
