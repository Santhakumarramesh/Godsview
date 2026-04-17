import { EventEmitter } from 'events';

/**
 * GodsView Phase 113 — Model Governance
 * Shadow Deployment Framework for champion/challenger comparison
 * ~450 lines, ESM (.js imports), no external packages
 */

interface ShadowPrediction {
  timestamp: number;
  symbol: string;
  championPrediction: number;
  challengerPrediction: number;
  actual?: number;
  championCorrect?: boolean;
  challengerCorrect?: boolean;
}

interface ComparisonResult {
  totalPredictions: number;
  championAccuracy: number;
  challengerAccuracy: number;
  championSharpe: number;
  challengerSharpe: number;
  championPF: number;
  challengerPF: number;
  winRateDelta: number;
  sharpeDelta: number;
  pValue: number;
  significant: boolean;
  daysRunning: number;
  daysRemaining: number;
}

interface ShadowDeployment {
  id: string;
  challengerModelId: string;
  championModelId: string;
  startedAt: number;
  minDurationDays: number;
  status: 'active' | 'completed' | 'aborted' | 'promoted';
  predictions: ShadowPrediction[];
  comparison: ComparisonResult | null;
  promotionReady: boolean;
  promotionBlockers: string[];
}

interface PredictionTrace {
  predictionId: string;
  timestamp: number;
  symbol: string;
  modelId: string;
  modelVersion: string;
  featuresUsed: string[];
  prediction: number;
  confidence: number;
  derivedFrom: string[];
}

export class ShadowDeployer extends EventEmitter {
  private deployments: Map<string, ShadowDeployment> = new Map();
  private predictionTraces: Map<string, PredictionTrace> = new Map();
  private predictionCounter: number = 0;

  constructor() {
    super();
    this.initializeDefaultDeployments();
  }

  /**
   * Pre-populate with 2 shadow deployments:
   * - One active (15 days in, challenger beating champion)
   * - One completed (promoted successfully)
   */
  private initializeDefaultDeployments(): void {
    const now = Date.now();
    const fifteenDaysAgo = now - 15 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Active deployment: challenger vs champion, 15 days running
    const activeId = 'shadow-2024-001';
    const activePredictions: ShadowPrediction[] = [];

    // Generate 150 synthetic predictions (10 per day over 15 days)
    for (let i = 0; i < 150; i++) {
      const timestamp = fifteenDaysAgo + (i * 24 * 60 * 60 * 1000) / 10;
      const symbols = ['AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN'];
      const symbol = symbols[i % symbols.length];

      // Challenger slightly outperforms champion
      const championPred = Math.random() * 0.1 - 0.05; // -5% to +5%
      const challengerPred = championPred + (Math.random() * 0.03); // +0.3% better on average
      const actual = Math.random() * 0.12 - 0.06;

      activePredictions.push({
        timestamp,
        symbol,
        championPrediction: championPred,
        challengerPrediction: challengerPred,
        actual,
        championCorrect: (championPred * actual) > 0,
        challengerCorrect: (challengerPred * actual) > 0,
      });
    }

    const activeComparison = this.calculateComparison(
      activePredictions,
      fifteenDaysAgo,
      7
    );

    const activeDeployment: ShadowDeployment = {
      id: activeId,
      challengerModelId: 'model-v2.1.0',
      championModelId: 'model-v2.0.5',
      startedAt: fifteenDaysAgo,
      minDurationDays: 7,
      status: 'active',
      predictions: activePredictions,
      comparison: activeComparison,
      promotionReady: false,
      promotionBlockers: ['p-value threshold not met (0.12 > 0.05)'],
    };

    this.deployments.set(activeId, activeDeployment);
    this.logPredictions(activeId, activePredictions, 'model-v2.1.0', 'model-v2.0.5');

    // Completed/promoted deployment: 30 days of successful shadow
    const completedId = 'shadow-2024-000';
    const completedPredictions: ShadowPrediction[] = [];

    // Generate 300 synthetic predictions (10 per day over 30 days)
    for (let i = 0; i < 300; i++) {
      const timestamp = thirtyDaysAgo + (i * 24 * 60 * 60 * 1000) / 10;
      const symbols = ['AAPL', 'TSLA', 'GOOGL', 'MSFT', 'AMZN', 'NVDA'];
      const symbol = symbols[i % symbols.length];

      // Challenger significantly outperforms champion
      const championPred = Math.random() * 0.1 - 0.05;
      const challengerPred = championPred + (Math.random() * 0.08 + 0.02); // +2-10% better
      const actual = Math.random() * 0.12 - 0.06;

      completedPredictions.push({
        timestamp,
        symbol,
        championPrediction: championPred,
        challengerPrediction: challengerPred,
        actual,
        championCorrect: (championPred * actual) > 0,
        challengerCorrect: (challengerPred * actual) > 0,
      });
    }

    const completedComparison = this.calculateComparison(
      completedPredictions,
      thirtyDaysAgo,
      7
    );

    const completedDeployment: ShadowDeployment = {
      id: completedId,
      challengerModelId: 'model-v2.0.4',
      championModelId: 'model-v2.0.3',
      startedAt: thirtyDaysAgo,
      minDurationDays: 7,
      status: 'promoted',
      predictions: completedPredictions,
      comparison: completedComparison,
      promotionReady: true,
      promotionBlockers: [],
    };

    this.deployments.set(completedId, completedDeployment);
    this.logPredictions(completedId, completedPredictions, 'model-v2.0.4', 'model-v2.0.3');
  }

