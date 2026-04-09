import { Router, Request, Response } from 'express';
import pino from 'pino';
import {
  parseStrategy,
  validateStrategy,
  getStrategy,
  getAllStrategies,
  updateStrategy,
  deleteStrategy,
  cloneStrategy,
  registerTemplate,
  getTemplate,
  getAllTemplates,
  instantiateTemplate,
  evaluateCondition,
  evaluateConditionGroup,
  extractIndicators,
  extractSymbols,
  type StrategyDSL,
  type ConditionGroup,
} from '../lib/strategy_dsl';

const router = Router();
const logger = pino();

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: string;
}

// ============================================================================
// POST /parse - Parse a strategy DSL definition
// ============================================================================

router.post('/parse', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const dsl: StrategyDSL = req.body;

    if (!dsl) {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain a valid StrategyDSL object',
      });
    }

    const parsed = parseStrategy(dsl);
    logger.info({ parsed }, 'Strategy parsed successfully');

    return res.status(201).json({
      success: true,
      data: parsed,
    });
  } catch (error) {
    logger.error(error, 'Failed to parse strategy');
    return res.status(500).json({
      success: false,
      error: `Failed to parse strategy: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// POST /validate - Validate without storing
// ============================================================================

router.post('/validate', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const dsl: StrategyDSL = req.body;

    if (!dsl) {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain a valid StrategyDSL object',
      });
    }

    const validation = validateStrategy(dsl);
    logger.info({ validation }, 'Strategy validated');

    return res.status(200).json({
      success: true,
      data: validation,
    });
  } catch (error) {
    logger.error(error, 'Failed to validate strategy');
    return res.status(500).json({
      success: false,
      error: `Failed to validate strategy: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// GET / - List all parsed strategies
// ============================================================================

router.get('/', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const strategies = getAllStrategies(limit);

    logger.info({ count: strategies.length }, 'Listed strategies');

    return res.status(200).json({
      success: true,
      data: strategies,
    });
  } catch (error) {
    logger.error(error, 'Failed to list strategies');
    return res.status(500).json({
      success: false,
      error: `Failed to list strategies: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// GET /:id - Get single strategy
// ============================================================================

router.get('/:id', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { id } = req.params;
    const strategy = getStrategy(id);

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: `Strategy with ID ${id} not found`,
      });
    }

    logger.info({ id }, 'Retrieved strategy');

    return res.status(200).json({
      success: true,
      data: strategy,
    });
  } catch (error) {
    logger.error(error, 'Failed to get strategy');
    return res.status(500).json({
      success: false,
      error: `Failed to get strategy: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// PATCH /:id - Update strategy
// ============================================================================

router.patch('/:id', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { id } = req.params;
    const updates: Partial<StrategyDSL> = req.body;

    const updated = updateStrategy(id, updates);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: `Strategy with ID ${id} not found`,
      });
    }

    logger.info({ id }, 'Strategy updated');

    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error(error, 'Failed to update strategy');
    return res.status(500).json({
      success: false,
      error: `Failed to update strategy: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// DELETE /:id - Delete strategy
// ============================================================================

router.delete('/:id', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { id } = req.params;
    const deleted = deleteStrategy(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: `Strategy with ID ${id} not found`,
      });
    }

    logger.info({ id }, 'Strategy deleted');

    return res.status(200).json({
      success: true,
      data: { id, deleted: true },
    });
  } catch (error) {
    logger.error(error, 'Failed to delete strategy');
    return res.status(500).json({
      success: false,
      error: `Failed to delete strategy: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// POST /:id/clone - Clone strategy
// ============================================================================

router.post('/:id/clone', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { id } = req.params;
    const { new_name } = req.body;

    if (!new_name) {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain new_name',
      });
    }

    const cloned = cloneStrategy(id, new_name);

    if (!cloned) {
      return res.status(404).json({
        success: false,
        error: `Strategy with ID ${id} not found`,
      });
    }

    logger.info({ id, new_id: cloned.id }, 'Strategy cloned');

    return res.status(201).json({
      success: true,
      data: cloned,
    });
  } catch (error) {
    logger.error(error, 'Failed to clone strategy');
    return res.status(500).json({
      success: false,
      error: `Failed to clone strategy: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// POST /templates - Register template
// ============================================================================

router.post('/templates', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { name, dsl } = req.body;

    if (!name || !dsl) {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain name and dsl',
      });
    }

    registerTemplate(name, dsl);
    logger.info({ name }, 'Template registered');

    return res.status(201).json({
      success: true,
      data: { name, registered: true },
    });
  } catch (error) {
    logger.error(error, 'Failed to register template');
    return res.status(500).json({
      success: false,
      error: `Failed to register template: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// GET /templates - List all templates
// ============================================================================

router.get('/templates', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const templates = getAllTemplates();
    logger.info({ count: templates.length }, 'Listed templates');

    return res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    logger.error(error, 'Failed to list templates');
    return res.status(500).json({
      success: false,
      error: `Failed to list templates: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// GET /templates/:name - Get template
// ============================================================================

router.get('/templates/:name', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { name } = req.params;
    const template = getTemplate(name);

    if (!template) {
      return res.status(404).json({
        success: false,
        error: `Template ${name} not found`,
      });
    }

    logger.info({ name }, 'Retrieved template');

    return res.status(200).json({
      success: true,
      data: template,
    });
  } catch (error) {
    logger.error(error, 'Failed to get template');
    return res.status(500).json({
      success: false,
      error: `Failed to get template: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// POST /templates/:name/instantiate - Instantiate template
// ============================================================================

router.post(
  '/templates/:name/instantiate',
  (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
    try {
      const { name } = req.params;
      const overrides: Partial<StrategyDSL> = req.body;

      const instance = instantiateTemplate(name, overrides);

      if (!instance) {
        return res.status(404).json({
          success: false,
          error: `Template ${name} not found`,
        });
      }

      logger.info({ template: name, strategy_id: instance.id }, 'Template instantiated');

      return res.status(201).json({
        success: true,
        data: instance,
      });
    } catch (error) {
      logger.error(error, 'Failed to instantiate template');
      return res.status(500).json({
        success: false,
        error: `Failed to instantiate template: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
);

// ============================================================================
// POST /evaluate - Evaluate conditions against market data
// ============================================================================

router.post('/evaluate', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { conditions, market_data } = req.body;

    if (!conditions || !market_data) {
      return res.status(400).json({
        success: false,
        error: 'Request body must contain conditions and market_data',
      });
    }

    const result = evaluateConditionGroup(conditions as ConditionGroup, market_data);

    logger.info({ result }, 'Conditions evaluated');

    return res.status(200).json({
      success: true,
      data: { result, conditions, market_data },
    });
  } catch (error) {
    logger.error(error, 'Failed to evaluate conditions');
    return res.status(500).json({
      success: false,
      error: `Failed to evaluate conditions: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

// ============================================================================
// POST /:id/indicators - Extract indicators from strategy
// ============================================================================

router.post('/:id/indicators', (req: Request, res: Response<SuccessResponse<any> | ErrorResponse>) => {
  try {
    const { id } = req.params;
    const strategy = getStrategy(id);

    if (!strategy) {
      return res.status(404).json({
        success: false,
        error: `Strategy with ID ${id} not found`,
      });
    }

    const indicators = extractIndicators(strategy.dsl);

    logger.info({ id, indicators }, 'Indicators extracted');

    return res.status(200).json({
      success: true,
      data: { id, indicators },
    });
  } catch (error) {
    logger.error(error, 'Failed to extract indicators');
    return res.status(500).json({
      success: false,
      error: `Failed to extract indicators: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

export default router;
