/**
 * SelfRefusal - Strategy refuses to trade when conditions are wrong
 * Prevents trading in unfavorable environments and auto-downgrades modes
 */

export type RefusalReason =
  | 'LOW_EDGE_REGIME'
  | 'DRIFT_EXCEEDED'
  | 'CORRELATION_SPIKE'
  | 'VOLATILITY_EXTREME'
  | 'LIQUIDITY_DROUGHT'
  | 'DATA_QUALITY'
  | 'DRAWDOWN_PROXIMITY'
  | 'CONFIDENCE_DECAY'
  | 'NEWS_BLACKOUT'
  | 'SYSTEM_HEALTH';

export type StrategyMode =
  | 'AGGRESSIVE'
  | 'NORMAL'
  | 'DEFENSIVE'
  | 'CAUTIOUS'
  | 'PAUSED';

export interface RefusalReason {
  code: RefusalReason;
  severity: 'critical' | 'warning' | 'caution';
  message: string;
  currentValue: number;
  threshold: number;
  suggestedMode: StrategyMode;
  autoResumeConditions: string[];
  estimatedResumption: number | null;
}

export interface RefusalDecision {
  refuse: boolean;
  reasons: Array<{
    code: RefusalReason;
    severity: 'critical' | 'warning' | 'caution';
    message: string;
    currentValue: number;
    threshold: number;
  }>;
  severity: 'critical' | 'warning' | 'caution';
  suggestedMode: StrategyMode;
  autoResumeConditions: string[];
  estimatedResumption: number | null;
}

export interface CurrentConditions {
  regimeScore: number;
  isInEdgeRegime: boolean;
  liveVsBacktestDrift: number;
  portfolioCorrelation: number;
  marketVolatility: number;
  liquidityScore: number;
  currentDrawdown: number;
  maxAllowedDrawdown: number;
  confidenceDecayRate: number;
  confidenceScore: number;
  newsEventImminent: boolean;
  systemHealth: {
    latency: number;
    memoryUsage: number;
    cpuUsage: number;
    dataFeedStatus: 'healthy' | 'degraded' | 'failed';
  };
}

export interface StrategyProfile {
  id: string;
  name: string;
  edgeRegimes: string[];
  expectedDriftTolerance: number;
  volatilityRange: {
    min: number;
    max: number;
  };
  minLiquidityScore: number;
  maxAcceptableLeverage: number;
  maxDrawdownLimit: number;
  minConfidenceThreshold: number;
}

export class SelfRefusal {
  private refusalHistory: Map<string, Date[]> = new Map();

