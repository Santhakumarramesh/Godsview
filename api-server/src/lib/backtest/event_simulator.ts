/**
 * EventAwareSimulator - Makes backtests respect real-world market events
 * Simulates the impact of earnings, FOMC, news shocks, market hours, circuit breakers,
 * liquidity conditions, and regime shifts on trading execution
 */

export enum EventType {
  EARNINGS = 'EARNINGS',
  FOMC = 'FOMC',
  NEWS_SHOCK = 'NEWS_SHOCK',
  MARKET_OPEN = 'MARKET_OPEN',
  MARKET_CLOSE = 'MARKET_CLOSE',
  CIRCUIT_BREAKER = 'CIRCUIT_BREAKER',
  LOW_LIQUIDITY = 'LOW_LIQUIDITY',
  REGIME_SHIFT = 'REGIME_SHIFT'
}

export interface MarketEvent {
  type: EventType;
  timestamp: Date;
  symbol?: string;
  metadata?: {
    severity?: number; // 0-1
    expectedDuration?: number; // minutes
    direction?: 'UP' | 'DOWN' | 'UNKNOWN';
    [key: string]: any;
  };
}

export interface EventImpactFactors {
  spreadWidthMultiplier: number;
  fillProbabilityReduction: number; // 0-1, reduction factor
  slippageMultiplier: number;
  latencyIncreaseMs: number;
  gapProbability: number; // 0-1
  liquidityFactor: number; // 0-1, of normal liquidity
}

export interface PriceCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Order {
  timestamp: Date;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  limitPrice: number;
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
}

export interface BacktestFill {
  order: Order;
  fillPrice: number;
  fillQuantity: number;
  fillTime: Date;
  filled: boolean;
  slippage: number;
  latencyMs: number;
}

export interface BacktestResult {
  trades: BacktestFill[];
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  metadata?: {
    [key: string]: any;
  };
}

export interface EventAnnotatedPriceData {
  candles: PriceCandle[];
  events: MarketEvent[];
  eventsByTimestamp: Map<number, MarketEvent[]>;
}

export interface SyntheticEventDetection {
  timestamp: Date;
  eventType: EventType;
  confidence: number; // 0-1
  volatilitySpike: number;
  volumeSpike: number;
}

export class EventAwareSimulator {
  private eventImpactMap: Map<EventType, EventImpactFactors>;

  constructor() {
    this.eventImpactMap = this.initializeEventImpactMap();
  }

  private initializeEventImpactMap(): Map<EventType, EventImpactFactors> {
    const map = new Map<EventType, EventImpactFactors>();

    // Earnings: significant market impact
    map.set(EventType.EARNINGS, {
      spreadWidthMultiplier: 3.5,
      fillProbabilityReduction: 0.4,
      slippageMultiplier: 2.8,
      latencyIncreaseMs: 150,
      gapProbability: 0.25,
      liquidityFactor: 0.4
    });

    // FOMC: announcement risk, pre-announcement caution
    map.set(EventType.FOMC, {
      spreadWidthMultiplier: 4.0,
      fillProbabilityReduction: 0.5,
      slippageMultiplier: 3.0,
      latencyIncreaseMs: 200,
      gapProbability: 0.35,
      liquidityFactor: 0.3
    });

    // News shock: sudden, severe
    map.set(EventType.NEWS_SHOCK, {
      spreadWidthMultiplier: 5.0,
      fillProbabilityReduction: 0.6,
      slippageMultiplier: 4.0,
      latencyIncreaseMs: 250,
      gapProbability: 0.5,
      liquidityFactor: 0.2
    });

    // Market open: first 15 min wider spreads
    map.set(EventType.MARKET_OPEN, {
      spreadWidthMultiplier: 1.5,
      fillProbabilityReduction: 0.15,
      slippageMultiplier: 1.3,
      latencyIncreaseMs: 50,
      gapProbability: 0.08,
      liquidityFactor: 0.7
    });

    // Market close: MOC imbalance
    map.set(EventType.MARKET_CLOSE, {
      spreadWidthMultiplier: 2.0,
      fillProbabilityReduction: 0.25,
      slippageMultiplier: 1.8,
      latencyIncreaseMs: 100,
      gapProbability: 0.12,
      liquidityFactor: 0.5
    });

    // Circuit breaker: halt and gap
    map.set(EventType.CIRCUIT_BREAKER, {
      spreadWidthMultiplier: 10.0,
      fillProbabilityReduction: 1.0,
      slippageMultiplier: 5.0,
      latencyIncreaseMs: 1000,
      gapProbability: 0.8,
      liquidityFactor: 0.1
    });

    // Low liquidity: holidays, pre/after hours
    map.set(EventType.LOW_LIQUIDITY, {
      spreadWidthMultiplier: 2.5,
      fillProbabilityReduction: 0.35,
      slippageMultiplier: 2.0,
      latencyIncreaseMs: 120,
      gapProbability: 0.15,
      liquidityFactor: 0.3
    });

    // Regime shift: structural change
    map.set(EventType.REGIME_SHIFT, {
      spreadWidthMultiplier: 1.0,
      fillProbabilityReduction: 0.1,
      slippageMultiplier: 1.0,
      latencyIncreaseMs: 0,
      gapProbability: 0.0,
      liquidityFactor: 1.0
    });

    return map;
  }

