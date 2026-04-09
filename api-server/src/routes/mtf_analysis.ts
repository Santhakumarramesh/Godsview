import { Router, Request, Response } from 'express';
import pino from 'pino';
import {
  addCandles,
  getCandles,
  analyzeTimeframe,
  getAnalysis,
  getAnalysesForSymbol,
  getAllAnalyses,
  detectConfluence,
  getConfluence,
  getConfluencesForSymbol,
  getAllConfluences,
  detectDivergence,
  getDivergence,
  getDivergencesForSymbol,
  getAllDivergences,
  computeCorrelation,
  getCorrelation,
  getAllCorrelations,
  runScan,
  getScan,
  getScansForSymbol,
  getAllScans,
  type Timeframe,
  type TimeframeCandle,
} from '../lib/mtf_analysis';

const router = Router();
const logger = pino();

// ============================================================================
// Candles Routes
// ============================================================================

/**
 * POST /candles
 * Add candles for a specific symbol and timeframe
 */
router.post('/candles', (req: Request, res: Response) => {
  try {
    const { symbol, timeframe, candles } = req.body;

    if (!symbol || !timeframe || !Array.isArray(candles)) {
      logger.warn('Invalid candles request body');
      return res.status(400).json({
        success: false,
        error: 'symbol, timeframe, and candles array are required',
      });
    }

    addCandles(symbol, timeframe as Timeframe, candles);

    logger.info(
      { symbol, timeframe, count: candles.length },
      'Added candles'
    );

    res.json({
      success: true,
      data: {
        symbol,
        timeframe,
        count: candles.length,
      },
    });
  } catch (error) {
    logger.error(error, 'Error adding candles');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /candles/:symbol/:timeframe
 * Get candles for a specific symbol and timeframe
 */
router.get('/candles/:symbol/:timeframe', (req: Request, res: Response) => {
  try {
    const { symbol, timeframe } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const candles = getCandles(symbol, timeframe as Timeframe, limit);

    logger.info(
      { symbol, timeframe, count: candles.length, limit },
      'Retrieved candles'
    );

    res.json({
      success: true,
      data: candles,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving candles');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Timeframe Analysis Routes
// ============================================================================

/**
 * POST /analyze
 * Analyze a single timeframe candle
 */
router.post('/analyze', (req: Request, res: Response) => {
  try {
    const { symbol, timeframe, candle } = req.body;

    if (!symbol || !timeframe || !candle) {
      logger.warn('Invalid analyze request body');
      return res.status(400).json({
        success: false,
        error: 'symbol, timeframe, and candle are required',
      });
    }

    const fullCandle: TimeframeCandle = {
      ...candle,
      symbol,
      timeframe,
    };

    const analysis = analyzeTimeframe(symbol, timeframe as Timeframe, fullCandle);

    logger.info(
      { symbol, timeframe, analysisId: analysis.id, trend: analysis.trend },
      'Analyzed timeframe'
    );

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    logger.error(error, 'Error analyzing timeframe');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /analyses
 * Get all analyses with optional limit
 */
router.get('/analyses', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const analyses = getAllAnalyses(limit);

    logger.info({ count: analyses.length, limit }, 'Retrieved all analyses');

    res.json({
      success: true,
      data: analyses,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving analyses');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /analyses/:symbol
 * Get analyses for a specific symbol
 */
router.get('/analyses/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    const analyses = getAnalysesForSymbol(symbol);

    logger.info({ symbol, count: analyses.length }, 'Retrieved analyses for symbol');

    res.json({
      success: true,
      data: analyses,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving analyses for symbol');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /analysis/:id
 * Get a single analysis by ID
 */
router.get('/analysis/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const analysis = getAnalysis(id);

    if (!analysis) {
      logger.warn({ id }, 'Analysis not found');
      return res.status(404).json({
        success: false,
        error: 'Analysis not found',
      });
    }

    logger.info({ id }, 'Retrieved analysis');

    res.json({
      success: true,
      data: analysis,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving analysis');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Confluence Routes
// ============================================================================

/**
 * POST /confluence
 * Detect confluence signals
 */
router.post('/confluence', (req: Request, res: Response) => {
  try {
    const { symbol, timeframes } = req.body;

    if (!symbol || !Array.isArray(timeframes)) {
      logger.warn('Invalid confluence request body');
      return res.status(400).json({
        success: false,
        error: 'symbol and timeframes array are required',
      });
    }

    const signal = detectConfluence(symbol, timeframes as Timeframe[]);

    logger.info(
      { symbol, timeframeCount: timeframes.length, confluenceId: signal.id },
      'Detected confluence'
    );

    res.json({
      success: true,
      data: signal,
    });
  } catch (error) {
    logger.error(error, 'Error detecting confluence');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /confluences
 * Get all confluence signals
 */
router.get('/confluences', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const confluences = getAllConfluences(limit);

    logger.info({ count: confluences.length, limit }, 'Retrieved all confluences');

    res.json({
      success: true,
      data: confluences,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving confluences');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /confluences/:symbol
 * Get confluences for a specific symbol
 */
router.get('/confluences/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    const confluences = getConfluencesForSymbol(symbol);

    logger.info({ symbol, count: confluences.length }, 'Retrieved confluences for symbol');

    res.json({
      success: true,
      data: confluences,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving confluences for symbol');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Divergence Routes
// ============================================================================

/**
 * POST /divergence
 * Detect divergences between timeframes
 */
router.post('/divergence', (req: Request, res: Response) => {
  try {
    const { symbol, short_tf, long_tf } = req.body;

    if (!symbol || !short_tf || !long_tf) {
      logger.warn('Invalid divergence request body');
      return res.status(400).json({
        success: false,
        error: 'symbol, short_tf, and long_tf are required',
      });
    }

    const divergence = detectDivergence(symbol, short_tf as Timeframe, long_tf as Timeframe);

    if (!divergence) {
      logger.info(
        { symbol, short_tf, long_tf },
        'No divergence detected'
      );
      return res.json({
        success: true,
        data: null,
      });
    }

    logger.info(
      { symbol, short_tf, long_tf, divergenceId: divergence.id },
      'Detected divergence'
    );

    res.json({
      success: true,
      data: divergence,
    });
  } catch (error) {
    logger.error(error, 'Error detecting divergence');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /divergences
 * Get all divergences
 */
router.get('/divergences', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const divergences = getAllDivergences(limit);

    logger.info({ count: divergences.length, limit }, 'Retrieved all divergences');

    res.json({
      success: true,
      data: divergences,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving divergences');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /divergences/:symbol
 * Get divergences for a specific symbol
 */
router.get('/divergences/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    const divergences = getDivergencesForSymbol(symbol);

    logger.info({ symbol, count: divergences.length }, 'Retrieved divergences for symbol');

    res.json({
      success: true,
      data: divergences,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving divergences for symbol');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Correlation Routes
// ============================================================================

/**
 * POST /correlation
 * Compute correlation between two timeframes
 */
router.post('/correlation', (req: Request, res: Response) => {
  try {
    const { symbol, tf_a, tf_b } = req.body;

    if (!symbol || !tf_a || !tf_b) {
      logger.warn('Invalid correlation request body');
      return res.status(400).json({
        success: false,
        error: 'symbol, tf_a, and tf_b are required',
      });
    }

    const correlation = computeCorrelation(symbol, tf_a as Timeframe, tf_b as Timeframe);

    logger.info(
      { symbol, tf_a, tf_b, correlationId: correlation.id, value: correlation.correlation },
      'Computed correlation'
    );

    res.json({
      success: true,
      data: correlation,
    });
  } catch (error) {
    logger.error(error, 'Error computing correlation');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /correlations
 * Get all correlations
 */
router.get('/correlations', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const correlations = getAllCorrelations(limit);

    logger.info({ count: correlations.length, limit }, 'Retrieved all correlations');

    res.json({
      success: true,
      data: correlations,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving correlations');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Scan Routes
// ============================================================================

/**
 * POST /scan
 * Run a multi-timeframe scan
 */
router.post('/scan', (req: Request, res: Response) => {
  try {
    const { symbol, timeframes, scan_type } = req.body;

    if (!symbol || !Array.isArray(timeframes) || !scan_type) {
      logger.warn('Invalid scan request body');
      return res.status(400).json({
        success: false,
        error: 'symbol, timeframes array, and scan_type are required',
      });
    }

    const validScanTypes = ['confluence', 'divergence', 'breakout', 'reversal'];
    if (!validScanTypes.includes(scan_type)) {
      logger.warn({ scan_type }, 'Invalid scan type');
      return res.status(400).json({
        success: false,
        error: `scan_type must be one of: ${validScanTypes.join(', ')}`,
      });
    }

    const result = runScan(
      symbol,
      timeframes as Timeframe[],
      scan_type as 'confluence' | 'divergence' | 'breakout' | 'reversal'
    );

    logger.info(
      { symbol, scanType: scan_type, scanId: result.id, score: result.score },
      'Ran scan'
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(error, 'Error running scan');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /scans
 * Get all scans
 */
router.get('/scans', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const scans = getAllScans(limit);

    logger.info({ count: scans.length, limit }, 'Retrieved all scans');

    res.json({
      success: true,
      data: scans,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving scans');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /scans/:symbol
 * Get scans for a specific symbol
 */
router.get('/scans/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    const scans = getScansForSymbol(symbol);

    logger.info({ symbol, count: scans.length }, 'Retrieved scans for symbol');

    res.json({
      success: true,
      data: scans,
    });
  } catch (error) {
    logger.error(error, 'Error retrieving scans for symbol');
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
