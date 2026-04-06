// system_bridge.ts - Express router for system bridge endpoints
// Wires the 11 subsystems together at the API boundary

import { Router, Request, Response, NextFunction } from 'express';
import { SystemBridge, FullEvaluationResult, EnhancedSignalResult, PostTradeAnalysis, SystemStatus, MaintenanceReport } from '../lib/system_bridge';
import { QuantAPIDocs } from '../lib/quant_api_docs';

// ============================================================================
// Types
// ============================================================================

interface BridgeRequest extends Request {
  bridge?: SystemBridge;
  docs?: QuantAPIDocs;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
  timestamp: number;
  executionTimeMs?: number;
}

// ============================================================================
// Express Router Setup
// ============================================================================

export function createSystemBridgeRouter(bridge: SystemBridge, docs: QuantAPIDocs): Router {
  const router = Router();

  // Attach dependencies to request
  router.use((req: BridgeRequest, res: Response, next: NextFunction) => {
    req.bridge = bridge;
    req.docs = docs;
    next();
  });

  // =========================================================================
  // Strategy Evaluation Endpoints
  // =========================================================================

  /**
   * POST /api/bridge/evaluate-strategy
   * Full strategy evaluation through entire pipeline
   */
  router.post(
    '/evaluate-strategy',
    async (req: BridgeRequest, res: Response) => {
      const startTime = Date.now();

      try {
        if (!req.body.input) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: input',
            code: 400,
            timestamp: Date.now()
          } as ApiResponse<null>);
        }

        const result = await req.bridge!.evaluateStrategy(req.body.input, req.body.timeoutMs);

        return res.status(200).json({
          success: true,
          data: result,
          timestamp: Date.now(),
          executionTimeMs: Date.now() - startTime
        } as ApiResponse<FullEvaluationResult>);
      } catch (error) {
        console.error('Strategy evaluation error:', error);
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Strategy evaluation failed',
          code: 500,
          timestamp: Date.now()
        } as ApiResponse<null>);
      }
    }
  );

  // =========================================================================
  // Signal Evaluation Endpoints
  // =========================================================================

  /**
   * POST /api/bridge/evaluate-signal
   * Enhanced signal evaluation with all subsystems
   */
  router.post(
    '/evaluate-signal',
    async (req: BridgeRequest, res: Response) => {
      const startTime = Date.now();

      try {
        if (!req.body.features) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: features',
            code: 400,
            timestamp: Date.now()
          } as ApiResponse<null>);
        }

        const result = await req.bridge!.evaluateSignal(
          req.body.features,
          req.body.strategy,
          req.body.symbol
        );

        return res.status(200).json({
          success: true,
          data: result,
          timestamp: Date.now(),
          executionTimeMs: Date.now() - startTime
        } as ApiResponse<EnhancedSignalResult>);
      } catch (error) {
        console.error('Signal evaluation error:', error);
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Signal evaluation failed',
          code: 500,
          timestamp: Date.now()
        } as ApiResponse<null>);
      }
    }
  );

  // =========================================================================
  // Trade Review Endpoints
  // =========================================================================

  /**
   * POST /api/bridge/post-trade
   * Post-trade review and updates
   */
  router.post(
    '/post-trade',
    async (req: BridgeRequest, res: Response) => {
      const startTime = Date.now();

      try {
        if (!req.body.trade || !req.body.prediction) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields: trade and prediction',
            code: 400,
            timestamp: Date.now()
          } as ApiResponse<null>);
        }

        const result = await req.bridge!.postTradeReview(req.body.trade, req.body.prediction);

        return res.status(200).json({
          success: true,
          data: result,
          timestamp: Date.now(),
          executionTimeMs: Date.now() - startTime
        } as ApiResponse<PostTradeAnalysis>);
      } catch (error) {
        console.error('Post-trade review error:', error);
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : 'Post-trade review failed',
          code: 500,
          timestamp: Date.now()
        } as ApiResponse<null>);
      }
    }
  );

  // =========================================================================
  // System Status Endpoints
  // =========================================================================

  /**
   * GET /api/bridge/status
   * Complete system status across all subsystems
   */
  router.get('/status', async (req: BridgeRequest, res: Response) => {
    try {
      const status = await req.bridge!.getSystemStatus();

      return res.status(200).json({
        success: true,
        data: status,
        timestamp: Date.now()
      } as ApiResponse<SystemStatus>);
    } catch (error) {
      console.error('Status check error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Status check failed',
        code: 500,
        timestamp: Date.now()
      } as ApiResponse<null>);
    }
  });

  /**
   * GET /api/bridge/health
   * Quick health check of bridge
   */
  router.get('/health', async (req: BridgeRequest, res: Response) => {
    try {
      const status = await req.bridge!.getSystemStatus();
      const healthy =
        status.bridge_health === 'HEALTHY' && status.subsystems_online >= status.subsystems_total - 1;

      return res.status(healthy ? 200 : 503).json({
        success: healthy,
        data: {
          health: status.bridge_health,
          subsystems_online: status.subsystems_online,
          subsystems_total: status.subsystems_total
        },
        timestamp: Date.now()
      });
    } catch (error) {
      return res.status(503).json({
        success: false,
        error: 'Health check failed',
        code: 503,
        timestamp: Date.now()
      });
    }
  });

  // =========================================================================
  // Maintenance Endpoints
  // =========================================================================

  /**
   * POST /api/bridge/maintenance
   * Trigger daily maintenance tasks
   */
  router.post('/maintenance', async (req: BridgeRequest, res: Response) => {
    const startTime = Date.now();

    try {
      const report = await req.bridge!.runDailyMaintenance();

      return res.status(200).json({
        success: true,
        data: report,
        timestamp: Date.now(),
        executionTimeMs: Date.now() - startTime
      } as ApiResponse<MaintenanceReport>);
    } catch (error) {
      console.error('Maintenance error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Maintenance failed',
        code: 500,
        timestamp: Date.now()
      } as ApiResponse<null>);
    }
  });

  // =========================================================================
  // Documentation Endpoints
  // =========================================================================

  /**
   * GET /api/bridge/docs
   * Live API documentation
   */
  router.get('/docs', (req: BridgeRequest, res: Response) => {
    try {
      const docs = req.docs!.getFullDocumentation();

      return res.status(200).json({
        success: true,
        data: docs,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Documentation error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Documentation retrieval failed',
        code: 500,
        timestamp: Date.now()
      });
    }
  });

  /**
   * GET /api/bridge/openapi
   * OpenAPI 3.0 specification
   */
  router.get('/openapi', (req: BridgeRequest, res: Response) => {
    try {
      const spec = req.docs!.getOpenAPISpec();

      return res.status(200).json({
        success: true,
        data: spec,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('OpenAPI spec error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'OpenAPI spec generation failed',
        code: 500,
        timestamp: Date.now()
      });
    }
  });

  /**
   * GET /api/bridge/docs/:path
   * Documentation for specific endpoint
   */
  router.get('/docs/:path', (req: BridgeRequest, res: Response) => {
    try {
      const path = `/${req.params.path}`;
      const doc = req.docs!.getEndpointDocs(path);

      if (!doc) {
        return res.status(404).json({
          success: false,
          error: `Documentation not found for path: ${path}`,
          code: 404,
          timestamp: Date.now()
        });
      }

      return res.status(200).json({
        success: true,
        data: doc,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Endpoint documentation error:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Endpoint documentation retrieval failed',
        code: 500,
        timestamp: Date.now()
      });
    }
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  /**
   * 404 handler for bridge routes
   */
  router.use((req: BridgeRequest, res: Response) => {
    return res.status(404).json({
      success: false,
      error: `Endpoint not found: ${req.method} ${req.path}`,
      code: 404,
      timestamp: Date.now()
    } as ApiResponse<null>);
  });

  return router;
}

/**
 * Express middleware for system bridge setup
 * Usage: app.use('/api/bridge', createSystemBridgeRouter(bridge, docs))
 */
export function attachSystemBridge(app: any, bridge: SystemBridge, docs: QuantAPIDocs): void {
  app.use('/api/bridge', createSystemBridgeRouter(bridge, docs));

  // Log router attachment
  console.log('System bridge router attached at /api/bridge');
  console.log('Available endpoints:');
  console.log('  POST   /api/bridge/evaluate-strategy');
  console.log('  POST   /api/bridge/evaluate-signal');
  console.log('  POST   /api/bridge/post-trade');
  console.log('  GET    /api/bridge/status');
  console.log('  GET    /api/bridge/health');
  console.log('  POST   /api/bridge/maintenance');
  console.log('  GET    /api/bridge/docs');
  console.log('  GET    /api/bridge/openapi');
  console.log('  GET    /api/bridge/docs/:path');
}

export default createSystemBridgeRouter;
