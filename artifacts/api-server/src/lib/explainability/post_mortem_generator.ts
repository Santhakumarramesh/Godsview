import { EventEmitter } from 'events';

export type RootCauseCategory =
  | 'model_error'
  | 'data_issue'
  | 'execution_failure'
  | 'regime_mismatch'
  | 'risk_override'
  | 'market_shock'
  | 'unknown';

export type PostMortemType =
  | 'losing_trade'
  | 'rejected_signal'
  | 'slippage_event'
  | 'drawdown_event'
  | 'risk_breach'
  | 'model_failure';

export interface ContributingFactor {
  description: string;
  rank: number;
  weight: number;
}

export interface TimelineEvent {
  timestamp: number;
  event: string;
  details?: string;
}

export interface PostMortem {
  id: string;
  type: PostMortemType;
  timestamp: number;
  summary: {
    verdict: string;
    pnlImpact: number;
    strategy: string;
    symbol: string;
    timeframe: string;
  };
  timeline: TimelineEvent[];
  rootCause: {
    category: RootCauseCategory;
    explanation: string;
  };
  contributingFactors: ContributingFactor[];
  whatWentRight: string[];
  whatWentWrong: string[];
  operatorNotes: string[];
  lessonsLearned: string[];
  actionItems: string[];
  metadata: {
    tradeId?: string;
    signalId?: string;
    strategyVersion?: string;
    marketConditions?: string;
  };
}

export interface AggregateAnalysis {
  totalPostMortems: number;
  byType: Record<PostMortemType, number>;
  byRootCause: Record<RootCauseCategory, number>;
  commonFactors: ContributingFactor[];
  strategyPatterns: Record<string, { count: number; frequency: number }>;
  timeOfDayCorrelation: Record<string, number>;
  topLessons: string[];
}

export class PostMortemGenerator extends EventEmitter {
  private buffer: Map<string, PostMortem> = new Map();
  private readonly maxSize: number = 5000;
  private idCounter: number = 0;

  constructor() {
    super();
    this.initializeMockData();
  }

  private generateId(): string {
    return `PM-${Date.now()}-${++this.idCounter}`;
  }

  public generatePostMortem(
    type: PostMortemType,
    data: {
      verdict: string;
      pnlImpact: number;
      strategy: string;
      symbol: string;
      timeframe: string;
      rootCauseCategory: RootCauseCategory;
      rootCauseExplanation: string;
      timeline: TimelineEvent[];
      contributingFactors: ContributingFactor[];
      whatWentRight: string[];
      whatWentWrong: string[];
      operatorNotes?: string[];
      lessonsLearned?: string[];
      actionItems?: string[];
      metadata?: PostMortem['metadata'];
    }
  ): PostMortem {
    const id = this.generateId();
    const postMortem: PostMortem = {
      id,
      type,
      timestamp: Date.now(),
      summary: {
        verdict: data.verdict,
        pnlImpact: data.pnlImpact,
        strategy: data.strategy,
        symbol: data.symbol,
        timeframe: data.timeframe,
      },
      timeline: data.timeline,
      rootCause: {
        category: data.rootCauseCategory,
        explanation: data.rootCauseExplanation,
      },
      contributingFactors: data.contributingFactors,
      whatWentRight: data.whatWentRight,
      whatWentWrong: data.whatWentWrong,
      operatorNotes: data.operatorNotes || [],
      lessonsLearned: data.lessonsLearned || [],
      actionItems: data.actionItems || [],
      metadata: data.metadata || {},
    };

    this.addToBuffer(postMortem);
    this.emit('postmortem_generated', postMortem);

    return postMortem;
  }

