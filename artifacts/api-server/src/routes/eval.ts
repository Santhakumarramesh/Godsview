/**
 * Evaluation API Routes
 * Phase 88: Expose eval harness and baseline comparison via REST
 * 
 * Endpoints:
 * - POST /api/eval/run - run full eval suite
 * - POST /api/eval/single/:testId - run single golden test
 * - GET /api/eval/golden-suite - list all golden test cases
 * - POST /api/eval/compare - run baseline comparison
 * - GET /api/eval/leaderboard - get latest leaderboard
 * - GET /api/eval/report - get latest eval report
 * - POST /api/eval/regression-check - compare against previous results
 */

import { logger } from '../lib/logger';
import { Router, Request, Response } from 'express';
import {
  DecisionLoopEvalHarness,
  EvalReport,
  SingleTestResult
} from '../lib/eval/eval_harness';
import {
  BaselineComparison,
  ComparisonReport,
  LeaderboardEntry
} from '../lib/eval/baseline_comparison';
import {
  GOLDEN_STRATEGIES,
  getGoldenStrategyById,
  getGoldenStrategiesByDifficulty,
  getGoldenStrategiesStats
} from '../lib/eval/golden_strategies';

const router = Router();

// Cache for latest results
let latestEvalReport: EvalReport | null = null;
let latestComparisonReport: ComparisonReport | null = null;
let latestLeaderboard: LeaderboardEntry[] = [];

// ============================================================================
// POST /api/eval/run - Run full evaluation suite
// ============================================================================

router.post('/run', async (req: Request, res: Response) => {
  try {
    logger.info('[EVAL] Starting full evaluation run...');
    const startTime = Date.now();

    const harness = new DecisionLoopEvalHarness(latestEvalReport || undefined);
    const evalReport = await harness.runFullEval();

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    // Cache the results
    latestEvalReport = evalReport;

    return res.json({
      success: true,
      message: `Full evaluation completed in ${elapsedSeconds.toFixed(2)}s`,
      report: {
        timestamp: evalReport.timestamp,
        totalCases: evalReport.totalCases,
        passedCases: evalReport.passedCases,
        passRate: evalReport.passRate,
        overallGrade: evalReport.overallGrade,
        overallScore: evalReport.overallScore,
        metrics: {
          ambiguity: evalReport.metrics.ambiguity,
          rejection: evalReport.metrics.rejection,
          critique: evalReport.metrics.critique,
          variant: evalReport.metrics.variant,
          causal: evalReport.metrics.causal,
          explain: evalReport.metrics.explain,
          recommendation: evalReport.metrics.recommendation
        },
        byDifficulty: evalReport.byDifficulty,
        weakestAreas: evalReport.weakestAreas.slice(0, 3),
        regressions: evalReport.regressions
      },
      cachedForComparison: true
    });
  } catch (error: any) {
    logger.error('[EVAL] Full run error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Evaluation run failed'
    });
  }
});

// ============================================================================
// POST /api/eval/single/:testId - Run single golden test
// ============================================================================

router.post('/single/:testId', async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId as string;

    const testCase = getGoldenStrategyById(testId);
    if (!testCase) {
      return res.status(404).json({
        success: false,
        error: `Test case ${testId} not found`
      });
    }

    logger.info(`[EVAL] Running single test: ${testId}`);

    const harness = new DecisionLoopEvalHarness();
    const result = await harness.runSingleEval(testCase);

    return res.json({
      success: true,
      testId,
      result: {
        title: result.testCase.title,
        difficulty: result.testCase.difficulty,
        verdict: result.verdict,
        metrics: {
          ambiguity: result.metrics.ambiguity,
          rejection: result.metrics.rejection,
          critique: result.metrics.critique,
          causal: result.metrics.causal
        },
        explanation: result.explanation,
        contradictions: result.contradictions,
        edgeMechanism: result.edgeMechanism
      }
    });
  } catch (error: any) {
    logger.error('[EVAL] Single test error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Single test evaluation failed'
    });
  }
});

// ============================================================================
// GET /api/eval/golden-suite - List all golden test cases
// ============================================================================

router.get('/golden-suite', (req: Request, res: Response) => {
  try {
    const { difficulty, tag } = req.query;

    let tests = GOLDEN_STRATEGIES;

    if (difficulty) {
      tests = tests.filter(t => t.difficulty === difficulty);
    }

    if (tag) {
      tests = tests.filter(t => t.tags.includes(tag as string));
    }

    const stats = getGoldenStrategiesStats();

    return res.json({
      success: true,
      count: tests.length,
      stats,
      tests: tests.map(t => ({
        id: t.id,
        title: t.title,
        difficulty: t.difficulty,
        tags: t.tags,
        expectedVerdict: t.expectedVerdict,
        expectedContradictions: t.expectedContradictions
      }))
    });
  } catch (error: any) {
    logger.error('[EVAL] Golden suite error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to list golden suite'
    });
  }
});

// ============================================================================
// POST /api/eval/compare - Run baseline comparison
// ============================================================================

