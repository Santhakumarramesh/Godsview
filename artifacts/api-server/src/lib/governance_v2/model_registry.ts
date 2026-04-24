import { EventEmitter } from 'events';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  sharpe: number;
  profitFactor: number;
  maxDrawdown: number;
  trainingLoss: number;
  validationLoss: number;
  overfitRatio: number;
}

export type ModelType =
  | 'classifier'
  | 'regressor'
  | 'ensemble'
  | 'rule_based'
  | 'hybrid';

export type ModelStatus =
  | 'draft'
  | 'training'
  | 'shadow'
  | 'champion'
  | 'challenger'
  | 'retired'
  | 'rolled_back';

export interface RegisteredModel {
  id: string;
  name: string;
  version: string;
  type: ModelType;
  status: ModelStatus;
  features: string[]; // feature IDs used
  datasetId: string;
  trainingConfig: Record<string, unknown>;
  metrics: ModelMetrics;
  createdAt: number;
  promotedAt?: number;
  retiredAt?: number;
  parentVersion?: string; // previous version lineage
  hash: string; // reproducibility hash
  owner: string;
  tags: string[];
}

export type FeatureType = 'numeric' | 'categorical' | 'boolean' | 'embedding';

export type FeatureStatus = 'active' | 'deprecated' | 'experimental';

export interface RegisteredFeature {
  id: string;
  name: string;
  type: FeatureType;
  source: string;
  version: string;
  description: string;
  computeLatencyMs: number;
  dependencies: string[];
  usedByModels: string[];
  status: FeatureStatus;
  createdAt: number;
}

export interface Dataset {
  id: string;
  name: string;
  version: string;
  source: string;
  startDate: string;
  endDate: string;
  symbols: string[];
  rowCount: number;
  featureCount: number;
  splitRatio: { train: number; val: number; test: number };
  hash: string;
  parentId?: string;
  transformations: string[];
}

export interface TrainingRun {
  id: string;
  modelId: string;
  timestamp: number;
  config: Record<string, unknown>;
  datasetId: string;
  featureIds: string[];
  metrics: ModelMetrics;
  duration: number;
  configHash: string;
  datasetHash: string;
  reproductionHash: string;
}

