/**
 * CodeHealthAnalyzer - Phase 108 Truth Phase System Integrity Audit
 *
 * GodsView Quant Trading Platform
 * Performs dead-code detection, config auditing for paper/live modes,
 * and test taxonomy analysis to ensure system integrity across the platform.
 *
 * Features:
 * - Dead code detection (unused exports, unreachable branches, deprecated APIs)
 * - Config audit for paper/live mode separation
 * - Test taxonomy analysis with coverage tracking
 * - Composite health scoring
 * - Event-driven architecture for monitoring
 */

import { EventEmitter } from 'events';

/**
 * Dead code entry representing a detected code quality issue
 */
interface DeadCodeEntry {
  id: string;
  filePath: string;
  type: 'unused_export' | 'unreachable_branch' | 'commented_out' | 'deprecated_api' | 'orphan_file' | 'unused_import';
  severity: 'critical' | 'warning' | 'info';
  description: string;
  lineRange: [number, number];
  detectedAt: number;
  suggestion: string;
}

/**
 * Config audit entry for paper/live mode separation validation
 */
interface ConfigAuditEntry {
  id: string;
  configKey: string;
  paperValue: string;
  liveValue: string;
  currentValue: string;
  isConsistent: boolean;
  riskLevel: 'safe' | 'caution' | 'dangerous';
  category: 'execution' | 'risk' | 'data' | 'api_keys' | 'sizing' | 'timing';
  description: string;
}

/**
 * Test entry for tracking test coverage across test types
 */
interface TestEntry {
  id: string;
  testFile: string;
  testType: 'unit' | 'integration' | 'replay' | 'paper' | 'chaos' | 'soak' | 'e2e';
  targetModule: string;
  status: 'passing' | 'failing' | 'skipped' | 'missing';
  lastRun: number;
  coverage: number; // 0-100
  description: string;
}

/**
 * Health report combining all analysis results
 */
interface HealthReport {
  timestamp: number;
  deadCodeScore: number;
  configScore: number;
  testScore: number;
  overallScore: number;
  deadCodeCount: { critical: number; warning: number; info: number };
  configRisks: { dangerous: number; caution: number; safe: number };
  testCoverage: { [key in 'unit' | 'integration' | 'replay' | 'paper' | 'chaos' | 'soak' | 'e2e']: number };
  modeConsistency: number;
  recommendations: string[];
}

/**
 * CodeHealthAnalyzer: Main class for system integrity auditing
 */
export class CodeHealthAnalyzer extends EventEmitter {
  private deadCodeEntries: Map<string, DeadCodeEntry> = new Map();
  private configAuditEntries: Map<string, ConfigAuditEntry> = new Map();
  private testEntries: Map<string, TestEntry> = new Map();
  private lastScanTimestamp: number = 0;
  private baseHealthScore: number = 100;

  constructor() {
    super();
    this.initializeMockData();
  }

  /**
   * Initialize with production-quality mock data representing typical system state
   */
  private initializeMockData(): void {
    this.initializeDeadCodeData();
    this.initializeConfigAuditData();
    this.initializeTestData();
  }