  shouldRefuse(
    strategy: StrategyProfile,
    currentConditions: CurrentConditions
  ): RefusalDecision {
    const reasons: RefusalDecision['reasons'] = [];
    let maxSeverity: 'critical' | 'warning' | 'caution' = 'caution';

    if (!currentConditions.isInEdgeRegime) {
      reasons.push({
        code: 'LOW_EDGE_REGIME' as RefusalReason,
        severity: 'warning',
        message: 'Current market regime does not match strategy edge',
        currentValue: currentConditions.regimeScore,
        threshold: 0.6,
      });
      maxSeverity = 'warning';
    }

    if (currentConditions.liveVsBacktestDrift > strategy.expectedDriftTolerance) {
      reasons.push({
        code: 'DRIFT_EXCEEDED' as RefusalReason,
        severity: 'critical',
        message: 'Live results diverging too much from backtest expectations',
        currentValue: currentConditions.liveVsBacktestDrift,
        threshold: strategy.expectedDriftTolerance,
      });
      maxSeverity = 'critical';
    }

    if (currentConditions.portfolioCorrelation > 0.8) {
      reasons.push({
        code: 'CORRELATION_SPIKE' as RefusalReason,
        severity: 'warning',
        message: 'Portfolio correlations above threshold. Diversification broken.',
        currentValue: currentConditions.portfolioCorrelation,
        threshold: 0.8,
      });
      maxSeverity = 'warning';
    }

    if (
      currentConditions.marketVolatility < strategy.volatilityRange.min ||
      currentConditions.marketVolatility > strategy.volatilityRange.max
    ) {
      reasons.push({
        code: 'VOLATILITY_EXTREME' as RefusalReason,
        severity: 'warning',
        message: `Volatility outside strategy range: ${currentConditions.marketVolatility.toFixed(1)}% vs [${strategy.volatilityRange.min}-${strategy.volatilityRange.max}%]`,
        currentValue: currentConditions.marketVolatility,
        threshold:
          (strategy.volatilityRange.min + strategy.volatilityRange.max) / 2,
      });
      maxSeverity = 'warning';
    }

    if (
      currentConditions.liquidityScore < strategy.minLiquidityScore
    ) {
      reasons.push({
        code: 'LIQUIDITY_DROUGHT' as RefusalReason,
        severity: 'warning',
        message: 'Insufficient market depth for planned position sizes',
        currentValue: currentConditions.liquidityScore,
        threshold: strategy.minLiquidityScore,
      });
      maxSeverity = 'warning';
    }

    if (currentConditions.systemHealth.dataFeedStatus === 'failed') {
      reasons.push({
        code: 'DATA_QUALITY' as RefusalReason,
        severity: 'critical',
        message: 'Data feed offline or severely degraded',
        currentValue: 0,
        threshold: 1,
      });
      maxSeverity = 'critical';
    }

    if (
      currentConditions.currentDrawdown >=
      currentConditions.maxAllowedDrawdown * 0.9
    ) {
      reasons.push({
        code: 'DRAWDOWN_PROXIMITY' as RefusalReason,
        severity: 'critical',
        message: `Approaching max drawdown limit: ${(currentConditions.currentDrawdown * 100).toFixed(1)}% of ${(currentConditions.maxAllowedDrawdown * 100).toFixed(1)}%`,
        currentValue: currentConditions.currentDrawdown,
        threshold: currentConditions.maxAllowedDrawdown,
      });
      maxSeverity = 'critical';
    }

    if (
      currentConditions.confidenceScore <
      strategy.minConfidenceThreshold
    ) {
      reasons.push({
        code: 'CONFIDENCE_DECAY' as RefusalReason,
        severity: 'warning',
        message: `Strategy confidence decayed below threshold: ${currentConditions.confidenceScore.toFixed(2)} vs ${strategy.minConfidenceThreshold.toFixed(2)}`,
        currentValue: currentConditions.confidenceScore,
        threshold: strategy.minConfidenceThreshold,
      });
      maxSeverity = 'warning';
    }

    if (currentConditions.newsEventImminent) {
      reasons.push({
        code: 'NEWS_BLACKOUT' as RefusalReason,
        severity: 'caution',
        message: 'Major economic event imminent (FOMC, earnings, etc.)',
        currentValue: 1,
        threshold: 0,
      });
    }

    if (currentConditions.systemHealth.latency > 100) {
      reasons.push({
        code: 'SYSTEM_HEALTH' as RefusalReason,
        severity: 'warning',
        message: `High order router latency: ${currentConditions.systemHealth.latency}ms`,
        currentValue: currentConditions.systemHealth.latency,
        threshold: 100,
      });
      maxSeverity = 'warning';
    }

    const refuse = reasons.length > 0;
    const suggestedMode = this.suggestModeForConditions(
      refuse,
      maxSeverity,
      reasons.length
    );
    const autoResumeConditions = this.generateResumeConditions(reasons);
    const estimatedResumption = refuse
      ? this.estimateResumption(reasons)
      : null;

    return {
      refuse,
      reasons,
      severity: maxSeverity,
      suggestedMode,
      autoResumeConditions,
      estimatedResumption,
    };
  }

  private suggestModeForConditions(
    refuse: boolean,
    severity: 'critical' | 'warning' | 'caution',
    reasonCount: number
  ): StrategyMode {
    if (!refuse) return 'AGGRESSIVE';

    if (severity === 'critical') return 'PAUSED';
    if (severity === 'warning' && reasonCount > 2) return 'DEFENSIVE';
    if (severity === 'warning') return 'NORMAL';
    return 'CAUTIOUS';
  }

  private generateResumeConditions(
    reasons: Array<{
      code: RefusalReason;
      severity: string;
      message: string;
    }>
  ): string[] {
    const conditions: string[] = [];

    for (const reason of reasons) {
      switch (reason.code) {
        case 'LOW_EDGE_REGIME':
          conditions.push('Wait for market regime to shift back to edge regime');
          break;
        case 'DRIFT_EXCEEDED':
          conditions.push(
            'Live performance must converge back to backtest expectations'
          );
          break;
        case 'CORRELATION_SPIKE':
          conditions.push('Portfolio correlation must drop below 0.7');
          break;
        case 'VOLATILITY_EXTREME':
          conditions.push('Market volatility must return to normal levels');
          break;
        case 'LIQUIDITY_DROUGHT':
          conditions.push('Market depth must improve significantly');
          break;
        case 'DATA_QUALITY':
          conditions.push('Data feed must fully recover');
          break;
        case 'DRAWDOWN_PROXIMITY':
          conditions.push('Recover partial losses to get below 80% of max drawdown');
          break;
        case 'CONFIDENCE_DECAY':
          conditions.push('Strategy confidence must recover');
          break;
        case 'NEWS_BLACKOUT':
          conditions.push('Economic event must pass');
          break;
        case 'SYSTEM_HEALTH':
          conditions.push('Latency must normalize');
          break;
      }
    }

    return [...new Set(conditions)];
  }

