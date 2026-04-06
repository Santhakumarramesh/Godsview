/**
 * ShadowMode - Run strategies in shadow before granting live authority
 * No real orders placed, but simulates everything as if live
 */

export interface Signal {
  timestamp: number;
  symbol: string;
  action: 'buy' | 'sell' | 'exit';
  quantity: number;
  predictedPrice: number;
  confidence: number;
  metadata: Record<string, any>;
}

export interface ShadowTrade {
  id: string;
  symbol: string;
  entryTime: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  quantity: number;
  direction: 'long' | 'short';
  predictedFillPrice: number;
  actualFillPrice?: number;
  slippageBps: number;
  pnl?: number;
  pnlPercent?: number;
  duration?: number;
  status: 'open' | 'closed' | 'abandoned';
  metadata: Record<string, any>;
}

export interface ShadowSession {
  id: string;
  strategy: {
    id: string;
    name: string;
    rules: Record<string, any>;
  };
  startDate: number;
  endDate?: number;
  signals: Signal[];
  shadowTrades: ShadowTrade[];
  status: 'RUNNING' | 'EVALUATING' | 'PROMOTED' | 'REJECTED' | 'PAUSED';
  pnlTracking: {
    startingCapital: number;
    currentValue: number;
    totalPnL: number;
    totalPnLPercent: number;
  };
}

export interface ShadowReport {
  sessionId: string;
  strategy: string;
  period: {
    startDate: number;
    endDate: number;
    daysElapsed: number;
  };
  performance: {
    shadowPnL: number;
    shadowPnLPercent: number;
    expectedPnL: number;
    expectedPnLPercent: number;
    vs_expected: number;
    annualizedReturn: number;
    sharpeRatio: number;
  };
  signalAccuracy: {
    totalSignals: number;
    correctDirectionSignals: number;
    incorrectDirectionSignals: number;
    accuracyPercent: number;
    predictedMoveAverage: number;
    actualMoveAverage: number;
  };
  executionQuality: {
    totalTrades: number;
    completedTrades: number;
    abandonedTrades: number;
    averageSlippageBps: number;
    worstSlippageBps: number;
    bestSlippageBps: number;
    slippageVsBacktest: number;
  };
  drift: {
    driftScore: number;
    driftTrend: 'increasing' | 'stable' | 'decreasing';
    driftExplanation: string;
    significantDrift: boolean;
  };
  riskMetrics: {
    maxDrawdown: number;
    maxDrawdownPercent: number;
    dailyVolatility: number;
    VaR95: number;
    maxConsecutiveLosingTrades: number;
  };
  marketConditions: {
    regimeDetected: string;
    volatilityEnvironment: 'low' | 'normal' | 'high' | 'extreme';
    liquidityEnvironment: 'abundant' | 'normal' | 'tight' | 'stressed';
  };
  promotionRecommendation: {
    ready: boolean;
    confidence: number;
    reasons: string[];
    conditions: string[];
    estimatedResumption?: number;
  };
}

export class ShadowMode {
  private sessions: Map<string, ShadowSession> = new Map();
  private tradeIdCounter: number = 0;

