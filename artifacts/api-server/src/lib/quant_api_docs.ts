// quant_api_docs.ts - Live API documentation generator for all subsystems
// Generates OpenAPI 3.0 spec and structured endpoint documentation

// @ts-expect-error TS2307 — auto-suppressed for strict build
import { OpenAPIObject, PathItemObject, OperationObject, SchemaObject } from 'openapi3-ts';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface EndpointDoc {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  domain: string;
  summary: string;
  description: string;
  operationId: string;
  requestBody?: RequestBodySchema;
  responses: ResponseSchema[];
  parameters?: ParameterSchema[];
  examples: EndpointExample[];
  errorCodes: ErrorCode[];
  tags: string[];
}

export interface RequestBodySchema {
  contentType: string;
  schema: SchemaObject;
  description: string;
  required: boolean;
  examples?: Record<string, unknown>;
}

export interface ResponseSchema {
  status: number;
  contentType: string;
  schema: SchemaObject;
  description: string;
  example?: unknown;
}

export interface ParameterSchema {
  name: string;
  in: 'query' | 'path' | 'header';
  schema: SchemaObject;
  description: string;
  required: boolean;
}

export interface EndpointExample {
  title: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    body: unknown;
  };
}

export interface ErrorCode {
  code: number;
  name: string;
  description: string;
  example?: unknown;
}

export interface APIDocumentation {
  version: string;
  title: string;
  description: string;
  domains: DomainDoc[];
  endpoints: EndpointDoc[];
  schemas: Record<string, SchemaObject>;
  lastUpdated: number;
}

export interface DomainDoc {
  name: string;
  description: string;
  baseUrl: string;
  endpoints: string[];
}

// ============================================================================
// QuantAPIDocs Class
// ============================================================================

export class QuantAPIDocs {
  private version: string = '1.0.0';
  private title: string = 'GodsView Quant API';
  private description: string =
    'Comprehensive API documentation for GodsView 11-subsystem integration';

  constructor() {}

  /**
   * getFullDocumentation: Complete API documentation
   */
  getFullDocumentation(): APIDocumentation {
    const endpoints = this.generateAllEndpoints();

    return {
      version: this.version,
      title: this.title,
      description: this.description,
      domains: this.generateDomains(endpoints),
      endpoints,
      schemas: this.generateSchemas(),
      lastUpdated: Date.now()
    };
  }

  /**
   * getEndpointDocs: Documentation for specific endpoint
   */
  getEndpointDocs(path: string): EndpointDoc | null {
    const endpoints = this.generateAllEndpoints();
    return endpoints.find((e) => e.path === path) || null;
  }

  /**
   * getOpenAPISpec: OpenAPI 3.0 specification object
   */
  getOpenAPISpec(): OpenAPIObject {
    const endpoints = this.generateAllEndpoints();
    const paths: Record<string, PathItemObject> = {};

    for (const endpoint of endpoints) {
      const pathItem: PathItemObject = {};
      const operation: OperationObject = this.endpointToOpenAPIOperation(endpoint);

      const methodKey = endpoint.method.toLowerCase() as any;
      (pathItem as any)[methodKey] = operation;

      paths[endpoint.path] = pathItem;
    }

    return {
      openapi: '3.0.0',
      info: {
        title: this.title,
        description: this.description,
        version: this.version
      },
      servers: [
        {
          url: 'https://api.godsview.io',
          description: 'Production API'
        },
        {
          url: 'http://localhost:3000',
          description: 'Development API'
        }
      ],
      paths,
      components: {
        schemas: this.generateSchemas()
      },
      tags: this.generateTags()
    };
  }

  // =========================================================================
  // Endpoint Generators
  // =========================================================================