  /**
   * Initialize ~25 dead code entries showing typical issues across codebase
   */
  private initializeDeadCodeData(): void {
    const deadCodeData: DeadCodeEntry[] = [
      {
        id: 'dc_001',
        filePath: 'src/core/execution/strategy_executor.ts',
        type: 'unused_export',
        severity: 'warning',
        description: 'LegacyStrategyExecutor export not used anywhere in codebase',
        lineRange: [42, 148],
        detectedAt: Date.now() - 2592000000, // 30 days ago
        suggestion: 'Remove legacy executor or integrate into new executor pattern'
      },
      {
        id: 'dc_002',
        filePath: 'src/core/risk/position_validator.ts',
        type: 'commented_out',
        severity: 'info',
        description: 'Experimental position limits validation code commented out (~50 lines)',
        lineRange: [89, 140],
        detectedAt: Date.now() - 1209600000, // 14 days ago
        suggestion: 'Either implement or remove; document rationale for disabling'
      },
      {
        id: 'dc_003',
        filePath: 'src/connectors/broker/api_handler.ts',
        type: 'deprecated_api',
        severity: 'critical',
        description: 'Legacy APIv1 endpoints still registered but deprecated since Phase 105',
        lineRange: [201, 215],
        detectedAt: Date.now() - 604800000, // 7 days ago
        suggestion: 'Migrate all callers to APIv2, then remove deprecated handlers'
      },
      {
        id: 'dc_004',
        filePath: 'src/data/feed_manager.ts',
        type: 'unused_import',
        severity: 'info',
        description: 'Unused import: WebsocketReconnectUtil not referenced in module',
        lineRange: [5, 5],
        detectedAt: Date.now() - 86400000, // 1 day ago
        suggestion: 'Remove unused import to reduce bundle size'
      },
      {
        id: 'dc_005',
        filePath: 'src/core/brain/decision_engine.ts',
        type: 'unreachable_branch',
        severity: 'warning',
        description: 'Condition always true; dead branch code never executes',
        lineRange: [267, 289],
        detectedAt: Date.now() - 172800000, // 2 days ago
        suggestion: 'Simplify control flow; verify intent of condition'
      },
      {
        id: 'dc_006',
        filePath: 'src/utils/backtester.ts',
        type: 'unused_export',
        severity: 'info',
        description: 'HistoricalDataSimulator not exported; replace with DataReplayEngine',
        lineRange: [156, 234],
        detectedAt: Date.now() - 1296000000, // 15 days ago
        suggestion: 'Migrate references, then remove function'
      },
      {
        id: 'dc_007',
        filePath: 'src/connectors/exchanges/legacy_exchange_adapter.ts',
        type: 'orphan_file',
        severity: 'critical',
        description: 'Orphaned module; no imports from current codebase',
        lineRange: [1, 450],
        detectedAt: Date.now() - 2419200000, // 28 days ago
        suggestion: 'Archive or delete entirely; no active references'
      },
      {
        id: 'dc_008',
        filePath: 'src/core/risk/margin_calculator.ts',
        type: 'unused_import',
        severity: 'info',
        description: 'Unused: NumericUtils.precisionRound not used in current implementation',
        lineRange: [3, 3],
        detectedAt: Date.now() - 259200000, // 3 days ago
        suggestion: 'Remove import; use native Math operations'
      },
      {
        id: 'dc_009',
        filePath: 'src/state/snapshot_manager.ts',
        type: 'commented_out',
        severity: 'warning',
        description: 'Debugging code block commented out; hard to maintain',
        lineRange: [112, 130],
        detectedAt: Date.now() - 432000000, // 5 days ago
        suggestion: 'Remove debug code or make it conditional via env flag'
      },
      {
        id: 'dc_010',
        filePath: 'src/core/execution/order_router.ts',
        type: 'deprecated_api',
        severity: 'warning',
        description: 'DirectOrderSubmit pattern deprecated; use new RouteOptimizer',
        lineRange: [73, 95],
        detectedAt: Date.now() - 518400000, // 6 days ago
        suggestion: 'Refactor to use RouteOptimizer; deprecate old pattern'
      },
      {
        id: 'dc_011',
        filePath: 'src/monitoring/metrics_collector.ts',
        type: 'unused_export',
        severity: 'info',
        description: 'LegacyMetricsFormat export; replaced by PrometheusFormat',
        lineRange: [285, 310],
        detectedAt: Date.now() - 345600000, // 4 days ago
        suggestion: 'Update all collectors to use PrometheusFormat; remove legacy'
      },
      {
        id: 'dc_012',
        filePath: 'src/core/brain/neural_network.ts',
        type: 'unreachable_branch',
        severity: 'info',
        description: 'Fallback activation function never reached due to prior return',
        lineRange: [178, 185],
        detectedAt: Date.now() - 777600000, // 9 days ago
        suggestion: 'Simplify conditional; verify intended behavior'
      },
      {
        id: 'dc_013',
        filePath: 'src/utils/logger.ts',
        type: 'unused_import',
        severity: 'info',
        description: 'Unused: Winston colors module imported but not used',
        lineRange: [2, 2],
        detectedAt: Date.now() - 86400000, // 1 day ago
        suggestion: 'Remove unused import'
      },
      {
        id: 'dc_014',
        filePath: 'src/data/cache_layer.ts',
        type: 'commented_out',
        severity: 'info',
        description: 'Old cache invalidation strategy commented out; current strategy in use',
        lineRange: [67, 85],
        detectedAt: Date.now() - 1382400000, // 16 days ago
        suggestion: 'Document why old strategy is disabled or remove it'
      },
      {
        id: 'dc_015',
        filePath: 'src/connectors/broker/position_sync.ts',
        type: 'deprecated_api',
        severity: 'critical',
        description: 'ManualPositionReconciliation deprecated; use auto-sync framework',
        lineRange: [140, 205],
        detectedAt: Date.now() - 345600000, // 4 days ago
        suggestion: 'Migrate to auto-sync; remove manual reconciliation'
      },
      {
        id: 'dc_016',
        filePath: 'src/core/accounting/pnl_calculator.ts',
        type: 'unused_export',
        severity: 'warning',
        description: 'OldPnLMethod not referenced; replaced by MarkToMarketEngine',
        lineRange: [98, 156],
        detectedAt: Date.now() - 604800000, // 7 days ago
        suggestion: 'Verify all callers use new engine; then remove'
      },
      {
        id: 'dc_017',
        filePath: 'src/utils/validators.ts',
        type: 'unused_import',
        severity: 'info',
        description: 'Unused validator utility; all validation in schema layer',
        lineRange: [1, 1],
        detectedAt: Date.now() - 172800000, // 2 days ago
        suggestion: 'Remove or consolidate validation logic'
      },
      {
        id: 'dc_018',
        filePath: 'src/monitoring/alerting.ts',
        type: 'commented_out',
        severity: 'warning',
        description: 'Legacy email alert formatter commented out; using Slack only',
        lineRange: [201, 240],
        detectedAt: Date.now() - 259200000, // 3 days ago
        suggestion: 'Remove legacy formatter or document intent to re-enable'
      },
      {
        id: 'dc_019',
        filePath: 'src/core/execution/slippage_model.ts',
        type: 'deprecated_api',
        severity: 'warning',
        description: 'BasicSlippageModel deprecated; use ML-based AdaptiveSlippageModel',
        lineRange: [45, 78],
        detectedAt: Date.now() - 432000000, // 5 days ago
        suggestion: 'Migrate to adaptive model; remove basic implementation'
      },
      {
        id: 'dc_020',
        filePath: 'src/state/event_store.ts',
        type: 'unused_export',
        severity: 'info',
        description: 'InMemoryEventStore not used; all code uses PersistentEventStore',
        lineRange: [112, 201],
        detectedAt: Date.now() - 518400000, // 6 days ago
        suggestion: 'Archive or remove; persistent store is production requirement'
      },
      {
        id: 'dc_021',
        filePath: 'src/core/risk/exposure_calculator.ts',
        type: 'unreachable_branch',
        severity: 'info',
        description: 'Defensive check after guard clause; never reaches',
        lineRange: [89, 95],
        detectedAt: Date.now() - 345600000, // 4 days ago
        suggestion: 'Remove redundant check'
      },
      {
        id: 'dc_022',
        filePath: 'src/connectors/data/historical_fetcher.ts',
        type: 'commented_out',
        severity: 'info',
        description: 'Retry logic commented out; using exponential backoff instead',
        lineRange: [134, 160],
        detectedAt: Date.now() - 691200000, // 8 days ago
        suggestion: 'Remove commented code; document backoff strategy'
      },
      {
        id: 'dc_023',
        filePath: 'src/core/brain/model_loader.ts',
        type: 'unused_import',
        severity: 'info',
        description: 'Unused: LegacyModelFormat; all models use binary format now',
        lineRange: [4, 4],
        detectedAt: Date.now() - 86400000, // 1 day ago
        suggestion: 'Remove unused import'
      },
      {
        id: 'dc_024',
        filePath: 'src/utils/string_utils.ts',
        type: 'unused_export',
        severity: 'info',
        description: 'LegacyStringFormatter not used anywhere',
        lineRange: [54, 89],
        detectedAt: Date.now() - 1468800000, // 17 days ago
        suggestion: 'Remove unused formatter function'
      },
      {
        id: 'dc_025',
        filePath: 'src/core/execution/venue_selector.ts',
        type: 'deprecated_api',
        severity: 'warning',
        description: 'ManualVenueSelection deprecated; use automated OptimalVenueRouter',
        lineRange: [67, 120],
        detectedAt: Date.now() - 172800000, // 2 days ago
        suggestion: 'Migrate all manual selections to router; then remove'
      }
    ];

    deadCodeData.forEach(entry => {
      this.deadCodeEntries.set(entry.id, entry);
    });
  }

