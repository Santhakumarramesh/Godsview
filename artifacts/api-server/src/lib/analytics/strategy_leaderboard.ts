import { EventEmitter } from 'events';

/**
 * Configuration for the strategy leaderboard
 */
export interface LeaderboardConfig {
  rankingMetric?: 'sharpe' | 'sortino' | 'calmar' | 'expectancy' | 'profit_factor';
  minTrades?: number;
  updateIntervalMs?: number;
}

/**
 * Represents a strategy's performance record
 */
export interface StrategyRecord {
  strategyId: string;
  name: string;
  tier: 'SEED' | 'LEARNING' | 'PROVEN' | 'ELITE' | 'DEGRADING' | 'SUSPENDED';
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalPnl: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  profitFactor: number;
  expectancy: number;
  avgHoldTimeMs: number;
  recentPerformance: {
    period: string;
    pnl: number;
    trades: number;
    winRate: number;
  }[];
  bestRegime: string;
  worstRegime: string;
  rank: number;
  rankChange: number;
  score: number;
  lastTradeAt: string;
  createdAt: string;
}

/**
 * Snapshot of the current leaderboard state
 */
export interface LeaderboardSnapshot {
  rankings: StrategyRecord[];
  totalStrategies: number;
  activeStrategies: number;
  topPerformer: StrategyRecord;
  worstPerformer: StrategyRecord;
  avgSharpe: number;
  avgWinRate: number;
  lastUpdated: string;
}

/**
 * Comparison result between multiple strategies
 */
export interface StrategyComparison {
  strategies: StrategyRecord[];
  metrics: string[];
  matrix: Record<string, Record<string, number>>;
  winner: string;
  reasoning: string;
}

/**
 * Historical rank record for a strategy
 */
interface RankHistoryEntry {
  timestamp: string;
  rank: number;
  score: number;
}

/**
 * Main leaderboard class for ranking and comparing trading strategies
 */
export class StrategyLeaderboard extends EventEmitter {
  private config: Required<LeaderboardConfig>;
  private strategies: Map<string, StrategyRecord> = new Map();
  private rankHistory: Map<string, RankHistoryEntry[]> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(config: LeaderboardConfig = {}) {
    super();
    this.config = {
      rankingMetric: config.rankingMetric || 'sharpe',
      minTrades: config.minTrades || 20,
      updateIntervalMs: config.updateIntervalMs || 300000,
    };

    this.initializeMockStrategies();
  }

  /**
   * Initialize strategies — no mock data, real strategies are added via updateStrategy()
   */
  private initializeMockStrategies(): void {
    // No mock strategies — real strategies are registered via updateStrategy() from backtest results
  }

  /**
   * Update a strategy's statistics
   */
  public updateStrategy(id: string, stats: Partial<StrategyRecord>): void {
    const existing = this.strategies.get(id);
    if (!existing) {
      throw new Error(`Strategy ${id} not found`);
    }

    const updated = { ...existing, ...stats, strategyId: existing.strategyId };
    this.strategies.set(id, updated);
    this.updateRankings();
  }

  /**
   * Get current rankings
   */
  public getRankings(metric?: string, limit?: number): StrategyRecord[] {
    const metricToUse = metric || this.config.rankingMetric;
    const rankings = Array.from(this.strategies.values())
      .filter(s => s.totalTrades >= this.config.minTrades)
      .sort((a, b) => this.compareByMetric(b, a, metricToUse));

    if (limit) {
      return rankings.slice(0, limit);
    }
    return rankings;
  }

  /**
   * Get current leaderboard snapshot
   */
  public getSnapshot(): LeaderboardSnapshot {
    const rankings = this.getRankings();
    const activeStrategies = rankings.filter(s => s.tier !== 'SUSPENDED').length;
    const topPerformer = rankings[0];
    const worstPerformer = rankings[rankings.length - 1];

    const avgSharpe = rankings.length > 0
      ? rankings.reduce((sum, s) => sum + s.sharpe, 0) / rankings.length
      : 0;

    const avgWinRate = rankings.length > 0
      ? rankings.reduce((sum, s) => sum + s.winRate, 0) / rankings.length
      : 0;

    return {
      rankings,
      totalStrategies: this.strategies.size,
      activeStrategies,
      topPerformer,
      worstPerformer,
      avgSharpe,
      avgWinRate,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Compare multiple strategies
   */
  public compareStrategies(ids: string[]): StrategyComparison {
    const strategies = ids.map(id => {
      const strategy = this.strategies.get(id);
      if (!strategy) {
        throw new Error(`Strategy ${id} not found`);
      }
      return strategy;
    });

    const metrics = ['sharpe', 'sortino', 'calmar', 'winRate', 'profitFactor', 'expectancy'];
    const matrix: Record<string, Record<string, number>> = {};

    strategies.forEach(s => {
      matrix[s.strategyId] = {
        sharpe: s.sharpe,
        sortino: s.sortino,
        calmar: s.calmar,
        winRate: s.winRate,
        profitFactor: s.profitFactor,
        expectancy: s.expectancy,
      };
    });

    const winner = strategies.reduce((best, current) => {
      return this.computeCompositeScore(current) > this.computeCompositeScore(best) ? current : best;
    });

    const reasoning = this.generateComparisonReasoning(winner, strategies);

    return {
      strategies,
      metrics,
      matrix,
      winner: winner.strategyId,
      reasoning,
    };
  }

  /**
   * Promote a strategy to the next tier
   */
  public promoteStrategy(id: string): void {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`Strategy ${id} not found`);
    }

    const tierProgression: Record<string, string> = {
      SEED: 'LEARNING',
      LEARNING: 'PROVEN',
      PROVEN: 'ELITE',
      ELITE: 'ELITE',
      DEGRADING: 'SEED',
      SUSPENDED: 'SEED',
    };

    const newTier = tierProgression[strategy.tier] as StrategyRecord['tier'];
    strategy.tier = newTier;
    this.strategies.set(id, strategy);

    this.emit('tier:promoted', { strategyId: id, newTier, previousTier: strategy.tier });
  }

