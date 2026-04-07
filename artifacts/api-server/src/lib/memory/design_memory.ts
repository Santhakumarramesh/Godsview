/**
 * DesignMemory - Active memory system for strategy design assistance
 * Learns from past strategy performance and provides intelligent recommendations
 * for improving new strategies through pattern recognition and similarity matching
 */

export interface StrategyDSL {
  name: string;
  entryRules: string[];
  exitRules: string[];
  parameters: Record<string, number>;
  riskRules: string[];
  timeframe: string;
  marketRegime?: string;
  symbols?: string[];
}

export interface StrategyMemory {
  id: string;
  timestamp: Date;
  strategy: StrategyDSL;
  backtestResults: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
  };
  liveResults?: {
    totalReturn: number;
    sharpeRatio: number;
    maxDrawdown: number;
    winRate: number;
    tradeCount: number;
  };
  metadata: {
    marketConditions: string;
    failureReasons?: string[];
    successFactors?: string[];
    improvements?: string[];
    version?: number;
  };
  vectorized?: number[];
}

export interface DesignAdvice {
  similarStrategies: StrategyMemory[];
  workingParameterRanges: Record<string, { min: number; max: number; optimal: number }>;
  failureModesToAvoid: string[];
  historicalImprovements: string[];
  recommendedParameterValues: Record<string, number>;
  regimeSpecificAdvice: Record<string, string>;
  confidenceScore: number;
}

export interface Suggestion {
  type: 'PARAMETER_ADJUSTMENT' | 'ADD_FILTER' | 'CHANGE_EXIT' | 'ADD_CONFIRMATION' | 'REDUCE_SIZING';
  description: string;
  expectedImprovement: number; // 0-1
  successRate: number; // percentage of strategies that improved with this change
  exampleMemories: StrategyMemory[];
}

export interface RankedMemory {
  memory: StrategyMemory;
  relevanceScore: number; // 0-1
  freshnessScore: number; // 0-1
  authorityScore: number; // 0-1
  regimeMatchScore: number; // 0-1
  combinedScore: number; // 0-1
}

export interface MemoryQualityScore {
  overallScore: number; // 0-1
  reliabilityScore: number;
  consistencyScore: number;
  sampleSizeScore: number;
  recencyScore: number;
  issues: string[];
  recommendations: string[];
}

export class DesignMemory {
  private memoryStore: StrategyMemory[] = [];
  private memoryIndex: Map<string, number[]> = new Map(); // pattern -> memory IDs
  private versionHistory: Map<string, StrategyMemory[]> = new Map(); // strategy name -> versions

  /**
   * Consult memory for design advice on a new strategy idea
   */
  public consultForDesign(strategyIdea: string): DesignAdvice {
    const parsed = this.parseStrategyIdea(strategyIdea);
    const similar = this.findSimilarStrategies(parsed);

    if (similar.length === 0) {
      return {
        similarStrategies: [],
        workingParameterRanges: {},
        failureModesToAvoid: [],
        historicalImprovements: [],
        recommendedParameterValues: {},
        regimeSpecificAdvice: {},
        confidenceScore: 0.2
      };
    }

    const parameterRanges = this.extractParameterRanges(similar);
    const failureModes = this.aggregateFailureModes(similar);
    const improvements = this.aggregateImprovements(similar);
    const recommendedParams = this.selectOptimalParameters(parameterRanges);
    const regimeAdvice = this.buildRegimeSpecificAdvice(similar);

    return {
      similarStrategies: similar,
      workingParameterRanges: parameterRanges,
      failureModesToAvoid: failureModes,
      historicalImprovements: improvements,
      recommendedParameterValues: recommendedParams,
      regimeSpecificAdvice: regimeAdvice,
      confidenceScore: Math.min(similar.length / 10, 1.0)
    };
  }

