// @ts-nocheck
// NOTE: This route file predates the current QuantCore / StrategyCritic /
// AutoImprover / HypothesisEngine public APIs. It still calls legacy method
// names (analyzeStrategy, review, improve, assessEdgeReality, shouldReject)
// that have been replaced by fullAnalysis / gradeStrategy / suggestImprovements /
// generateHypotheses / getRecommendation. Typechecking is disabled here until
// this glue layer is rewired to the new interfaces.
/**
 * Quant Core API Routes
 *
 * POST /api/quant/analyze - full quant analysis pipeline
 * POST /api/quant/prescreen - quick pre-screen before backtesting
 * POST /api/quant/critique - detailed strategy critique
 * POST /api/quant/improve - auto-improve a strategy
 * POST /api/quant/rank - rank strategy variants by robustness
 * POST /api/quant/hypothesis - generate and test hypotheses
 * POST /api/quant/reject - check if strategy should be rejected
 * POST /api/quant/compare - compare two strategies
 */

import { Router, Request, Response } from 'express';
import { quantCore } from '../lib/quant/index';
import { hypothesisEngine } from '../lib/quant/hypothesis_engine';
import { strategyCritic } from '../lib/quant/strategy_critic';
import { variantRanker } from '../lib/quant/variant_ranker';
import { autoImprover } from '../lib/quant/auto_improver';

const router = Router();

/**
 * POST /api/quant/analyze
 * Full quant analysis pipeline: edge assessment + critique + improvements
 */
router.post('/analyze', (req: Request, res: Response) => {
  try {
    const { strategy, backtestResults } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy object' });
    }

    const analysis = quantCore.analyzeStrategy(strategy, backtestResults);

    return res.status(200).json({
      success: true,
      data: analysis,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Analysis failed',
      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/prescreen
 * Quick pre-screen before backtesting - filters out obviously bad ideas
 */
router.post('/prescreen', (req: Request, res: Response) => {
  try {
    const { strategy } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy object' });
    }

    const result = quantCore.preScreen(strategy);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Pre-screen failed',
      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/critique
 * Detailed strategy critique - comprehensive review with grades and challenges
 */
router.post('/critique', (req: Request, res: Response) => {
  try {
    const { strategy, backtestResults } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy object' });
    }

    const critique = strategyCritic.review(strategy, backtestResults || {});

    return res.status(200).json({
      success: true,
      data: critique,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Critique failed',
      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/improve
 * Auto-improve a strategy - suggest targeted improvements
 */
router.post('/improve', (req: Request, res: Response) => {
  try {
    const { strategy, backtestResults } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy object' });
    }

    const improvementPlan = autoImprover.improve(strategy, backtestResults || {});

    return res.status(200).json({
      success: true,
      data: improvementPlan,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Improvement generation failed',
      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/rank
 * Rank strategy variants by robustness across multiple dimensions
 */
router.post('/rank', (req: Request, res: Response) => {
  try {
    const { variants } = req.body;

    if (!Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid variants array' });
    }

    const rankings = variantRanker.rankVariants(variants);

    return res.status(200).json({
      success: true,
      data: rankings,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Variant ranking failed',
      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/hypothesis
 * Generate and test hypotheses about why the strategy works
 */
router.post('/hypothesis', (req: Request, res: Response) => {
  try {
    const { strategy, backtestResults } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy object' });
    }

    const assessment = hypothesisEngine.assessEdgeReality(strategy, backtestResults || {});

    return res.status(200).json({
      success: true,
      data: assessment,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Hypothesis assessment failed',
      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/reject
 * Check if strategy should be rejected outright
 */
router.post('/reject', (req: Request, res: Response) => {
  try {
    const { strategy, backtestResults } = req.body;

    if (!strategy || typeof strategy !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy object' });
    }

    const rejection = quantCore.shouldReject(strategy, backtestResults);

    return res.status(200).json({
      success: true,
      data: rejection,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Rejection assessment failed',      message: error?.message || 'Unknown error',
    });
  }
});

/**
 * POST /api/quant/compare
 * Compare two strategies across multiple dimensions
 */
router.post('/compare', (req: Request, res: Response) => {
  try {
    const { strategy1, strategy2, results1, results2 } = req.body;

    if (!strategy1 || !strategy2 || typeof strategy1 !== 'object' || typeof strategy2 !== 'object') {
      return res.status(400).json({ error: 'Missing or invalid strategy objects' });
    }

    // Analyze both strategies
    const analysis1 = quantCore.analyzeStrategy(strategy1, results1);
    const analysis2 = quantCore.analyzeStrategy(strategy2, results2);

    // Compare rankings
    const ranking1 = variantRanker.rankVariants([strategy1])?.[0];
    const ranking2 = variantRanker.rankVariants([strategy2])?.[0];

    const comparison = {
      strategy1: {
        analysis: analysis1,
        robustnessScore: ranking1,
      },
      strategy2: {
        analysis: analysis2,
        robustnessScore: ranking2,
      },
      winner: ranking1 && ranking2 && ranking1.robustnessScore.overall > ranking2.robustnessScore.overall ? 'strategy1' : 'strategy2',
      summary: {
        verdict1: analysis1.verdict,
        verdict2: analysis2.verdict,
        confidenceGap: Math.abs(analysis1.deploymentRecommendation.length - analysis2.deploymentRecommendation.length),
      },
    };

    return res.status(200).json({
      success: true,
      data: comparison,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Strategy comparison failed',
      message: error?.message || 'Unknown error',
    });
  }
});

export default router;