router.post('/compare', async (req: Request, res: Response) => {
  try {
    if (!latestEvalReport) {
      return res.status(400).json({
        success: false,
        error: 'No evaluation results cached. Run /api/eval/run first.'
      });
    }

    logger.info('[EVAL] Starting baseline comparison...');
    const startTime = Date.now();

    const comparison = new BaselineComparison();
    const comparisonReport = await comparison.runComparison(
      latestEvalReport.testResults,
      GOLDEN_STRATEGIES
    );

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    // Cache the comparison results
    latestComparisonReport = comparisonReport;
    latestLeaderboard = comparisonReport.leaderboard;

    return res.json({
      success: true,
      message: `Baseline comparison completed in ${elapsedSeconds.toFixed(2)}s`,
      report: {
        timestamp: comparisonReport.timestamp,
        testCaseCount: comparisonReport.testCaseCount,
        leaderboard: comparisonReport.leaderboard,
        aggregateScores: comparisonReport.aggregateScores,
        godsviewAdvantages: comparisonReport.godsviewAdvantages,
        godsviewWeaknesses: comparisonReport.godsviewWeaknesses
      }
    });
  } catch (error: any) {
    logger.error('[EVAL] Comparison error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Baseline comparison failed'
    });
  }
});

// ============================================================================
// GET /api/eval/leaderboard - Get latest leaderboard
// ============================================================================

router.get('/leaderboard', (req: Request, res: Response) => {
  try {
    if (!latestComparisonReport) {
      return res.status(400).json({
        success: false,
        error: 'No comparison results available. Run /api/eval/compare first.',
        leaderboard: []
      });
    }

    const leaderboard = latestComparisonReport.leaderboard;
    const godsviewPosition = leaderboard.find(e => e.baseline === 'GODSVIEW');

    return res.json({
      success: true,
      timestamp: latestComparisonReport.timestamp,
      leaderboard,
      godsviewRank: godsviewPosition?.rank || null,
      godsviewScore: godsviewPosition?.overallScore || null
    });
  } catch (error: any) {
    logger.error('[EVAL] Leaderboard error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch leaderboard'
    });
  }
});

// ============================================================================
// GET /api/eval/report - Get latest eval report
// ============================================================================

router.get('/report', (req: Request, res: Response) => {
  try {
    if (!latestEvalReport) {
      return res.status(400).json({
        success: false,
        error: 'No evaluation report available. Run /api/eval/run first.'
      });
    }

    return res.json({
      success: true,
      report: {
        timestamp: latestEvalReport.timestamp,
        totalCases: latestEvalReport.totalCases,
        passedCases: latestEvalReport.passedCases,
        passRate: latestEvalReport.passRate,
        overallGrade: latestEvalReport.overallGrade,
        overallScore: latestEvalReport.overallScore,
        metrics: latestEvalReport.metrics,
        byDifficulty: latestEvalReport.byDifficulty,
        weakestAreas: latestEvalReport.weakestAreas,
        regressions: latestEvalReport.regressions,
        testResults: latestEvalReport.testResults.map(t => ({
          testId: t.testCase.id,
          title: t.testCase.title,
          difficulty: t.testCase.difficulty,
          verdict: t.verdict,
          correctVerdictRate: t.verdict.correct ? 100 : 0
        }))
      }
    });
  } catch (error: any) {
    logger.error('[EVAL] Report error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch eval report'
    });
  }
});

// ============================================================================
// POST /api/eval/regression-check - Compare against previous results
// ============================================================================

router.post('/regression-check', async (req: Request, res: Response) => {
  try {
    const { previousReport } = req.body;

    if (!previousReport) {
      return res.status(400).json({
        success: false,
        error: 'previousReport required in request body'
      });
    }

    if (!latestEvalReport) {
      return res.status(400).json({
        success: false,
        error: 'No current evaluation results. Run /api/eval/run first.'
      });
    }

    logger.info('[EVAL] Checking for regressions...');

    const harness = new DecisionLoopEvalHarness(previousReport);
    const regressions = harness.regressionCheck(previousReport, latestEvalReport);

    // Calculate changes
    const passRateDelta = latestEvalReport.passRate - previousReport.passRate;
    const overallScoreDelta = latestEvalReport.overallScore - previousReport.overallScore;

    const status = regressions.length === 0 ? 'PASS' : 
                   Math.abs(passRateDelta) < 5 ? 'WARN' : 'FAIL';

    return res.json({
      success: true,
      status,
      summary: {
        previousPassRate: previousReport.passRate,
        currentPassRate: latestEvalReport.passRate,
        passRateDelta,
        previousScore: previousReport.overallScore,
        currentScore: latestEvalReport.overallScore,
        scoreDelta: overallScoreDelta,
        regressionCount: regressions.length
      },
      regressions,
      message: regressions.length === 0 ? 'No regressions detected' : 
               `${regressions.length} regression(s) detected`
    });
  } catch (error: any) {
    logger.error('[EVAL] Regression check error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Regression check failed'
    });
  }
});

// ============================================================================
// GET /api/eval/status - Get current eval status
// ============================================================================

router.get('/status', (req: Request, res: Response) => {
  return res.json({
    success: true,
    status: {
      latestEvalReport: latestEvalReport ? {
        timestamp: latestEvalReport.timestamp,
        passRate: latestEvalReport.passRate,
        overallGrade: latestEvalReport.overallGrade,
        totalCases: latestEvalReport.totalCases
      } : null,
      latestComparisonReport: latestComparisonReport ? {
        timestamp: latestComparisonReport.timestamp,
        testCaseCount: latestComparisonReport.testCaseCount
      } : null,
      goldenSuiteStats: getGoldenStrategiesStats()
    }
  });
});

export default router;
