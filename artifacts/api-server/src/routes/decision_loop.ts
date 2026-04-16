/**
 * Decision Loop Routes
 * Express router for all decision loop endpoints
 */

import { Router, Request, Response, NextFunction } from 'express';
import {
  runDecisionLoop,
  runDecisionLoopTo,
  resumeDecisionLoop,
  QuantDecisionPipeline,
  StrategyDSL,
  DecisionLoopResult,
  PipelineState,
  PipelineStep,
} from '../lib/decision_loop';
import { logger } from "../lib/logger.js";

// ============================================================================
// TYPES
// ============================================================================

interface RunDecisionLoopRequest {
  input: string | StrategyDSL;
  memory_db?: any;
  backtest_engine?: any;
  governance_rules?: any;
  explain_engine?: any;
}

interface RunToRequest extends RunDecisionLoopRequest {
  step: PipelineStep;
}

interface ResumeRequest extends RunDecisionLoopRequest {
  saved_state: PipelineState;
  from_step: PipelineStep;
}

interface InterpretRequest {
  input: string;
}

interface ScreenRequest {
  strategy: StrategyDSL;
  memory_context?: any;
}

interface CausalityRequest {
  strategy: StrategyDSL;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

const validateInput = (req: Request, res: Response, next: NextFunction) => {
  if (!req.body) {
    return res.status(400).json({
      success: false,
      error: 'Request body required',
      timestamp: Date.now(),
    } as ApiResponse<null>);
  }
  return next();
};

const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error({ err }, "[decision_loop] Route error");
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error',
    timestamp: Date.now(),
  } as ApiResponse<null>);
};

// ============================================================================
// PIPELINE STATE STORAGE (In-memory; replace with DB in production)
// ============================================================================

const pipelineStates = new Map<string, PipelineState>();

// ============================================================================
// ROUTER
// ============================================================================

const router = Router();

router.use(validateInput);

/**
 * POST /api/decision-loop/run
 * Run full decision loop pipeline
 */
