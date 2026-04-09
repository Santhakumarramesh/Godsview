import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BacktestConfig,
  BacktestResult,
  BacktestStatus,
  BacktestMode,
  createBacktest,
  runBacktest,
  cancelBacktest,
  getBacktest,
  getAllBacktests,
  getBacktestsForStrategy,
  runWalkForward,
  getWalkForward,
  getWalkForwardForBacktest,
  runMonteCarlo,
  getMonteCarlo,
  getMonteCarloForBacktest,
  addStressScenario,
  getStressScenario,
  getAllStressScenarios,
  runStressTest,
  getStressTestResult,
  getStressTestsForBacktest,
  getBacktestStats,
  _clearBacktestV2,
} from '../lib/backtest_v2_engine';

// Mock pino logger
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('pino-pretty', () => ({
  default: vi.fn(),
}));

describe('BacktestEngineV2', () => {
  beforeEach(() => {
    _clearBacktestV2();
  });

  // =========================================================================
  // BACKTEST CREATION & LIFECYCLE
  // =========================================================================

  describe('Backtest Creation', () => {
    it('should create a backtest with pending status', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const result = createBacktest(config);

      expect(result.id).toMatch(/^bt_/);
      expect(result.status).toBe('pending');
      expect(result.config).toEqual(config);
      expect(result.trades).toEqual([]);
      expect(result.equity_curve).toEqual([]);
    });

    it('should generate unique backtest IDs', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'ETH/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 50000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const bt1 = createBacktest(config);
      const bt2 = createBacktest(config);

      expect(bt1.id).not.toBe(bt2.id);
    });

    it('should accept optional params in config', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
        params: { rsi_period: 14, rsi_threshold: 70 },
      };

      const result = createBacktest(config);

      expect(result.config.params).toEqual({ rsi_period: 14, rsi_threshold: 70 });
    });
  });

  describe('Backtest Execution', () => {
    it('should run backtest and set status to completed', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const created = createBacktest(config);
      const result = runBacktest(created.id);

      expect(result.status).toBe('completed');
      expect(result.completed_at).toBeDefined();
      expect(result.duration_ms).toBeDefined();
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should generate trades during backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const created = createBacktest(config);
      const result = runBacktest(created.id);

      expect(result.trades.length).toBeGreaterThanOrEqual(10);
      expect(result.trades.length).toBeLessThanOrEqual(20);
    });

    it('should generate equity curve during backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const created = createBacktest(config);
      const result = runBacktest(created.id);

      expect(result.equity_curve.length).toBeGreaterThan(0);
      expect(result.equity_curve[0].equity).toBeGreaterThan(0);
    });

    it('should compute metrics after backtest execution', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const created = createBacktest(config);
      const result = runBacktest(created.id);

      expect(result.metrics).toBeDefined();
      expect(result.metrics?.total_return_pct).toBeDefined();
      expect(result.metrics?.sharpe_ratio).toBeDefined();
      expect(result.metrics?.max_drawdown_pct).toBeDefined();
      expect(result.metrics?.win_rate).toBeDefined();
    });

    it('should throw error for non-existent backtest', () => {
      expect(() => runBacktest('bt_nonexistent')).toThrow('not found');
    });
  });

  describe('Backtest Cancellation', () => {
    it('should cancel a backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const created = createBacktest(config);
      const result = cancelBacktest(created.id);

      expect(result.status).toBe('cancelled');
      expect(result.completed_at).toBeDefined();
    });

    it('should throw error when cancelling non-existent backtest', () => {
      expect(() => cancelBacktest('bt_nonexistent')).toThrow('not found');
    });
  });

  // =========================================================================
  // BACKTEST RETRIEVAL
  // =========================================================================

  describe('Backtest Retrieval', () => {
    it('should retrieve a single backtest by ID', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const created = createBacktest(config);
      const retrieved = getBacktest(created.id);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent backtest', () => {
      const result = getBacktest('bt_nonexistent');
      expect(result).toBeUndefined();
    });

    it('should retrieve all backtests', () => {
      const config1: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const config2: BacktestConfig = {
        strategy_id: 'strat_002',
        symbol: 'ETH/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 50000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      createBacktest(config1);
      createBacktest(config2);

      const all = getAllBacktests();
      expect(all.length).toBe(2);
    });

    it('should apply limit when retrieving all backtests', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      createBacktest(config);
      createBacktest(config);
      createBacktest(config);

      const limited = getAllBacktests(2);
      expect(limited.length).toBe(2);
    });

    it('should retrieve backtests for a specific strategy', () => {
      const config1: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const config2: BacktestConfig = {
        strategy_id: 'strat_002',
        symbol: 'ETH/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 50000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      createBacktest(config1);
      createBacktest(config1);
      createBacktest(config2);

      const strat1 = getBacktestsForStrategy('strat_001');
      const strat2 = getBacktestsForStrategy('strat_002');

      expect(strat1.length).toBe(2);
      expect(strat2.length).toBe(1);
    });
  });

  // =========================================================================
  // WALK-FORWARD ANALYSIS
  // =========================================================================

  describe('Walk-Forward Analysis', () => {
    it('should run walk-forward analysis', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      const backtest = createBacktest(config);
      const result = runWalkForward(backtest.id, 5);

      expect(result.id).toMatch(/^wf_/);
      expect(result.total_windows).toBe(5);
      expect(result.windows.length).toBe(5);
    });

    it('should calculate efficiency ratio for each window', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      const backtest = createBacktest(config);
      const result = runWalkForward(backtest.id, 3);

      result.windows.forEach((window) => {
        expect(window.efficiency_ratio).toBeGreaterThanOrEqual(0);
        expect(window.window_number).toBeGreaterThan(0);
      });
    });

    it('should assign verdict based on average efficiency', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      const backtest = createBacktest(config);
      const result = runWalkForward(backtest.id, 5);

      expect(['robust', 'marginal', 'overfit', 'insufficient_data']).toContain(result.verdict);
    });

    it('should assign insufficient_data verdict for < 3 windows', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      const backtest = createBacktest(config);
      const result = runWalkForward(backtest.id, 2);

      expect(result.verdict).toBe('insufficient_data');
    });

    it('should retrieve walk-forward result by ID', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      const backtest = createBacktest(config);
      const wf = runWalkForward(backtest.id, 5);
      const retrieved = getWalkForward(wf.id);

      expect(retrieved).toEqual(wf);
    });

    it('should retrieve walk-forward result for a backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'walk_forward',
      };

      const backtest = createBacktest(config);
      const wf = runWalkForward(backtest.id, 3);
      const retrieved = getWalkForwardForBacktest(backtest.id);

      expect(retrieved?.id).toBe(wf.id);
    });

    it('should throw error for non-existent backtest in walk-forward', () => {
      expect(() => runWalkForward('bt_nonexistent', 3)).toThrow('not found');
    });
  });

  // =========================================================================
  // MONTE CARLO SIMULATION
  // =========================================================================

  describe('Monte Carlo Simulation', () => {
    it('should run Monte Carlo simulation', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'monte_carlo',
      };

      const backtest = createBacktest(config);
      const result = runMonteCarlo(backtest.id, 100);

      expect(result.id).toMatch(/^mc_/);
      expect(result.num_runs).toBe(100);
      expect(result.runs.length).toBe(100);
    });

    it('should calculate percentiles correctly', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'monte_carlo',
      };

      const backtest = createBacktest(config);
      const result = runMonteCarlo(backtest.id, 100);

      expect(result.percentiles.p5).toBeDefined();
      expect(result.percentiles.p25).toBeDefined();
      expect(result.percentiles.p50).toBeDefined();
      expect(result.percentiles.p75).toBeDefined();
      expect(result.percentiles.p95).toBeDefined();
    });

    it('should calculate ruin probability', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'monte_carlo',
      };

      const backtest = createBacktest(config);
      const result = runMonteCarlo(backtest.id, 100);

      expect(result.ruin_probability).toBeGreaterThanOrEqual(0);
      expect(result.ruin_probability).toBeLessThanOrEqual(1);
    });

    it('should assign verdict based on ruin probability', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'monte_carlo',
      };

      const backtest = createBacktest(config);
      const result = runMonteCarlo(backtest.id, 100);

      expect(['robust', 'acceptable', 'fragile']).toContain(result.verdict);
    });

    it('should retrieve Monte Carlo result by ID', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'monte_carlo',
      };

      const backtest = createBacktest(config);
      const mc = runMonteCarlo(backtest.id, 100);
      const retrieved = getMonteCarlo(mc.id);

      expect(retrieved).toEqual(mc);
    });

    it('should retrieve Monte Carlo result for a backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'monte_carlo',
      };

      const backtest = createBacktest(config);
      const mc = runMonteCarlo(backtest.id, 100);
      const retrieved = getMonteCarloForBacktest(backtest.id);

      expect(retrieved?.id).toBe(mc.id);
    });

    it('should throw error for non-existent backtest in Monte Carlo', () => {
      expect(() => runMonteCarlo('bt_nonexistent', 100)).toThrow('not found');
    });
  });

  // =========================================================================
  // STRESS TESTING
  // =========================================================================

  describe('Stress Scenarios', () => {
    it('should create a stress scenario', () => {
      const scenario = addStressScenario(
        'Market Crash',
        'Simulates 2008-like crash',
        -30,
        2.5,
        50
      );

      expect(scenario.id).toMatch(/^stress_/);
      expect(scenario.name).toBe('Market Crash');
      expect(scenario.price_shock_pct).toBe(-30);
    });

    it('should retrieve a stress scenario by ID', () => {
      const scenario = addStressScenario(
        'Flash Crash',
        'Sudden market drop',
        -20,
        3.0,
        75
      );

      const retrieved = getStressScenario(scenario.id);
      expect(retrieved).toEqual(scenario);
    });

    it('should retrieve all stress scenarios', () => {
      addStressScenario('Scenario 1', 'Desc 1', -10, 1.5, 25);
      addStressScenario('Scenario 2', 'Desc 2', -20, 2.0, 50);
      addStressScenario('Scenario 3', 'Desc 3', -30, 2.5, 75);

      const all = getAllStressScenarios();
      expect(all.length).toBe(3);
    });

    it('should return undefined for non-existent scenario', () => {
      const result = getStressScenario('stress_nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('Stress Testing', () => {
    it('should run stress test on a backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'stress_test',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      const scenario = addStressScenario('Market Crash', 'Test crash', -20, 2.0, 50);
      const result = runStressTest(backtest.id, scenario.id);

      expect(result.id).toMatch(/^stresst_/);
      expect(result.backtest_id).toBe(backtest.id);
      expect(result.scenario.id).toBe(scenario.id);
    });

    it('should calculate impact score', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'stress_test',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      const scenario = addStressScenario('Crash', 'Test', -15, 1.5, 40);
      const result = runStressTest(backtest.id, scenario.id);

      expect(result.impact_score).toBeGreaterThanOrEqual(0);
    });

    it('should determine survival based on max drawdown', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'stress_test',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      const scenario = addStressScenario('Mild', 'Mild stress', -5, 1.1, 10);
      const result = runStressTest(backtest.id, scenario.id);

      expect(typeof result.survival).toBe('boolean');
    });

    it('should retrieve stress test result by ID', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'stress_test',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      const scenario = addStressScenario('Test', 'Test', -10, 1.5, 30);
      const result = runStressTest(backtest.id, scenario.id);

      const retrieved = getStressTestResult(result.id);
      expect(retrieved).toEqual(result);
    });

    it('should retrieve all stress tests for a backtest', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'stress_test',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      const scenario1 = addStressScenario('S1', 'Desc1', -10, 1.5, 25);
      const scenario2 = addStressScenario('S2', 'Desc2', -20, 2.0, 50);

      runStressTest(backtest.id, scenario1.id);
      runStressTest(backtest.id, scenario2.id);

      const results = getStressTestsForBacktest(backtest.id);
      expect(results.length).toBe(2);
    });

    it('should throw error for non-existent backtest in stress test', () => {
      const scenario = addStressScenario('Test', 'Test', -10, 1.5, 30);
      expect(() => runStressTest('bt_nonexistent', scenario.id)).toThrow('not found');
    });

    it('should throw error for non-existent scenario in stress test', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'stress_test',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      expect(() => runStressTest(backtest.id, 'stress_nonexistent')).toThrow('not found');
    });
  });

  // =========================================================================
  // STATISTICS
  // =========================================================================

  describe('Statistics', () => {
    it('should return overall backtest statistics', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      createBacktest(config);
      createBacktest(config);

      const stats = getBacktestStats();

      expect(stats.total_backtests).toBe(2);
      expect(stats.by_status).toBeDefined();
      expect(stats.by_mode).toBeDefined();
    });

    it('should count backtests by status', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const bt1 = createBacktest(config);
      const bt2 = createBacktest(config);
      const bt3 = createBacktest(config);

      runBacktest(bt1.id);
      runBacktest(bt2.id);
      cancelBacktest(bt3.id);

      const stats = getBacktestStats();

      expect(stats.by_status.completed).toBeGreaterThan(0);
      expect(stats.by_status.cancelled).toBeGreaterThan(0);
      expect(stats.total_backtests).toBe(3);
    });

    it('should count backtests by mode', () => {
      const config1: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const config2: BacktestConfig = {
        ...config1,
        mode: 'walk_forward',
      };

      createBacktest(config1);
      createBacktest(config2);

      const stats = getBacktestStats();

      expect(stats.by_mode.standard).toBeGreaterThan(0);
      expect(stats.by_mode.walk_forward).toBeGreaterThan(0);
    });

    it('should calculate average sharpe ratio', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const bt1 = createBacktest(config);
      const bt2 = createBacktest(config);

      runBacktest(bt1.id);
      runBacktest(bt2.id);

      const stats = getBacktestStats();

      expect(stats.avg_sharpe).toBeDefined();
      expect(typeof stats.avg_sharpe).toBe('number');
    });

    it('should calculate average win rate', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const bt = createBacktest(config);
      runBacktest(bt.id);

      const stats = getBacktestStats();

      expect(stats.avg_win_rate).toBeGreaterThanOrEqual(0);
      expect(stats.avg_win_rate).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // METRICS VALIDATION
  // =========================================================================

  describe('Backtest Metrics', () => {
    it('should have valid total_return_pct', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const backtest = createBacktest(config);
      const result = runBacktest(backtest.id);

      expect(result.metrics?.total_return_pct).toBeDefined();
      expect(typeof result.metrics?.total_return_pct).toBe('number');
    });

    it('should have valid win_rate between 0 and 1', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const backtest = createBacktest(config);
      const result = runBacktest(backtest.id);

      expect(result.metrics?.win_rate).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.win_rate).toBeLessThanOrEqual(1);
    });

    it('should have valid profit_factor', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const backtest = createBacktest(config);
      const result = runBacktest(backtest.id);

      expect(result.metrics?.profit_factor).toBeGreaterThanOrEqual(0);
    });

    it('should have valid max_drawdown_pct between 0 and 100', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const backtest = createBacktest(config);
      const result = runBacktest(backtest.id);

      expect(result.metrics?.max_drawdown_pct).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.max_drawdown_pct).toBeLessThanOrEqual(100);
    });

    it('should have valid trade counts', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const backtest = createBacktest(config);
      const result = runBacktest(backtest.id);

      const metrics = result.metrics!;
      const totalTrades = metrics.winning_trades + metrics.losing_trades;

      expect(totalTrades).toBeLessThanOrEqual(metrics.total_trades);
    });
  });

  // =========================================================================
  // INTEGRATION TESTS
  // =========================================================================

  describe('Integration Tests', () => {
    it('should handle complete backtest workflow', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      // Create
      const backtest = createBacktest(config);
      expect(backtest.status).toBe('pending');

      // Run
      const runResult = runBacktest(backtest.id);
      expect(runResult.status).toBe('completed');

      // Retrieve
      const retrieved = getBacktest(backtest.id);
      expect(retrieved?.id).toBe(backtest.id);
    });

    it('should handle complete analysis workflow', () => {
      const config: BacktestConfig = {
        strategy_id: 'strat_001',
        symbol: 'BTC/USD',
        start_date: '2024-01-01',
        end_date: '2024-12-31',
        initial_capital: 100000,
        commission_bps: 10,
        slippage_bps: 5,
        mode: 'standard',
      };

      const backtest = createBacktest(config);
      runBacktest(backtest.id);

      // Walk-forward
      const wf = runWalkForward(backtest.id, 5);
      expect(wf.total_windows).toBe(5);

      // Monte Carlo
      const mc = runMonteCarlo(backtest.id, 100);
      expect(mc.num_runs).toBe(100);

      // Stress test
      const scenario = addStressScenario('Test', 'Test', -15, 1.5, 40);
      const st = runStressTest(backtest.id, scenario.id);
      expect(st.backtest_id).toBe(backtest.id);
    });
  });
});