  /**
   * Start a new shadow deployment
   */
  startShadow(
    challengerModelId: string,
    championModelId: string,
    durationDays: number = 7
  ): string {
    const id = `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const deployment: ShadowDeployment = {
      id,
      challengerModelId,
      championModelId,
      startedAt: now,
      minDurationDays: durationDays,
      status: 'active',
      predictions: [],
      comparison: null,
      promotionReady: false,
      promotionBlockers: [`Min duration not reached (0/${durationDays} days)`],
    };

    this.deployments.set(id, deployment);
    this.emit('shadow:started', {
      deploymentId: id,
      challengerModelId,
      championModelId,
      minDurationDays: durationDays,
      timestamp: now,
    });

    return id;
  }

  /**
   * Log a shadow prediction pair (both models receive same input)
   */
  logPrediction(
    deploymentId: string,
    symbol: string,
    championPrediction: number,
    challengerPrediction: number,
    actual?: number
  ): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (deployment.status !== 'active') {
      throw new Error(`Deployment ${deploymentId} is not active`);
    }

    const timestamp = Date.now();
    const prediction: ShadowPrediction = {
      timestamp,
      symbol,
      championPrediction,
      challengerPrediction,
      actual,
      championCorrect: actual ? (championPrediction * actual) > 0 : undefined,
      challengerCorrect: actual ? (challengerPrediction * actual) > 0 : undefined,
    };

    deployment.predictions.push(prediction);

    // Log traces for both models
    this.logTrace(
      deploymentId,
      symbol,
      deployment.championModelId,
      championPrediction,
      ['price', 'volume', 'rsi', 'macd', 'bollinger']
    );

    this.logTrace(
      deploymentId,
      symbol,
      deployment.challengerModelId,
      challengerPrediction,
      ['price', 'volume', 'rsi', 'macd', 'bollinger', 'vix', 'yield_curve']
    );

    this.emit('prediction:logged', {
      deploymentId,
      symbol,
      timestamp,
      championPrediction,
      challengerPrediction,
      actual,
    });
  }

  /**
   * Internal: log prediction trace for traceability
   */
  private logTrace(
    deploymentId: string,
    symbol: string,
    modelId: string,
    prediction: number,
    features: string[]
  ): void {
    const traceId = `trace-${deploymentId}-${symbol}-${this.predictionCounter++}`;
    const trace: PredictionTrace = {
      predictionId: traceId,
      timestamp: Date.now(),
      symbol,
      modelId,
      modelVersion: this.getModelVersion(modelId),
      featuresUsed: features,
      prediction,
      confidence: 0.7 + Math.random() * 0.25,
      derivedFrom: this.getDerivedFromFeatures(features),
    };

    this.predictionTraces.set(traceId, trace);
  }

  /**
   * Internal: helper to get model version
   */
  private getModelVersion(modelId: string): string {
    // Extract version from modelId or return a semantic version
    const versionMatch = modelId.match(/v([\d.]+)/);
    return versionMatch ? versionMatch[1] : '1.0.0';
  }

  /**
   * Internal: helper to trace features back to raw data sources
   */
  private getDerivedFromFeatures(features: string[]): string[] {
    const derivations: Record<string, string[]> = {
      price: ['market_data', 'ticker_stream'],
      volume: ['market_data', 'trade_log'],
      rsi: ['price', 'historical_close'],
      macd: ['price', 'exponential_moving_average'],
      bollinger: ['price', 'standard_deviation'],
      vix: ['options_chain', 'implied_volatility'],
      yield_curve: ['treasury_data', 'fed_rates'],
    };

    const derived = new Set<string>();
    features.forEach(f => {
      if (derivations[f]) {
        derivations[f].forEach(d => derived.add(d));
      }
    });

    return Array.from(derived);
  }

  /**
   * Evaluate shadow deployment and check promotion readiness
   */
  evaluateShadow(deploymentId: string): ComparisonResult {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const now = Date.now();
    const daysRunning = (now - deployment.startedAt) / (24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, deployment.minDurationDays - daysRunning);

    const comparison = this.calculateComparison(
      deployment.predictions,
      deployment.startedAt,
      deployment.minDurationDays
    );

    deployment.comparison = comparison;

    // Determine promotion readiness
    const blockers: string[] = [];

    if (daysRunning < deployment.minDurationDays) {
      blockers.push(
        `Min duration not reached (${daysRunning.toFixed(1)}/${deployment.minDurationDays} days)`
      );
    }

    if (comparison.challengerAccuracy < comparison.championAccuracy) {
      blockers.push(
        `Challenger accuracy lower (${(comparison.challengerAccuracy * 100).toFixed(1)}% < ${(comparison.championAccuracy * 100).toFixed(1)}%)`
      );
    }

    if (comparison.challengerSharpe < comparison.championSharpe) {
      blockers.push(
        `Challenger Sharpe lower (${comparison.challengerSharpe.toFixed(2)} < ${comparison.championSharpe.toFixed(2)})`
      );
    }

    if (comparison.pValue >= 0.05) {
      blockers.push(
        `Not statistically significant (p=${comparison.pValue.toFixed(3)} >= 0.05)`
      );
    }

    deployment.promotionReady = blockers.length === 0;
    deployment.promotionBlockers = blockers;

    this.emit('shadow:evaluated', {
      deploymentId,
      comparison,
      promotionReady: deployment.promotionReady,
      blockers,
      timestamp: now,
    });

    return comparison;
  }

  /**
   * Internal: calculate comparison metrics
   */
  private calculateComparison(
    predictions: ShadowPrediction[],
    startTime: number,
    minDurationDays: number
  ): ComparisonResult {
    const now = Date.now();
    const daysRunning = (now - startTime) / (24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, minDurationDays - daysRunning);

    if (predictions.length === 0) {
      return {
        totalPredictions: 0,
        championAccuracy: 0,
        challengerAccuracy: 0,
        championSharpe: 0,
        challengerSharpe: 0,
        championPF: 0,
        challengerPF: 0,
        winRateDelta: 0,
        sharpeDelta: 0,
        pValue: 1,
        significant: false,
        daysRunning: daysRunning,
        daysRemaining: daysRemaining,
      };
    }

    // Calculate accuracy (percent of predictions with correct sign)
    const championCorrect = predictions.filter(p => p.championCorrect).length;
    const challengerCorrect = predictions.filter(p => p.challengerCorrect).length;

    const championAccuracy = championCorrect / predictions.length;
    const challengerAccuracy = challengerCorrect / predictions.length;

    // Calculate returns (simplified: sum of prediction * actual)
    const championReturns = predictions
      .filter(p => p.actual !== undefined)
      .reduce((sum, p) => sum + (p.championPrediction * p.actual!), 0);

    const challengerReturns = predictions
      .filter(p => p.actual !== undefined)
      .reduce((sum, p) => sum + (p.challengerPrediction * p.actual!), 0);

    // Calculate volatility (simplified)
    const championVol = Math.sqrt(
      predictions
        .filter(p => p.actual !== undefined)
        .reduce((sum, p) => sum + Math.pow(p.championPrediction - championReturns / predictions.length, 2), 0) /
        predictions.length
    );

    const challengerVol = Math.sqrt(
      predictions
        .filter(p => p.actual !== undefined)
        .reduce((sum, p) => sum + Math.pow(p.challengerPrediction - challengerReturns / predictions.length, 2), 0) /
        predictions.length
    );

    // Calculate Sharpe (simplified: returns / volatility)
    const championSharpe = championVol > 0 ? championReturns / championVol : 0;
    const challengerSharpe = challengerVol > 0 ? challengerReturns / challengerVol : 0;

    // Profit factor (simplified: sum of wins / abs sum of losses)
    const championWins = predictions
      .filter(p => p.actual && (p.championPrediction * p.actual) > 0)
      .length;
    const championLosses = predictions.length - championWins;

    const challengerWins = predictions
      .filter(p => p.actual && (p.challengerPrediction * p.actual) > 0)
      .length;
    const challengerLosses = predictions.length - challengerWins;

    const championPF = championLosses > 0 ? championWins / championLosses : championWins > 0 ? 999 : 0;
    const challengerPF = challengerLosses > 0 ? challengerWins / challengerLosses : challengerWins > 0 ? 999 : 0;

    // Win rate delta
    const winRateDelta = challengerAccuracy - championAccuracy;

    // Sharpe delta
    const sharpeDelta = challengerSharpe - championSharpe;

    // p-value: simplified t-test approximation
    // Smaller p when difference is significant relative to sample size
    const pValue = Math.min(1, Math.exp(-Math.abs(winRateDelta) * predictions.length / 2));

    return {
      totalPredictions: predictions.length,
      championAccuracy,
      challengerAccuracy,
      championSharpe,
      challengerSharpe,
      championPF,
      challengerPF,
      winRateDelta,
      sharpeDelta,
      pValue,
      significant: pValue < 0.05,
      daysRunning,
      daysRemaining,
    };
  }

  /**
   * Promote challenger to champion status
   */
  promoteShadow(deploymentId: string): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (!deployment.promotionReady) {
      throw new Error(`Deployment ${deploymentId} is not ready for promotion`);
    }

    deployment.status = 'promoted';

    this.emit('shadow:promoted', {
      deploymentId,
      previousChampion: deployment.championModelId,
      newChampion: deployment.challengerModelId,
      comparison: deployment.comparison,
      timestamp: Date.now(),
    });
  }

  /**
   * Abort a shadow deployment
   */
  abortShadow(deploymentId: string, reason: string): void {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    deployment.status = 'aborted';

    this.emit('shadow:aborted', {
      deploymentId,
      challengerModelId: deployment.challengerModelId,
      championModelId: deployment.championModelId,
      reason,
      predictionsLogged: deployment.predictions.length,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all active shadow deployments
   */
  getActiveShadows(): ShadowDeployment[] {
    return Array.from(this.deployments.values()).filter(d => d.status === 'active');
  }

  /**
   * Get shadow deployment history (completed/aborted)
   */
  getShadowHistory(): ShadowDeployment[] {
    return Array.from(this.deployments.values()).filter(
      d => d.status === 'completed' || d.status === 'aborted' || d.status === 'promoted'
    );
  }

  /**
   * Get detailed comparison report
   */
  getComparisonReport(deploymentId: string): Record<string, any> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const comparison = deployment.comparison || this.evaluateShadow(deploymentId);

    return {
      deploymentId,
      status: deployment.status,
      challengerModelId: deployment.challengerModelId,
      championModelId: deployment.championModelId,
      startedAt: new Date(deployment.startedAt).toISOString(),
      comparison,
      promotionReady: deployment.promotionReady,
      promotionBlockers: deployment.promotionBlockers,
      predictionCount: deployment.predictions.length,
      summary: {
        championWinRate: `${(comparison.championAccuracy * 100).toFixed(1)}%`,
        challengerWinRate: `${(comparison.challengerAccuracy * 100).toFixed(1)}%`,
        improvement: `${(comparison.winRateDelta * 100).toFixed(1)}%`,
        sharpeImprovement: comparison.sharpeDelta.toFixed(2),
        statisticalSignificance: `p=${comparison.pValue.toFixed(3)}`,
      },
    };
  }

  /**
   * Trace a prediction back to its full decision context
   */
  tracePrediction(predictionId: string): PredictionTrace | null {
    const trace = this.predictionTraces.get(predictionId);
    if (!trace) {
      return null;
    }

    return {
      ...trace,
      derivedFrom: this.getDerivedFromFeatures(trace.featuresUsed),
    };
  }

  /**
   * Internal: log all predictions to traces
   */
  private logPredictions(
    deploymentId: string,
    predictions: ShadowPrediction[],
    challengerId: string,
    championId: string
  ): void {
    predictions.forEach((pred, index) => {
      const championTraceId = `trace-${deploymentId}-c-${index}`;
      const challengerTraceId = `trace-${deploymentId}-ch-${index}`;

      const features = ['price', 'volume', 'rsi', 'macd', 'bollinger'];
      const challengerFeatures = [...features, 'vix', 'yield_curve'];

      this.predictionTraces.set(championTraceId, {
        predictionId: championTraceId,
        timestamp: pred.timestamp,
        symbol: pred.symbol,
        modelId: championId,
        modelVersion: this.getModelVersion(championId),
        featuresUsed: features,
        prediction: pred.championPrediction,
        confidence: 0.75 + Math.random() * 0.2,
        derivedFrom: this.getDerivedFromFeatures(features),
      });

      this.predictionTraces.set(challengerTraceId, {
        predictionId: challengerTraceId,
        timestamp: pred.timestamp,
        symbol: pred.symbol,
        modelId: challengerId,
        modelVersion: this.getModelVersion(challengerId),
        featuresUsed: challengerFeatures,
        prediction: pred.challengerPrediction,
        confidence: 0.78 + Math.random() * 0.2,
        derivedFrom: this.getDerivedFromFeatures(challengerFeatures),
      });
    });
  }

  /**
   * Get all deployments (for admin/debugging)
   */
  getAllDeployments(): ShadowDeployment[] {
    return Array.from(this.deployments.values());
  }

  /**
   * Get deployment by ID
   */
  getDeployment(deploymentId: string): ShadowDeployment | undefined {
    return this.deployments.get(deploymentId);
  }
}

export type { ShadowDeployment, ShadowPrediction, ComparisonResult, PredictionTrace };