export interface ShadowPeriod {
  startedAt: number;
  durationDays: number;
  metricsComparison: {
    challenger: ModelMetrics;
    champion: ModelMetrics;
    improvement: Record<string, number>;
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Simple deterministic hash for reproducibility
 */
function computeHash(data: unknown): string {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Compare two model metrics
 */
function compareMetrics(
  current: ModelMetrics,
  previous: ModelMetrics
): Record<string, number> {
  return {
    accuracy: current.accuracy - previous.accuracy,
    precision: current.precision - previous.precision,
    recall: current.recall - previous.recall,
    f1: current.f1 - previous.f1,
    sharpe: current.sharpe - previous.sharpe,
    profitFactor: current.profitFactor - previous.profitFactor,
    maxDrawdown: current.maxDrawdown - previous.maxDrawdown,
    trainingLoss: current.trainingLoss - previous.trainingLoss,
    validationLoss: current.validationLoss - previous.validationLoss,
    overfitRatio: current.overfitRatio - previous.overfitRatio,
  };
}

/**
 * Check if challenger metrics beat champion
 */
function metricsImprove(
  challenger: ModelMetrics,
  champion: ModelMetrics
): boolean {
  const improvement = compareMetrics(challenger, champion);
  const positiveMetrics = [
    'accuracy',
    'precision',
    'recall',
    'f1',
    'sharpe',
    'profitFactor',
  ];
  const negativeMetrics = ['trainingLoss', 'validationLoss', 'maxDrawdown'];

  let improvedCount = 0;

  for (const metric of positiveMetrics) {
    if (improvement[metric] > 0.001) improvedCount++;
  }

  for (const metric of negativeMetrics) {
    if (improvement[metric] < -0.001) improvedCount++;
  }

  return improvedCount >= 3;
}

// ============================================================================
// MODEL REGISTRY CLASS
// ============================================================================

export class ModelRegistry extends EventEmitter {
  private models: Map<string, RegisteredModel> = new Map();
  private features: Map<string, RegisteredFeature> = new Map();
  private datasets: Map<string, Dataset> = new Map();
  private trainingRuns: Map<string, TrainingRun> = new Map();
  private championAssignments: Map<string, string> = new Map(); // slot -> modelId
  private shadowPeriods: Map<string, ShadowPeriod> = new Map(); // modelId -> period
  private modelVersionHistory: Map<string, string[]> = new Map(); // modelId -> [versions]

  constructor() {
    super();
    this.initializeDefaults();
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  private initializeDefaults(): void {
    // Initialize 3 datasets
    this.registerDataset({
      id: 'dataset-001',
      name: 'Training Data 2023-2024',
      version: '1.0.0',
      source: 'market_data_provider',
      startDate: '2023-01-01',
      endDate: '2024-01-01',
      symbols: ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'],
      rowCount: 250000,
      featureCount: 150,
      splitRatio: { train: 0.7, val: 0.15, test: 0.15 },
      hash: computeHash({ name: 'Training Data 2023-2024' }),
      transformations: ['normalization', 'outlier_removal'],
    });

    this.registerDataset({
      id: 'dataset-002',
      name: 'Validation Data 2024',
      version: '1.0.0',
      source: 'market_data_provider',
      startDate: '2024-01-01',
      endDate: '2024-06-01',
      symbols: ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'],
      rowCount: 150000,
      featureCount: 150,
      splitRatio: { train: 0.0, val: 1.0, test: 0.0 },
      hash: computeHash({ name: 'Validation Data 2024' }),
      parentId: 'dataset-001',
      transformations: ['normalization'],
    });

    this.registerDataset({
      id: 'dataset-003',
      name: 'Live Data Feed 2024',
      version: '2.0.0',
      source: 'realtime_market_data',
      startDate: '2024-06-01',
      endDate: '2024-12-31',
      symbols: ['AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'],
      rowCount: 500000,
      featureCount: 150,
      splitRatio: { train: 0.0, val: 0.0, test: 1.0 },
      hash: computeHash({ name: 'Live Data Feed 2024' }),
      parentId: 'dataset-002',
      transformations: ['normalization', 'drift_adaptation'],
    });

    // Initialize 15 features
    const featureDefinitions = [
      {
        id: 'feat-001',
        name: 'SMA_20',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: '20-period simple moving average',
        dependencies: [],
      },
      {
        id: 'feat-002',
        name: 'SMA_50',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: '50-period simple moving average',
        dependencies: [],
      },
      {
        id: 'feat-003',
        name: 'RSI_14',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: '14-period relative strength index',
        dependencies: [],
      },
      {
        id: 'feat-004',
        name: 'MACD',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: 'MACD histogram',
        dependencies: [],
      },
      {
        id: 'feat-005',
        name: 'BB_WIDTH',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: 'Bollinger Bands width',
        dependencies: [],
      },
      {
        id: 'feat-006',
        name: 'ATR_14',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: '14-period average true range',
        dependencies: [],
      },
      {
        id: 'feat-007',
        name: 'VOLUME_RATIO',
        type: 'numeric' as FeatureType,
        source: 'market_data',
        description: 'Volume to average volume ratio',
        dependencies: [],
      },
      {
        id: 'feat-008',
        name: 'PRICE_CHANGE_PCT',
        type: 'numeric' as FeatureType,
        source: 'market_data',
        description: 'Price change percentage',
        dependencies: [],
      },
      {
        id: 'feat-009',
        name: 'MARKET_REGIME',
        type: 'categorical' as FeatureType,
        source: 'regime_detector',
        description: 'Current market regime classification',
        dependencies: ['feat-001', 'feat-002'],
      },
      {
        id: 'feat-010',
        name: 'VOLATILITY',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: 'Historical volatility (20-period)',
        dependencies: [],
      },
      {
        id: 'feat-011',
        name: 'TREND_STRENGTH',
        type: 'numeric' as FeatureType,
        source: 'custom_indicator',
        description: 'ADX-based trend strength',
        dependencies: ['feat-001', 'feat-002'],
      },
      {
        id: 'feat-012',
        name: 'MOMENTUM',
        type: 'numeric' as FeatureType,
        source: 'ta_lib',
        description: 'Rate of change indicator',
        dependencies: [],
      },
      {
        id: 'feat-013',
        name: 'SECTOR_BETA',
        type: 'numeric' as FeatureType,
        source: 'market_data',
        description: 'Sector-relative beta',
        dependencies: [],
      },
      {
        id: 'feat-014',
        name: 'EARNINGS_SURPRISE',
        type: 'numeric' as FeatureType,
        source: 'fundamental_data',
        description: 'Latest earnings surprise percentage',
        dependencies: [],
      },
      {
        id: 'feat-015',
        name: 'NEWS_SENTIMENT',
        type: 'embedding' as FeatureType,
        source: 'nlp_sentiment',
        description: 'Embedded sentiment from recent news',
        dependencies: [],
      },
    ];

    for (const feat of featureDefinitions) {
      this.registerFeature({
        ...feat,
        version: '1.0.0',
        computeLatencyMs: 0, // Real values come from feature computation performance monitoring
        usedByModels: [],
        status: 'active' as FeatureStatus,
        createdAt: Date.now(),
      });
    }

    // Initialize 3 models
    const baseMetrics: ModelMetrics = {
      accuracy: 0.72,
      precision: 0.75,
      recall: 0.68,
      f1: 0.71,
      sharpe: 1.8,
      profitFactor: 1.45,
      maxDrawdown: -0.18,
      trainingLoss: 0.35,
      validationLoss: 0.41,
      overfitRatio: 1.17,
    };

    // Regime Classifier
    this.registerModel({
      id: 'model-regime-001',
      name: 'Regime Classifier v1',
      version: '1.0.0',
      type: 'classifier',
      status: 'champion',
      features: ['feat-001', 'feat-002', 'feat-003', 'feat-010', 'feat-011'],
      datasetId: 'dataset-001',
      trainingConfig: {
        algorithm: 'random_forest',
        n_estimators: 100,
        max_depth: 15,
        min_samples_split: 10,
      },
      metrics: baseMetrics,
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      promotedAt: Date.now() - 28 * 24 * 60 * 60 * 1000,
      hash: computeHash({
        algorithm: 'random_forest',
        n_estimators: 100,
      }),
      owner: 'data_science_team',
      tags: ['production', 'regime_detection'],
    });

    // Signal Scorer
    this.registerModel({
      id: 'model-signal-001',
      name: 'Signal Scorer v1',
      version: '1.0.0',
      type: 'regressor',
      status: 'champion',
      features: [
        'feat-003',
        'feat-004',
        'feat-006',
        'feat-012',
        'feat-013',
        'feat-015',
      ],
      datasetId: 'dataset-001',
      trainingConfig: {
        algorithm: 'gradient_boosting',
        n_estimators: 200,
        learning_rate: 0.05,
        max_depth: 8,
      },
      metrics: { ...baseMetrics, accuracy: 0.76, f1: 0.74 },
      createdAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
      promotedAt: Date.now() - 23 * 24 * 60 * 60 * 1000,
      hash: computeHash({
        algorithm: 'gradient_boosting',
        n_estimators: 200,
      }),
      owner: 'data_science_team',
      tags: ['production', 'signal_generation'],
    });

    // Entry Timing Model
    this.registerModel({
      id: 'model-entry-001',
      name: 'Entry Timing Model v1',
      version: '1.0.0',
      type: 'hybrid',
      status: 'champion',
      features: [
        'feat-005',
        'feat-007',
        'feat-008',
        'feat-009',
        'feat-014',
      ],
      datasetId: 'dataset-001',
      trainingConfig: {
        algorithm: 'neural_network',
        layers: [128, 64, 32, 16],
        epochs: 150,
        batch_size: 32,
        dropout: 0.3,
      },
      metrics: { ...baseMetrics, accuracy: 0.74, sharpe: 2.1 },
      createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
      promotedAt: Date.now() - 18 * 24 * 60 * 60 * 1000,
      hash: computeHash({
        algorithm: 'neural_network',
        layers: [128, 64, 32, 16],
      }),
      owner: 'data_science_team',
      tags: ['production', 'entry_timing'],
    });

    // Set champion assignments
    this.championAssignments.set('regime_detection', 'model-regime-001');
    this.championAssignments.set('signal_generation', 'model-signal-001');
    this.championAssignments.set('entry_timing', 'model-entry-001');

    // Track version history
    this.modelVersionHistory.set('model-regime-001', ['1.0.0']);
    this.modelVersionHistory.set('model-signal-001', ['1.0.0']);
    this.modelVersionHistory.set('model-entry-001', ['1.0.0']);
  }

  // ============================================================================
  // MODEL REGISTRY OPERATIONS
  // ============================================================================

  /**
   * Register a new model or new version
   */
  registerModel(model: RegisteredModel): void {
    if (this.models.has(model.id)) {
      throw new Error(`Model ${model.id} already registered`);
    }

    this.models.set(model.id, { ...model });

    // Track version history
    const versions = this.modelVersionHistory.get(model.id) || [];
    if (!versions.includes(model.version)) {
      versions.push(model.version);
      this.modelVersionHistory.set(model.id, versions);
    }

    // Update feature usage
    for (const featureId of model.features) {
      const feature = this.features.get(featureId);
      if (feature) {
        if (!feature.usedByModels.includes(model.id)) {
          feature.usedByModels.push(model.id);
        }
      }
    }

    this.emit('model:registered', {
      modelId: model.id,
      name: model.name,
      version: model.version,
      status: model.status,
    });
  }

  /**
   * Get model by ID
   */
  getModel(modelId: string): RegisteredModel | undefined {
    return this.models.get(modelId);
  }

  /**
   * Get all models
   */
  getAllModels(): RegisteredModel[] {
    return Array.from(this.models.values());
  }

  /**
   * Get models by status
   */
  getModelsByStatus(status: ModelStatus): RegisteredModel[] {
    return Array.from(this.models.values()).filter((m) => m.status === status);
  }

  /**
   * Get model version history
   */
  getModelVersionHistory(modelId: string): string[] {
    return this.modelVersionHistory.get(modelId) || [];
  }

  /**
   * Update model metrics (e.g., during training)
   */
  updateModelMetrics(modelId: string, metrics: ModelMetrics): void {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    model.metrics = metrics;
  }

  /**
   * Update model status
   */
  updateModelStatus(modelId: string, status: ModelStatus): void {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    model.status = status;
  }

  // ============================================================================
  // FEATURE REGISTRY OPERATIONS
  // ============================================================================

  /**
   * Register a new feature
   */
  registerFeature(feature: RegisteredFeature): void {
    if (this.features.has(feature.id)) {
      throw new Error(`Feature ${feature.id} already registered`);
    }
    this.features.set(feature.id, { ...feature });

    this.emit('feature:registered', {
      featureId: feature.id,
      name: feature.name,
      type: feature.type,
      status: feature.status,
    });
  }

  /**
   * Get feature by ID
   */
  getFeature(featureId: string): RegisteredFeature | undefined {
    return this.features.get(featureId);
  }

  /**
   * Get all features
   */
  getAllFeatures(): RegisteredFeature[] {
    return Array.from(this.features.values());
  }

  /**
   * Get active features
   */
  getActiveFeatures(): RegisteredFeature[] {
    return Array.from(this.features.values()).filter(
      (f) => f.status === 'active'
    );
  }

  /**
   * Get features by type
   */
  getFeaturesByType(type: FeatureType): RegisteredFeature[] {
    return Array.from(this.features.values()).filter((f) => f.type === type);
  }

  /**
   * Deprecate a feature
   */
  deprecateFeature(featureId: string): void {
    const feature = this.features.get(featureId);
    if (!feature) {
      throw new Error(`Feature ${featureId} not found`);
    }
    feature.status = 'deprecated';
  }

  // ============================================================================
  // DATASET OPERATIONS
  // ============================================================================

  /**
   * Register a new dataset
   */
  registerDataset(dataset: Dataset): void {
    if (this.datasets.has(dataset.id)) {
      throw new Error(`Dataset ${dataset.id} already registered`);
    }
    this.datasets.set(dataset.id, { ...dataset });

    this.emit('dataset:registered', {
      datasetId: dataset.id,
      name: dataset.name,
      version: dataset.version,
      rowCount: dataset.rowCount,
    });
  }

  /**
   * Get dataset by ID
   */
  getDataset(datasetId: string): Dataset | undefined {
    return this.datasets.get(datasetId);
  }

  /**
   * Get all datasets
   */
  getAllDatasets(): Dataset[] {
    return Array.from(this.datasets.values());
  }

  // ============================================================================
  // TRAINING & VERSIONING
  // ============================================================================

  /**
   * Record a training run with reproducibility hash
   */
  recordTrainingRun(
    modelId: string,
    config: Record<string, unknown>,
    datasetId: string,
    featureIds: string[],
    metrics: ModelMetrics,
    duration: number
  ): TrainingRun {
    const configHash = computeHash(config);
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }
    const datasetHash = dataset.hash;
    const featuresHash = computeHash(featureIds);
    const reproductionHash = computeHash({
      configHash,
      datasetHash,
      featuresHash,
    });

    const run: TrainingRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      modelId,
      timestamp: Date.now(),
      config,
      datasetId,
      featureIds,
      metrics,
      duration,
      configHash,
      datasetHash,
      reproductionHash,
    };

    this.trainingRuns.set(run.id, run);
    return run;
  }

  /**
   * Get training run by ID
   */
  getTrainingRun(runId: string): TrainingRun | undefined {
    return this.trainingRuns.get(runId);
  }

  /**
   * Get all training runs for a model
   */
  getModelTrainingRuns(modelId: string): TrainingRun[] {
    return Array.from(this.trainingRuns.values()).filter(
      (r) => r.modelId === modelId
    );
  }

  /**
   * Compare two versions side-by-side
   */
  compareVersions(
    modelId: string,
    v1: string,
    v2: string
  ): { v1: RegisteredModel; v2: RegisteredModel; metricsComparison: Record<string, number> } | null {
    const models = this.getAllModels().filter((m) => m.id === modelId);
    const model1 = models.find((m) => m.version === v1);
    const model2 = models.find((m) => m.version === v2);

    if (!model1 || !model2) {
      return null;
    }

    return {
      v1: model1,
      v2: model2,
      metricsComparison: compareMetrics(model2.metrics, model1.metrics),
    };
  }

  // ============================================================================
  // CHAMPION / CHALLENGER FRAMEWORK
  // ============================================================================

  /**
   * Get current champion for a slot
   */
  getChampion(slot: string): RegisteredModel | undefined {
    const modelId = this.championAssignments.get(slot);
    if (!modelId) return undefined;
    return this.models.get(modelId);
  }

  /**
   * Set a model as champion
   */
  setChampion(slot: string, modelId: string): void {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }
    this.championAssignments.set(slot, modelId);
    model.status = 'champion';
    model.promotedAt = Date.now();
  }

  /**
   * Start shadow mode for a challenger
   */
  startShadowMode(
    challengerId: string,
    durationDays: number = 7
  ): void {
    const challenger = this.models.get(challengerId);
    if (!challenger) {
      throw new Error(`Model ${challengerId} not found`);
    }

    // Infer slot from tags or challenger status
    const slot = challenger.tags[0] || 'default';
    const champion = this.getChampion(slot);

    if (!champion) {
      throw new Error(`No champion found for slot ${slot}`);
    }

    challenger.status = 'shadow';
    const improvement = compareMetrics(challenger.metrics, champion.metrics);

    this.shadowPeriods.set(challengerId, {
      startedAt: Date.now(),
      durationDays,
      metricsComparison: {
        challenger: challenger.metrics,
        champion: champion.metrics,
        improvement,
      },
    });
  }

  /**
   * Promote challenger to champion (requires: shadow >= 7 days, metrics improve)
   */
  promoteChallenger(challengerId: string, slot: string): boolean {
    const challenger = this.models.get(challengerId);
    if (!challenger) {
      throw new Error(`Model ${challengerId} not found`);
    }

    const champion = this.getChampion(slot);
    if (!champion) {
      throw new Error(`No champion found for slot ${slot}`);
    }

    const shadowPeriod = this.shadowPeriods.get(challengerId);
    if (!shadowPeriod) {
      throw new Error(`No shadow period found for challenger ${challengerId}`);
    }

    const shadowDays =
      (Date.now() - shadowPeriod.startedAt) / (24 * 60 * 60 * 1000);
    if (shadowDays < shadowPeriod.durationDays) {
      return false; // Not ready yet
    }

    if (!metricsImprove(challenger.metrics, champion.metrics)) {
      return false; // Metrics didn't improve
    }

    // Promotion approved
    this.setChampion(slot, challengerId);
    champion.status = 'rolled_back';

    this.emit('model:promoted', {
      modelId: challengerId,
      slot,
      fromChampion: champion.id,
      metrics: challenger.metrics,
    });

    return true;
  }

  /**
   * Rollback to a previous version
   */
  rollbackToVersion(modelId: string, targetVersion: string): RegisteredModel | null {
    const models = this.getAllModels().filter((m) => m.id === modelId);
    const targetModel = models.find((m) => m.version === targetVersion);

    if (!targetModel) {
      throw new Error(
        `Version ${targetVersion} not found for model ${modelId}`
      );
    }

    // Find the slot this model occupies
    let slot = 'default';
    for (const [s, mid] of this.championAssignments.entries()) {
      if (mid === modelId) {
        slot = s;
        break;
      }
    }

    // Update the model version
    const oldModel = this.models.get(modelId);
    if (oldModel) {
      oldModel.status = 'rolled_back';
      oldModel.retiredAt = Date.now();
    }

    // Restore target version
    this.models.set(modelId, { ...targetModel });
    this.setChampion(slot, modelId);

    this.emit('model:rolled-back', {
      modelId,
      fromVersion: oldModel?.version,
      toVersion: targetVersion,
      slot,
    });

    return targetModel;
  }

  /**
   * Get shadow performance summary
   */
  getShadowSummary(challengerId: string): ShadowPeriod | undefined {
    return this.shadowPeriods.get(challengerId);
  }

  // ============================================================================
  // GOVERNANCE & AUDIT
  // ============================================================================

  /**
   * Get complete model lineage (parent -> current)
   */
  getModelLineage(modelId: string): RegisteredModel[] {
    const lineage: RegisteredModel[] = [];
    let current = this.models.get(modelId);

    while (current) {
      lineage.unshift(current);
      if (current.parentVersion) {
        // Find parent by version
        const allVersions = this.getAllModels().filter(
          (m) => m.id === modelId
        );
        current = allVersions.find((m) => m.version === current?.parentVersion);
      } else {
        break;
      }
    }

    return lineage;
  }

  /**
   * Get reproducibility info for a model
   */
  getReproducibilityInfo(modelId: string): {
    modelHash: string;
    datasetHash: string;
    configHash: string;
    featureIds: string[];
  } | null {
    const model = this.models.get(modelId);
    if (!model) return null;

    const dataset = this.datasets.get(model.datasetId);
    if (!dataset) return null;

    return {
      modelHash: model.hash,
      datasetHash: dataset.hash,
      configHash: computeHash(model.trainingConfig),
      featureIds: model.features,
    };
  }

  /**
   * Get audit summary
   */
  getAuditSummary(): {
    totalModels: number;
    totalFeatures: number;
    totalDatasets: number;
    championsCount: number;
    trainingRunsCount: number;
  } {
    return {
      totalModels: this.models.size,
      totalFeatures: this.features.size,
      totalDatasets: this.datasets.size,
      championsCount: this.championAssignments.size,
      trainingRunsCount: this.trainingRuns.size,
    };
  }

  /**
   * Export full registry state (for backup/versioning)
   */
  export(): {
    models: RegisteredModel[];
    features: RegisteredFeature[];
    datasets: Dataset[];
    championAssignments: Record<string, string>;
    timestamp: number;
  } {
    return {
      models: Array.from(this.models.values()),
      features: Array.from(this.features.values()),
      datasets: Array.from(this.datasets.values()),
      championAssignments: Object.fromEntries(this.championAssignments),
      timestamp: Date.now(),
    };
  }

  /**
   * Import registry state (restore from backup)
   */
  import(state: {
    models: RegisteredModel[];
    features: RegisteredFeature[];
    datasets: Dataset[];
    championAssignments: Record<string, string>;
  }): void {
    this.models.clear();
    this.features.clear();
    this.datasets.clear();
    this.championAssignments.clear();

    for (const model of state.models) {
      this.models.set(model.id, model);
    }

    for (const feature of state.features) {
      this.features.set(feature.id, feature);
    }

    for (const dataset of state.datasets) {
      this.datasets.set(dataset.id, dataset);
    }

    for (const [slot, modelId] of Object.entries(state.championAssignments)) {
      this.championAssignments.set(slot, modelId);
    }
  }
}