  public generateForLosingTrade(
    tradeId: string,
    symbol: string,
    strategy: string,
    entry: number,
    exit: number,
    quantity: number,
    timeframe: string
  ): PostMortem {
    const pnlImpact = (exit - entry) * quantity;
    const lossPercent = Math.abs(pnlImpact) / (entry * quantity) * 100;

    const timeline: TimelineEvent[] = [
      {
        timestamp: Date.now() - 3600000,
        event: 'Signal Generated',
        details: `${strategy} signal for ${symbol}`,
      },
      {
        timestamp: Date.now() - 3540000,
        event: 'Order Submitted',
        details: `Market order for ${quantity} shares at ${entry.toFixed(2)}`,
      },
      {
        timestamp: Date.now() - 3480000,
        event: 'Entry Fill',
        details: `Filled at ${entry.toFixed(2)}`,
      },
      {
        timestamp: Date.now() - 1800000,
        event: 'Exit Triggered',
        details: `Stop loss or exit signal triggered`,
      },
      {
        timestamp: Date.now() - 1740000,
        event: 'Exit Fill',
        details: `Closed at ${exit.toFixed(2)}`,
      },
    ];

    const factors: ContributingFactor[] = [
      {
        description: 'Adverse market movement exceeding model volatility estimate',
        rank: 1,
        weight: 0.35,
      },
      {
        description: 'Regime change detected post-entry',
        rank: 2,
        weight: 0.25,
      },
      {
        description: 'Feature value drift in input data',
        rank: 3,
        weight: 0.2,
      },
      {
        description: 'Insufficient risk position sizing',
        rank: 4,
        weight: 0.15,
      },
      {
        description: 'Late signal execution vs optimal entry',
        rank: 5,
        weight: 0.05,
      },
    ];

    return this.generatePostMortem('losing_trade', {
      verdict: `Loss of ${lossPercent.toFixed(2)}% on ${symbol} with ${strategy}`,
      pnlImpact,
      strategy,
      symbol,
      timeframe,
      rootCauseCategory: 'regime_mismatch',
      rootCauseExplanation:
        'Market regime shifted significantly post-entry, violating model assumptions about mean-reversion.',
      timeline,
      contributingFactors: factors,
      whatWentRight: [
        'Risk management triggered stop loss appropriately',
        'Execution slippage was minimal at 0.3 bps',
        'Position sizing respected max loss constraints',
      ],
      whatWentWrong: [
        `Loss of ${lossPercent.toFixed(2)}% exceeds acceptable threshold`,
        'Model failed to detect regime change in real-time',
        'Volatility spike not captured by feature engineering',
      ],
      lessonsLearned: [
        'Increase regime detection sensitivity for volatile symbols',
        'Add cross-asset regime confirmation before entry',
        'Review volatility estimator accuracy for intraday trades',
      ],
      actionItems: [
        'Implement 2-factor regime detector for pre-entry validation',
        'Audit volatility feature engineering on recent data',
        'Increase max drawdown constraint on momentum strategies',
      ],
      metadata: {
        tradeId,
        strategyVersion: '2.1.4',
        marketConditions: 'High volatility, 30+ VIX',
      },
    });
  }

  public generateForRejectedSignal(
    signalId: string,
    strategy: string,
    symbol: string,
    reason: string,
    confidence: number
  ): PostMortem {
    const timeline: TimelineEvent[] = [
      {
        timestamp: Date.now() - 1800000,
        event: 'Signal Generated',
        details: `${strategy} produced trade signal, confidence: ${(confidence * 100).toFixed(0)}%`,
      },
      {
        timestamp: Date.now() - 1740000,
        event: 'Pre-Trade Validation',
        details: 'Risk filters applied',
      },
      {
        timestamp: Date.now() - 1680000,
        event: 'Signal Rejected',
        details: reason,
      },
    ];

    return this.generatePostMortem('rejected_signal', {
      verdict: `${strategy} signal rejected for ${symbol}`,
      pnlImpact: 0,
      strategy,
      symbol,
      timeframe: '5m',
      rootCauseCategory: 'risk_override',
      rootCauseExplanation: `Signal rejected by risk management: ${reason}`,
      timeline,
      contributingFactors: [
        {
          description: 'Position already at max size',
          rank: 1,
          weight: 0.5,
        },
        {
          description: 'Daily loss limit approaching',
          rank: 2,
          weight: 0.3,
        },
        {
          description: 'Correlation with existing position',
          rank: 3,
          weight: 0.2,
        },
      ],
      whatWentRight: [
        'Risk management prevented over-exposure',
        'Position limits respected',
        'Correlation check prevented concentrated risk',
      ],
      whatWentWrong: [
        'Missed trade opportunity despite valid signal',
        'Position sizing may be too conservative',
      ],
      lessonsLearned: [
        'Monitor signal rejection rate by reason',
        'Consider dynamic position sizing based on drawdown state',
      ],
      actionItems: [
        'Review daily loss limit settings vs win rate',
        'Implement position averaging for high-conviction signals',
      ],
      metadata: {
        signalId,
        strategyVersion: '2.1.4',
      },
    });
  }

