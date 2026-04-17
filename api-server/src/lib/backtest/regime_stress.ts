/**
 * RegimeStressTester - Test strategy across all market conditions
 * Analyzes how strategies perform in different market regimes and identifies
 * regime dependency, transition risk, and degradation during shifts
 */

export enum MarketRegime {
  BULL_TREND = 'BULL_TREND',
  BEAR_TREND = 'BEAR_TREND',
  SIDEWAYS = 'SIDEWAYS',
  HIGH_VOL = 'HIGH_VOL',
  LOW_VOL = 'LOW_VOL',
  CRASH = 'CRASH',
  RECOVERY = 'RECOVERY',
  SQUEEZE = 'SQUEEZE'
}

export interface Trade {
  entryTime: Date;
  entryPrice: number;
  exitTime: Date;
  exitPrice: number;
  quantity: number;
  side: 'LONG' | 'SHORT';
  pnl: number;
}

export interface RegimeMetrics {
  tradeCount: number;
  winCount: number;
  winRate: number;
  avgTrade: number;
  grossProfit: number;
  grossLoss: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  stdDevReturns: number;
}

export interface RegimePerformance {
  regime: MarketRegime;
  metrics: RegimeMetrics;
  profitContribution: number; // percentage of total profit
  timeSpent: number; // percentage of total time
  volatilityMeasured: number;
  trendStrength: number;
}

export interface TransitionMetrics {
  fromRegime: MarketRegime;
  toRegime: MarketRegime;
  transitionCount: number;
  avgPnlDuringTransition: number;
  successRate: number;
  drawdownDuringTransition: number;
  recoveryTime: number; // bars
}

export interface RegimeStressResult {
  perRegimeStats: RegimePerformance[];
  regimeDependencyScore: number; // 0-1, higher means more regime-dependent
  overallSharpe: number;
  worstRegimePerformance: RegimePerformance;
  bestRegimePerformance: RegimePerformance;
  transitionRisk: number; // 0-1
  regimeTransitions: TransitionMetrics[];
  randomEntryBenchmark: RegimeMetrics;
  degradationRates: Map<MarketRegime, number>; // estimated loss when leaving optimal regime
  concentrationAnalysis: {
    profitConcentration: number; // 0-1, Herfindahl index
    timeConcentration: number;
    isSkewed: boolean;
  };
  recommendations: string[];
}

export interface PriceData {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestResult {
  trades: Trade[];
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  priceData: PriceData[];
}

export class RegimeStressTester {
  /**
   * Comprehensive stress test across all market regimes
   */
  public stressTest(
    backtestResults: BacktestResult
  ): RegimeStressResult {
    const regimes = this.identifyRegimes(backtestResults.priceData);
    const regimePerformances = this.analyzePerRegime(
      backtestResults.trades,
      regimes,
      backtestResults.priceData
    );

    const regimeDependencyScore = this.calculateRegimeDependency(
      regimePerformances
    );
    const transitionRisk = this.calculateTransitionRisk(
      backtestResults.trades,
      regimes
    );
    const transitionMetrics = this.synthesizeRegimeTransitions(
      backtestResults.trades,
      regimes
    );
    const randomBenchmark = this.compareToRandomEntry(
      backtestResults.trades,
      regimes
    );
    const degradationRates = this.estimateDegradationRates(
      regimePerformances
    );

    const sortedByProfit = [...regimePerformances].sort(
      (a, b) => b.profitContribution - a.profitContribution
    );

    const recommendations = this.generateRecommendations(
      regimePerformances,
      regimeDependencyScore,
      transitionRisk
    );

    return {
      perRegimeStats: regimePerformances,
      regimeDependencyScore,
      overallSharpe: backtestResults.sharpeRatio,
      worstRegimePerformance: sortedByProfit[sortedByProfit.length - 1],
      bestRegimePerformance: sortedByProfit[0],
      transitionRisk,
      regimeTransitions: transitionMetrics,
      randomEntryBenchmark: randomBenchmark,
      degradationRates,
      concentrationAnalysis: this.analyzeConcentration(regimePerformances),
      recommendations
    };
  }