  /**
   * Initialize ~20 config audit entries checking paper/live separation
   */
  private initializeConfigAuditData(): void {
    const configAuditData: ConfigAuditEntry[] = [
      {
        id: 'ca_001',
        configKey: 'BROKER_MODE',
        paperValue: 'paper',
        liveValue: 'live',
        currentValue: 'paper',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'execution',
        description: 'Broker mode correctly set to paper for testing environment'
      },
      {
        id: 'ca_002',
        configKey: 'MAX_POSITION_SIZE',
        paperValue: '1000000',
        liveValue: '500000',
        currentValue: '1000000',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'sizing',
        description: 'Position size limit appropriately set for paper trading'
      },
      {
        id: 'ca_003',
        configKey: 'ORDER_TIMEOUT_MS',
        paperValue: '10000',
        liveValue: '5000',
        currentValue: '10000',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'timing',
        description: 'Order timeout correctly lenient for paper environment'
      },
      {
        id: 'ca_004',
        configKey: 'API_KEY_BROKER',
        paperValue: 'paper_test_key_xxxx',
        liveValue: '***REDACTED***',
        currentValue: 'paper_test_key_xxxx',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'api_keys',
        description: 'Broker API key correctly isolated for paper trading'
      },
      {
        id: 'ca_005',
        configKey: 'API_KEY_DATA',
        paperValue: 'paper_data_key_xxxx',
        liveValue: '***REDACTED***',
        currentValue: 'paper_data_key_xxxx',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'api_keys',
        description: 'Data API key correctly isolated for paper environment'
      },
      {
        id: 'ca_006',
        configKey: 'SLIPPAGE_MODEL',
        paperValue: 'fixed_0.1%',
        liveValue: 'adaptive_ml',
        currentValue: 'fixed_0.1%',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'data',
        description: 'Paper trading using fixed slippage; live uses adaptive model'
      },
      {
        id: 'ca_007',
        configKey: 'RISK_MULTIPLIER',
        paperValue: '1.0',
        liveValue: '0.8',
        currentValue: '1.0',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'risk',
        description: 'Risk multiplier correctly set for paper (no real constraints)'
      },
      {
        id: 'ca_008',
        configKey: 'DB_WRITE_MODE',
        paperValue: 'in_memory',
        liveValue: 'persistent',
        currentValue: 'in_memory',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'data',
        description: 'Paper trading correctly uses in-memory DB'
      },
      {
        id: 'ca_009',
        configKey: 'ALERT_CHANNELS',
        paperValue: 'logger_only',
        liveValue: 'slack,email,pagerduty',
        currentValue: 'logger_only',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'execution',
        description: 'Paper alerts limited to logs; live uses full channels'
      },
      {
        id: 'ca_010',
        configKey: 'LOG_LEVEL',
        paperValue: 'debug',
        liveValue: 'info',
        currentValue: 'debug',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'data',
        description: 'Paper environment has verbose logging enabled'
      },
      {
        id: 'ca_011',
        configKey: 'EXECUTION_MODE',
        paperValue: 'backtest',
        liveValue: 'realtime',
        currentValue: 'backtest',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'execution',
        description: 'Execution mode correctly set to backtest for paper'
      },
      {
        id: 'ca_012',
        configKey: 'MAX_LEVERAGE',
        paperValue: '5.0',
        liveValue: '2.0',
        currentValue: '2.0',
        isConsistent: false,
        riskLevel: 'caution',
        category: 'risk',
        description: 'WARNING: Max leverage set to live value (2.0) in paper environment'
      },
      {
        id: 'ca_013',
        configKey: 'POSITION_HEDGE_RATIO',
        paperValue: '0.0',
        liveValue: '0.3',
        currentValue: '0.0',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'risk',
        description: 'Paper trading no hedging requirement'
      },
      {
        id: 'ca_014',
        configKey: 'EMERGENCY_SHUTDOWN_ENABLED',
        paperValue: 'false',
        liveValue: 'true',
        currentValue: 'true',
        isConsistent: false,
        riskLevel: 'dangerous',
        category: 'execution',
        description: 'DANGER: Emergency shutdown enabled in paper (should be disabled for testing)'
      },
      {
        id: 'ca_015',
        configKey: 'MARKET_DATA_CACHE_TTL_MS',
        paperValue: '1000',
        liveValue: '100',
        currentValue: '1000',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'timing',
        description: 'Paper trading uses longer cache TTL for stability'
      },
      {
        id: 'ca_016',
        configKey: 'FILL_CERTAINTY_THRESHOLD',
        paperValue: '0.5',
        liveValue: '0.95',
        currentValue: '0.95',
        isConsistent: false,
        riskLevel: 'dangerous',
        category: 'risk',
        description: 'DANGER: Fill certainty threshold set to live level (0.95) in paper'
      },
      {
        id: 'ca_017',
        configKey: 'MARGIN_REQUIREMENT_PCT',
        paperValue: '0',
        liveValue: '5',
        currentValue: '0',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'sizing',
        description: 'Paper trading has no margin requirement'
      },
      {
        id: 'ca_018',
        configKey: 'TRADE_DECISION_TIMEOUT_MS',
        paperValue: '30000',
        liveValue: '5000',
        currentValue: '30000',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'timing',
        description: 'Paper trading allows longer decision window'
      },
      {
        id: 'ca_019',
        configKey: 'DATA_VALIDATION_STRICT',
        paperValue: 'false',
        liveValue: 'true',
        currentValue: 'false',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'data',
        description: 'Paper trading uses lenient data validation'
      },
      {
        id: 'ca_020',
        configKey: 'CIRCUIT_BREAKER_ENABLED',
        paperValue: 'false',
        liveValue: 'true',
        currentValue: 'false',
        isConsistent: true,
        riskLevel: 'safe',
        category: 'execution',
        description: 'Circuit breaker disabled for paper testing'
      }
    ];

    configAuditData.forEach(entry => {
      this.configAuditEntries.set(entry.id, entry);
    });
  }

