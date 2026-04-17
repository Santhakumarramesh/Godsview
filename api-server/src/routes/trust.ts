// Trust Routes: Complete transparency endpoints for evidence, calibration, and promotion
// Every endpoint surfaces operator-facing intelligence for confident human decision-making

import { Router, Request, Response } from 'express';
import { Logger } from '../lib/logging/logger';
import { CalibrationTracker } from '../lib/eval/calibration_tracker';
import { ShadowScorecard } from '../lib/eval/shadow_scorecard';
import { TrustSurface } from '../lib/eval/trust_surface';
import { PromotionDiscipline } from '../lib/eval/promotion_discipline';

export interface AppRequest extends Request {
  logger?: Logger;
  calibrationTracker?: CalibrationTracker;
  shadowScorecard?: ShadowScorecard;
  trustSurface?: TrustSurface;
  promotionDiscipline?: PromotionDiscipline;
}

export function createTrustRouter(
  logger: Logger,
  calibrationTracker: CalibrationTracker,
  shadowScorecard: ShadowScorecard,
  trustSurface: TrustSurface,
  promotionDiscipline: PromotionDiscipline
): Router {
  const router = Router();

  /**
   * GET /api/trust/view/:strategyId
   * Full trust surface view - complete operator decision brief
   * Includes: description, interpretation, screening, causal, critique, variants, backtest, fragility, shadow, calibration, recommendation, next action, traffic light
   */
  router.get('/view/:strategyId', (req: AppRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      // Fetch strategy pipeline result from database/cache
      // In real implementation, this would be retrieved from persistent storage
      const pipelineResult = {
        strategyId,
        strategyName: `Strategy-${strategyId}`,
        dslValid: true,
        stage: 'PAPER' as const,
        description: 'Sample strategy for demonstration',
        interpretation: {
          type: 'momentum',
          confidence: 0.78,
          alternatives: [
            { type: 'mean_reversion', confidence: 0.15 },
            { type: 'regime_switching', confidence: 0.07 },
          ],
        },
        earlyScreen: {
          passed: true,
          filters: [
            { name: 'Minimum Sharpe', passed: true, reason: '0.8 > 0.5' },
            { name: 'Diversification', passed: true, reason: 'Across 4 assets' },
          ],
        },
        causal: {
          mechanism: 'Exploits momentum reversal in mean price deviations',
          confidence: 0.72,
          keyAssumptions: [
            'Mean reversion window stable across regimes',
            'Execution slippage <15bps',
            'Liquidity sufficient for position size',
          ],
        },
        critique: {
          grade: 'B+' as const,
          strengths: ['Clear edge mechanism', 'Robust across regimes', 'Low correlation to market'],
          weaknesses: ['Limited sample size', 'Parameter sensitivity in volatility'],
        },
        variants: [
          { name: 'Base', sharpe: 0.85, maxDD: 0.12, winRate: 0.56, profitFactor: 1.8 },
          { name: 'Aggressive', sharpe: 0.92, maxDD: 0.18, winRate: 0.54, profitFactor: 2.1 },
          { name: 'Conservative', sharpe: 0.65, maxDD: 0.08, winRate: 0.58, profitFactor: 1.5 },
        ],
        backtest: {
          sharpe: 0.85,
          maxDD: 0.12,
          winRate: 0.56,
          profitFactor: 1.8,
          sampleSize: 342,
          recoveryFactor: 2.4,
        },
        fragility: {
          worstRegime: 'Low-volatility ranging',
          worstPerformance: { sharpe: 0.15, maxDD: 0.14 },
          breakingConditions: [
            'VIX < 10 for extended period',
            'Regime changes without transition',
            'Flash liquidity events',
          ],
        },
        shadowSession: {
          active: true,
          daysElapsed: 18,
          tradeCount: 38,
          sharpe: 0.78,
          maxDD: 0.11,
          onTrack: true,
        },
        calibration: 82,
      };

      const trustView = trustSurface.generateTrustView(pipelineResult);

      logger.info(`Trust view generated for ${strategyId}`);
      res.json({
        success: true,
        strategyId,
        view: trustView,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/card/:strategyId
   * Compact 10-line summary card for quick scanning
   */
  router.get('/card/:strategyId', (req: AppRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      // Fetch strategy pipeline result (would come from database)
      const pipelineResult = {
        strategyId,
        strategyName: `Strategy-${strategyId}`,
        dslValid: true,
        stage: 'PAPER' as const,
        description: 'Sample strategy',
        interpretation: { type: 'momentum', confidence: 0.78, alternatives: [] },
        earlyScreen: { passed: true, filters: [] },
        causal: {
          mechanism: 'Momentum reversal',
          confidence: 0.72,
          keyAssumptions: [],
        },
        critique: { grade: 'B+' as const, strengths: [], weaknesses: [] },
        variants: [
          { name: 'Base', sharpe: 0.85, maxDD: 0.12, winRate: 0.56, profitFactor: 1.8 },
        ],
        backtest: {
          sharpe: 0.85,
          maxDD: 0.12,
          winRate: 0.56,
          profitFactor: 1.8,
          sampleSize: 342,
          recoveryFactor: 2.4,
        },
        fragility: {
          worstRegime: 'Low vol',
          worstPerformance: { sharpe: 0.15, maxDD: 0.14 },
          breakingConditions: [],
        },
        shadowSession: {
          active: true,
          daysElapsed: 18,
          tradeCount: 38,
          sharpe: 0.78,
          maxDD: 0.11,
          onTrack: true,
        },
        calibration: 82,
      };

      const card = trustSurface.generateCompactCard(pipelineResult);

      logger.info(`Trust card generated for ${strategyId}`);
      res.json({
        success: true,
        card,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/go-no-go/:strategyId
   * Single GO / NO_GO decision with confidence and reasoning
   */
  router.get('/go-no-go/:strategyId', (req: AppRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      // Fetch strategy pipeline result
      const pipelineResult = {
        strategyId,
        strategyName: `Strategy-${strategyId}`,
        dslValid: true,
        stage: 'PAPER' as const,
        description: 'Sample strategy',
        interpretation: { type: 'momentum', confidence: 0.78, alternatives: [] },
        earlyScreen: { passed: true, filters: [] },
        causal: {
          mechanism: 'Momentum reversal',
          confidence: 0.72,
          keyAssumptions: [],
        },
        critique: { grade: 'B+' as const, strengths: ['Clear edge'], weaknesses: ['Limited sample'] },
        variants: [
          { name: 'Base', sharpe: 0.85, maxDD: 0.12, winRate: 0.56, profitFactor: 1.8 },
        ],
        backtest: {
          sharpe: 0.85,
          maxDD: 0.12,
          winRate: 0.56,
          profitFactor: 1.8,
          sampleSize: 342,
          recoveryFactor: 2.4,
        },
        fragility: {
          worstRegime: 'Low vol',
          worstPerformance: { sharpe: 0.15, maxDD: 0.14 },
          breakingConditions: [],
        },
        shadowSession: {
          active: true,
          daysElapsed: 18,
          tradeCount: 38,
          sharpe: 0.78,
          maxDD: 0.11,
          onTrack: true,
        },
        calibration: 82,
      };

      const goNoGo = trustSurface.generateGoNoGo(pipelineResult);

      logger.info(`GO/NO-GO decision for ${strategyId}: ${goNoGo.decision}`);
      res.json({
        success: true,
        decision: goNoGo,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/calibration
   * Full calibration report for specified period
   */
  router.get('/calibration', (req: AppRequest, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const logger = req.logger || new Logger('trust-routes');

      const report = calibrationTracker.getCalibrationReport(days);

      logger.info(`Calibration report generated for ${days} days`);
      res.json({
        success: true,
        report,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/calibration/score
   * Single 0-100 calibration score
   */
  router.get('/calibration/score', (req: AppRequest, res: Response) => {
    try {
      const logger = req.logger || new Logger('trust-routes');
      const score = calibrationTracker.getCalibrationScore();

      logger.info(`Calibration score: ${score.toFixed(0)}`);
      res.json({
        success: true,
        calibrationScore: score,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/shadow/:sessionId/scorecard
   * Shadow mode scorecard with pass/fail per criterion
   */
  router.get('/shadow/:sessionId/scorecard', (req: AppRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      const scorecard = shadowScorecard.getScorecard(sessionId);

      logger.info(`Shadow scorecard retrieved for ${sessionId}`);
      res.json({
        success: true,
        scorecard,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/trust/shadow/:sessionId/evaluate
   * Evaluate shadow session for promotion to ASSISTED tier
   */
  router.post('/shadow/:sessionId/evaluate', (req: AppRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      const decision = shadowScorecard.evaluateForPromotion(sessionId);

      logger.info(`Shadow evaluation complete for ${sessionId}: ${decision.decision}`);
      res.json({
        success: true,
        decision,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/promotion/:strategyId/gate
   * Check promotion gate - can strategy promote to next tier?
   */
  router.get('/promotion/:strategyId/gate', (req: AppRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      const targetTier = (req.query.targetTier as string) || 'LEARNING';
      const logger = req.logger || new Logger('trust-routes');

      // Mock current metrics (would come from database)
      const currentMetrics = {
        dsl_valid: true,
        early_screen_passed: true,
        critique_grade: 'B+',
        causal_confidence: 0.72,
        sharpe: 0.85,
        max_dd: 0.12,
        sample_size: 342,
        calibration_score: 82,
        override_rate: 0.08,
      };

      const gateResult = promotionDiscipline.checkGate(
        strategyId,
        currentMetrics,
        targetTier as any
      );

      logger.info(`Promotion gate check: ${strategyId} -> ${targetTier}`);
      res.json({
        success: true,
        gateResult,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/promotion/:strategyId/timeline
   * Promotion timeline - road to AUTONOMOUS with milestones
   */
  router.get('/promotion/:strategyId/timeline', (req: AppRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      // Mock current metrics
      const currentMetrics = {
        sharpe: 0.85,
        max_dd: 0.12,
        sample_size: 342,
        calibration_score: 82,
      };

      const timeline = promotionDiscipline.getPromotionTimeline(strategyId, currentMetrics);

      logger.info(`Promotion timeline generated for ${strategyId}`);
      res.json({
        success: true,
        timeline,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/promotion/history
   * All promotion decisions across platform
   */
  router.get('/promotion/history', (req: AppRequest, res: Response) => {
    try {
      const logger = req.logger || new Logger('trust-routes');
      const limit = parseInt(req.query.limit as string) || 100;

      // Would fetch from database
      const history = shadowScorecard.getPromotionHistory().slice(0, limit);

      logger.info(`Promotion history retrieved: ${history.length} entries`);
      res.json({
        success: true,
        count: history.length,
        history,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/trust/compare
   * Side-by-side comparison of two strategies
   * Request body: { strategyIdA: string, strategyIdB: string }
   */
  router.post('/compare', (req: AppRequest, res: Response) => {
    try {
      const { strategyIdA, strategyIdB } = req.body;
      const logger = req.logger || new Logger('trust-routes');

      if (!strategyIdA || !strategyIdB) {
        return res.status(400).json({
          success: false,
          error: 'Both strategyIdA and strategyIdB required',
        });
      }

      // Mock pipeline results (would come from database)
      const resultA = {
        strategyId: strategyIdA,
        strategyName: `Strategy-${strategyIdA}`,
        dslValid: true,
        stage: 'PAPER' as const,
        description: 'Strategy A',
        interpretation: { type: 'momentum', confidence: 0.78, alternatives: [] },
        earlyScreen: { passed: true, filters: [] },
        causal: { mechanism: 'Momentum reversal', confidence: 0.72, keyAssumptions: [] },
        critique: { grade: 'B+' as const, strengths: [], weaknesses: [] },
        variants: [
          { name: 'Base', sharpe: 0.85, maxDD: 0.12, winRate: 0.56, profitFactor: 1.8 },
        ],
        backtest: {
          sharpe: 0.85,
          maxDD: 0.12,
          winRate: 0.56,
          profitFactor: 1.8,
          sampleSize: 342,
          recoveryFactor: 2.4,
        },
        fragility: {
          worstRegime: 'Low vol',
          worstPerformance: { sharpe: 0.15, maxDD: 0.14 },
          breakingConditions: [],
        },
        shadowSession: undefined,
        calibration: 82,
      };

      const resultB = {
        strategyId: strategyIdB,
        strategyName: `Strategy-${strategyIdB}`,
        dslValid: true,
        stage: 'PROVEN' as const,
        description: 'Strategy B',
        interpretation: { type: 'mean_reversion', confidence: 0.75, alternatives: [] },
        earlyScreen: { passed: true, filters: [] },
        causal: { mechanism: 'Mean reversion', confidence: 0.68, keyAssumptions: [] },
        critique: { grade: 'B' as const, strengths: [], weaknesses: [] },
        variants: [
          { name: 'Base', sharpe: 0.72, maxDD: 0.15, winRate: 0.54, profitFactor: 1.6 },
        ],
        backtest: {
          sharpe: 0.72,
          maxDD: 0.15,
          winRate: 0.54,
          profitFactor: 1.6,
          sampleSize: 280,
          recoveryFactor: 1.9,
        },
        fragility: {
          worstRegime: 'Trending',
          worstPerformance: { sharpe: 0.05, maxDD: 0.2 },
          breakingConditions: [],
        },
        shadowSession: undefined,
        calibration: 75,
      };

      const comparison = trustSurface.generateComparisonView(resultA, resultB);

      logger.info(`Strategy comparison: ${strategyIdA} vs ${strategyIdB}`);
      res.json({
        success: true,
        comparison,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/trust/health/demotion-triggers/:strategyId
   * Check demotion triggers for currently deployed strategy
   */
  router.get('/health/demotion-triggers/:strategyId', (req: AppRequest, res: Response) => {
    try {
      const { strategyId } = req.params;
      const logger = req.logger || new Logger('trust-routes');

      // Mock current metrics
      const currentMetrics = {
        calibration_score: 82,
        override_rate: 0.08,
        autonomous_sharpe: 0.75,
      };

      const triggers = promotionDiscipline.getDemotionTriggers(strategyId, currentMetrics);

      logger.info(`Demotion triggers checked for ${strategyId}`);
      res.json({
        success: true,
        strategyId,
        triggers,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}