router.post('/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { input, memory_db, backtest_engine, governance_rules, explain_engine } =
      req.body as RunDecisionLoopRequest;

    if (!input) {
      return res.status(400).json({
        success: false,
        error: 'input field required (string or StrategyDSL object)',
        timestamp: Date.now(),
      } as ApiResponse<null>);
    }

    const result = await runDecisionLoop(
      input,
      memory_db,
      backtest_engine,
      governance_rules,
      explain_engine
    );

    pipelineStates.set(result.pipeline_state.pipeline_id, result.pipeline_state);

    return res.status(200).json({
      success: true,
      data: result,
      timestamp: Date.now(),
    } as ApiResponse<DecisionLoopResult>);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/decision-loop/run-to/:step
 * Run pipeline up to specific step
 */
router.post(
  '/run-to/:step',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const step = req.params.step as PipelineStep;
      const { input, memory_db, backtest_engine, governance_rules, explain_engine } =
        req.body as RunToRequest;

      if (!input) {
        return res.status(400).json({
          success: false,
          error: 'input field required',
          timestamp: Date.now(),
        } as ApiResponse<null>);
      }

      const validSteps: PipelineStep[] = [
        'INTAKE',
        'MEMORY_CONSULT',
        'PARSE_AND_RESOLVE',
        'EARLY_SCREEN',
        'CRITIQUE',
        'VARIANT_GENERATION',
        'BACKTEST',
        'POST_BACKTEST_ANALYSIS',
        'RANKING',
        'IMPROVEMENT',
        'EXPLAIN',
        'GOVERNANCE_GATE',
        'MEMORY_LEARN',
        'RECOMMEND',
      ];

      if (!validSteps.includes(step as PipelineStep)) {
        return res.status(400).json({
          success: false,
          error: `Invalid step: ${step}. Must be one of: ${validSteps.join(', ')}`,
          timestamp: Date.now(),
        } as ApiResponse<null>);
      }

      const result = await runDecisionLoopTo(
        input,
        step,
        memory_db,
        backtest_engine,
        governance_rules,
        explain_engine
      );

      pipelineStates.set(result.pipeline_state.pipeline_id, result.pipeline_state);

      return res.status(200).json({
        success: true,
        data: result,
        timestamp: Date.now(),
      } as ApiResponse<DecisionLoopResult>);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/decision-loop/resume
 * Resume pipeline from checkpoint
 */
router.post('/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      saved_state,
      from_step,
      memory_db,
      backtest_engine,
      governance_rules,
      explain_engine,
    } = req.body as ResumeRequest;

    if (!saved_state) {
      return res.status(400).json({
        success: false,
        error: 'saved_state field required (PipelineState object)',
        timestamp: Date.now(),
      } as ApiResponse<null>);
    }

    if (!from_step) {
      return res.status(400).json({
        success: false,
        error: 'from_step field required',
        timestamp: Date.now(),
      } as ApiResponse<null>);
    }

    const result = await resumeDecisionLoop(
      saved_state,
      from_step,
      memory_db,
      backtest_engine,
      governance_rules,
      explain_engine
    );

    pipelineStates.set(result.pipeline_state.pipeline_id, result.pipeline_state);

    return res.status(200).json({
      success: true,
      data: result,
      timestamp: Date.now(),
    } as ApiResponse<DecisionLoopResult>);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/decision-loop/status/:pipelineId
 * Get current pipeline status
 */
router.get(
  '/status/:pipelineId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const pipelineId = req.params.pipelineId as string;

      const state = pipelineStates.get(pipelineId);
      if (!state) {
        return res.status(404).json({
          success: false,
          error: `Pipeline ${pipelineId} not found`,
          timestamp: Date.now(),
        } as ApiResponse<null>);
      }

      return res.status(200).json({
        success: true,
        data: state,
        timestamp: Date.now(),
      } as ApiResponse<PipelineState>);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/decision-loop/abort/:pipelineId
 * Abort running pipeline
 */
router.post(
  '/abort/:pipelineId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const pipelineId = req.params.pipelineId as string;

      const state = pipelineStates.get(pipelineId);
      if (!state) {
        return res.status(404).json({
          success: false,
          error: `Pipeline ${pipelineId} not found`,
          timestamp: Date.now(),
        } as ApiResponse<null>);
      }

      state.abort_requested = true;

      return res.status(200).json({
        success: true,
        data: { message: 'Pipeline abort requested', pipeline_id: pipelineId },
        timestamp: Date.now(),
      } as ApiResponse<any>);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * POST /api/decision-loop/interpret
 * Just resolve ambiguity (no full pipeline)
 */
router.post('/interpret', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { input } = req.body as InterpretRequest;

    if (!input || typeof input !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'input field required (string)',
        timestamp: Date.now(),
      } as ApiResponse<null>);
    }

    const { AmbiguityResolver } = await import('../lib/decision_loop');
    const resolver = new AmbiguityResolver();
    const interpretations = resolver.resolveAmbiguity(input);

    return res.status(200).json({
      success: true,
      data: {
        interpretations,
        best_interpretation: interpretations[0],
        input_text: input,
      },
      timestamp: Date.now(),
    } as ApiResponse<any>);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/decision-loop/screen
 * Just early screen (no full pipeline)
 */
router.post('/screen', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { strategy, memory_context } = req.body as ScreenRequest;

    if (!strategy) {
      return res.status(400).json({
        success: false,
        error: 'strategy field required (StrategyDSL object)',
        timestamp: Date.now(),
      } as ApiResponse<null>);
    }

    const { EarlyRejector } = await import('../lib/decision_loop');
    const rejector = new EarlyRejector();
    const screenResult = rejector.screen(strategy, memory_context || {});

    return res.status(200).json({
      success: true,
      data: screenResult,
      timestamp: Date.now(),
    } as ApiResponse<any>);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/decision-loop/explain-causality
 * Just causal reasoning (no full pipeline)
 */
router.post(
  '/explain-causality',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { strategy } = req.body as CausalityRequest;

      if (!strategy) {
        return res.status(400).json({
          success: false,
          error: 'strategy field required (StrategyDSL object)',
          timestamp: Date.now(),
        } as ApiResponse<null>);
      }

      const { CausalReasoner } = await import('../lib/decision_loop');
      const reasoner = new CausalReasoner();
      const analysis = reasoner.analyzeEdgeCausality(strategy);

      return res.status(200).json({
        success: true,
        data: analysis,
        timestamp: Date.now(),
      } as ApiResponse<any>);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * GET /api/decision-loop/history
 * Get past pipeline runs (from in-memory store)
 */
router.get('/history', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '20', offset = '0' } = req.query;

    const limitNum = Math.min(parseInt(limit as string, 10) || 20, 100);
    const offsetNum = parseInt(offset as string, 10) || 0;

    const allStates = Array.from(pipelineStates.values());
    allStates.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    const paginated = allStates.slice(offsetNum, offsetNum + limitNum);

    return res.status(200).json({
      success: true,
      data: {
        runs: paginated,
        total: allStates.length,
        limit: limitNum,
        offset: offsetNum,
      },
      timestamp: Date.now(),
    } as ApiResponse<any>);
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /api/decision-loop/history/:pipelineId
 * Delete a pipeline state
 */
router.delete(
  '/history/:pipelineId',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const pipelineId = req.params.pipelineId as string;

      if (pipelineStates.has(pipelineId)) {
        pipelineStates.delete(pipelineId);
        return res.status(200).json({
          success: true,
          data: { deleted: pipelineId },
          timestamp: Date.now(),
        } as ApiResponse<any>);
      }

      return res.status(404).json({
        success: false,
        error: `Pipeline ${pipelineId} not found`,
        timestamp: Date.now(),
      } as ApiResponse<null>);
    } catch (error) {
      return next(error);
    }
  }
);

/**
 * GET /api/decision-loop/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      active_pipelines: pipelineStates.size,
      timestamp: Date.now(),
    },
    timestamp: Date.now(),
  } as ApiResponse<any>);
});

router.use(errorHandler);

export default router;