  /**
   * Initialize ~30 test entries covering test taxonomy
   */
  private initializeTestData(): void {
    const testData: TestEntry[] = [
      // Unit tests
      {
        id: 'test_001',
        testFile: 'src/core/brain/decision_engine.test.ts',
        testType: 'unit',
        targetModule: 'decision_engine',
        status: 'passing',
        lastRun: Date.now() - 3600000,
        coverage: 87,
        description: 'Unit tests for decision engine core logic'
      },
      {
        id: 'test_002',
        testFile: 'src/core/risk/position_validator.test.ts',
        testType: 'unit',
        targetModule: 'position_validator',
        status: 'passing',
        lastRun: Date.now() - 7200000,
        coverage: 92,
        description: 'Unit tests for position validation rules'
      },
      {
        id: 'test_003',
        testFile: 'src/core/accounting/pnl_calculator.test.ts',
        testType: 'unit',
        targetModule: 'pnl_calculator',
        status: 'passing',
        lastRun: Date.now() - 3600000,
        coverage: 88,
        description: 'Unit tests for P&L calculation logic'
      },
      {
        id: 'test_004',
        testFile: 'src/core/execution/order_router.test.ts',
        testType: 'unit',
        targetModule: 'order_router',
        status: 'passing',
        lastRun: Date.now() - 5400000,
        coverage: 85,
        description: 'Unit tests for order routing algorithms'
      },
      {
        id: 'test_005',
        testFile: 'src/data/feed_manager.test.ts',
        testType: 'unit',
        targetModule: 'feed_manager',
        status: 'passing',
        lastRun: Date.now() - 3600000,
        coverage: 79,
        description: 'Unit tests for market data feed management'
      },
      {
        id: 'test_006',
        testFile: 'src/core/risk/exposure_calculator.test.ts',
        testType: 'unit',
        targetModule: 'exposure_calculator',
        status: 'passing',
        lastRun: Date.now() - 7200000,
        coverage: 91,
        description: 'Unit tests for risk exposure calculation'
      },
      // Integration tests
      {
        id: 'test_007',
        testFile: 'tests/integration/execution_pipeline.test.ts',
        testType: 'integration',
        targetModule: 'execution_pipeline',
        status: 'passing',
        lastRun: Date.now() - 86400000,
        coverage: 72,
        description: 'Integration test for end-to-end execution flow'
      },
      {
        id: 'test_008',
        testFile: 'tests/integration/data_flow.test.ts',
        testType: 'integration',
        targetModule: 'data_pipeline',
        status: 'passing',
        lastRun: Date.now() - 86400000,
        coverage: 68,
        description: 'Integration test for market data ingestion pipeline'
      },
      {
        id: 'test_009',
        testFile: 'tests/integration/broker_connector.test.ts',
        testType: 'integration',
        targetModule: 'broker_connector',
        status: 'passing',
        lastRun: Date.now() - 172800000,
        coverage: 65,
        description: 'Integration test for broker API connectivity'
      },
      {
        id: 'test_010',
        testFile: 'tests/integration/state_management.test.ts',
        testType: 'integration',
        targetModule: 'state_manager',
        status: 'failing',
        lastRun: Date.now() - 86400000,
        coverage: 45,
        description: 'Integration test for state consistency; failing due to race condition'
      },
      // Replay tests
      {
        id: 'test_011',
        testFile: 'tests/replay/decision_reconstruction.test.ts',
        testType: 'replay',
        targetModule: 'decision_engine',
        status: 'passing',
        lastRun: Date.now() - 259200000,
        coverage: 73,
        description: 'Replay test for reconstructing historical decisions'
      },
      {
        id: 'test_012',
        testFile: 'tests/replay/execution_reconstruction.test.ts',
        testType: 'replay',
        targetModule: 'execution_engine',
        status: 'passing',
        lastRun: Date.now() - 259200000,
        coverage: 69,
        description: 'Replay test for verifying execution faithfulness'
      },
      {
        id: 'test_013',
        testFile: 'tests/replay/market_replay.test.ts',
        testType: 'replay',
        targetModule: 'data_pipeline',
        status: 'passing',
        lastRun: Date.now() - 172800000,
        coverage: 71,
        description: 'Replay test for market condition reconstruction'
      },
      // Paper validation tests
      {
        id: 'test_014',
        testFile: 'tests/paper/execution_validation.test.ts',
        testType: 'paper',
        targetModule: 'execution_engine',
        status: 'passing',
        lastRun: Date.now() - 3600000,
        coverage: 84,
        description: 'Paper trading validation for execution logic'
      },
      {
        id: 'test_015',
        testFile: 'tests/paper/risk_validation.test.ts',
        testType: 'paper',
        targetModule: 'risk_engine',
        status: 'passing',
        lastRun: Date.now() - 3600000,
        coverage: 88,
        description: 'Paper trading validation for risk controls'
      },
      {
        id: 'test_016',
        testFile: 'tests/paper/pnl_validation.test.ts',
        testType: 'paper',
        targetModule: 'accounting_engine',
        status: 'passing',
        lastRun: Date.now() - 7200000,
        coverage: 90,
        description: 'Paper trading validation for P&L accuracy'
      },
      // Chaos tests
      {
        id: 'test_017',
        testFile: 'tests/chaos/broker_disconnect.test.ts',
        testType: 'chaos',
        targetModule: 'broker_connector',
        status: 'passing',
        lastRun: Date.now() - 432000000,
        coverage: 76,
        description: 'Chaos test for broker connection failure recovery'
      },
      {
        id: 'test_018',
        testFile: 'tests/chaos/stale_feed.test.ts',
        testType: 'chaos',
        targetModule: 'data_pipeline',
        status: 'passing',
        lastRun: Date.now() - 432000000,
        coverage: 72,
        description: 'Chaos test for handling stale market data'
      },
      {
        id: 'test_019',
        testFile: 'tests/chaos/latency_spike.test.ts',
        testType: 'chaos',
        targetModule: 'execution_engine',
        status: 'passing',
        lastRun: Date.now() - 345600000,
        coverage: 68,
        description: 'Chaos test for high-latency execution conditions'
      },
      {
        id: 'test_020',
        testFile: 'tests/chaos/data_corruption.test.ts',
        testType: 'chaos',
        targetModule: 'data_validation',
        status: 'failing',
        lastRun: Date.now() - 604800000,
        coverage: 55,
        description: 'Chaos test for corrupted market data handling; needs update'
      },
      // Soak tests
      {
        id: 'test_021',
        testFile: 'tests/soak/multi_day_stability.test.ts',
        testType: 'soak',
        targetModule: 'system_stability',
        status: 'passing',
        lastRun: Date.now() - 604800000,
        coverage: 61,
        description: 'Soak test for 7-day continuous operation stability'
      },
      {
        id: 'test_022',
        testFile: 'tests/soak/memory_leak_detection.test.ts',
        testType: 'soak',
        targetModule: 'memory_management',
        status: 'passing',
        lastRun: Date.now() - 864000000,
        coverage: 58,
        description: 'Soak test for memory leak detection over extended runtime'
      },
      {
        id: 'test_023',
        testFile: 'tests/soak/cache_stability.test.ts',
        testType: 'soak',
        targetModule: 'cache_layer',
        status: 'passing',
        lastRun: Date.now() - 864000000,
        coverage: 64,
        description: 'Soak test for cache coherency under sustained load'
      },
      // E2E tests
      {
        id: 'test_024',
        testFile: 'tests/e2e/strategy_lifecycle.test.ts',
        testType: 'e2e',
        targetModule: 'strategy_framework',
        status: 'passing',
        lastRun: Date.now() - 172800000,
        coverage: 75,
        description: 'E2E test for complete strategy initialization-execution-teardown cycle'
      },
      {
        id: 'test_025',
        testFile: 'tests/e2e/full_trading_day.test.ts',
        testType: 'e2e',
        targetModule: 'trading_engine',
        status: 'passing',
        lastRun: Date.now() - 259200000,
        coverage: 71,
        description: 'E2E test for simulated full trading day scenario'
      },
      // Missing tests
      {
        id: 'test_026',
        testFile: 'N/A',
        testType: 'unit',
        targetModule: 'slippage_model',
        status: 'missing',
        lastRun: 0,
        coverage: 0,
        description: 'MISSING: Unit tests for adaptive slippage model'
      },
      {
        id: 'test_027',
        testFile: 'N/A',
        testType: 'integration',
        targetModule: 'multi_venue_execution',
        status: 'missing',
        lastRun: 0,
        coverage: 0,
        description: 'MISSING: Integration tests for multi-venue order execution'
      },
      {
        id: 'test_028',
        testFile: 'N/A',
        testType: 'chaos',
        targetModule: 'neural_network',
        status: 'missing',
        lastRun: 0,
        coverage: 0,
        description: 'MISSING: Chaos tests for neural network model robustness'
      },
      {
        id: 'test_029',
        testFile: 'N/A',
        testType: 'soak',
        targetModule: 'event_store',
        status: 'missing',
        lastRun: 0,
        coverage: 0,
        description: 'MISSING: Soak tests for event store persistence under load'
      },
      {
        id: 'test_030',
        testFile: 'N/A',
        testType: 'e2e',
        targetModule: 'disaster_recovery',
        status: 'missing',
        lastRun: 0,
        coverage: 0,
        description: 'MISSING: E2E tests for disaster recovery procedures'
      }
    ];

    testData.forEach(entry => {
      this.testEntries.set(entry.id, entry);
    });
  }

