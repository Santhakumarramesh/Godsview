/**
 * ux.ts - API Routes for UX System
 *
 * Endpoints for workflow management, strategy guidance, and system diagnostics:
 * - POST /api/ux/workflow/start - start workflow
 * - GET /api/ux/workflow/:id - get workflow state
 * - GET /api/ux/workflow/:id/next - next steps guidance
 * - POST /api/ux/workflow/:id/resume - resume from checkpoint
 * - POST /api/ux/quick-backtest - quick backtest from natural language
 * - GET /api/ux/summary/:strategyId - strategy summary
 * - POST /api/ux/builder/start - start guided builder
 * - POST /api/ux/builder/:id/answer - submit answer
 * - GET /api/ux/diagnostics/:strategyId - diagnose strategy
 * - GET /api/ux/diagnostics/system - system health check
 */

import { Router, Request, Response } from 'express';
import {
  getWorkflowEngine,
  type WorkflowInput,
} from '../lib/ux/workflow_engine';
import {
  getStrategySummarizer,
} from '../lib/ux/strategy_summarizer';
import {
  getGuidedBuilder,
} from '../lib/ux/guided_builder';
import {
  getDiagnostics,
} from '../lib/ux/diagnostics';

const router = Router();

// ──────────────────────────────────────────────────────────────────────────
// Workflow Endpoints
// ──────────────────────────────────────────────────────────────────────────

/**
 * POST /api/ux/workflow/start
 * Start a new workflow (idea → review → ready)
 */
router.post('/workflow/start', async (req: Request, res: Response) => {
  try {
    const { type, content, preferences } = req.body;

    if (!type || !content) {
      return res.status(400).json({
        error: 'Missing required fields: type, content',
      });
    }

    const input: WorkflowInput = {
      type,
      content,
      preferences,
    };

    const engine = getWorkflowEngine();
    const result = await engine.runFullWorkflow(input);

    return res.json({
      success: result.success,
      workflowId: result.workflowId,
      state: result.state,
      readyToDeploy: result.readyToDeploy,
      message: result.message,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Workflow start failed',
    });
  }
});

/**
 * GET /api/ux/workflow/:id
 * Get current workflow state
 */
router.get('/workflow/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const engine = getWorkflowEngine();
    const state = engine.getWorkflowState(id);

    if (!state) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    return res.json({
      success: true,
      workflow: {
        id: state.id,
        currentStep: state.currentStep,
        progress: state.progress,
        status: state.status,
        steps: state.steps,
        strategy: state.strategy,
        backtestResults: state.backtestResults,
        critiqueReport: state.critiqueReport,
        variants: state.variants,
        selectedVariant: state.selectedVariant,
        promotionStatus: state.promotionStatus,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to get workflow',
    });
  }
});

/**
 * GET /api/ux/workflow/:id/next
 * Get next steps guidance
 */
router.get('/workflow/:id/next', (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const engine = getWorkflowEngine();
    const guidance = engine.getNextSteps(id);

    return res.json({
      success: true,
      guidance: {
        currentStep: guidance.currentStep,
        nextAction: guidance.nextAction,
        explanation: guidance.explanation,
        options: guidance.options,
        warnings: guidance.warnings,
        estimatedTimeRemaining: guidance.estimatedTimeRemaining,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to get next steps',
    });
  }
});

/**
 * POST /api/ux/workflow/:id/resume
 * Resume workflow from checkpoint
 */
