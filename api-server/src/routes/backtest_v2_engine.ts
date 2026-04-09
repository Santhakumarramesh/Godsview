import { Router, Request, Response } from 'express';
import pino from 'pino';
import {
  BacktestConfig,
  createBacktest,
  runBacktest,
  cancelBacktest,
  getBacktest,
  getAllBacktests,
  getBacktestsForStrategy,
  runWalkForward,
  getWalkForward,
  runMonteCarlo,
  getMonteCarlo,
  addStressScenario,
  getStressScenario,
  getAllStressScenarios,
  runStressTest,
  getStressTestResult,
  getStressTestsForBacktest,
  getBacktestStats,
} from '../lib/backtest_v2_engine';

const router = Router();
const logger = pino();

// ============================================================================
// BACKTEST LIFECYCLE ENDPOINTS
// ============================================================================

/**
 * POST / - Create a new backtest
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const config: BacktestConfig = req.body;

    // Validate required fields
    if (!config.strategy_id || !config.symbol || !config.start_date || !config.end_date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: strategy_id, symbol, start_date, end_date',
      });
    }

    const backtest = createBacktest(config);
    logger.info({ backtest_id: backtest.id }, 'Backtest created');

    res.status(201).json({
      success: true,
      data: backtest,
    });
  } catch (error) {
    logger.error(error, 'Error creating backtest');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /:id/run - Run a backtest
 */
router.post('/:id/run', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const backtest = runBacktest(id);

    logger.info({ backtest_id: id, status: backtest.status }, 'Backtest executed');

    res.status(200).json({
      success: true,
      data: backtest,
    });
  } catch (error) {
    logger.error(error, 'Error running backtest');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /:id/cancel - Cancel a backtest
 */
router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const backtest = cancelBacktest(id);

    logger.info({ backtest_id: id }, 'Backtest cancelled');

    res.status(200).json({
      success: true,
      data: backtest,
    });
  } catch (error) {
    logger.error(error, 'Error cancelling backtest');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET / - List all backtests with optional limit and strategy filter
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const { limit, strategy_id } = req.query;

    let backtests = getAllBacktests(limit ? parseInt(limit as string) : undefined);

    if (strategy_id) {
      backtests = backtests.filter((bt) => bt.config.strategy_id === strategy_id);
    }

    logger.info({ count: backtests.length }, 'Backtests retrieved');

    res.status(200).json({
      success: true,
      data: backtests,
    });
  } catch (error) {
    logger.error(error, 'Error listing backtests');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /:id - Get single backtest
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const backtest = getBacktest(id);

    if (!backtest) {
      return res.status(404).json({
        success: false,
        error: `Backtest ${id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: backtest,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving backtest');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /strategy/:strategy_id - Get backtests for a specific strategy
 */
router.get('/strategy/:strategy_id', (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const backtests = getBacktestsForStrategy(strategy_id);

    logger.info({ strategy_id, count: backtests.length }, 'Strategy backtests retrieved');

    res.status(200).json({
      success: true,
      data: backtests,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving strategy backtests');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// WALK-FORWARD ENDPOINTS
// ============================================================================

/**
 * POST /:id/walk-forward - Run walk-forward analysis
 */
router.post('/:id/walk-forward', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { num_windows } = req.body;

    if (!num_windows || num_windows < 2) {
      return res.status(400).json({
        success: false,
        error: 'num_windows must be at least 2',
      });
    }

    const result = runWalkForward(id, num_windows);

    logger.info(
      { backtest_id: id, num_windows, verdict: result.verdict },
      'Walk-forward analysis completed'
    );

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error running walk-forward');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /walk-forward/:id - Get walk-forward result
 */
router.get('/walk-forward/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = getWalkForward(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: `Walk-forward result ${id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving walk-forward result');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// MONTE CARLO ENDPOINTS
// ============================================================================

/**
 * POST /:id/monte-carlo - Run Monte Carlo simulation
 */
router.post('/:id/monte-carlo', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { num_runs } = req.body;

    if (!num_runs || num_runs < 10) {
      return res.status(400).json({
        success: false,
        error: 'num_runs must be at least 10',
      });
    }

    const result = runMonteCarlo(id, num_runs);

    logger.info(
      {
        backtest_id: id,
        num_runs,
        ruin_probability: result.ruin_probability,
        verdict: result.verdict,
      },
      'Monte Carlo simulation completed'
    );

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error running Monte Carlo');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /monte-carlo/:id - Get Monte Carlo result
 */
router.get('/monte-carlo/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = getMonteCarlo(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: `Monte Carlo result ${id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving Monte Carlo result');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// STRESS TEST ENDPOINTS
// ============================================================================

/**
 * POST /stress-scenarios - Add a new stress scenario
 */
router.post('/stress-scenarios', (req: Request, res: Response) => {
  try {
    const { name, description, price_shock_pct, volatility_multiplier, liquidity_reduction_pct } =
      req.body;

    if (!name || !description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, description',
      });
    }

    const scenario = addStressScenario(
      name,
      description,
      price_shock_pct || 0,
      volatility_multiplier || 1,
      liquidity_reduction_pct || 0
    );

    logger.info({ scenario_id: scenario.id, name }, 'Stress scenario created');

    res.status(201).json({
      success: true,
      data: scenario,
    });
  } catch (error) {
    logger.error(error, 'Error creating stress scenario');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /stress-scenarios - List all stress scenarios
 */
router.get('/stress-scenarios', (req: Request, res: Response) => {
  try {
    const scenarios = getAllStressScenarios();

    logger.info({ count: scenarios.length }, 'Stress scenarios retrieved');

    res.status(200).json({
      success: true,
      data: scenarios,
    });
  } catch (error) {
    logger.error(error, 'Error listing stress scenarios');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /:id/stress-test - Run stress test on a backtest
 */
router.post('/:id/stress-test', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { scenario_id } = req.body;

    if (!scenario_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: scenario_id',
      });
    }

    const result = runStressTest(id, scenario_id);

    logger.info(
      { backtest_id: id, scenario_id, impact_score: result.impact_score, survival: result.survival },
      'Stress test completed'
    );

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error running stress test');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /stress-test/:id - Get stress test result
 */
router.get('/stress-test/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = getStressTestResult(id);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: `Stress test result ${id} not found`,
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving stress test result');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /stress-tests/backtest/:backtest_id - Get all stress tests for a backtest
 */
router.get('/stress-tests/backtest/:backtest_id', (req: Request, res: Response) => {
  try {
    const { backtest_id } = req.params;
    const results = getStressTestsForBacktest(backtest_id);

    logger.info({ backtest_id, count: results.length }, 'Stress tests retrieved');

    res.status(200).json({
      success: true,
      data: results,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving stress tests');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// STATISTICS ENDPOINT
// ============================================================================

/**
 * GET /stats - Get overall backtest statistics
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = getBacktestStats();

    logger.info(
      { total_backtests: stats.total_backtests, avg_sharpe: stats.avg_sharpe },
      'Backtest stats retrieved'
    );

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving stats');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