  /**
   * Run dead code scan and emit events for findings
   */
  public runDeadCodeScan(): DeadCodeEntry[] {
    const results = Array.from(this.deadCodeEntries.values());
    results.forEach(entry => {
      this.emit('dead-code:found', entry);
    });
    return results;
  }

  /**
   * Run config audit for paper/live mode separation
   */
  public runConfigAudit(): ConfigAuditEntry[] {
    const results = Array.from(this.configAuditEntries.values());
    results.forEach(entry => {
      if (entry.riskLevel !== 'safe') {
        this.emit('config:risk', entry);
      }
    });
    return results;
  }

  /**
   * Run test taxonomy analysis
   */
  public runTestTaxonomy(): TestEntry[] {
    return Array.from(this.testEntries.values());
  }

  /**
   * Get dead code entries filtered by severity level
   */
  public getDeadCodeBySeverity(severity: 'critical' | 'warning' | 'info'): DeadCodeEntry[] {
    return Array.from(this.deadCodeEntries.values()).filter(entry => entry.severity === severity);
  }

  /**
   * Get only config entries with risk (dangerous or caution)
   */
  public getConfigRisks(): ConfigAuditEntry[] {
    return Array.from(this.configAuditEntries.values()).filter(
      entry => entry.riskLevel === 'dangerous' || entry.riskLevel === 'caution'
    );
  }