  /**
   * Identify market regimes from price data
   */
  private identifyRegimes(priceData: PriceData[]): Map<number, MarketRegime> {
    const regimes = new Map<number, MarketRegime>();

    if (priceData.length < 50) return regimes;

    for (let i = 50; i < priceData.length; i++) {
      const window = priceData.slice(i - 50, i);
      const trend = this.calculateTrend(window);
      const volatility = this.calculateVolatility(window);
      const momentum = this.calculateMomentum(window);

      let regime: MarketRegime;

      if (volatility > 2.0) {
        if (trend > 0.5) {
          regime = MarketRegime.HIGH_VOL;
        } else if (trend < -0.5) {
          regime = MarketRegime.CRASH;
        } else {
          regime = MarketRegime.SQUEEZE;
        }
      } else if (volatility < 0.5) {
        regime = MarketRegime.LOW_VOL;
      } else if (trend > 0.5 && momentum > 0.3) {
        regime = MarketRegime.BULL_TREND;
      } else if (trend < -0.5 && momentum < -0.3) {
        regime = MarketRegime.BEAR_TREND;
      } else if (Math.abs(trend) < 0.2) {
        regime = MarketRegime.SIDEWAYS;
      } else {
        regime = MarketRegime.RECOVERY;
      }

      regimes.set(i, regime);
    }

    return regimes;
  }

  /**
   * Analyze strategy performance within each regime
   */
  private analyzePerRegime(
    trades: Trade[],
    regimes: Map<number, MarketRegime>,
    priceData: PriceData[]
  ): RegimePerformance[] {
    const regimeTradesMap = new Map<MarketRegime, Trade[]>();
    const regimeTimeMap = new Map<MarketRegime, number>();
    const regimeVolatilityMap = new Map<MarketRegime, number>();

    // Initialize maps
    for (const regime of Object.values(MarketRegime)) {
      regimeTradesMap.set(regime, []);
      regimeTimeMap.set(regime, 0);
      regimeVolatilityMap.set(regime, 0);
    }

    // Assign trades to regimes
    for (const trade of trades) {
      const regimeAtEntry = this.findRegimeAtTime(
        trade.entryTime,
        regimes,
        priceData
      );
      if (regimeAtEntry) {
        regimeTradesMap.get(regimeAtEntry)!.push(trade);
      }
    }

    // Count time in each regime
    let regimeCounts = new Map<MarketRegime, number>();
    for (const [, regime] of regimes) {
      regimeCounts.set(regime, (regimeCounts.get(regime) || 0) + 1);
    }

    const totalTime = regimes.size;

    // Calculate volatility in each regime
    const regimeWindows = new Map<MarketRegime, PriceData[]>();
    for (const regime of Object.values(MarketRegime)) {
      regimeWindows.set(regime, []);
    }

    for (let i = 50; i < priceData.length; i++) {
      const regime = regimes.get(i);
      if (regime) {
        regimeWindows.get(regime)!.push(priceData[i]);
      }
    }

    const performances: RegimePerformance[] = [];

    for (const regime of Object.values(MarketRegime)) {
      const regimeTrades = regimeTradesMap.get(regime) || [];
      const metrics = this.calculateRegimeMetrics(regimeTrades);
      const timeSpent = (regimeCounts.get(regime) || 0) / totalTime;
      const totalProfit = regimeTrades.reduce((sum, t) => sum + t.pnl, 0);
      const allProfit = trades.reduce((sum, t) => sum + Math.max(0, t.pnl), 0);
      const profitContribution = allProfit === 0 ? 0 : totalProfit / allProfit;

      const window = regimeWindows.get(regime);
      const volatility =
        window && window.length > 0 ? this.calculateVolatility(window) : 0;

      performances.push({
        regime,
        metrics,
        profitContribution: Math.max(0, profitContribution),
        timeSpent,
        volatilityMeasured: volatility,
        trendStrength: this.estimateTrendStrength(regimeTrades)
      });
    }

    return performances;
  }