  /**
   * Simulate strategy execution with event-aware realism
   */
  public simulateWithEvents(
    strategy: (priceData: PriceCandle[]) => Order[],
    priceData: PriceCandle[],
    events: MarketEvent[]
  ): BacktestResult {
    const annotatedPriceData = this.injectEvents(priceData, events);
    const orders = strategy(priceData);
    const fills: BacktestFill[] = [];

    for (const order of orders) {
      const fill = this.executeOrderWithEvents(
        order,
        annotatedPriceData,
        priceData
      );
      fills.push(fill);
    }

    return this.calculateBacktestMetrics(fills);
  }

  /**
   * Execute a single order with event impact
   */
  private executeOrderWithEvents(
    order: Order,
    eventData: EventAnnotatedPriceData,
    priceData: PriceCandle[]
  ): BacktestFill {
    const orderTimestamp = order.timestamp.getTime();
    const activeEvents = eventData.eventsByTimestamp.get(orderTimestamp) || [];

    let impactFactors = this.getBaseImpactFactors();
    for (const event of activeEvents) {
      const eventFactors = this.eventImpactMap.get(event.type);
      if (eventFactors) {
        impactFactors = this.compoundFactors(impactFactors, eventFactors);
      }
    }

    const basePrice = this.findPriceAtTimestamp(order.timestamp, priceData);
    if (!basePrice) {
      return {
        order,
        fillPrice: 0,
        fillQuantity: 0,
        fillTime: order.timestamp,
        filled: false,
        slippage: 0,
        latencyMs: 0
      };
    }

    const slippage = this.calculateSlippage(
      basePrice,
      order.side,
      impactFactors.slippageMultiplier
    );
    const fillPrice = order.side === 'BUY'
      ? basePrice + slippage
      : basePrice - slippage;

    const fillProbability = this.calculateFillProbability(
      order.limitPrice,
      fillPrice,
      impactFactors.fillProbabilityReduction
    );

    const filled = Math.random() < fillProbability;
    const fillQuantity = filled
      ? this.calculateFillQuantity(
          order.quantity,
          impactFactors.liquidityFactor
        )
      : 0;

    const latencyMs =
      100 + impactFactors.latencyIncreaseMs + Math.random() * 50;
    const fillTime = new Date(
      order.timestamp.getTime() + Math.round(latencyMs)
    );

    return {
      order,
      fillPrice: filled ? fillPrice : 0,
      fillQuantity,
      fillTime,
      filled,
      slippage: filled ? Math.abs(slippage) : 0,
      latencyMs: Math.round(latencyMs)
    };
  }