  private estimateResumption(
    reasons: Array<{
      code: RefusalReason;
      severity: string;
    }>
  ): number | null {
    const estimateMs = Date.now() + 60 * 60 * 1000;
    if (reasons.some((r) => r.code === 'DATA_QUALITY')) return null;
    if (reasons.some((r) => r.code === 'DRIFT_EXCEEDED')) return null;
    return estimateMs;
  }

  autoDowngrade(
    currentMode: StrategyMode,
    refusalHistory: Map<string, Date[]>
  ): StrategyMode {
    const modeHierarchy: StrategyMode[] = [
      'AGGRESSIVE',
      'NORMAL',
      'DEFENSIVE',
      'CAUTIOUS',
      'PAUSED',
    ];

    const currentIndex = modeHierarchy.indexOf(currentMode);
    if (currentIndex === -1 || currentIndex === modeHierarchy.length - 1) {
      return currentMode;
    }

    const timeWindow = 24 * 60 * 60 * 1000;
    const now = Date.now();

    let refusalCount = 0;
    for (const dates of refusalHistory.values()) {
      refusalCount += dates.filter((d) => now - d.getTime() < timeWindow)
        .length;
    }

    if (refusalCount > 3) {
      return modeHierarchy[currentIndex + 1];
    }

    return currentMode;
  }

  autoResume(
    pausedStrategy: {
      id: string;
      lastMode: StrategyMode;
    },
    currentConditions: CurrentConditions,
    strategyProfile: StrategyProfile
  ): StrategyMode {
    const decision = this.shouldRefuse(strategyProfile, currentConditions);

    if (decision.refuse) {
      return pausedStrategy.lastMode;
    }

    const modeHierarchy: StrategyMode[] = [
      'PAUSED',
      'CAUTIOUS',
      'DEFENSIVE',
      'NORMAL',
      'AGGRESSIVE',
    ];

    const lastIndex = modeHierarchy.indexOf(pausedStrategy.lastMode);
    if (lastIndex === -1) return 'NORMAL';

    const confidenceRecovery =
      currentConditions.confidenceScore > strategyProfile.minConfidenceThreshold
        ? 0.5
        : 0;
    const stabilityScore = 1 - decision.reasons.length * 0.1;

    if (stabilityScore > 0.7 && confidenceRecovery > 0) {
      return 'NORMAL';
    }

    if (stabilityScore > 0.5) {
      return 'DEFENSIVE';
    }

    return 'CAUTIOUS';
  }

  recordRefusal(strategyId: string): void {
    if (!this.refusalHistory.has(strategyId)) {
      this.refusalHistory.set(strategyId, []);
    }
    const dates = this.refusalHistory.get(strategyId)!;
    dates.push(new Date());

    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = dates.filter((d) => d.getTime() > cutoffTime);
    this.refusalHistory.set(strategyId, filtered);
  }

  getRefusalHistory(strategyId: string): Date[] {
    return this.refusalHistory.get(strategyId) || [];
  }

  clearRefusalHistory(strategyId: string): void {
    this.refusalHistory.delete(strategyId);
  }
}

export function createStrategyProfile(overrides?: Partial<StrategyProfile>): StrategyProfile {
  return {
    id: overrides?.id || 'strategy_1',
    name: overrides?.name || 'Default Strategy',
    edgeRegimes: overrides?.edgeRegimes || ['trending', 'mean_reverting'],
    expectedDriftTolerance: overrides?.expectedDriftTolerance || 0.25,
    volatilityRange: overrides?.volatilityRange || { min: 8, max: 40 },
    minLiquidityScore: overrides?.minLiquidityScore || 0.6,
    maxAcceptableLeverage: overrides?.maxAcceptableLeverage || 3,
    maxDrawdownLimit: overrides?.maxDrawdownLimit || 0.25,
    minConfidenceThreshold: overrides?.minConfidenceThreshold || 0.5,
  };
}

export function createCurrentConditions(overrides?: Partial<CurrentConditions>): CurrentConditions {
  return {
    regimeScore: overrides?.regimeScore || 0.85,
    isInEdgeRegime: overrides?.isInEdgeRegime !== undefined ? overrides.isInEdgeRegime : true,
    liveVsBacktestDrift: overrides?.liveVsBacktestDrift || 0.12,
    portfolioCorrelation: overrides?.portfolioCorrelation || 0.45,
    marketVolatility: overrides?.marketVolatility || 18,
    liquidityScore: overrides?.liquidityScore || 0.85,
    currentDrawdown: overrides?.currentDrawdown || 0.08,
    maxAllowedDrawdown: overrides?.maxAllowedDrawdown || 0.25,
    confidenceDecayRate: overrides?.confidenceDecayRate || 0.02,
    confidenceScore: overrides?.confidenceScore || 0.78,
    newsEventImminent: overrides?.newsEventImminent || false,
    systemHealth: overrides?.systemHealth || {
      latency: 45,
      memoryUsage: 62,
      cpuUsage: 35,
      dataFeedStatus: 'healthy',
    },
  };
}