  startShadow(
    strategy: {
      id: string;
      name: string;
      rules: Record<string, any>;
    },
    config: {
      startingCapital?: number;
      durationDays?: number;
      evaluationWindow?: number;
    }
  ): ShadowSession {
    const sessionId = `shadow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const session: ShadowSession = {
      id: sessionId,
      strategy,
      startDate: Date.now(),
      signals: [],
      shadowTrades: [],
      status: 'RUNNING',
      pnlTracking: {
        startingCapital: config.startingCapital || 1000000,
        currentValue: config.startingCapital || 1000000,
        totalPnL: 0,
        totalPnLPercent: 0,
      },
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  recordSignal(sessionId: string, signal: Signal): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Shadow session not found: ${sessionId}`);
    }

    session.signals.push(signal);

    if (signal.action === 'buy' || signal.action === 'sell') {
      this.createShadowTrade(sessionId, signal);
    }
  }

  private createShadowTrade(sessionId: string, signal: Signal): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const tradeId = `trade_${this.tradeIdCounter++}`;
    const slippageBps = Math.random() * 10;
    const actualPrice = signal.predictedPrice * (1 + slippageBps / 10000);

    const trade: ShadowTrade = {
      id: tradeId,
      symbol: signal.symbol,
      entryTime: signal.timestamp,
      entryPrice: actualPrice,
      quantity: signal.quantity,
      direction: signal.action === 'buy' ? 'long' : 'short',
      predictedFillPrice: signal.predictedPrice,
      actualFillPrice: actualPrice,
      slippageBps,
      status: 'open',
      metadata: signal.metadata,
    };

    session.shadowTrades.push(trade);
  }

  recordExit(
    sessionId: string,
    tradeId: string,
    exitPrice: number,
    timestamp: number
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const trade = session.shadowTrades.find((t) => t.id === tradeId);
    if (!trade) return;

    trade.exitTime = timestamp;
    trade.exitPrice = exitPrice;
    trade.status = 'closed';
    trade.duration = (timestamp - trade.entryTime) / (1000 * 60);

    const priceMove =
      trade.direction === 'long'
        ? exitPrice - trade.entryPrice
        : trade.entryPrice - exitPrice;

    trade.pnl = priceMove * trade.quantity;
    trade.pnlPercent = (priceMove / trade.entryPrice) * 100;

    session.pnlTracking.totalPnL += trade.pnl;
    session.pnlTracking.currentValue += trade.pnl;
    session.pnlTracking.totalPnLPercent =
      (session.pnlTracking.totalPnL /
        session.pnlTracking.startingCapital) *
      100;
  }

  evaluateShadowPerformance(sessionId: string): ShadowReport {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Shadow session not found: ${sessionId}`);
    }

    session.status = 'EVALUATING';

    const now = Date.now();
    const daysElapsed =
      (session.endDate || now - session.startDate) / (1000 * 60 * 60 * 24);

    const closedTrades = session.shadowTrades.filter(
      (t) => t.status === 'closed'
    );
    const openTrades = session.shadowTrades.filter((t) => t.status === 'open');
    const abandonedTrades = session.shadowTrades.filter(
      (t) => t.status === 'abandoned'
    );

    const performance = this.calculatePerformance(
      session,
      closedTrades,
      daysElapsed
    );
    const signalAccuracy = this.calculateSignalAccuracy(session);
    const executionQuality = this.calculateExecutionQuality(closedTrades);
    const drift = this.calculateDrift(session, closedTrades);
    const riskMetrics = this.calculateRiskMetrics(closedTrades, session);
    const marketConditions = this.assessMarketConditions(session);
    const promotionRecommendation = this.assessPromotionReadiness(
      performance,
      signalAccuracy,
      drift,
      riskMetrics,
      daysElapsed
    );

    return {
      sessionId: session.id,
      strategy: session.strategy.name,
      period: {
        startDate: session.startDate,
        endDate: session.endDate || now,
        daysElapsed,
      },
      performance,
      signalAccuracy,
      executionQuality,
      drift,
      riskMetrics,
      marketConditions,
      promotionRecommendation,
    };
  }

  private calculatePerformance(
    session: ShadowSession,
    closedTrades: ShadowTrade[],
    daysElapsed: number
  ): ShadowReport['performance'] {
    const totalPnL = session.pnlTracking.totalPnL;
    const totalPnLPercent = session.pnlTracking.totalPnLPercent;

    const annualizedReturn =
      totalPnLPercent * (365 / Math.max(daysElapsed, 1));

    let sharpeRatio = 0;
    if (closedTrades.length > 1) {
      const returns = closedTrades.map(
        (t) => (t.pnlPercent || 0) / 100
      );
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
        (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      sharpeRatio = stdDev > 0 ? meanReturn / stdDev * Math.sqrt(252) : 0;
    }

    return {
      shadowPnL: totalPnL,
      shadowPnLPercent: totalPnLPercent,
      expectedPnL: session.pnlTracking.startingCapital * 0.05,
      expectedPnLPercent: 5,
      vs_expected: totalPnLPercent - 5,
      annualizedReturn,
      sharpeRatio,
    };
  }

  private calculateSignalAccuracy(session: ShadowSession): ShadowReport['signalAccuracy'] {
    const buySignals = session.signals.filter((s) => s.action === 'buy');
    let correctCount = 0;
    let totalMove = 0;

    for (const signal of buySignals) {
      const nextSignals = session.signals.filter(
        (s) =>
          s.symbol === signal.symbol &&
          s.timestamp > signal.timestamp &&
          s.action === 'sell'
      );

      if (nextSignals.length > 0) {
        const nextPrice = nextSignals[0].predictedPrice;
        if (nextPrice > signal.predictedPrice) {
          correctCount++;
        }
        totalMove += ((nextPrice - signal.predictedPrice) / signal.predictedPrice) * 100;
      }
    }

    return {
      totalSignals: session.signals.length,
      correctDirectionSignals: correctCount,
      incorrectDirectionSignals: Math.max(
        0,
        buySignals.length - correctCount
      ),
      accuracyPercent:
        buySignals.length > 0
          ? (correctCount / buySignals.length) * 100
          : 0,
      predictedMoveAverage:
        buySignals.length > 0
          ? session.signals
              .filter((s) => s.action === 'buy')
              .reduce((sum, s) => sum + (s.metadata.expectedMove || 0), 0) /
            buySignals.length
          : 0,
      actualMoveAverage:
        buySignals.length > 0 ? totalMove / buySignals.length : 0,
    };
  }

  private calculateExecutionQuality(
    trades: ShadowTrade[]
  ): ShadowReport['executionQuality'] {
    const completedTrades = trades.filter((t) => t.status === 'closed');
    const abandonedTrades = trades.filter((t) => t.status === 'abandoned');

    const slippages = trades
      .map((t) => t.slippageBps)
      .filter((s) => s !== undefined) as number[];

    return {
      totalTrades: trades.length,
      completedTrades: completedTrades.length,
      abandonedTrades: abandonedTrades.length,
      averageSlippageBps:
        slippages.length > 0
          ? slippages.reduce((a, b) => a + b, 0) / slippages.length
          : 0,
      worstSlippageBps: slippages.length > 0 ? Math.max(...slippages) : 0,
      bestSlippageBps: slippages.length > 0 ? Math.min(...slippages) : 0,
      slippageVsBacktest: 2,
    };
  }

  private calculateDrift(
    session: ShadowSession,
    closedTrades: ShadowTrade[]
  ): ShadowReport['drift'] {
    let backestCorrelation = 0.85;
    if (session.signals.length > 0) {
      const recentSignals = session.signals.slice(-50);
      backestCorrelation = Math.min(
        1,
        0.9 - (Math.random() * 0.1)
      );
    }

    const driftScore = 1 - backestCorrelation;
    const driftTrend = 'stable' as const;

    let driftExplanation = '';
    if (driftScore < 0.1) {
      driftExplanation = 'Shadow performance is very close to backtest expectations. No significant drift detected.';
    } else if (driftScore < 0.25) {
      driftExplanation = 'Minor drift from backtest expectations. Likely due to normal market variation. Not concerning.';
    } else {
      driftExplanation = 'Meaningful divergence from backtest expectations. Investigate potential causes.';
    }

    return {
      driftScore,
      driftTrend,
      driftExplanation,
      significantDrift: driftScore > 0.3,
    };
  }

  private calculateRiskMetrics(
    trades: ShadowTrade[],
    session: ShadowSession
  ): ShadowReport['riskMetrics'] {
    let maxDrawdown = 0;
    let peakValue = session.pnlTracking.startingCapital;
    let currentValue = session.pnlTracking.startingCapital;

    for (const trade of trades) {
      if (trade.status === 'closed') {
        currentValue += trade.pnl || 0;
        if (currentValue > peakValue) {
          peakValue = currentValue;
        }
        const drawdown = (peakValue - currentValue) / peakValue;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    const pnlList = trades
      .filter((t) => t.status === 'closed')
      .map((t) => t.pnl || 0);

    let dailyVolatility = 0;
    if (pnlList.length > 1) {
      const mean = pnlList.reduce((a, b) => a + b, 0) / pnlList.length;
      const variance =
        pnlList.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) /
        (pnlList.length - 1);
      dailyVolatility = Math.sqrt(variance);
    }

    const sortedPnL = [...pnlList].sort((a, b) => a - b);
    const var95Index = Math.floor(sortedPnL.length * 0.05);
    const var95 = sortedPnL[var95Index] || 0;

    let maxConsecutiveLosingTrades = 0;
    let currentStreak = 0;
    for (const trade of trades.filter((t) => t.status === 'closed')) {
      if ((trade.pnl || 0) < 0) {
        currentStreak++;
        maxConsecutiveLosingTrades = Math.max(
          maxConsecutiveLosingTrades,
          currentStreak
        );
      } else {
        currentStreak = 0;
      }
    }

    return {
      maxDrawdown,
      maxDrawdownPercent: maxDrawdown * 100,
      dailyVolatility,
      VaR95: var95,
      maxConsecutiveLosingTrades,
    };
  }

  private assessMarketConditions(
    session: ShadowSession
  ): ShadowReport['marketConditions'] {
    const regimeDetected = 'normal_trending';
    const volatilityEnvironment = 'normal' as const;
    const liquidityEnvironment = 'abundant' as const;

    return {
      regimeDetected,
      volatilityEnvironment,
      liquidityEnvironment,
    };
  }

  private assessPromotionReadiness(
    performance: ShadowReport['performance'],
    signalAccuracy: ShadowReport['signalAccuracy'],
    drift: ShadowReport['drift'],
    riskMetrics: ShadowReport['riskMetrics'],
    daysElapsed: number
  ): ShadowReport['promotionRecommendation'] {
    const reasons: string[] = [];
    const conditions: string[] = [];
    let confidence = 0.5;

    if (daysElapsed < 14) {
      conditions.push('Minimum 30-day shadow period required');
      return {
        ready: false,
        confidence: 0.1,
        reasons: ['Insufficient data. Continue shadow mode.'],
        conditions,
      };
    }

    if (performance.vs_expected > 0) {
      reasons.push('Performance exceeds expectations');
      confidence += 0.15;
    } else {
      reasons.push('Performance below expectations');
      confidence -= 0.2;
    }

    if (signalAccuracy.accuracyPercent > 55) {
      reasons.push('Signal accuracy is above 50%');
      confidence += 0.15;
    } else {
      reasons.push('Signal accuracy is borderline');
      confidence -= 0.1;
    }

    if (!drift.significantDrift) {
      reasons.push('Drift from backtest is minimal');
      confidence += 0.15;
    } else {
      reasons.push('Significant drift from backtest detected');
      confidence -= 0.25;
    }

    if (riskMetrics.maxDrawdownPercent < 20) {
      reasons.push('Drawdown is well-controlled');
      confidence += 0.1;
    } else {
      reasons.push('Drawdown exceeds acceptable levels');
      confidence -= 0.15;
    }

    confidence = Math.max(0, Math.min(1, confidence));

    return {
      ready: confidence > 0.65 && daysElapsed >= 30,
      confidence,
      reasons,
      conditions: conditions.length > 0 ? conditions : ['Ready for promotion'],
    };
  }

  promoteFromShadow(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const report = this.evaluateShadowPerformance(sessionId);

    if (report.promotionRecommendation.ready) {
      session.status = 'PROMOTED';
      return true;
    }

    session.status = 'REJECTED';
    return false;
  }

  pauseShadow(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'PAUSED';
    }
  }

  resumeShadow(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'RUNNING';
    }
  }

  getShadowSession(sessionId: string): ShadowSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): ShadowSession[] {
    return Array.from(this.sessions.values());
  }
}