  /**
   * Inject events into price data with temporal mapping
   */
  public injectEvents(
    priceData: PriceCandle[],
    eventCalendar: MarketEvent[]
  ): EventAnnotatedPriceData {
    const eventsByTimestamp = new Map<number, MarketEvent[]>();

    for (const event of eventCalendar) {
      const ts = event.timestamp.getTime();
      if (!eventsByTimestamp.has(ts)) {
        eventsByTimestamp.set(ts, []);
      }
      eventsByTimestamp.get(ts)!.push(event);
    }

    return {
      candles: priceData,
      events: eventCalendar,
      eventsByTimestamp
    };
  }

  /**
   * Generate synthetic events from volatility/volume patterns
   */
  public generateSyntheticEvents(priceData: PriceCandle[]): SyntheticEventDetection[] {
    const detections: SyntheticEventDetection[] = [];

    if (priceData.length < 20) return detections;

    for (let i = 20; i < priceData.length; i++) {
      const window = priceData.slice(i - 20, i);
      const avgVolume = window.reduce((sum, c) => sum + c.volume, 0) / window.length;
      const avgVolatility = this.calculateWindowVolatility(window);

      const currentCandle = priceData[i];
      const volumeSpike = currentCandle.volume / avgVolume;
      const volatilitySpike = this.calculateCandleVolatility(currentCandle) / avgVolatility;

      // Detect significant spikes
      if (volumeSpike > 2.5 || volatilitySpike > 2.0) {
        const eventType = this.classifyEventType(
          volumeSpike,
          volatilitySpike
        );
        detections.push({
          timestamp: currentCandle.timestamp,
          eventType,
          confidence: Math.min(
            (volumeSpike + volatilitySpike) / 4,
            1.0
          ),
          volumeSpike,
          volatilitySpike
        });
      }
    }

    return detections;
  }

  private findPriceAtTimestamp(
    timestamp: Date,
    priceData: PriceCandle[]
  ): number | null {
    const ts = timestamp.getTime();
    for (const candle of priceData) {
      if (candle.timestamp.getTime() === ts) {
        return candle.close;
      }
    }
    return null;
  }

  private getBaseImpactFactors(): EventImpactFactors {
    return {
      spreadWidthMultiplier: 1.0,
      fillProbabilityReduction: 0.0,
      slippageMultiplier: 1.0,
      latencyIncreaseMs: 0,
      gapProbability: 0.0,
      liquidityFactor: 1.0
    };
  }

  private compoundFactors(
    base: EventImpactFactors,
    event: EventImpactFactors
  ): EventImpactFactors {
    return {
      spreadWidthMultiplier: base.spreadWidthMultiplier * event.spreadWidthMultiplier,
      fillProbabilityReduction: Math.min(
        base.fillProbabilityReduction + event.fillProbabilityReduction,
        1.0
      ),
      slippageMultiplier: base.slippageMultiplier * event.slippageMultiplier,
      latencyIncreaseMs: base.latencyIncreaseMs + event.latencyIncreaseMs,
      gapProbability: Math.min(
        base.gapProbability + event.gapProbability,
        1.0
      ),
      liquidityFactor: base.liquidityFactor * event.liquidityFactor
    };
  }

  private calculateSlippage(
    basePrice: number,
    side: 'BUY' | 'SELL',
    multiplier: number
  ): number {
    const baseSlippage = basePrice * 0.001; // 0.1% base slippage
    const adjustedSlippage = baseSlippage * multiplier;
    return (Math.random() - 0.5) * 2 * adjustedSlippage;
  }

  private calculateFillProbability(
    limitPrice: number,
    fillPrice: number,
    reductionFactor: number
  ): number {
    const baseProbability = Math.min(
      Math.abs(limitPrice - fillPrice) / fillPrice + 0.5,
      1.0
    );
    return baseProbability * (1 - reductionFactor);
  }

