/**
 * RetrievalQuality - Ensure memory retrieval is actually useful and actionable
 * Assesses quality of retrieved memories, applies quality filters, and tracks
 * retrieval effectiveness over time
 */

export interface Memory {
  id: string;
  content: string;
  timestamp: Date;
  source: 'live' | 'backtest' | 'validated' | 'unvalidated';
  reliability: number; // 0-1
  regime?: string;
  metadata?: Record<string, any>;
}

export interface RetrievalQuery {
  text: string;
  regime?: string;
  context?: string;
}

export interface QualityScore {
  relevanceScore: number; // 0-1
  freshnessScore: number; // 0-1
  authorityScore: number; // 0-1
  regimeMatchScore: number; // 0-1
  consistencyScore: number; // 0-1
  overallQuality: number; // 0-1
  trustLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  issues: string[];
}

export interface RankedMemory {
  memory: Memory;
  quality: QualityScore;
  rank: number;
}

export interface RetrievalOutcome {
  query: RetrievalQuery;
  retrievedMemory: Memory;
  actualOutcome: boolean; // was it helpful?
  confidence: number; // how confident was the system?
  improvement: number; // measured improvement from following the memory
  timestamp: Date;
}

export interface RetrievalStatistics {
  totalRetrievals: number;
  helpfulRetrievals: number;
  harmfulRetrievals: number;
  neutralRetrievals: number;
  precision: number; // helpful / total
  recall: number; // estimated coverage of useful memories
  avgConfidence: number;
  avgImprovement: number;
  trendingUp: boolean;
  memoriesWithHighFalsePositiveRate: string[];
}

export class RetrievalQuality {
  private retrievalOutcomeHistory: RetrievalOutcome[] = [];
  private memoryScoreCache: Map<string, QualityScore> = new Map();

  /**
   * Assess quality of retrieved memories
   */
  public assessRetrieval(
    query: RetrievalQuery,
    retrievedMemories: Memory[]
  ): QualityScore[] {
    const scores: QualityScore[] = [];

    for (const memory of retrievedMemories) {
      const cached = this.memoryScoreCache.get(memory.id);
      if (cached) {
        scores.push(cached);
        continue;
      }

      const relevance = this.calculateRelevance(query, memory);
      const freshness = this.calculateFreshness(memory);
      const authority = this.calculateAuthority(memory);
      const regimeMatch = this.calculateRegimeMatch(query, memory);
      const consistency = this.calculateConsistency(memory);

      const overall = this.calculateOverallQuality(
        relevance,
        freshness,
        authority,
        regimeMatch,
        consistency
      );

      const trustLevel = this.determineTrustLevel(overall);
      const issues = this.identifyIssues(
        relevance,
        freshness,
        authority,
        regimeMatch,
        consistency
      );

      const score: QualityScore = {
        relevanceScore: relevance,
        freshnessScore: freshness,
        authorityScore: authority,
        regimeMatchScore: regimeMatch,
        consistencyScore: consistency,
        overallQuality: overall,
        trustLevel,
        issues
      };

      this.memoryScoreCache.set(memory.id, score);
      scores.push(score);
    }

    return scores;
  }

  /**
   * Re-rank memories by combined quality score
   */
  public rerank(
    memories: Memory[],
    context: RetrievalQuery
  ): RankedMemory[] {
    const scores = this.assessRetrieval(context, memories);

    const ranked: RankedMemory[] = memories.map((memory, index) => ({
      memory,
      quality: scores[index],
      rank: 0
    }));

    ranked.sort((a, b) => b.quality.overallQuality - a.quality.overallQuality);

    // Assign ranks
    for (let i = 0; i < ranked.length; i++) {
      ranked[i].rank = i + 1;
    }

    return ranked;
  }

  /**
   * Filter out low-quality memories
   */
  public filterLowQuality(
    memories: Memory[],
    threshold: number = 0.5
  ): Memory[] {
    const fakeQuery: RetrievalQuery = { text: '', context: '' };
    const scores = this.assessRetrieval(fakeQuery, memories);

    return memories.filter((memory, index) => {
      return scores[index].overallQuality >= threshold;
    });
  }