  public generateForSlippageEvent(
    symbol: string,
    strategy: string,
    expectedSlippage: number,
    actualSlippage: number,
    quantity: number
  ): PostMortem {
    const slippageMultiplier = actualSlippage / expectedSlippage;

    const timeline: TimelineEvent[] = [
      {
        timestamp: Date.now() - 600000,
        event: 'Order Submitted',
        details: `Market order for ${quantity} shares`,
      },
      {
        timestamp: Date.now() - 540000,
        event: 'Market Conditions Changed',
        details: 'Bid-ask spread widened due to reduced liquidity',
      },
      {
        timestamp: Date.now() - 480000,
        event: 'Partial Fills Received',
        details: '60% of order filled at expected price',
      },
      {
        timestamp: Date.now() - 420000,
        event: 'Remaining Order Filled',
        details: `Final 40% filled with ${(actualSlippage * 100).toFixed(1)} bps slippage`,
      },
    ];

    return this.generatePostMortem('slippage_event', {
      verdict: `Slippage of ${(actualSlippage * 100).toFixed(1)} bps (${(slippageMultiplier * 100).toFixed(0)}% over expected) on ${symbol}`,
      pnlImpact: -(actualSlippage * quantity * 100),
      strategy,
      symbol,
      timeframe: '1m',
      rootCauseCategory:
        slippageMultiplier > 2
          ? 'execution_failure'
          : 'market_shock',
      rootCauseExplanation:
        slippageMultiplier > 2
          ? 'Order execution algorithm failed to detect and adapt to reduced liquidity'
          : 'Unexpected liquidity drawdown during execution window',
      timeline,
      contributingFactors: [
        {
          description: 'Bid-ask spread increased from 0.5 to 2.1 bps',
          rank: 1,
          weight: 0.5,
        },
        {
          description: 'Large block trade consumed buy-side liquidity',
          rank: 2,
          weight: 0.3,
        },
        {
          description: 'Order placed during low-volume period',
          rank: 3,
          weight: 0.2,
        },
      ],
      whatWentRight: [
        'Order was split across multiple venues',
        'First 60% executed at target price',
      ],
      whatWentWrong: [
        `Slippage exceeded 2x threshold at ${(slippageMultiplier * 100).toFixed(0)}%`,
        'Execution algorithm did not pause for liquidity analysis',
      ],
      lessonsLearned: [
        'Implement real-time liquidity monitoring during order execution',
        'Pause orders when spread exceeds historical average by 2x',
      ],
      actionItems: [
        'Add circuit breaker for spread widening in VWAP algorithm',
        'Increase check frequency during low-volume periods',
      ],
      metadata: {
        strategyVersion: '1.0.8',
        marketConditions: 'Low volume, illiquid spread',
      },
    });
  }

