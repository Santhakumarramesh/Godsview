import express, { Request, Response } from 'express';
import pino from 'pino';
import {
  detectRegime,
  getSnapshot,
  getLatestForSymbol,
  getHistoryForSymbol,
  getTransition,
  getTransitionsForSymbol,
  getAllTransitions,
  confirmTransition,
  suggestAdaptation,
  getAdaptation,
  getAdaptationsForStrategy,
  getAllAdaptations,
  createAlert,
  acknowledgeAlert,
  getAlert,
  getAlertsForSymbol,
  getUnacknowledgedAlerts,
  getAllAlerts,
  registerModel,
  updateModelAccuracy,
  getModel,
  getAllModels,
  getRegimeStats,
  MarketData,
  RegimeAlert,
} from '../lib/regime_detection';

const router = express.Router();
const logger = pino();

// POST /detect - Detect regime
router.post('/detect', (req: Request, res: Response) => {
  try {
    const { symbol, market_data } = req.body;

    if (!symbol || !market_data) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: symbol, market_data',
      });
    }

    const snapshot = detectRegime(symbol, market_data as MarketData);
    logger.info({ snapshot }, 'Regime detected');

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    logger.error(error, 'Error detecting regime');
    res.status(500).json({
      success: false,
      error: 'Failed to detect regime',
    });
  }
});

// GET /snapshots - List all snapshots
router.get('/snapshots', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const stats = getRegimeStats();
    const allSnapshots = Array.from({ length: stats.total_snapshots }, (_, i) => i);

    const snapshots = allSnapshots
      .map((_, i) => {
        const history = getHistoryForSymbol(`SYMBOL_${i}`, 1);
        return history.snapshots[0];
      })
      .filter(Boolean);

    const displaySnapshots = limit ? snapshots.slice(-limit) : snapshots;

    res.json({
      success: true,
      data: displaySnapshots,
    });
  } catch (error) {
    logger.error(error, 'Error listing snapshots');
    res.status(500).json({
      success: false,
      error: 'Failed to list snapshots',
    });
  }
});

// GET /snapshots/:symbol - Get snapshots for symbol
router.get('/snapshots/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const history = getHistoryForSymbol(symbol, limit);

    res.json({
      success: true,
      data: history.snapshots,
    });
  } catch (error) {
    logger.error(error, 'Error getting symbol snapshots');
    res.status(500).json({
      success: false,
      error: 'Failed to get symbol snapshots',
    });
  }
});

// GET /snapshot/:id - Get single snapshot
router.get('/snapshot/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const snapshot = getSnapshot(id);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found',
      });
    }

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    logger.error(error, 'Error getting snapshot');
    res.status(500).json({
      success: false,
      error: 'Failed to get snapshot',
    });
  }
});

// GET /latest/:symbol - Get latest for symbol
router.get('/latest/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const snapshot = getLatestForSymbol(symbol);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'No snapshot found for symbol',
      });
    }

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    logger.error(error, 'Error getting latest snapshot');
    res.status(500).json({
      success: false,
      error: 'Failed to get latest snapshot',
    });
  }
});

// GET /transitions - Get all transitions
router.get('/transitions', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const transitions = getAllTransitions(limit);

    res.json({
      success: true,
      data: transitions,
    });
  } catch (error) {
    logger.error(error, 'Error getting transitions');
    res.status(500).json({
      success: false,
      error: 'Failed to get transitions',
    });
  }
});

// GET /transitions/:symbol - Get transitions for symbol
router.get('/transitions/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    const transitions = getTransitionsForSymbol(symbol, limit);

    res.json({
      success: true,
      data: transitions,
    });
  } catch (error) {
    logger.error(error, 'Error getting symbol transitions');
    res.status(500).json({
      success: false,
      error: 'Failed to get symbol transitions',
    });
  }
});

// POST /transitions/:id/confirm - Confirm transition
router.post('/transitions/:id/confirm', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const transition = confirmTransition(id);

    if (!transition) {
      return res.status(404).json({
        success: false,
        error: 'Transition not found',
      });
    }

    logger.info({ transition }, 'Transition confirmed');

    res.json({
      success: true,
      data: transition,
    });
  } catch (error) {
    logger.error(error, 'Error confirming transition');
    res.status(500).json({
      success: false,
      error: 'Failed to confirm transition',
    });
  }
});

// POST /adaptations - Suggest adaptation
router.post('/adaptations', (req: Request, res: Response) => {
  try {
    const { strategy_id, symbol } = req.body;

    if (!strategy_id || !symbol) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: strategy_id, symbol',
      });
    }

    const adaptation = suggestAdaptation(strategy_id, symbol);

    if (!adaptation) {
      return res.status(404).json({
        success: false,
        error: 'No regime found for symbol',
      });
    }

    logger.info({ adaptation }, 'Strategy adaptation suggested');

    res.json({
      success: true,
      data: adaptation,
    });
  } catch (error) {
    logger.error(error, 'Error suggesting adaptation');
    res.status(500).json({
      success: false,
      error: 'Failed to suggest adaptation',
    });
  }
});