  private calculateFillQuantity(
    requestedQuantity: number,
    liquidityFactor: number
  ): number {
    return Math.floor(requestedQuantity * liquidityFactor * (0.8 + Math.random() * 0.4));
  }

  private calculateWindowVolatility(candles: PriceCandle[]): number {
    const returns = candles.slice(1).map((c, i) => {
      const prevClose = candles[i].close;
      return Math.log(c.close / prevClose);
    });

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  private calculateCandleVolatility(candle: PriceCandle): number {
    return Math.abs(Math.log(candle.high / candle.low));
  }

  private classifyEventType(
    volumeSpike: number,
    volatilitySpike: number
  ): EventType {
    if (volatilitySpike > 3.0 && volumeSpike > 3.0) {
      return EventType.NEWS_SHOCK;
    }
    if (volatilitySpike > 2.5) {
      return EventType.EARNINGS;
    }
    if (volumeSpike > 2.5) {
      return EventType.FOMC;
    }
    return EventType.LOW_LIQUIDITY;
  }

  private calculateBacktestMetrics(fills: BacktestFill[]): BacktestResult {
    const filledTrades = fills.filter((f) => f.filled);
    const totalReturn = this.calculateReturn(filledTrades);
    const sharpeRatio = this.calculateSharpe(filledTrades);
    const maxDrawdown = this.calculateMaxDrawdown(filledTrades);
    const winRate = this.calculateWinRate(filledTrades);

    return {
      trades: fills,
      totalReturn,
      sharpeRatio,
      maxDrawdown,
      winRate,
      metadata: {
        filledCount: filledTrades.length,
        totalOrders: fills.length,
        avgSlippage: this.calculateAvgSlippage(filledTrades),
        avgLatencyMs: this.calculateAvgLatency(filledTrades)
      }
    };
  }

  private calculateReturn(fills: BacktestFill[]): number {
    if (fills.length === 0) return 0;
    let totalReturn = 0;
    for (let i = 0; i < fills.length - 1; i += 2) {
      if (fills[i + 1]) {
        const entryPrice = fills[i].fillPrice;
        const exitPrice = fills[i + 1].fillPrice;
        totalReturn += (exitPrice - entryPrice) / entryPrice;
      }
    }
    return totalReturn;
  }

  private calculateSharpe(fills: BacktestFill[]): number {
    const returns = [];
    for (let i = 0; i < fills.length - 1; i += 2) {
      if (fills[i + 1]) {
        returns.push(
          (fills[i + 1].fillPrice - fills[i].fillPrice) / fills[i].fillPrice
        );
      }
    }

    if (returns.length < 2) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev === 0 ? 0 : (mean / stdDev) * Math.sqrt(252);
  }

  private calculateMaxDrawdown(fills: BacktestFill[]): number {
    let peak = 0;
    let maxDD = 0;
    let equity = 10000;

    for (const fill of fills) {
      if (fill.filled) {
        equity *= 1 + (fill.fillPrice / 100 - 1) * 0.1;
        peak = Math.max(peak, equity);
        const dd = (peak - equity) / peak;
        maxDD = Math.max(maxDD, dd);
      }
    }

    return maxDD;
  }

  private calculateWinRate(fills: BacktestFill[]): number {
    let wins = 0;
    for (let i = 0; i < fills.length - 1; i += 2) {
      if (
        fills[i + 1] &&
        fills[i + 1].fillPrice > fills[i].fillPrice
      ) {
        wins++;
      }
    }
    const trades = Math.floor(fills.length / 2);
    return trades === 0 ? 0 : wins / trades;
  }

  private calculateAvgSlippage(fills: BacktestFill[]): number {
    const sum = fills.reduce((acc, f) => acc + f.slippage, 0);
    return fills.length === 0 ? 0 : sum / fills.length;
  }

  private calculateAvgLatency(fills: BacktestFill[]): number {
    const sum = fills.reduce((acc, f) => acc + f.latencyMs, 0);
    return fills.length === 0 ? 0 : sum / fills.length;
  }
}