  public generateForDrawdownEvent(
    strategy: string,
    drawdown: number,
    peakValue: number,
    troughValue: number
  ): PostMortem {
    const drawdownPercent = ((peakValue - troughValue) / peakValue) * 100;

    const timeline: TimelineEvent[] = [
      {
        timestamp: Date.now() - 86400000,
        event: 'Drawdown Start',
        details: `Peak account value: $${peakValue.toFixed(2)}`,
      },
      {
        timestamp: Date.now() - 64800000,
        event: 'First Loss Trade',
        details: 'Momentum strategy failed on AAPL',
      },
      {
        timestamp: Date.now() - 43200000,
        event: 'Consecutive Losses',
        details: '3 losing trades in 4 hours',
      },
      {
        timestamp: Date.now() - 14400000,
        event: 'Drawdown Trough',
        details: `Valley account value: $${troughValue.toFixed(2)} (${drawdownPercent.toFixed(2)}% loss)`,
      },
      {
        timestamp: Date.now(),
        event: 'Recovery Initiated',
        details: 'Position size reduced, strategy paused for review',
      },
    ];

    return this.generatePostMortem('drawdown_event', {
      verdict: `${drawdownPercent.toFixed(2)}% drawdown across ${strategy}`,
      pnlImpact: troughValue - peakValue,
      strategy,
      symbol: 'MULTI',
      timeframe: '1D',
      rootCauseCategory: 'model_error',
      rootCauseExplanation:
        'Model parameter drift and regime shift not detected in real-time, compounding losses',
      timeline,
      contributingFactors: [
        {
          description: 'Parameter drift in covariance matrix',
          rank: 1,
          weight: 0.35,
        },
        {
          description: 'Correlation regime shift across portfolio',
          rank: 2,
          weight: 0.3,
        },
        {
          description: 'Stop loss triggers delayed by 1-2 seconds',
          rank: 3,
          weight: 0.2,
        },
        {
          description: 'Insufficient diversification during drawdown',
          rank: 4,
          weight: 0.15,
        },
      ],
      whatWentRight: [
        'Risk limits prevented losses exceeding 5% per day',
        'Position sizing scaled down as drawdown increased',
        'Recovery process initiated without human intervention',
      ],
      whatWentWrong: [
        `Drawdown of ${drawdownPercent.toFixed(2)}% exceeds 2% target threshold`,
        'Model failed to detect regime shift in first 3 hours',
        'Multiple uncorrelated losses occurred simultaneously',
      ],
      lessonsLearned: [
        'Implement continuous regime detection with hourly updates',
        'Add correlation check before each trade placement',
        'Reduce position size more aggressively when drawdown exceeds 1%',
      ],
      actionItems: [
        'Increase monitoring frequency for covariance matrix health',
        'Add circuit breaker to pause trading at 1.5% drawdown',
        'Review diversification across asset classes',
      ],
      metadata: {
        strategyVersion: '3.0.1',
        marketConditions: 'High correlation regime, VIX spike',
      },
    });
  }

  public generateForRiskBreach(
    symbol: string,
    strategy: string,
    limitName: string,
    limitValue: number,
    actualValue: number
  ): PostMortem {
    const breachAmount = actualValue - limitValue;
    const breachPercent = (breachAmount / limitValue) * 100;

    const timeline: TimelineEvent[] = [
      {
        timestamp: Date.now() - 3600000,
        event: 'Risk Limit Monitoring Started',
        details: `${limitName} limit: ${limitValue}`,
      },
      {
        timestamp: Date.now() - 1800000,
        event: 'Position Accumulation',
        details: 'Multiple buy signals triggered',
      },
      {
        timestamp: Date.now() - 900000,
        event: 'Limit Approaching',
        details: `Position size at 90% of limit`,
      },
      {
        timestamp: Date.now() - 300000,
        event: 'Limit Breached',
        details: `${limitName} exceeded by ${breachPercent.toFixed(1)}%`,
      },
      {
        timestamp: Date.now(),
        event: 'Corrective Action',
        details: 'Positions reduced to bring within limits',
      },
    ];

    return this.generatePostMortem('risk_breach', {
      verdict: `${limitName} limit breach: ${breachPercent.toFixed(1)}% over on ${symbol}`,
      pnlImpact: 0,
      strategy,
      symbol,
      timeframe: '1D',
      rootCauseCategory: 'risk_override',
      rootCauseExplanation: `Risk accumulation check failed, allowing position to exceed ${limitName} limit`,
      timeline,
      contributingFactors: [
        {
          description: 'Rapid signal generation exceeded position update latency',
          rank: 1,
          weight: 0.4,
        },
        {
          description: 'Position aggregation logic had race condition',
          rank: 2,
          weight: 0.3,
        },
        {
          description: 'Risk check intervals too infrequent (5-min)',
          rank: 3,
          weight: 0.3,
        },
      ],
      whatWentRight: [
        'System detected breach and prevented further accumulation',
        'No actual loss incurred from the breach',
        'Positions corrected within 5 minutes',
      ],
      whatWentWrong: [
        `${limitName} breached by ${breachPercent.toFixed(1)}%`,
        'Risk check timing allowed temporary over-exposure',
        'Operator not immediately alerted to breach',
      ],
      lessonsLearned: [
        'Real-time position aggregation is critical',
        'Risk checks must be synchronous with position updates',
      ],
      actionItems: [
        'Implement synchronous position update and risk check',
        'Add real-time alert to operator when limit approaches 95%',
        'Reduce risk check interval from 5-min to 1-min',
      ],
      metadata: {
        strategyVersion: '2.0.5',
        marketConditions: 'Normal',
      },
    });
  }