// GET /adaptations - Get all adaptations
router.get('/adaptations', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const adaptations = getAllAdaptations(limit);

    res.json({
      success: true,
      data: adaptations,
    });
  } catch (error) {
    logger.error(error, 'Error getting adaptations');
    res.status(500).json({
      success: false,
      error: 'Failed to get adaptations',
    });
  }
});

// GET /adaptations/strategy/:strategy_id - Get adaptations for strategy
router.get('/adaptations/strategy/:strategy_id', (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const adaptations = getAdaptationsForStrategy(strategy_id);

    res.json({
      success: true,
      data: adaptations,
    });
  } catch (error) {
    logger.error(error, 'Error getting strategy adaptations');
    res.status(500).json({
      success: false,
      error: 'Failed to get strategy adaptations',
    });
  }
});

// GET /adaptation/:id - Get single adaptation
router.get('/adaptation/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const adaptation = getAdaptation(id);

    if (!adaptation) {
      return res.status(404).json({
        success: false,
        error: 'Adaptation not found',
      });
    }

    res.json({
      success: true,
      data: adaptation,
    });
  } catch (error) {
    logger.error(error, 'Error getting adaptation');
    res.status(500).json({
      success: false,
      error: 'Failed to get adaptation',
    });
  }
});

// POST /alerts - Create alert
router.post('/alerts', (req: Request, res: Response) => {
  try {
    const { symbol, alert_type, severity, message, regime_before, regime_after } = req.body;

    if (!symbol || !alert_type || !severity || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: symbol, alert_type, severity, message',
      });
    }

    const alert = createAlert(symbol, alert_type, severity, message, regime_before, regime_after);

    logger.info({ alert }, 'Alert created');

    res.status(201).json({
      success: true,
      data: alert,
    });
  } catch (error) {
    logger.error(error, 'Error creating alert');
    res.status(500).json({
      success: false,
      error: 'Failed to create alert',
    });
  }
});

// GET /alerts - Get all alerts
router.get('/alerts', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const alerts = getAllAlerts(limit);

    res.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    logger.error(error, 'Error getting alerts');
    res.status(500).json({
      success: false,
      error: 'Failed to get alerts',
    });
  }
});

// GET /alerts/unacknowledged - Get unacknowledged alerts
router.get('/alerts/unacknowledged', (req: Request, res: Response) => {
  try {
    const alerts = getUnacknowledgedAlerts();

    res.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    logger.error(error, 'Error getting unacknowledged alerts');
    res.status(500).json({
      success: false,
      error: 'Failed to get unacknowledged alerts',
    });
  }
});

// GET /alerts/:symbol - Get alerts for symbol
router.get('/alerts/:symbol', (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const alerts = getAlertsForSymbol(symbol);

    res.json({
      success: true,
      data: alerts,
    });
  } catch (error) {
    logger.error(error, 'Error getting symbol alerts');
    res.status(500).json({
      success: false,
      error: 'Failed to get symbol alerts',
    });
  }
});

// POST /alerts/:id/acknowledge - Acknowledge alert
router.post('/alerts/:id/acknowledge', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alert = acknowledgeAlert(id);

    if (!alert) {
      return res.status(404).json({
        success: false,
        error: 'Alert not found',
      });
    }

    logger.info({ alert }, 'Alert acknowledged');

    res.json({
      success: true,
      data: alert,
    });
  } catch (error) {
    logger.error(error, 'Error acknowledging alert');
    res.status(500).json({
      success: false,
      error: 'Failed to acknowledge alert',
    });
  }
});

// POST /models - Register model
router.post('/models', (req: Request, res: Response) => {
  try {
    const { name, version, symbols, features } = req.body;

    if (!name || !version || !symbols || !features) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, version, symbols, features',
      });
    }

    const model = registerModel(name, version, symbols, features);

    logger.info({ model }, 'Model registered');

    res.status(201).json({
      success: true,
      data: model,
    });
  } catch (error) {
    logger.error(error, 'Error registering model');
    res.status(500).json({
      success: false,
      error: 'Failed to register model',
    });
  }
});

// GET /models - Get all models
router.get('/models', (req: Request, res: Response) => {
  try {
    const models = getAllModels();

    res.json({
      success: true,
      data: models,
    });
  } catch (error) {
    logger.error(error, 'Error getting models');
    res.status(500).json({
      success: false,
      error: 'Failed to get models',
    });
  }
});

// PATCH /models/:id/accuracy - Update model accuracy
router.patch('/models/:id/accuracy', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { accuracy_score } = req.body;

    if (accuracy_score === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: accuracy_score',
      });
    }

    const model = updateModelAccuracy(id, accuracy_score);

    if (!model) {
      return res.status(404).json({
        success: false,
        error: 'Model not found',
      });
    }

    logger.info({ model }, 'Model accuracy updated');

    res.json({
      success: true,
      data: model,
    });
  } catch (error) {
    logger.error(error, 'Error updating model accuracy');
    res.status(500).json({
      success: false,
      error: 'Failed to update model accuracy',
    });
  }
});

// GET /stats - Get regime stats
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = getRegimeStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error(error, 'Error getting regime stats');
    res.status(500).json({
      success: false,
      error: 'Failed to get regime stats',
    });
  }
});

export default router;