  /**
   * Demote a strategy to a lower tier
   */
  public demoteStrategy(id: string): void {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`Strategy ${id} not found`);
    }

    const tierDemotion: Record<string, string> = {
      ELITE: 'PROVEN',
      PROVEN: 'LEARNING',
      LEARNING: 'SEED',
      SEED: 'DEGRADING',
      DEGRADING: 'SUSPENDED',
      SUSPENDED: 'SUSPENDED',
    };

    const newTier = tierDemotion[strategy.tier] as StrategyRecord['tier'];
    strategy.tier = newTier;
    this.strategies.set(id, strategy);

    this.emit('tier:demoted', { strategyId: id, newTier, previousTier: strategy.tier });
  }

  /**
   * Get historical rank data for a strategy
   */
  public getStrategyHistory(id: string): RankHistoryEntry[] {
    const history = this.rankHistory.get(id);
    if (!history) {
      throw new Error(`Strategy ${id} not found`);
    }
    return [...history];
  }

  /**
   * Get distribution of strategies across tiers
   */
  public getTierDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {
      SEED: 0,
      LEARNING: 0,
      PROVEN: 0,
      ELITE: 0,
      DEGRADING: 0,
      SUSPENDED: 0,
    };

    this.strategies.forEach(strategy => {
      distribution[strategy.tier]++;
    });

    return distribution;
  }

  /**
   * Update rankings based on composite score
   */
  private updateRankings(): void {
    const rankings = this.getRankings();
    const previousRanks = new Map(Array.from(this.strategies.entries()).map(([id, s]) => [id, s.rank]));

    rankings.forEach((strategy, index) => {
      strategy.rank = index + 1;
      strategy.rankChange = (previousRanks.get(strategy.strategyId) || index + 1) - (index + 1);
      strategy.score = this.computeCompositeScore(strategy);

      this.strategies.set(strategy.strategyId, strategy);

      const history = this.rankHistory.get(strategy.strategyId) || [];
      history.push({
        timestamp: new Date().toISOString(),
        rank: strategy.rank,
        score: strategy.score,
      });
      this.rankHistory.set(strategy.strategyId, history);
    });

    this.emit('ranking:updated', { timestamp: new Date().toISOString(), totalStrategies: this.strategies.size });
  }

  /**
   * Compute composite score using weighted metrics
   */
  private computeCompositeScore(strategy: StrategyRecord): number {
    const weights = {
      sharpe: 0.30,
      sortino: 0.20,
      profitFactor: 0.20,
      winRate: 0.15,
      expectancy: 0.15,
    };

    // Normalize metrics to 0-100 scale for comparison
    const normalizedSharpe = Math.min(strategy.sharpe / 2.5, 1) * 100;
    const normalizedSortino = Math.min(strategy.sortino / 3.0, 1) * 100;
    const normalizedProfitFactor = Math.min(strategy.profitFactor / 3.0, 1) * 100;
    const normalizedWinRate = strategy.winRate * 100;
    const normalizedExpectancy = Math.min(strategy.expectancy / 50, 1) * 100;

    return (
      normalizedSharpe * weights.sharpe +
      normalizedSortino * weights.sortino +
      normalizedProfitFactor * weights.profitFactor +
      normalizedWinRate * weights.winRate +
      normalizedExpectancy * weights.expectancy
    );
  }

  /**
   * Compare two strategies by a specific metric
   */
  private compareByMetric(a: StrategyRecord, b: StrategyRecord, metric: string): number {
    const metricMap: Record<string, (s: StrategyRecord) => number> = {
      sharpe: s => s.sharpe,
      sortino: s => s.sortino,
      calmar: s => s.calmar,
      expectancy: s => s.expectancy,
      profit_factor: s => s.profitFactor,
      win_rate: s => s.winRate,
    };

    const getter = metricMap[metric] || metricMap.sharpe;
    return getter(a) - getter(b);
  }

  /**
   * Generate reasoning for comparison winner
   */
  private generateComparisonReasoning(winner: StrategyRecord, allStrategies: StrategyRecord[]): string {
    const winnerScore = this.computeCompositeScore(winner);
    const avgScore = allStrategies.reduce((sum, s) => sum + this.computeCompositeScore(s), 0) / allStrategies.length;
    const scoreMargin = ((winnerScore - avgScore) / avgScore * 100).toFixed(1);

    return `${winner.name} leads with a composite score of ${winnerScore.toFixed(1)} (${scoreMargin}% above average). ` +
      `Superior Sharpe ratio (${winner.sharpe.toFixed(2)}), win rate (${(winner.winRate * 100).toFixed(1)}%), ` +
      `and expectancy (${winner.expectancy.toFixed(2)}) drive the advantage.`;
  }

  /**
   * Start automatic ranking updates
   */
  public startAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.updateRankings();
    }, this.config.updateIntervalMs);
  }

  /**
   * Stop automatic ranking updates
   */
  public stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stopAutoUpdate();
    this.removeAllListeners();
    this.strategies.clear();
    this.rankHistory.clear();
  }
}