  /**
   * Explain why a memory was retrieved and confidence
   */
  public explainRetrieval(
    memory: Memory,
    query: RetrievalQuery
  ): {
    retrievalReason: string;
    confidence: number;
    quality: QualityScore;
    warnings: string[];
  } {
    const score = this.memoryScoreCache.get(memory.id);
    if (!score) {
      return {
        retrievalReason: 'Unknown',
        confidence: 0.3,
        quality: {
          relevanceScore: 0,
          freshnessScore: 0,
          authorityScore: 0,
          regimeMatchScore: 0,
          consistencyScore: 0,
          overallQuality: 0,
          trustLevel: 'LOW',
          issues: ['Not assessed']
        },
        warnings: []
      };
    }

    const reasons: string[] = [];

    if (score.relevanceScore > 0.7) {
      reasons.push(
        `Highly relevant to your query (${(score.relevanceScore * 100).toFixed(0)}% match)`
      );
    }

    if (score.authorityScore > 0.8) {
      reasons.push('From validated live execution data');
    } else if (score.authorityScore > 0.6) {
      reasons.push('Based on backtest results with good sample size');
    }

    if (score.regimeMatchScore > 0.8) {
      reasons.push(`Applies to current market regime: ${query.regime}`);
    }

    if (score.freshnessScore > 0.8) {
      reasons.push('Recent and still relevant');
    }

    const warnings: string[] = [];

    if (score.freshnessScore < 0.4) {
      warnings.push('This memory is based on older market data');
    }

    if (score.consistencyScore < 0.6) {
      warnings.push('Results from this memory vary depending on conditions');
    }

    if (score.authorityScore < 0.5) {
      warnings.push('Based on limited or unvalidated data');
    }

    return {
      retrievalReason: reasons.length > 0 ? reasons.join('. ') : 'Matching pattern found',
      confidence: score.overallQuality,
      quality: score,
      warnings
    };
  }

  /**
   * Track whether retrieved memory was helpful in practice
   */
  public trackRetrievalOutcome(
    query: RetrievalQuery,
    retrievedMemory: Memory,
    actualOutcome: boolean,
    confidence: number,
    improvement: number = 0
  ): void {
    const outcome: RetrievalOutcome = {
      query,
      retrievedMemory,
      actualOutcome,
      confidence,
      improvement,
      timestamp: new Date()
    };

    this.retrievalOutcomeHistory.push(outcome);

    // Update authority score based on outcome
    if (actualOutcome && improvement > 0.1) {
      // Boost authority of helpful memories
      const currentScore = this.memoryScoreCache.get(retrievedMemory.id);
      if (currentScore) {
        currentScore.authorityScore = Math.min(currentScore.authorityScore + 0.05, 1.0);
      }
    } else if (!actualOutcome) {
      // Reduce authority of unhelpful memories
      const currentScore = this.memoryScoreCache.get(retrievedMemory.id);
      if (currentScore) {
        currentScore.authorityScore = Math.max(currentScore.authorityScore - 0.1, 0);
      }
    }
  }

  /**
   * Get retrieval statistics and performance metrics
   */
  public getRetrievalStats(): RetrievalStatistics {
    if (this.retrievalOutcomeHistory.length === 0) {
      return {
        totalRetrievals: 0,
        helpfulRetrievals: 0,
        harmfulRetrievals: 0,
        neutralRetrievals: 0,
        precision: 0,
        recall: 0,
        avgConfidence: 0,
        avgImprovement: 0,
        trendingUp: false,
        memoriesWithHighFalsePositiveRate: []
      };
    }

    const helpful = this.retrievalOutcomeHistory.filter((o) => o.actualOutcome && o.improvement > 0.05);
    const harmful = this.retrievalOutcomeHistory.filter((o) => !o.actualOutcome && o.improvement < 0);
    const neutral = this.retrievalOutcomeHistory.filter(
      (o) => (!o.actualOutcome && o.improvement >= 0) || (o.actualOutcome && o.improvement <= 0.05)
    );

    const totalRetrievals = this.retrievalOutcomeHistory.length;
    const precision = helpful.length / totalRetrievals;
    const avgConfidence = this.retrievalOutcomeHistory.reduce((sum, o) => sum + o.confidence, 0) / totalRetrievals;
    const avgImprovement = this.retrievalOutcomeHistory.reduce((sum, o) => sum + o.improvement, 0) / totalRetrievals;

    // Calculate trend (are recent retrievals more helpful?)
    const recentOutcomes = this.retrievalOutcomeHistory.slice(-20);
    const recentPrecision = recentOutcomes.filter((o) => o.actualOutcome).length / Math.max(recentOutcomes.length, 1);
    const olderOutcomes = this.retrievalOutcomeHistory.slice(0, -20);
    const olderPrecision = olderOutcomes.length > 0
      ? olderOutcomes.filter((o) => o.actualOutcome).length / olderOutcomes.length
      : 0.5;

    const trendingUp = recentPrecision > olderPrecision;

    // Identify problematic memories
    const memorySuccessRate = new Map<string, { success: number; total: number }>();
    for (const outcome of this.retrievalOutcomeHistory) {
      const id = outcome.retrievedMemory.id;
      const current = memorySuccessRate.get(id) || { success: 0, total: 0 };
      current.total++;
      if (outcome.actualOutcome) current.success++;
      memorySuccessRate.set(id, current);
    }

    const problematic = Array.from(memorySuccessRate.entries())
      .filter(([, stats]) => stats.total > 5 && stats.success / stats.total < 0.4)
      .map(([id]) => id);

    return {
      totalRetrievals,
      helpfulRetrievals: helpful.length,
      harmfulRetrievals: harmful.length,
      neutralRetrievals: neutral.length,
      precision,
      recall: Math.min(helpful.length / Math.max(totalRetrievals * 0.8, 1), 1.0), // estimated
      avgConfidence,
      avgImprovement,
      trendingUp,
      memoriesWithHighFalsePositiveRate: problematic
    };
  }