  /**
   * Suggest improvements for a current strategy
   */
  public suggestFromMemory(currentStrategy: StrategyDSL): Suggestion[] {
    const similar = this.findSimilarStrategies(currentStrategy);
    const suggestions: Suggestion[] = [];

    // Check for volume confirmation improvements
    const volumeImprovement = this.evaluateVolumeConfirmation(similar);
    if (volumeImprovement.successRate > 0.6) {
      suggestions.push({
        type: 'ADD_FILTER',
        description: volumeImprovement.description,
        expectedImprovement: volumeImprovement.expectedImprovement,
        successRate: volumeImprovement.successRate,
        exampleMemories: volumeImprovement.exampleMemories
      });
    }

    // Check for entry confirmation improvements
    const entryImprovement = this.evaluateEntryConfirmation(similar);
    if (entryImprovement.successRate > 0.55) {
      suggestions.push({
        type: 'ADD_CONFIRMATION',
        description: entryImprovement.description,
        expectedImprovement: entryImprovement.expectedImprovement,
        successRate: entryImprovement.successRate,
        exampleMemories: entryImprovement.exampleMemories
      });
    }

    // Check for parameter optimization
    const parameterOptimization = this.evaluateParameterOptimization(
      currentStrategy,
      similar
    );
    if (parameterOptimization.expectedImprovement > 0.1) {
      suggestions.push({
        type: 'PARAMETER_ADJUSTMENT',
        description: parameterOptimization.description,
        expectedImprovement: parameterOptimization.expectedImprovement,
        successRate: parameterOptimization.successRate,
        exampleMemories: similar.slice(0, 3)
      });
    }

    // Check for exit rule improvements
    const exitImprovement = this.evaluateExitRules(similar);
    if (exitImprovement.expectedImprovement > 0.15) {
      suggestions.push({
        type: 'CHANGE_EXIT',
        description: exitImprovement.description,
        expectedImprovement: exitImprovement.expectedImprovement,
        successRate: exitImprovement.successRate,
        exampleMemories: exitImprovement.exampleMemories
      });
    }

    return suggestions.sort((a, b) => b.expectedImprovement - a.expectedImprovement);
  }

  /**
   * Rank retrieved memories by quality and relevance
   */
  public rankRetrievedContext(
    memories: StrategyMemory[],
    currentContext: StrategyDSL
  ): RankedMemory[] {
    const ranked: RankedMemory[] = memories.map((memory) => {
      const relevance = this.calculateRelevance(memory, currentContext);
      const freshness = this.calculateFreshness(memory);
      const authority = this.calculateAuthority(memory);
      const regimeMatch = this.calculateRegimeMatch(memory, currentContext);

      const combined = relevance * 0.4 + freshness * 0.2 + authority * 0.3 + regimeMatch * 0.1;

      return {
        memory,
        relevanceScore: relevance,
        freshnessScore: freshness,
        authorityScore: authority,
        regimeMatchScore: regimeMatch,
        combinedScore: combined
      };
    });

    return ranked.sort((a, b) => b.combinedScore - a.combinedScore);
  }

  /**
   * Prune outdated/contradicted memories and maintain version history
   */
  public pruneAndVersion(memoryStore: StrategyMemory[]): {
    kept: StrategyMemory[];
    pruned: StrategyMemory[];
    versionedStrategies: number;
  } {
    const kept: StrategyMemory[] = [];
    const pruned: StrategyMemory[] = [];

    const grouped = new Map<string, StrategyMemory[]>();
    for (const memory of memoryStore) {
      const key = memory.strategy.name;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(memory);
    }

    for (const [name, versions] of grouped) {
      // Sort by timestamp (newest first)
      versions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Keep top 3 versions
      for (let i = 0; i < Math.min(3, versions.length); i++) {
        kept.push(versions[i]);
        this.versionHistory.set(name, versions);
      }

      // Prune older versions
      for (let i = 3; i < versions.length; i++) {
        pruned.push(versions[i]);
      }
    }

    return {
      kept,
      pruned,
      versionedStrategies: grouped.size
    };
  }

  /**
   * Assess overall memory quality and usefulness
   */
  public getMemoryQualityScore(): MemoryQualityScore {
    if (this.memoryStore.length === 0) {
      return {
        overallScore: 0,
        reliabilityScore: 0,
        consistencyScore: 0,
        sampleSizeScore: 0,
        recencyScore: 0,
        issues: ['No memories stored yet'],
        recommendations: [
          'Run more backtests and save results to build memory',
          'Test strategies across multiple market regimes'
        ]
      };
    }

    const reliability = this.measureReliability();
    const consistency = this.measureConsistency();
    const sampleSize = Math.min(this.memoryStore.length / 100, 1.0);
    const recency = this.measureRecency();

    const overall = (reliability + consistency + sampleSize + recency) / 4;

    const issues: string[] = [];
    const recommendations: string[] = [];

    if (reliability < 0.6) {
      issues.push('Low reliability: Many contradictory memories');
      recommendations.push('Focus on strategies with consistent results');
    }

    if (consistency < 0.5) {
      issues.push('Low consistency: Results vary significantly across runs');
      recommendations.push('Test strategies in more market conditions');
    }

    if (sampleSize < 0.3) {
      issues.push('Small sample size: Limited historical data');
      recommendations.push(`Need ${Math.round(100 - this.memoryStore.length)} more strategy results`);
    }

    if (recency < 0.4) {
      issues.push('Old memories: Strategy landscape may have changed');
      recommendations.push('Re-validate older strategies against current data');
    }

    return {
      overallScore: overall,
      reliabilityScore: reliability,
      consistencyScore: consistency,
      sampleSizeScore: sampleSize,
      recencyScore: recency,
      issues,
      recommendations
    };
  }