router.post('/workflow/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const { fromStep } = req.body;

    if (!fromStep) {
      return res.status(400).json({ error: 'Missing required field: fromStep' });
    }

    const engine = getWorkflowEngine();
    const result = await engine.resumeWorkflow(id, fromStep);

    return res.json({
      success: result.success,
      workflow: result.state,
      message: result.message,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Workflow resume failed',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Quick Actions
// ──────────────────────────────────────────────────────────────────────────

/**
 * POST /api/ux/quick-backtest
 * Quick backtest from natural language
 */
router.post('/quick-backtest', async (req: Request, res: Response) => {
  try {
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({
        error: 'Missing required field: description',
      });
    }

    const engine = getWorkflowEngine();
    const result = await engine.quickBacktest(description);

    return res.json({
      success: result.success,
      backtestId: result.backtestId,
      summary: result.summary,
      metrics: {
        sharpeRatio: result.sharpeRatio,
        maxDrawdown: result.maxDrawdown,
        winRate: result.winRate,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Quick backtest failed',
    });
  }
});

/**
 * POST /api/ux/quick-deploy/:strategyId
 * Quick deploy a strategy
 */
router.post('/quick-deploy/:strategyId', async (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params as { strategyId: string };
    const engine = getWorkflowEngine();
    const result = await engine.quickDeploy(strategyId);

    return res.json({
      success: result.success,
      deploymentId: result.deploymentId,
      status: result.status,
      timestamp: result.timestamp,
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Quick deploy failed',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Strategy Summary Endpoints
// ──────────────────────────────────────────────────────────────────────────

/**
 * GET /api/ux/summary/:strategyId
 * Get human-readable strategy summary
 */
router.get('/summary/:strategyId', (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params as { strategyId: string };

    // Mock strategy for demo
    const mockStrategy = {
      id: strategyId,
      name: `Strategy_${strategyId}`,
      entry: { type: 'moving_average_cross', fast_ma: 10, slow_ma: 50 },
      exit: { type: 'profit_target', target: 0.05 },
      timeframe: 'daily',
      win_rate: 0.58,
      sharpe_ratio: 1.5,
      max_drawdown: 0.12,
      profit_factor: 2.0,
    };

    const summarizer = getStrategySummarizer();
    const summary = summarizer.summarize(mockStrategy);

    return res.json({
      success: true,
      summary: {
        strategyId,
        oneLiner: summary.oneLiner,
        description: summary.description,
        howItWorks: summary.howItWorks,
        whenItWorks: summary.whenItWorks,
        whenItFails: summary.whenItFails,
        riskProfile: summary.riskProfile,
        suitableFor: summary.suitableFor,
        keyMetrics: summary.keyMetrics,
        quickFacts: summary.quickFacts,
        grade: summary.grade,
        emoji: summary.emoji,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to get summary',
    });
  }
});

/**
 * POST /api/ux/summary/compare
 * Compare multiple strategies
 */
router.post('/summary/compare', (req: Request, res: Response) => {
  try {
    const { strategies } = req.body;

    if (!Array.isArray(strategies) || strategies.length < 2) {
      return res.status(400).json({
        error: 'Must provide at least 2 strategies',
      });
    }

    const summarizer = getStrategySummarizer();
    const comparison = summarizer.compareSummary(strategies);

    return res.json({
      success: true,
      comparison: {
        strategies: comparison.strategies,
        recommendation: comparison.recommendation,
        differences: comparison.differences,
        winner: comparison.winner,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Comparison failed',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Guided Builder Endpoints
// ──────────────────────────────────────────────────────────────────────────

/**
 * POST /api/ux/builder/start
 * Start a guided strategy builder session
 */
router.post('/builder/start', (req: Request, res: Response) => {
  try {
    const builder = getGuidedBuilder();
    const session = builder.startSession();
    const step = builder.getCurrentStep(session.id);

    return res.json({
      success: true,
      session: {
        id: session.id,
        currentStep: session.currentStep,
        totalSteps: session.totalSteps,
        progress: (session.currentStep / session.totalSteps) * 100,
      },
      currentQuestion: {
        section: step.section,
        question: step.question,
        progress: step.progress,
        nextButtonText: step.nextButtonText,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to start builder',
    });
  }
});

/**
 * GET /api/ux/builder/:sessionId
 * Get current builder step
 */
router.get('/builder/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as { sessionId: string };
    const builder = getGuidedBuilder();
    const step = builder.getCurrentStep(sessionId);

    return res.json({
      success: true,
      step: {
        section: step.section,
        question: step.question,
        progress: step.progress,
        strategySoFar: step.strategySoFar,
        nextButtonText: step.nextButtonText,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to get step',
    });
  }
});

/**
 * POST /api/ux/builder/:sessionId/answer
 * Submit answer to current question
 */
router.post('/builder/:sessionId/answer', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as { sessionId: string };
    const { answer } = req.body;

    if (!answer) {
      return res.status(400).json({ error: 'Missing required field: answer' });
    }

    const builder = getGuidedBuilder();
    const nextStep = builder.processAnswer(sessionId, answer);

    return res.json({
      success: true,
      step: {
        section: nextStep.section,
        question: nextStep.question,
        progress: nextStep.progress,
        strategySoFar: nextStep.strategySoFar,
        nextButtonText: nextStep.nextButtonText,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to process answer',
    });
  }
});

/**
 * POST /api/ux/builder/:sessionId/compile
 * Compile and finalize strategy
 */
router.post('/builder/:sessionId/compile', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params as { sessionId: string };
    const builder = getGuidedBuilder();
    const strategy = builder.compile(sessionId);

    return res.json({
      success: true,
      strategy: {
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        instruments: strategy.instruments,
        timeframe: strategy.timeframe,
        symbols: strategy.symbols,
        approach: strategy.approach,
        indicators: strategy.indicators,
        riskTolerance: strategy.riskTolerance,
        entry: strategy.entry,
        exit: strategy.exit,
        filters: strategy.filters,
        createdAt: strategy.createdAt,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Failed to compile strategy',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Diagnostics Endpoints
// ──────────────────────────────────────────────────────────────────────────

/**
 * GET /api/ux/diagnostics/:strategyId
 * Diagnose a strategy
 */
router.get('/diagnostics/:strategyId', (req: Request, res: Response) => {
  try {
    const { strategyId } = req.params as { strategyId: string };
    const diagnostics = getDiagnostics();
    const report = diagnostics.diagnose(strategyId);

    return res.json({
      success: true,
      report: {
        strategyId: report.strategyId,
        health: report.health,
        issues: report.issues,
        quickFixes: report.quickFixes,
        detailedAnalysis: report.detailedAnalysis,
        timeline: report.timeline,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Diagnosis failed',
    });
  }
});

/**
 * GET /api/ux/diagnostics/trade/:tradeId
 * Diagnose a failed trade
 */
router.get('/diagnostics/trade/:tradeId', (req: Request, res: Response) => {
  try {
    const { tradeId } = req.params as { tradeId: string };
    const diagnostics = getDiagnostics();
    const diagnosis = diagnostics.diagnoseTradeFailure(tradeId);

    return res.json({
      success: true,
      diagnosis: {
        tradeId: diagnosis.tradeId,
        failureReason: diagnosis.failureReason,
        rootCauses: diagnosis.rootCauses,
        preventionStrategies: diagnosis.preventionStrategies,
        marketCondition: diagnosis.marketCondition,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Trade diagnosis failed',
    });
  }
});

/**
 * GET /api/ux/diagnostics/inactivity
 * Diagnose why system isn't trading
 */
router.get('/diagnostics/inactivity', (req: Request, res: Response) => {
  try {
    const diagnostics = getDiagnostics();
    const diagnosis = diagnostics.diagnoseInactivity();

    return res.json({
      success: true,
      diagnosis: {
        reason: diagnosis.reason,
        duration: diagnosis.duration,
        affectedStrategies: diagnosis.affectedStrategies,
        checkItems: diagnosis.checkItems,
        nextSteps: diagnosis.nextSteps,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'Inactivity diagnosis failed',
    });
  }
});

/**
 * GET /api/ux/diagnostics/system
 * System-wide health check
 */
router.get('/diagnostics/system', (req: Request, res: Response) => {
  try {
    const diagnostics = getDiagnostics();
    const check = diagnostics.systemCheck();

    return res.json({
      success: true,
      systemCheck: {
        timestamp: check.timestamp,
        overallHealth: check.overallHealth,
        components: check.components,
        issues: check.issues,
        recommendations: check.recommendations,
      },
    });
  } catch (error) {
    return res.status(503).json({
      error: error instanceof Error ? error.message : 'System check failed',
    });
  }
});

export default router;