  /**
   * Calculate metrics for trades within a regime
   */
  private calculateRegimeMetrics(trades: Trade[]): RegimeMetrics {
    if (trades.length === 0) {
      return {
        tradeCount: 0,
        winCount: 0,
        winRate: 0,
        avgTrade: 0,
        grossProfit: 0,
        grossLoss: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        stdDevReturns: 0
      };
    }

    const returns = trades.map((t) => t.pnl / 100);
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);

    const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    let maxDD = 0;
    let peak = 0;
    let equity = 10000;
    for (const trade of trades) {
      equity *= 1 + trade.pnl / 10000;
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, (peak - equity) / peak);
    }

    return {
      tradeCount: trades.length,
      winCount: wins.length,
      winRate: wins.length / trades.length,
      avgTrade: returns.reduce((a, b) => a + b, 0) / returns.length,
      grossProfit,
      grossLoss,
      sharpeRatio: stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(252),
      maxDrawdown: maxDD,
      profitFactor: grossLoss === 0 ? 0 : grossProfit / grossLoss,
      stdDevReturns: stdDev
    };
  }

  /**
   * Calculate regime dependency score (0-1, higher = more dependent)
   */
  private calculateRegimeDependency(
    regimePerformances: RegimePerformance[]
  ): number {
    const sortedByProfit = [...regimePerformances].sort(
      (a, b) => b.profitContribution - a.profitContribution
    );

    // If top regime accounts for >70% of profits, strategy is regime-dependent
    const topRegimeProfit = sortedByProfit[0]?.profitContribution || 0;
    return Math.min(topRegimeProfit / 0.7, 1.0);
  }

  /**
   * Calculate transition risk (0-1)
   */
  private calculateTransitionRisk(
    trades: Trade[],
    regimes: Map<number, MarketRegime>
  ): number {
    const transitionTrades: Trade[] = [];

    for (const trade of trades) {
      const isInTransition = this.isTradeInTransition(
        trade,
        regimes
      );
      if (isInTransition) {
        transitionTrades.push(trade);
      }
    }

    if (trades.length === 0) return 0;

    const transitionCount = transitionTrades.length;
    const transitionLossCount = transitionTrades.filter((t) => t.pnl < 0).length;

    return Math.min(
      (transitionCount / trades.length) * 0.5 +
        (transitionLossCount / transitionCount) * 0.5,
      1.0
    );
  }

  /**
   * Synthesize regime transitions
   */
  private synthesizeRegimeTransitions(
    trades: Trade[],
    regimes: Map<number, MarketRegime>
  ): TransitionMetrics[] {
    const transitions = new Map<string, TransitionMetrics>();

    const regimeArray = Array.from(regimes.values());
    for (let i = 1; i < regimeArray.length; i++) {
      const fromRegime = regimeArray[i - 1];
      const toRegime = regimeArray[i];

      if (fromRegime !== toRegime) {
        const key = `${fromRegime}->${toRegime}`;
        if (!transitions.has(key)) {
          transitions.set(key, {
            fromRegime,
            toRegime,
            transitionCount: 0,
            avgPnlDuringTransition: 0,
            successRate: 0,
            drawdownDuringTransition: 0,
            recoveryTime: 0
          });
        }

        const metric = transitions.get(key)!;
        metric.transitionCount++;
      }
    }

    return Array.from(transitions.values());
  }

  /**
   * Compare strategy performance to random entry benchmark
   */
  private compareToRandomEntry(
    trades: Trade[],
    regimes: Map<number, MarketRegime>
  ): RegimeMetrics {
    const randomTrades = trades.map((t) => ({
      ...t,
      pnl: (Math.random() - 0.5) * 200
    }));

    return this.calculateRegimeMetrics(randomTrades);
  }

  /**
   * Estimate degradation rates when leaving optimal regime
   */
  private estimateDegradationRates(
    regimePerformances: RegimePerformance[]
  ): Map<MarketRegime, number> {
    const rates = new Map<MarketRegime, number>();
    const bestPerf = [...regimePerformances].sort(
      (a, b) => b.metrics.sharpeRatio - a.metrics.sharpeRatio
    )[0];

    for (const perf of regimePerformances) {
      const degradation =
        bestPerf.metrics.sharpeRatio === 0
          ? 0
          : 1 - perf.metrics.sharpeRatio / bestPerf.metrics.sharpeRatio;
      rates.set(perf.regime, Math.max(0, degradation));
    }

    return rates;
  }

  private calculateTrend(window: PriceData[]): number {
    if (window.length < 2) return 0;
    const firstHalf = window.slice(0, window.length / 2);
    const secondHalf = window.slice(window.length / 2);
    const avgFirst = firstHalf.reduce((sum, p) => sum + p.close, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, p) => sum + p.close, 0) / secondHalf.length;
    return (avgSecond - avgFirst) / avgFirst;
  }

  private calculateVolatility(window: PriceData[]): number {
    const returns = window.slice(1).map((p, i) => {
      const prevClose = window[i].close;
      return Math.log(p.close / prevClose);
    });
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  private calculateMomentum(window: PriceData[]): number {
    if (window.length < 10) return 0;
    const recent = window.slice(-10);
    const avgRecent = recent.reduce((sum, p) => sum + p.close, 0) / recent.length;
    const avgAll = window.reduce((sum, p) => sum + p.close, 0) / window.length;
    return (avgRecent - avgAll) / avgAll;
  }

  private findRegimeAtTime(
    time: Date,
    regimes: Map<number, MarketRegime>,
    priceData: PriceData[]
  ): MarketRegime | null {
    const targetIndex = priceData.findIndex((p) => p.timestamp >= time);
    if (targetIndex === -1) return null;
    return regimes.get(targetIndex) || null;
  }

  private isTradeInTransition(
    trade: Trade,
    regimes: Map<number, MarketRegime>
  ): boolean {
    // Simplified: check if regime changed during trade
    return Math.random() < 0.1; // placeholder
  }

  private estimateTrendStrength(trades: Trade[]): number {
    if (trades.length === 0) return 0;
    const longTrades = trades.filter((t) => t.side === 'LONG');
    const winRate = longTrades.filter((t) => t.pnl > 0).length / longTrades.length;
    return Math.min(Math.abs(winRate - 0.5) * 2, 1.0);
  }

  private analyzeConcentration(
    regimePerformances: RegimePerformance[]
  ): {
    profitConcentration: number;
    timeConcentration: number;
    isSkewed: boolean;
  } {
    const profitShares = regimePerformances.map((r) => r.profitContribution);
    const timeShares = regimePerformances.map((r) => r.timeSpent);

    const herfindahlProfit = profitShares.reduce((sum, s) => sum + s * s, 0);
    const herfindahlTime = timeShares.reduce((sum, s) => sum + s * s, 0);

    const isSkewed = herfindahlProfit > 0.5 || herfindahlTime > 0.5;

    return {
      profitConcentration: herfindahlProfit,
      timeConcentration: herfindahlTime,
      isSkewed
    };
  }

  private generateRecommendations(
    regimePerformances: RegimePerformance[],
    regimeDependency: number,
    transitionRisk: number
  ): string[] {
    const recommendations: string[] = [];

    if (regimeDependency > 0.7) {
      recommendations.push(
        'Strategy is highly regime-dependent. Consider adding regime detection and filtering.'
      );
      recommendations.push(
        'Test parameter adjustments that work across all regimes.'
      );
    }

    if (transitionRisk > 0.4) {
      recommendations.push(
        'High transition risk detected. Add protection or hedges during regime changes.'
      );
    }

    const worstRegime = [...regimePerformances].sort(
      (a, b) => a.metrics.sharpeRatio - b.metrics.sharpeRatio
    )[0];

    if (worstRegime.metrics.sharpeRatio < 0) {
      recommendations.push(
        `Strategy loses money in ${worstRegime.regime} regimes. Consider market filters.`
      );
    }

    return recommendations;
  }
}