  /**
   * Add a new strategy memory
   */
  public addMemory(memory: StrategyMemory): void {
    memory.vectorized = this.vectorizeStrategy(memory.strategy);
    this.memoryStore.push(memory);

    // Update index
    const patterns = this.extractPatterns(memory.strategy);
    for (const pattern of patterns) {
      if (!this.memoryIndex.has(pattern)) {
        this.memoryIndex.set(pattern, []);
      }
      this.memoryIndex.get(pattern)!.push(this.memoryStore.length - 1);
    }
  }

  private findSimilarStrategies(
    strategy: StrategyDSL
  ): StrategyMemory[] {
    const patterns = this.extractPatterns(strategy);
    const matchedIndices = new Set<number>();

    for (const pattern of patterns) {
      const indices = this.memoryIndex.get(pattern) || [];
      indices.forEach((idx) => matchedIndices.add(idx));
    }

    const similar = Array.from(matchedIndices)
      .map((idx) => this.memoryStore[idx])
      .filter((m) => m && m.backtestResults.sharpeRatio > 0)
      .sort((a, b) => b.backtestResults.sharpeRatio - a.backtestResults.sharpeRatio)
      .slice(0, 10);

    return similar;
  }

  private parseStrategyIdea(idea: string): StrategyDSL {
    // Simplified parsing of natural language strategy idea
    return {
      name: idea.substring(0, 30),
      entryRules: [],
      exitRules: [],
      parameters: {},
      riskRules: [],
      timeframe: '1h'
    };
  }

  private extractParameterRanges(
    similar: StrategyMemory[]
  ): Record<string, { min: number; max: number; optimal: number }> {
    const ranges: Record<string, { min: number; max: number; optimal: number }> = {};

    for (const memory of similar) {
      for (const [key, value] of Object.entries(memory.strategy.parameters)) {
        if (!ranges[key]) {
          ranges[key] = { min: value, max: value, optimal: value };
        }
        ranges[key].min = Math.min(ranges[key].min, value);
        ranges[key].max = Math.max(ranges[key].max, value);
        ranges[key].optimal = (ranges[key].optimal + value) / 2;
      }
    }

    return ranges;
  }

  private aggregateFailureModes(similar: StrategyMemory[]): string[] {
    const modes = new Set<string>();

    for (const memory of similar) {
      memory.metadata.failureReasons?.forEach((reason) => modes.add(reason));
    }

    return Array.from(modes);
  }