  /**
   * Calculate relevance between query and memory
   */
  private calculateRelevance(query: RetrievalQuery, memory: Memory): number {
    // Simplified cosine similarity between query text and memory content
    const queryWords = new Set(query.text.toLowerCase().split(/\s+/));
    const memoryWords = new Set(memory.content.toLowerCase().split(/\s+/));

    const intersection = Array.from(queryWords).filter((w) => memoryWords.has(w));
    const union = new Set([...queryWords, ...memoryWords]);

    return intersection.length / Math.max(union.size, 1);
  }

  /**
   * Calculate freshness score (time-weighted relevance)
   */
  private calculateFreshness(memory: Memory): number {
    const ageMs = Date.now() - memory.timestamp.getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);

    // Exponential decay: half-life of 3 months
    return Math.exp(-Math.log(2) * (ageMonths / 3));
  }

  /**
   * Calculate authority score (source reliability)
   */
  private calculateAuthority(memory: Memory): number {
    const sourceScores = {
      live: 1.0,
      validated: 0.85,
      backtest: 0.7,
      unvalidated: 0.4
    };

    const baseScore = sourceScores[memory.source] || 0.5;
    const reliabilityBonus = memory.reliability * 0.2;

    return Math.min(baseScore + reliabilityBonus, 1.0);
  }

  /**
   * Calculate regime match score
   */
  private calculateRegimeMatch(query: RetrievalQuery, memory: Memory): number {
    if (!query.regime || !memory.regime) {
      return 0.5; // neutral if regime not specified
    }

    if (query.regime === memory.regime) {
      return 1.0;
    }

    // Related regimes score higher than unrelated
    const relatedRegimes = new Map<string, string[]>([
      ['BULL_TREND', ['RECOVERY', 'HIGH_VOL']],
      ['BEAR_TREND', ['CRASH', 'HIGH_VOL']],
      ['SIDEWAYS', ['LOW_VOL', 'SQUEEZE']],
      ['HIGH_VOL', ['BULL_TREND', 'BEAR_TREND']],
      ['LOW_VOL', ['SIDEWAYS', 'SQUEEZE']],
      ['CRASH', ['BEAR_TREND']],
      ['RECOVERY', ['BULL_TREND']],
      ['SQUEEZE', ['SIDEWAYS', 'LOW_VOL']]
    ]);

    const relatedToQuery = relatedRegimes.get(query.regime) || [];
    if (relatedToQuery.includes(memory.regime)) {
      return 0.7;
    }

    return 0.2;
  }

  /**
   * Calculate consistency score (do results agree?)
   */
  private calculateConsistency(memory: Memory): number {
    // Simplified: based on how often this memory has been helpful
    const outcomes = this.retrievalOutcomeHistory.filter(
      (o) => o.retrievedMemory.id === memory.id
    );

    if (outcomes.length < 3) {
      return 0.5; // insufficient data
    }

    const helpfulCount = outcomes.filter((o) => o.actualOutcome).length;
    const consistency = helpfulCount / outcomes.length;

    return consistency;
  }

  /**
   * Calculate overall quality score
   */
  private calculateOverallQuality(
    relevance: number,
    freshness: number,
    authority: number,
    regimeMatch: number,
    consistency: number
  ): number {
    return (
      relevance * 0.35 +
      authority * 0.3 +
      freshness * 0.15 +
      regimeMatch * 0.12 +
      consistency * 0.08
    );
  }

  /**
   * Determine trust level based on quality score
   */
  private determineTrustLevel(
    qualityScore: number
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (qualityScore >= 0.75) return 'HIGH';
    if (qualityScore >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Identify issues with retrieved memory
   */
  private identifyIssues(
    relevance: number,
    freshness: number,
    authority: number,
    regimeMatch: number,
    consistency: number
  ): string[] {
    const issues: string[] = [];

    if (relevance < 0.5) {
      issues.push('Low relevance to your query');
    }

    if (freshness < 0.4) {
      issues.push('Based on old market data (>3 months)');
    }

    if (authority < 0.5) {
      issues.push('Low authority (unvalidated source)');
    }

    if (regimeMatch < 0.5) {
      issues.push('May not apply to current market regime');
    }

    if (consistency < 0.5) {
      issues.push('Results are inconsistent or unreliable');
    }

    return issues;
  }
}