  /**
   * Get test entries with missing tests for each module/type combination
   */
  public getTestGaps(): TestEntry[] {
    return Array.from(this.testEntries.values()).filter(entry => entry.status === 'missing');
  }

  /**
   * Check alignment between paper and live configs
   * Returns percentage of consistent configs (0-100)
   */
  public getModeConsistency(): number {
    const entries = Array.from(this.configAuditEntries.values());
    if (entries.length === 0) return 100;

    const consistentCount = entries.filter(e => e.isConsistent).length;
    return Math.round((consistentCount / entries.length) * 100);
  }

  /**
   * Calculate composite health score (0-100)
   * Accounts for dead code, config risks, and test coverage
   */
  public getHealthScore(): number {
    let score = this.baseHealthScore;

    // Dead code penalties
    const deadCodeEntries = Array.from(this.deadCodeEntries.values());
    deadCodeEntries.forEach(entry => {
      if (entry.severity === 'critical') score -= 10;
      else if (entry.severity === 'warning') score -= 5;
      else if (entry.severity === 'info') score -= 2;
    });

    // Config risk penalties
    const configEntries = Array.from(this.configAuditEntries.values());
    configEntries.forEach(entry => {
      if (entry.riskLevel === 'dangerous') score -= 15;
      else if (entry.riskLevel === 'caution') score -= 5;
    });

    // Test coverage bonus
    const testEntries = Array.from(this.testEntries.values());
    const testTypes = new Set<string>();
    testEntries.forEach(entry => {
      if (entry.status === 'passing' || entry.status === 'failing') {
        testTypes.add(entry.testType);
      }
    });

    // 5 points per distinct test type present (max 35 for 7 types)
    score += Math.min(testTypes.size * 5, 35);

    // Clamp between 0 and 100
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate comprehensive health report
   */
  public getFullHealthReport(): HealthReport {
    const deadCodeEntries = Array.from(this.deadCodeEntries.values());
    const configEntries = Array.from(this.configAuditEntries.values());
    const testEntries = Array.from(this.testEntries.values());

    // Count dead code by severity
    const deadCodeCount = {
      critical: deadCodeEntries.filter(e => e.severity === 'critical').length,
      warning: deadCodeEntries.filter(e => e.severity === 'warning').length,
      info: deadCodeEntries.filter(e => e.severity === 'info').length
    };

    // Count config risks
    const configRisks = {
      dangerous: configEntries.filter(e => e.riskLevel === 'dangerous').length,
      caution: configEntries.filter(e => e.riskLevel === 'caution').length,
      safe: configEntries.filter(e => e.riskLevel === 'safe').length
    };

    // Count test coverage by type
    const testCoverage = {
      unit: testEntries.filter(e => e.testType === 'unit' && (e.status === 'passing' || e.status === 'failing')).length,
      integration: testEntries.filter(e => e.testType === 'integration' && (e.status === 'passing' || e.status === 'failing')).length,
      replay: testEntries.filter(e => e.testType === 'replay' && (e.status === 'passing' || e.status === 'failing')).length,
      paper: testEntries.filter(e => e.testType === 'paper' && (e.status === 'passing' || e.status === 'failing')).length,
      chaos: testEntries.filter(e => e.testType === 'chaos' && (e.status === 'passing' || e.status === 'failing')).length,
      soak: testEntries.filter(e => e.testType === 'soak' && (e.status === 'passing' || e.status === 'failing')).length,
      e2e: testEntries.filter(e => e.testType === 'e2e' && (e.status === 'passing' || e.status === 'failing')).length
    };

    // Calculate individual scores
    const deadCodeScore = Math.max(0, 100 - (deadCodeCount.critical * 10 + deadCodeCount.warning * 5 + deadCodeCount.info * 2));
    const configScore = Math.max(0, 100 - (configRisks.dangerous * 15 + configRisks.caution * 5));
    const testScore = Math.min(100, 50 + Object.values(testCoverage).reduce((a, b) => a + b, 0) * 3);

    // Generate recommendations
    const recommendations: string[] = [];
    if (deadCodeCount.critical > 0) {
      recommendations.push(`Address ${deadCodeCount.critical} critical dead code issues immediately`);
    }
    if (configRisks.dangerous > 0) {
      recommendations.push(`Fix ${configRisks.dangerous} dangerous config mismatches before next deployment`);
    }
    if (Object.values(testCoverage).some(v => v === 0)) {
      recommendations.push('Add missing test types to improve coverage across all categories');
    }
    const gaps = testEntries.filter(e => e.status === 'missing').length;
    if (gaps > 0) {
      recommendations.push(`Implement ${gaps} missing test suites to close coverage gaps`);
    }
    if (testEntries.filter(e => e.status === 'failing').length > 0) {
      recommendations.push('Investigate and fix failing test cases');
    }

    this.lastScanTimestamp = Date.now();
    this.emit('scan:complete', {
      timestamp: this.lastScanTimestamp,
      score: this.getHealthScore()
    });

    return {
      timestamp: this.lastScanTimestamp,
      deadCodeScore,
      configScore,
      testScore,
      overallScore: this.getHealthScore(),
      deadCodeCount,
      configRisks,
      testCoverage,
      modeConsistency: this.getModeConsistency(),
      recommendations
    };
  }

  /**
   * Get all dead code entries
   */
  public getAllDeadCode(): DeadCodeEntry[] {
    return Array.from(this.deadCodeEntries.values());
  }

  /**
   * Get all config audit entries
   */
  public getAllConfigEntries(): ConfigAuditEntry[] {
    return Array.from(this.configAuditEntries.values());
  }

  /**
   * Get all test entries
   */
  public getAllTestEntries(): TestEntry[] {
    return Array.from(this.testEntries.values());
  }
}

// Export interfaces for external use
export type { DeadCodeEntry, ConfigAuditEntry, TestEntry, HealthReport };