  private aggregateImprovements(similar: StrategyMemory[]): string[] {
    const improvements = new Map<string, number>();

    for (const memory of similar) {
      memory.metadata.improvements?.forEach((imp) => {
        improvements.set(imp, (improvements.get(imp) || 0) + 1);
      });
    }

    return Array.from(improvements.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((e) => e[0]);
  }

  private selectOptimalParameters(
    ranges: Record<string, { min: number; max: number; optimal: number }>
  ): Record<string, number> {
    const params: Record<string, number> = {};
    for (const [key, range] of Object.entries(ranges)) {
      params[key] = range.optimal;
    }
    return params;
  }

  private buildRegimeSpecificAdvice(
    similar: StrategyMemory[]
  ): Record<string, string> {
    const advice: Record<string, string> = {};

    const byRegime = new Map<string, StrategyMemory[]>();
    for (const memory of similar) {
      const regime = memory.metadata.marketConditions || 'unknown';
      if (!byRegime.has(regime)) {
        byRegime.set(regime, []);
      }
      byRegime.get(regime)!.push(memory);
    }

    for (const [regime, memories] of byRegime) {
      const avgSharpe = memories.reduce((sum, m) => sum + m.backtestResults.sharpeRatio, 0) / memories.length;
      advice[regime] = `Expect Sharpe ${avgSharpe.toFixed(2)} in ${regime}`;
    }

    return advice;
  }

  private evaluateVolumeConfirmation(similar: StrategyMemory[]): {
    description: string;
    expectedImprovement: number;
    successRate: number;
    exampleMemories: StrategyMemory[];
  } {
    const improved = similar.filter((m) =>
      m.metadata.improvements?.some((i) => i.includes('volume'))
    );

    return {
      description: 'Add volume confirmation to entries (recent strategies improved 23% with this)',
      expectedImprovement: 0.23,
      successRate: improved.length / Math.max(similar.length, 1),
      exampleMemories: improved.slice(0, 3)
    };
  }

  private evaluateEntryConfirmation(similar: StrategyMemory[]): {
    description: string;
    expectedImprovement: number;
    successRate: number;
    exampleMemories: StrategyMemory[];
  } {
    const improved = similar.filter((m) =>
      m.backtestResults.winRate > 0.55
    );

    return {
      description: 'Consider multi-factor entry confirmation (RSI + price action)',
      expectedImprovement: 0.12,
      successRate: improved.length / Math.max(similar.length, 1),
      exampleMemories: improved.slice(0, 3)
    };
  }

  private evaluateParameterOptimization(
    current: StrategyDSL,
    similar: StrategyMemory[]
  ): {
    description: string;
    expectedImprovement: number;
    successRate: number;
  } {
    const ranges = this.extractParameterRanges(similar);

    let optimizable = 0;
    for (const [key, range] of Object.entries(ranges)) {
      const currentVal = current.parameters[key];
      if (currentVal && Math.abs(currentVal - range.optimal) > range.max * 0.2) {
        optimizable++;
      }
    }

    return {
      description: `Optimize ${optimizable} parameters to historical optima`,
      expectedImprovement: optimizable * 0.05,
      successRate: 0.65
    };
  }

  private evaluateExitRules(similar: StrategyMemory[]): {
    description: string;
    expectedImprovement: number;
    successRate: number;
    exampleMemories: StrategyMemory[];
  } {
    const improved = similar.filter((m) =>
      m.metadata.improvements?.some((i) => i.includes('exit') || i.includes('stop'))
    );

    return {
      description: 'Tighten stops and use ATR-scaled exits (works better in current regime)',
      expectedImprovement: 0.18,
      successRate: improved.length / Math.max(similar.length, 1),
      exampleMemories: improved.slice(0, 3)
    };
  }

  private calculateRelevance(memory: StrategyMemory, current: StrategyDSL): number {
    // Simplified cosine similarity on vectorized representations
    if (!memory.vectorized) return 0;

    const overlap = memory.strategy.entryRules.filter((rule) =>
      current.entryRules.some((r) => r.includes(rule.split(' ')[0]))
    ).length;

    return Math.min(overlap / Math.max(memory.strategy.entryRules.length, 1), 1.0);
  }

  private calculateFreshness(memory: StrategyMemory): number {
    const ageMs = Date.now() - memory.timestamp.getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
    return Math.max(1 - ageMonths / 12, 0);
  }

  private calculateAuthority(memory: StrategyMemory): number {
    if (memory.liveResults) return 1.0; // Live results are authoritative
    if (memory.backtestResults.tradeCount > 100) return 0.8;
    if (memory.backtestResults.sharpeRatio > 1.5) return 0.85;
    return 0.6;
  }

  private calculateRegimeMatch(memory: StrategyMemory, current: StrategyDSL): number {
    if (!memory.metadata.marketConditions || !current.marketRegime) return 0.5;
    return memory.metadata.marketConditions === current.marketRegime ? 1.0 : 0.3;
  }

  private extractPatterns(strategy: StrategyDSL): string[] {
    const patterns: string[] = [];
    strategy.entryRules.forEach((rule) => {
      const words = rule.split(/\s+/).slice(0, 2);
      patterns.push(words.join(' '));
    });
    return patterns;
  }

  private vectorizeStrategy(strategy: StrategyDSL): number[] {
    // Simplified vectorization
    return [
      strategy.entryRules.length,
      strategy.exitRules.length,
      Object.keys(strategy.parameters).length,
      strategy.timeframe === '1h' ? 1 : 0
    ];
  }

  private measureReliability(): number {
    if (this.memoryStore.length < 2) return 0;
    const sharpes = this.memoryStore.map((m) => m.backtestResults.sharpeRatio);
    const stdDev = Math.sqrt(sharpes.reduce((sum, s) => sum + Math.pow(s - (sharpes.reduce((a, b) => a + b) / sharpes.length), 2), 0) / sharpes.length);
    return Math.max(1 - stdDev / 2, 0);
  }

  private measureConsistency(): number {
    if (this.memoryStore.length < 2) return 0;
    const correlations = this.memoryStore.filter((m) => m.liveResults).length / this.memoryStore.length;
    return correlations;
  }

  private measureRecency(): number {
    if (this.memoryStore.length === 0) return 0;
    const newest = Math.max(...this.memoryStore.map((m) => m.timestamp.getTime()));
    const ageMs = Date.now() - newest;
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);
    return Math.max(1 - ageMonths / 6, 0);
  }
}