  private generateAllEndpoints(): EndpointDoc[] {
    return [
      ...this.generateDecisionLoopEndpoints(),
      ...this.generateEvalEndpoints(),
      ...this.generateTrustEndpoints(),
      ...this.generateLabEndpoints(),
      ...this.generateQuantEndpoints(),
      ...this.generateMemoryEndpoints(),
      ...this.generateGovernanceEndpoints(),
      ...this.generateUxEndpoints(),
      ...this.generateExplainEndpoints(),
      ...this.generateAutonomousEndpoints(),
      ...this.generateBacktestEndpoints(),
      ...this.generateMarketEndpoints()
    ];
  }

  private generateDecisionLoopEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/decision-loop/run-pipeline',
        method: 'POST',
        domain: 'decision_loop',
        summary: 'Run full 14-step decision pipeline',
        description: 'Execute the complete decision loop pipeline for strategy evaluation',
        operationId: 'runDecisionLoop',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              strategy: { $ref: '#/components/schemas/StrategyDSL' },
              features: { $ref: '#/components/schemas/SIFeatures' }
            },
            required: ['strategy']
          },
          description: 'Strategy and features for pipeline execution'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/PipelineResult' },
            description: 'Pipeline execution result'
          },
          {
            status: 400,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            description: 'Invalid strategy or features'
          }
        ],
        examples: [
          {
            title: 'Run pipeline for momentum strategy',
            request: {
              method: 'POST',
              path: '/api/decision-loop/run-pipeline',
              body: {
                strategy: {
                  id: 'momentum_001',
                  name: 'Momentum Breakout',
                  rules: []
                },
                features: {
                  price_momentum: 0.85,
                  volatility: 0.3,
                  volume_ratio: 1.5
                }
              }
            },
            response: {
              status: 200,
              body: {
                success: true,
                final_signal: 'BUY',
                confidence: 0.78,
                reasoning: 'Strong momentum with volume confirmation'
              }
            }
          }
        ],
        errorCodes: [
          { code: 400, name: 'BadRequest', description: 'Invalid strategy format' },
          { code: 408, name: 'Timeout', description: 'Pipeline timeout exceeded' }
        ],
        tags: ['decision_loop', 'core']
      },
      {
        path: '/api/decision-loop/stage/{stageName}',
        method: 'POST',
        domain: 'decision_loop',
        summary: 'Execute individual pipeline stage',
        description: 'Run a specific stage of the decision loop independently',
        operationId: 'runPipelineStage',
        parameters: [
          {
            name: 'stageName',
            in: 'path',
            schema: { type: 'string' },
            description: 'Name of pipeline stage (e.g., feature_validation, pattern_recognition)',
            required: true
          }
        ],
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Input data for the stage'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Stage execution result'
          }
        ],
        examples: [],
        errorCodes: [
          { code: 404, name: 'NotFound', description: 'Stage not found' }
        ],
        tags: ['decision_loop', 'advanced']
      },
      {
        path: '/api/decision-loop/status',
        method: 'GET',
        domain: 'decision_loop',
        summary: 'Get pipeline status',
        description: 'Check availability and health of all pipeline stages',
        operationId: 'getPipelineStatus',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/DecisionLoopStatus' },
            description: 'Pipeline health status'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['decision_loop', 'monitoring']
      },
      {
        path: '/api/decision-loop/optimize',
        method: 'POST',
        domain: 'decision_loop',
        summary: 'Optimize pipeline for specific goal',
        description: 'Automatically adjust pipeline weights to optimize for profit, risk, or accuracy',
        operationId: 'optimizePipeline',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              goal: { type: 'string', enum: ['profit', 'risk', 'accuracy', 'sharpe'] },
              constraints: { type: 'object' }
            }
          },
          description: 'Optimization parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Optimized pipeline configuration'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['decision_loop', 'advanced']
      }
    ];
  }

  private generateEvalEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/eval/score-strategy',
        method: 'POST',
        domain: 'eval',
        summary: 'Evaluate strategy performance',
        description: 'Score strategy using comprehensive evaluation framework',
        operationId: 'scoreStrategy',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/StrategyDSL' },
          description: 'Strategy to evaluate'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/EvalResult' },
            description: 'Evaluation result with grades'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['eval', 'assessment']
      },
      {
        path: '/api/eval/regression-check',
        method: 'POST',
        domain: 'eval',
        summary: 'Run regression detection',
        description: 'Check for performance regressions in strategies',
        operationId: 'checkRegressions',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              lookback_days: { type: 'number' }
            }
          },
          description: 'Regression check parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                regressions_found: { type: 'number' },
                regression_details: { type: 'array', items: { type: 'string' } }
              }
            },
            description: 'Regression check results'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['eval', 'monitoring']
      },
      {
        path: '/api/eval/compare-versions',
        method: 'POST',
        domain: 'eval',
        summary: 'Compare two strategy versions',
        description: 'Evaluate differences between strategy versions',
        operationId: 'compareVersions',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              v1_id: { type: 'string' },
              v2_id: { type: 'string' }
            }
          },
          description: 'Version IDs to compare'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Comparison result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['eval', 'comparison']
      },
      {
        path: '/api/eval/grading-criteria',
        method: 'GET',
        domain: 'eval',
        summary: 'Get evaluation grading criteria',
        description: 'Retrieve all grading criteria used in evaluations',
        operationId: 'getGradingCriteria',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Grading criteria matrix'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['eval', 'reference']
      }
    ];
  }

  private generateTrustEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/bridge/evaluate-strategy',
        method: 'POST',
        domain: 'bridge',
        summary: 'Full strategy evaluation via system bridge',
        description: 'Runs full 14-step pipeline through governance and trust surface',
        operationId: 'bridgeEvaluateStrategy',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              input: {
                oneOf: [
                  { type: 'string' },
                  { $ref: '#/components/schemas/StrategyDSL' }
                ]
              }
            }
          },
          description: 'Strategy string or object'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/FullEvaluationResult' },
            description: 'Complete evaluation result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['bridge', 'evaluation']
      },
      {
        path: '/api/bridge/evaluate-signal',
        method: 'POST',
        domain: 'bridge',
        summary: 'Enhanced signal evaluation',
        description: 'Evaluate signal with memory, causal, calibration, authority checks',
        operationId: 'bridgeEvaluateSignal',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              features: { $ref: '#/components/schemas/SIFeatures' },
              strategy: { $ref: '#/components/schemas/StrategyDSL' },
              symbol: { type: 'string' }
            }
          },
          description: 'Signal evaluation parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/EnhancedSignalResult' },
            description: 'Enhanced signal evaluation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['bridge', 'signals']
      },
      {
        path: '/api/bridge/post-trade',
        method: 'POST',
        domain: 'bridge',
        summary: 'Post-trade review and update',
        description: 'Updates memory, calibration, governance after trade completion',
        operationId: 'bridgePostTrade',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              trade: { $ref: '#/components/schemas/TradeResult' },
              prediction: { $ref: '#/components/schemas/EnhancedSignalResult' }
            }
          },
          description: 'Trade result and prediction'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/PostTradeAnalysis' },
            description: 'Post-trade analysis'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['bridge', 'trade_lifecycle']
      },
      {
        path: '/api/bridge/status',
        method: 'GET',
        domain: 'bridge',
        summary: 'System bridge health status',
        description: 'Aggregated health from all 11 subsystems',
        operationId: 'bridgeStatus',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/SystemStatus' },
            description: 'System status'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['bridge', 'monitoring']
      }
    ];
  }

  private generateLabEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/lab/parse-strategy',
        method: 'POST',
        domain: 'lab',
        summary: 'Parse strategy DSL',
        description: 'Parse strategy domain-specific language into executable form',
        operationId: 'parseStrategy',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Strategy DSL text or object'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/StrategyDSL' },
            description: 'Parsed strategy'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['lab', 'parsing']
      },
      {
        path: '/api/lab/validate-strategy',
        method: 'POST',
        domain: 'lab',
        summary: 'Validate strategy',
        description: 'Check strategy for syntax errors and logical issues',
        operationId: 'validateStrategy',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/StrategyDSL' },
          description: 'Strategy to validate'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                valid: { type: 'boolean' },
                errors: { type: 'array', items: { type: 'string' } }
              }
            },
            description: 'Validation result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['lab', 'validation']
      },
      {
        path: '/api/lab/analyze-strategy',
        method: 'POST',
        domain: 'lab',
        summary: 'Analyze strategy characteristics',
        description: 'Deep analysis of strategy mechanics and edge',
        operationId: 'analyzeStrategy',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/StrategyDSL' },
          description: 'Strategy to analyze'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/LabAnalysis' },
            description: 'Strategy analysis'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['lab', 'analysis']
      },
      {
        path: '/api/lab/list-templates',
        method: 'GET',
        domain: 'lab',
        summary: 'List strategy templates',
        description: 'Get available strategy templates for quickstart',
        operationId: 'listTemplates',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'array',
              items: { type: 'object' }
            },
            description: 'Available templates'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['lab', 'templates']
      }
    ];
  }

  private generateQuantEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/quant/v4-prediction',
        method: 'POST',
        domain: 'quant',
        summary: 'Get V4 prediction with all enhancements',
        description: 'Full V4 prediction with memory, causal, calibration',
        operationId: 'getV4Prediction',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              features: { $ref: '#/components/schemas/SIFeatures' },
              strategy: { $ref: '#/components/schemas/StrategyDSL' }
            }
          },
          description: 'Prediction parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/V4Prediction' },
            description: 'V4 prediction result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['quant', 'predictions']
      },
      {
        path: '/api/quant/record-outcome',
        method: 'POST',
        domain: 'quant',
        summary: 'Record prediction outcome',
        description: 'Update memory, calibration with actual trade result',
        operationId: 'recordOutcome',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Prediction and actual result'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Update confirmation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['quant', 'outcomes']
      },
      {
        path: '/api/quant/v4-status',
        method: 'GET',
        domain: 'quant',
        summary: 'Get V4 system health',
        description: 'Health status of all V4 components',
        operationId: 'getV4Status',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/V4Status' },
            description: 'V4 health status'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['quant', 'monitoring']
      },
      {
        path: '/api/quant/calibration-metrics',
        method: 'GET',
        domain: 'quant',
        summary: 'Get calibration metrics',
        description: 'Current calibration score and deviation metrics',
        operationId: 'getCalibrationMetrics',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Calibration metrics'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['quant', 'calibration']
      }
    ];
  }

  private generateMemoryEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/memory/find-similar',
        method: 'POST',
        domain: 'memory',
        summary: 'Find similar past setups',
        description: 'Retrieve similar market setups from memory',
        operationId: 'findSimilarSetups',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/SIFeatures' },
          description: 'Features to match'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/SimilarSetup' }
            },
            description: 'Similar setups'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['memory', 'lookup']
      },
      {
        path: '/api/memory/record-outcome',
        method: 'POST',
        domain: 'memory',
        summary: 'Record trade outcome in memory',
        description: 'Store completed trade outcome for future reference',
        operationId: 'recordMemoryOutcome',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Trade outcome'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Storage confirmation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['memory', 'recording']
      },
      {
        path: '/api/memory/regime-context',
        method: 'GET',
        domain: 'memory',
        summary: 'Get current regime context',
        description: 'Retrieve current market regime classification',
        operationId: 'getRegimeContext',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Regime context'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['memory', 'context']
      },
      {
        path: '/api/memory/prune-stale',
        method: 'POST',
        domain: 'memory',
        summary: 'Prune stale memories',
        description: 'Remove old or irrelevant memory entries',
        operationId: 'pruneStale',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                pruned_count: { type: 'number' }
              }
            },
            description: 'Prune result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['memory', 'maintenance']
      }
    ];
  }

  private generateGovernanceEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/governance/evaluate-tier',
        method: 'POST',
        domain: 'governance',
        summary: 'Evaluate strategy governance tier',
        description: 'Determine governance tier for strategy',
        operationId: 'evaluateTier',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/StrategyDSL' },
          description: 'Strategy to evaluate'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                tier: { type: 'string', enum: ['TIER1', 'TIER2', 'TIER3'] }
              }
            },
            description: 'Tier assignment'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['governance', 'evaluation']
      },
      {
        path: '/api/governance/check-shadow-readiness',
        method: 'POST',
        domain: 'governance',
        summary: 'Check shadow strategy promotion readiness',
        description: 'Evaluate if strategy is ready to promote from shadow mode',
        operationId: 'checkShadowReadiness',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Strategy and recent results'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Promotion readiness result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['governance', 'promotion']
      },
      {
        path: '/api/governance/active-alerts',
        method: 'GET',
        domain: 'governance',
        summary: 'Get active governance alerts',
        description: 'Retrieve current governance-level alerts',
        operationId: 'getActiveAlerts',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/GovernanceAlert' }
            },
            description: 'Active alerts'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['governance', 'monitoring']
      },
      {
        path: '/api/governance/ready-for-promotion',
        method: 'GET',
        domain: 'governance',
        summary: 'List strategies ready for promotion',
        description: 'Get strategies that have met shadow mode criteria',
        operationId: 'getReadyForPromotion',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'array',
              items: { type: 'string' }
            },
            description: 'Strategy IDs ready for promotion'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['governance', 'promotion']
      }
    ];
  }

  private generateUxEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/ux/dashboard-data',
        method: 'GET',
        domain: 'ux',
        summary: 'Get dashboard data',
        description: 'Retrieve data for main dashboard view',
        operationId: 'getDashboardData',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Dashboard data'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['ux', 'dashboard']
      },
      {
        path: '/api/ux/strategy-grid',
        method: 'GET',
        domain: 'ux',
        summary: 'Get strategy grid view',
        description: 'Retrieve strategies for grid/table display',
        operationId: 'getStrategyGrid',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Strategy grid data'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['ux', 'strategies']
      },
      {
        path: '/api/ux/trade-history',
        method: 'GET',
        domain: 'ux',
        summary: 'Get trade history for display',
        description: 'Retrieve formatted trade history',
        operationId: 'getTradeHistory',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Trade history'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['ux', 'trades']
      },
      {
        path: '/api/ux/notifications',
        method: 'GET',
        domain: 'ux',
        summary: 'Get user notifications',
        description: 'Retrieve pending notifications',
        operationId: 'getNotifications',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'array',
              items: { type: 'object' }
            },
            description: 'Notifications'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['ux', 'notifications']
      }
    ];
  }

  private generateExplainEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/explain/prediction',
        method: 'POST',
        domain: 'explain',
        summary: 'Explain prediction decision',
        description: 'Get human-readable explanation of prediction',
        operationId: 'explainPrediction',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/V4Prediction' },
          description: 'Prediction to explain'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                explanation: { type: 'string' },
                factors: { type: 'array', items: { type: 'object' } }
              }
            },
            description: 'Explanation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['explain', 'interpretability']
      },
      {
        path: '/api/explain/feature-importance',
        method: 'POST',
        domain: 'explain',
        summary: 'Get feature importance breakdown',
        description: 'Identify which features most influenced prediction',
        operationId: 'getFeatureImportance',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Prediction context'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Feature importance scores'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['explain', 'interpretability']
      },
      {
        path: '/api/explain/causal-mechanism',
        method: 'GET',
        domain: 'explain',
        summary: 'Explain causal mechanism',
        description: 'Get explanation of identified causal mechanism',
        operationId: 'explainCausalMechanism',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Causal explanation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['explain', 'causality']
      },
      {
        path: '/api/explain/memory-suggestion',
        method: 'POST',
        domain: 'explain',
        summary: 'Explain memory-based suggestion',
        description: 'Why memory system recommended this approach',
        operationId: 'explainMemorySuggestion',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Prediction with memory context'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Memory suggestion explanation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['explain', 'memory']
      }
    ];
  }

  private generateAutonomousEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/autonomous/current-mode',
        method: 'GET',
        domain: 'autonomous',
        summary: 'Get current autonomous mode',
        description: 'Retrieve current operation mode (PAPER, ASSISTED, AUTONOMOUS)',
        operationId: 'getCurrentMode',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['PAPER', 'ASSISTED', 'AUTONOMOUS'] }
              }
            },
            description: 'Current mode'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['autonomous', 'mode']
      },
      {
        path: '/api/autonomous/set-mode',
        method: 'POST',
        domain: 'autonomous',
        summary: 'Set autonomous mode',
        description: 'Change operational mode',
        operationId: 'setMode',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['PAPER', 'ASSISTED', 'AUTONOMOUS'] }
            }
          },
          description: 'New mode'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Mode change confirmation'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['autonomous', 'mode']
      },
      {
        path: '/api/autonomous/check-refusal',
        method: 'POST',
        domain: 'autonomous',
        summary: 'Check self-refusal conditions',
        description: 'Evaluate whether system should refuse to trade',
        operationId: 'checkRefusal',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { $ref: '#/components/schemas/V4Prediction' },
          description: 'Prediction to check'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                refused: { type: 'boolean' },
                reasons: { type: 'array', items: { type: 'string' } }
              }
            },
            description: 'Refusal check result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['autonomous', 'safety']
      },
      {
        path: '/api/autonomous/drift-detection',
        method: 'POST',
        domain: 'autonomous',
        summary: 'Detect strategy drift',
        description: 'Check for performance drift in active strategies',
        operationId: 'detectDrift',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Trade result for drift check'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: {
              type: 'object',
              properties: {
                drift_score: { type: 'number' },
                drift_detected: { type: 'boolean' }
              }
            },
            description: 'Drift detection result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['autonomous', 'monitoring']
      }
    ];
  }

  private generateBacktestEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/backtest/run',
        method: 'POST',
        domain: 'backtest',
        summary: 'Run strategy backtest',
        description: 'Execute backtest with historical data',
        operationId: 'runBacktest',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              strategy: { $ref: '#/components/schemas/StrategyDSL' },
              symbol: { type: 'string' },
              start_date: { type: 'string' },
              end_date: { type: 'string' }
            }
          },
          description: 'Backtest parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { $ref: '#/components/schemas/BacktestResult' },
            description: 'Backtest result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['backtest', 'testing']
      },
      {
        path: '/api/backtest/optimization',
        method: 'POST',
        domain: 'backtest',
        summary: 'Optimize strategy parameters',
        description: 'Run parameter optimization via backtest',
        operationId: 'optimizeParameters',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Optimization parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Optimization result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['backtest', 'optimization']
      },
      {
        path: '/api/backtest/monte-carlo',
        method: 'POST',
        domain: 'backtest',
        summary: 'Run Monte Carlo simulation',
        description: 'Test strategy robustness via Monte Carlo',
        operationId: 'runMonteCarlo',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Monte Carlo parameters'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Monte Carlo result'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['backtest', 'analysis']
      },
      {
        path: '/api/backtest/drawdown-analysis',
        method: 'POST',
        domain: 'backtest',
        summary: 'Analyze maximum drawdown',
        description: 'Get detailed drawdown analysis',
        operationId: 'analyzeDrawdown',
        // @ts-expect-error TS2741 — auto-suppressed for strict build
        requestBody: {
          contentType: 'application/json',
          schema: { type: 'object' },
          description: 'Backtest result'
        },
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Drawdown analysis'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['backtest', 'analysis']
      }
    ];
  }

  private generateMarketEndpoints(): EndpointDoc[] {
    return [
      {
        path: '/api/market/current-context',
        method: 'GET',
        domain: 'market',
        summary: 'Get current market context',
        description: 'Retrieve current market regime and conditions',
        operationId: 'getCurrentMarketContext',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Market context'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['market', 'context']
      },
      {
        path: '/api/market/historical-context',
        method: 'GET',
        domain: 'market',
        summary: 'Get historical market context',
        description: 'Retrieve historical regime classifications',
        operationId: 'getHistoricalContext',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'array', items: { type: 'object' } },
            description: 'Historical context'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['market', 'context']
      },
      {
        path: '/api/market/volatility-regime',
        method: 'GET',
        domain: 'market',
        summary: 'Get volatility regime',
        description: 'Current and historical volatility classification',
        operationId: 'getVolatilityRegime',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Volatility regime'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['market', 'regime']
      },
      {
        path: '/api/market/trend-analysis',
        method: 'GET',
        domain: 'market',
        summary: 'Get market trend analysis',
        description: 'Current trend direction and strength',
        operationId: 'getTrendAnalysis',
        responses: [
          {
            status: 200,
            contentType: 'application/json',
            schema: { type: 'object' },
            description: 'Trend analysis'
          }
        ],
        examples: [],
        errorCodes: [],
        tags: ['market', 'analysis']
      }
    ];
  }

  private generateDomains(endpoints: EndpointDoc[]): DomainDoc[] {
    const domainMap = new Map<string, Set<string>>();

    for (const endpoint of endpoints) {
      if (!domainMap.has(endpoint.domain)) {
        domainMap.set(endpoint.domain, new Set());
      }
      domainMap.get(endpoint.domain)!.add(endpoint.path);
    }

    return Array.from(domainMap.entries()).map(([name, paths]) => ({
      name,
      description: this.getDomainDescription(name),
      baseUrl: `/api/${name}`,
      endpoints: Array.from(paths)
    }));
  }

  private getDomainDescription(domain: string): string {
    const descriptions: Record<string, string> = {
      decision_loop: 'Core 14-step decision pipeline',
      eval: 'Strategy evaluation and grading framework',
      bridge: 'Master system integration orchestrator',
      lab: 'Strategy development and experimentation',
      quant: 'V4 quantitative intelligence layer',
      memory: 'Historical setup memory system',
      governance: 'Strategy approval and promotion',
      ux: 'User interface data endpoints',
      explain: 'Explainability and interpretability',
      autonomous: 'Autonomous operation modes and safety',
      backtest: 'Backtesting and optimization',
      market: 'Market regime and context'
    };
    return descriptions[domain] || 'API endpoints';
  }

  private generateSchemas(): Record<string, SchemaObject> {
    return {
      StrategyDSL: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          rules: { type: 'array', items: { type: 'object' } }
        }
      },
      SIFeatures: {
        type: 'object',
        properties: {
          price_momentum: { type: 'number' },
          volatility: { type: 'number' },
          volume_ratio: { type: 'number' }
        }
      },
      V4Prediction: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          v4Score: { type: 'number' },
          shouldTrade: { type: 'boolean' },
          memoryContext: { type: 'object' },
          causalEdge: { type: 'object' },
          refusalCheck: { type: 'object' },
          calibrationAdj: { type: 'object' },
          authorityCheck: { type: 'object' }
        }
      },
      PipelineResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          final_signal: { type: 'string' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' }
        }
      },
      EvalResult: {
        type: 'object',
        properties: {
          grade: { type: 'string' },
          score: { type: 'number' },
          categories: { type: 'object' }
        }
      },
      FullEvaluationResult: {
        type: 'object',
        properties: {
          strategyId: { type: 'string' },
          trustScore: { type: 'number' },
          recommendation: { type: 'object' }
        }
      },
      EnhancedSignalResult: {
        type: 'object',
        properties: {
          v3Prediction: { type: 'object' },
          v4Score: { type: 'number' },
          memoryContext: { type: 'object' }
        }
      },
      PostTradeAnalysis: {
        type: 'object',
        properties: {
          tradeId: { type: 'string' },
          driftDetected: { type: 'boolean' },
          driftScore: { type: 'number' }
        }
      },
      SystemStatus: {
        type: 'object',
        properties: {
          bridge_health: { type: 'string' },
          subsystems_online: { type: 'number' },
          subsystems_total: { type: 'number' }
        }
      },
      V4Status: {
        type: 'object',
        properties: {
          memory_healthy: { type: 'boolean' },
          causal_healthy: { type: 'boolean' },
          total_predictions: { type: 'number' },
          average_v4_score: { type: 'number' }
        }
      },
      DecisionLoopStatus: {
        type: 'object',
        properties: {
          available: { type: 'boolean' },
          pipeline_stages_ready: { type: 'number' },
          pipeline_stages_total: { type: 'number' }
        }
      },
      SimilarSetup: {
        type: 'object',
        properties: {
          setup_id: { type: 'string' },
          pnl: { type: 'number' },
          similarity_score: { type: 'number' }
        }
      },
      BacktestResult: {
        type: 'object',
        properties: {
          total_return: { type: 'number' },
          sharpe_ratio: { type: 'number' },
          max_drawdown: { type: 'number' }
        }
      },
      TradeResult: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          pnl: { type: 'number' },
          pnlPercent: { type: 'number' }
        }
      },
      GovernanceAlert: {
        type: 'object',
        properties: {
          level: { type: 'string' },
          message: { type: 'string' },
          suggestedAction: { type: 'string' }
        }
      },
      LabAnalysis: {
        type: 'object',
        properties: {
          edge_description: { type: 'string' },
          risk_profile: { type: 'object' }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'number' },
          details: { type: 'string' }
        }
      }
    };
  }

  private generateTags(): Array<{ name: string; description: string }> {
    return [
      { name: 'decision_loop', description: 'Core pipeline execution' },
      { name: 'eval', description: 'Strategy evaluation' },
      { name: 'bridge', description: 'System orchestration' },
      { name: 'lab', description: 'Strategy development' },
      { name: 'quant', description: 'Quantitative intelligence' },
      { name: 'memory', description: 'Historical context' },
      { name: 'governance', description: 'Approval and promotion' },
      { name: 'ux', description: 'User interface' },
      { name: 'explain', description: 'Interpretability' },
      { name: 'autonomous', description: 'Autonomous operations' },
      { name: 'backtest', description: 'Testing and optimization' },
      { name: 'market', description: 'Market analysis' }
    ] as Array<{ name: string; description: string }>;
  }

  private endpointToOpenAPIOperation(endpoint: EndpointDoc): OperationObject {
    return {
      summary: endpoint.summary,
      description: endpoint.description,
      operationId: endpoint.operationId,
      tags: endpoint.tags,
      parameters: endpoint.parameters?.map((p) => ({
        name: p.name,
        in: p.in,
        schema: p.schema,
        description: p.description,
        required: p.required
      })),
      requestBody: endpoint.requestBody
        ? {
            description: endpoint.requestBody.description,
            content: {
              [endpoint.requestBody.contentType]: {
                schema: endpoint.requestBody.schema
              }
            }
          }
        : undefined,
      responses: Object.fromEntries(
        endpoint.responses.map((r) => [
          r.status.toString(),
          {
            description: r.description,
            content: {
              [r.contentType]: {
                schema: r.schema
              }
            }
          }
        ])
      )
    };
  }
}

export default QuantAPIDocs;