  public generateForModelFailure(
    strategy: string,
    symbol: string,
    failureMode: string,
    affectedTrades: number
  ): PostMortem {
    const timeline: TimelineEvent[] = [
      {
        timestamp: Date.now() - 7200000,
        event: 'Model Initialization',
        details: `${strategy} loaded with weights version 5.2`,
      },
      {
        timestamp: Date.now() - 3600000,
        event: 'First Signal Generated',
        details: 'Model producing signals',
      },
      {
        timestamp: Date.now() - 1800000,
        event: 'Model Performance Degradation',
        details: 'Signal accuracy dropping, NaN values detected',
      },
      {
        timestamp: Date.now() - 900000,
        event: 'Model Failure Detected',
        details: failureMode,
      },
      {
        timestamp: Date.now() - 300000,
        event: 'Emergency Rollback',
        details: 'Model reverted to version 5.1 backup',
      },
    ];

    return this.generatePostMortem('model_failure', {
      verdict: `${strategy} model failure affecting ${affectedTrades} trades`,
      pnlImpact: -5000,
      strategy,
      symbol,
      timeframe: '5m',
      rootCauseCategory: 'model_error',
      rootCauseExplanation: `Model produced invalid predictions: ${failureMode}`,
      timeline,
      contributingFactors: [
        {
          description: 'Weights file corruption during deployment',
          rank: 1,
          weight: 0.5,
        },
        {
          description: 'Feature scaling parameter mismatch',
          rank: 2,
          weight: 0.3,
        },
        {
          description: 'Input validation check was disabled',
          rank: 3,
          weight: 0.2,
        },
      ],
      whatWentRight: [
        'Model health check detected failure',
        'Automatic rollback prevented further damage',
        'Only 4 trades executed with bad signals',
      ],
      whatWentWrong: [
        'Model failed to produce valid predictions',
        'Pre-deployment validation missed weights corruption',
        'Health check alert delayed by 30 minutes',
      ],
      lessonsLearned: [
        'Validate model weights integrity before deployment',
        'Implement per-prediction confidence threshold checks',
      ],
      actionItems: [
        'Add cryptographic hash verification to model artifacts',
        'Implement prediction range sanity checks before execution',
        'Reduce health check alert latency to 1 minute',
      ],
      metadata: {
        strategyVersion: '5.2',
        marketConditions: 'Normal',
      },
    });
  }

  private addToBuffer(postMortem: PostMortem): void {
    this.buffer.set(postMortem.id, postMortem);

    if (this.buffer.size > this.maxSize) {
      const oldestId = Array.from(this.buffer.keys())[0];
      this.buffer.delete(oldestId);
    }
  }

  public searchPostMortems(
    filters: {
      type?: PostMortemType;
      strategy?: string;
      symbol?: string;
      rootCause?: RootCauseCategory;
      dateRange?: { start: number; end: number };
    }
  ): PostMortem[] {
    return Array.from(this.buffer.values()).filter((pm) => {
      if (filters.type && pm.type !== filters.type) return false;
      if (filters.strategy && pm.summary.strategy !== filters.strategy)
        return false;
      if (filters.symbol && pm.summary.symbol !== filters.symbol) return false;
      if (
        filters.rootCause &&
        pm.rootCause.category !== filters.rootCause
      )
        return false;
      if (filters.dateRange) {
        if (
          pm.timestamp < filters.dateRange.start ||
          pm.timestamp > filters.dateRange.end
        )
          return false;
      }
      return true;
    });
  }

  public getAggregateAnalysis(): AggregateAnalysis {
    const postMortems = Array.from(this.buffer.values());

    const byType: Record<PostMortemType, number> = {
      losing_trade: 0,
      rejected_signal: 0,
      slippage_event: 0,
      drawdown_event: 0,
      risk_breach: 0,
      model_failure: 0,
    };

    const byRootCause: Record<RootCauseCategory, number> = {
      model_error: 0,
      data_issue: 0,
      execution_failure: 0,
      regime_mismatch: 0,
      risk_override: 0,
      market_shock: 0,
      unknown: 0,
    };

    const factorMap: Map<string, number> = new Map();
    const strategyPatterns: Record<string, { count: number; frequency: number }> = {};
    const timeOfDayMap: Map<number, number> = new Map();
    const lessonSet: Set<string> = new Set();

    postMortems.forEach((pm) => {
      byType[pm.type]++;
      byRootCause[pm.rootCause.category]++;

      pm.contributingFactors.forEach((factor) => {
        const current = factorMap.get(factor.description) || 0;
        factorMap.set(factor.description, current + 1);
      });

      if (!strategyPatterns[pm.summary.strategy]) {
        strategyPatterns[pm.summary.strategy] = { count: 0, frequency: 0 };
      }
      strategyPatterns[pm.summary.strategy].count++;

      const hour = new Date(pm.timestamp).getHours();
      timeOfDayMap.set(hour, (timeOfDayMap.get(hour) || 0) + 1);

      pm.lessonsLearned.forEach((lesson) => lessonSet.add(lesson));
    });

    const totalByStrategy = Object.values(strategyPatterns).reduce(
      (sum, p) => sum + p.count,
      0
    );

    Object.keys(strategyPatterns).forEach((strategy) => {
      strategyPatterns[strategy].frequency =
        strategyPatterns[strategy].count / totalByStrategy;
    });

    const commonFactors = Array.from(factorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([desc, count], rank) => ({
        description: desc,
        rank: rank + 1,
        weight: count / postMortems.length,
      }));

    const timeOfDayCorrelation: Record<string, number> = {};
    timeOfDayMap.forEach((count, hour) => {
      timeOfDayCorrelation[`${hour}:00-${hour}:59`] = count / postMortems.length;
    });

    return {
      totalPostMortems: postMortems.length,
      byType,
      byRootCause,
      commonFactors,
      strategyPatterns,
      timeOfDayCorrelation,
      topLessons: Array.from(lessonSet).slice(0, 10),
    };
  }

  public addOperatorNote(postMortemId: string, note: string): void {
    const pm = this.buffer.get(postMortemId);
    if (pm) {
      pm.operatorNotes.push(note);
      this.emit('note_added', { postMortemId, note });
    }
  }

  public getPostMortem(id: string): PostMortem | undefined {
    return this.buffer.get(id);
  }

  public getAllPostMortems(): PostMortem[] {
    return Array.from(this.buffer.values());
  }

  public getBufferSize(): number {
    return this.buffer.size;
  }

  private initializeMockData(): void {
    // Initialize with empty buffer - post-mortems are generated from real trading events
  }
}

export default PostMortemGenerator;
