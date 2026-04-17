import { EventEmitter } from "events";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface MarketSnapshot {
  timestamp: number;
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  volumeLastCandle: number;
  vwap: number;
  recentCandles: Candle[];
  orderbook: {
    bids: [number, number][]; // [price, size]
    asks: [number, number][];
    depth: number;
  };
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StrategyState {
  strategyId: string;
  strategyName: string;
  parameterValues: Record<string, number | string | boolean>;
  entryRuleMatched: boolean;
  exitRuleMatched: boolean;
  entryRuleExplanation: string;
  exitRuleExplanation: string;
  strategyScore: number;
  signalStrength: number;
  confidenceLevel: number;
}

export interface RegimeContext {
  regimeType: "trending" | "mean-reverting" | "volatile" | "quiet";
  regimeConfidence: number;
  regimeDurationSeconds: number;
  trendDirection: "up" | "down" | "sideways";
  volatilityRegime: "low" | "medium" | "high";
  meanReversionStrength: number;
}

export interface OrderFlowFeatures {
  imbalanceRatio: number;
  tradeFlowToxicity: number;
  largeBlockActivityCount: number;
  buyPressure: number;
  sellPressure: number;
  netOrderFlow: number;
}

export interface ModelScore {
  modelName: string;
  modelVersion: string;
  prediction: number; // 0-1 or -1 to 1
  confidenceInterval: [number, number];
  explainability: {
    topFeatures: Array<{ name: string; importance: number; contribution: number }>;
    shapValues: Record<string, number>;
  };
}

export interface RiskCheck {
  checkName: string;
  passed: boolean;
  value: number;
  threshold: number;
  message: string;
}

export interface RiskMetrics {
  currentExposure: number;
  exposureLimit: number;
  varContribution: number;
  sharpeRatio: number;
  drawdownRisk: number;
  riskChecks: RiskCheck[];
  allChecksPassed: boolean;
}

export interface FinalAction {
  actionType: "buy" | "sell" | "hold";
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: "immediate-or-cancel" | "fill-or-kill" | "good-for-day";
  orderType: "market" | "limit" | "stop-limit";
}

export interface TimingInfo {
  signalTimestamp: number;
  decisionTimestamp: number;
  submissionTimestamp: number;
  latencyBreakdown: {
    strategyEvaluationMs: number;
    riskCheckMs: number;
    orderConstructionMs: number;
    networkDelayMs: number;
    totalMs: number;
  };
}

export interface DecisionPacket {
  version: string;
  packetId: string;
  tradeId: string;
  symbol: string;
  timestamp: number;
  marketSnapshot: MarketSnapshot;
  strategyState: StrategyState;
  regimeContext: RegimeContext;
  orderFlowFeatures: OrderFlowFeatures;
  modelScores: ModelScore[];
  riskMetrics: RiskMetrics;
  finalAction: FinalAction;
  timingInfo: TimingInfo;
  notes: string;
  metadata: Record<string, any>;
}

export interface PacketComparison {
  packetIdA: string;
  packetIdB: string;
  divergences: Array<{
    field: string;
    valueA: any;
    valueB: any;
    difference: number | string;
    impact: "high" | "medium" | "low";
  }>;
  slippageAnalysis: {
    expectedFillPrice: number;
    actualFillPrice: number;
    slippageBps: number;
    slippageReason: string;
  };
  timingAnalysis: {
    expectedLatencyMs: number;
    actualLatencyMs: number;
    latencyVariance: number;
  };
}

// ============================================================================
// DECISION PACKET BUILDER CLASS
// ============================================================================

export class DecisionPacketBuilder extends EventEmitter {
  private packetBuffer: Map<string, DecisionPacket> = new Map();
  private readonly MAX_BUFFER_SIZE = 10000;
  private schemaVersion = "1.0.0";
  private insertionOrder: string[] = [];

  constructor() {
    super();
  }

  /**
   * Create and store a new decision packet
   */
  public createPacket(
    tradeId: string,
    symbol: string,
    marketSnapshot: MarketSnapshot,
    strategyState: StrategyState,
    regimeContext: RegimeContext,
    orderFlowFeatures: OrderFlowFeatures,
    modelScores: ModelScore[],
    riskMetrics: RiskMetrics,
    finalAction: FinalAction,
    timingInfo: TimingInfo,
    notes: string = "",
    metadata: Record<string, any> = {}
  ): DecisionPacket {
    const packetId = this.generatePacketId(tradeId, symbol);
    const packet: DecisionPacket = {
      version: this.schemaVersion,
      packetId,
      tradeId,
      symbol,
      timestamp: Date.now(),
      marketSnapshot,
      strategyState,
      regimeContext,
      orderFlowFeatures,
      modelScores,
      riskMetrics,
      finalAction,
      timingInfo,
      notes,
      metadata,
    };

    // Maintain ring buffer of 10,000 packets
    if (this.packetBuffer.size >= this.MAX_BUFFER_SIZE) {
      const oldestId = this.insertionOrder.shift();
      if (oldestId) {
        this.packetBuffer.delete(oldestId);
      }
    }

    this.packetBuffer.set(packetId, packet);
    this.insertionOrder.push(packetId);

    this.emit("packet-created", { packetId, tradeId, symbol });
    return packet;
  }

  /**
   * Retrieve a packet by ID
   */
  public getPacket(packetId: string): DecisionPacket | null {
    return this.packetBuffer.get(packetId) || null;
  }

  /**
   * Retrieve packets by trade ID
   */
  public getPacketsByTradeId(tradeId: string): DecisionPacket[] {
    return Array.from(this.packetBuffer.values()).filter(
      (p) => p.tradeId === tradeId
    );
  }

  /**
   * Retrieve packets by time range
   */
  public getPacketsByTimeRange(
    startTime: number,
    endTime: number
  ): DecisionPacket[] {
    return Array.from(this.packetBuffer.values()).filter(
      (p) => p.timestamp >= startTime && p.timestamp <= endTime
    );
  }

  /**
   * Retrieve packets by strategy
   */
  public getPacketsByStrategy(strategyId: string): DecisionPacket[] {
    return Array.from(this.packetBuffer.values()).filter(
      (p) => p.strategyState.strategyId === strategyId
    );
  }

  /**
   * Retrieve packets by symbol
   */
  public getPacketsBySymbol(symbol: string): DecisionPacket[] {
    return Array.from(this.packetBuffer.values()).filter(
      (p) => p.symbol === symbol
    );
  }

  /**
   * Compare two decision packets
   */
  public comparePackets(
    packetIdA: string,
    packetIdB: string
  ): PacketComparison | null {
    const packetA = this.packetBuffer.get(packetIdA);
    const packetB = this.packetBuffer.get(packetIdB);

    if (!packetA || !packetB) {
      return null;
    }

    const divergences: PacketComparison["divergences"] = [];

    // Compare market snapshots
    if (packetA.marketSnapshot.price !== packetB.marketSnapshot.price) {
      divergences.push({
        field: "marketSnapshot.price",
        valueA: packetA.marketSnapshot.price,
        valueB: packetB.marketSnapshot.price,
        difference: Math.abs(packetA.marketSnapshot.price - packetB.marketSnapshot.price),
        impact: "high",
      });
    }

    // Compare strategy states
    if (packetA.strategyState.signalStrength !== packetB.strategyState.signalStrength) {
      divergences.push({
        field: "strategyState.signalStrength",
        valueA: packetA.strategyState.signalStrength,
        valueB: packetB.strategyState.signalStrength,
        difference: Math.abs(
          packetA.strategyState.signalStrength - packetB.strategyState.signalStrength
        ),
        impact: "medium",
      });
    }

    // Compare final actions
    if (packetA.finalAction.size !== packetB.finalAction.size) {
      divergences.push({
        field: "finalAction.size",
        valueA: packetA.finalAction.size,
        valueB: packetB.finalAction.size,
        difference: Math.abs(packetA.finalAction.size - packetB.finalAction.size),
        impact: "high",
      });
    }

    // Slippage analysis
    const expectedPrice = packetA.finalAction.limitPrice || packetA.marketSnapshot.price;
    const actualPrice = packetB.finalAction.limitPrice || packetB.marketSnapshot.price;
    const slippageBps = ((actualPrice - expectedPrice) / expectedPrice) * 10000;

    const slippageAnalysis = {
      expectedFillPrice: expectedPrice,
      actualFillPrice: actualPrice,
      slippageBps,
      slippageReason: slippageBps > 0 ? "Adverse slippage" : "Favorable slippage",
    };

    // Timing analysis
    const expectedLatency = packetA.timingInfo.latencyBreakdown.totalMs;
    const actualLatency = packetB.timingInfo.latencyBreakdown.totalMs;
    const latencyVariance = actualLatency - expectedLatency;

    const timingAnalysis = {
      expectedLatencyMs: expectedLatency,
      actualLatencyMs: actualLatency,
      latencyVariance,
    };

    return {
      packetIdA,
      packetIdB,
      divergences,
      slippageAnalysis,
      timingAnalysis,
    };
  }

  /**
   * Export packet as JSON
   */
  public exportPacketAsJson(packetId: string): string | null {
    const packet = this.packetBuffer.get(packetId);
    if (!packet) {
      return null;
    }
    return JSON.stringify(packet, null, 2);
  }

  /**
   * Export multiple packets as JSON array
   */
  public exportPacketsAsJson(packetIds: string[]): string {
    const packets = packetIds
      .map((id) => this.packetBuffer.get(id))
      .filter((p) => p !== undefined);
    return JSON.stringify(packets, null, 2);
  }

  /**
   * Export all packets by time range
   */
  public exportByTimeRangeAsJson(startTime: number, endTime: number): string {
    const packets = this.getPacketsByTimeRange(startTime, endTime);
    return JSON.stringify(packets, null, 2);
  }

  /**
   * Get buffer statistics
   */
  public getBufferStats(): {
    totalPackets: number;
    maxCapacity: number;
    utilizationPercent: number;
    symbolCount: number;
    strategyCount: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    const packets = Array.from(this.packetBuffer.values());
    const symbols = new Set(packets.map((p) => p.symbol));
    const strategies = new Set(packets.map((p) => p.strategyState.strategyId));

    const timestamps = packets.map((p) => p.timestamp);
    const oldestTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : null;
    const newestTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : null;

    return {
      totalPackets: this.packetBuffer.size,
      maxCapacity: this.MAX_BUFFER_SIZE,
      utilizationPercent: (this.packetBuffer.size / this.MAX_BUFFER_SIZE) * 100,
      symbolCount: symbols.size,
      strategyCount: strategies.size,
      oldestTimestamp,
      newestTimestamp,
    };
  }

  /**
   * Clear all packets from buffer
   */
  public clearBuffer(): void {
    this.packetBuffer.clear();
    this.insertionOrder = [];
    this.emit("buffer-cleared");
  }

  /**
   * Generate unique packet ID
   */
  private generatePacketId(tradeId: string, symbol: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `pkt_${symbol}_${tradeId}_${timestamp}_${random}`;
  }

  /**
   * Get schema version
   */
  public getSchemaVersion(): string {
    return this.schemaVersion;
  }
}

// ============================================================================
// MOCK DATA GENERATOR (25 Pre-built Decision Packets)
// ============================================================================

export function generateMockDecisionPackets(builder: DecisionPacketBuilder): DecisionPacket[] {
  const symbols = ["BTCUSD", "ETHUSD", "AAPL", "GOOGL", "SPY"];
  const strategies = [
    { id: "strat_momentum", name: "Momentum Strategy" },
    { id: "strat_meanrev", name: "Mean Reversion Strategy" },
    { id: "strat_arb", name: "Arbitrage Strategy" },
    { id: "strat_mlmodel", name: "ML Model Strategy" },
    { id: "strat_trend", name: "Trend Following Strategy" },
  ];

  const packets: DecisionPacket[] = [];
  const baseTime = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

  for (let i = 0; i < 25; i++) {
    const symbol = symbols[i % symbols.length];
    const strategy = strategies[i % strategies.length];
    const timestamp = baseTime + i * 60 * 60 * 1000; // 1 hour apart
    const basePrice = 40000 + Math.random() * 10000;

    const marketSnapshot: MarketSnapshot = {
      timestamp,
      symbol,
      price: basePrice,
      bid: basePrice - 2,
      ask: basePrice + 2,
      spread: 4,
      volume24h: Math.random() * 1000000,
      volumeLastCandle: Math.random() * 50000,
      vwap: basePrice * 0.99,
      recentCandles: [
        {
          timestamp: timestamp - 3600000,
          open: basePrice - 200,
          high: basePrice + 300,
          low: basePrice - 400,
          close: basePrice - 100,
          volume: 45000,
        },
        {
          timestamp: timestamp - 1800000,
          open: basePrice - 100,
          high: basePrice + 200,
          low: basePrice - 300,
          close: basePrice + 150,
          volume: 38000,
        },
      ],
      orderbook: {
        bids: [
          [basePrice - 1, 10],
          [basePrice - 2, 20],
          [basePrice - 3, 30],
        ],
        asks: [
          [basePrice + 1, 15],
          [basePrice + 2, 25],
          [basePrice + 3, 35],
        ],
        depth: 50,
      },
    };

    const strategyState: StrategyState = {
      strategyId: strategy.id,
      strategyName: strategy.name,
      parameterValues: {
        lookbackPeriod: 20 + i,
        threshold: 0.5 + Math.random() * 0.3,
        maxExposure: 0.1 + Math.random() * 0.05,
        stopLossPercent: 0.02 + Math.random() * 0.02,
      },
      entryRuleMatched: Math.random() > 0.3,
      exitRuleMatched: Math.random() > 0.7,
      entryRuleExplanation: `Price crossed above ${50 + i}-period MA with ${(Math.random() * 100).toFixed(2)}% signal strength`,
      exitRuleExplanation: "Stop-loss or profit-taking level reached",
      strategyScore: 0.6 + Math.random() * 0.35,
      signalStrength: 0.5 + Math.random() * 0.45,
      confidenceLevel: 0.65 + Math.random() * 0.3,
    };

    const regimes = ["trending", "mean-reverting", "volatile", "quiet"] as const;
    const regimeContext: RegimeContext = {
      regimeType: regimes[i % regimes.length],
      regimeConfidence: 0.7 + Math.random() * 0.25,
      regimeDurationSeconds: 3600 + Math.random() * 7200,
      trendDirection: (["up", "down", "sideways"] as const)[i % 3],
      volatilityRegime: (["low", "medium", "high"] as const)[i % 3],
      meanReversionStrength: 0.4 + Math.random() * 0.4,
    };

    const orderFlowFeatures: OrderFlowFeatures = {
      imbalanceRatio: 0.5 + Math.random() * 0.5,
      tradeFlowToxicity: Math.random() * 0.6,
      largeBlockActivityCount: Math.floor(Math.random() * 15),
      buyPressure: 0.4 + Math.random() * 0.4,
      sellPressure: 0.3 + Math.random() * 0.4,
      netOrderFlow: (Math.random() - 0.5) * 10000,
    };

    const modelScores: ModelScore[] = [
      {
        modelName: "LSTM Predictor",
        modelVersion: "2.1.0",
        prediction: 0.65 + Math.random() * 0.3,
        confidenceInterval: [0.55, 0.85],
        explainability: {
          topFeatures: [
            { name: "volatility", importance: 0.35, contribution: 0.2 },
            { name: "momentum", importance: 0.28, contribution: 0.18 },
            { name: "mean_reversion", importance: 0.18, contribution: -0.08 },
            { name: "order_flow", importance: 0.15, contribution: 0.12 },
            { name: "regime_signal", importance: 0.04, contribution: 0.03 },
          ],
          shapValues: {
            volatility: 0.08,
            momentum: 0.065,
            mean_reversion: -0.028,
            order_flow: 0.042,
          },
        },
      },
      {
        modelName: "Gradient Boost Classifier",
        modelVersion: "3.0.2",
        prediction: 0.58 + Math.random() * 0.35,
        confidenceInterval: [0.48, 0.88],
        explainability: {
          topFeatures: [
            { name: "volatility", importance: 0.32, contribution: 0.18 },
            { name: "regime_type", importance: 0.25, contribution: 0.14 },
            { name: "order_imbalance", importance: 0.22, contribution: 0.12 },
            { name: "vwap_distance", importance: 0.12, contribution: 0.06 },
            { name: "spread", importance: 0.09, contribution: 0.04 },
          ],
          shapValues: {
            volatility: 0.072,
            regime_type: 0.056,
            order_imbalance: 0.048,
          },
        },
      },
    ];

    const riskChecks: RiskCheck[] = [
      {
        checkName: "Daily Loss Limit",
        passed: true,
        value: 2500 + Math.random() * 2000,
        threshold: 5000,
        message: "Below daily loss limit",
      },
      {
        checkName: "Position Size Limit",
        passed: true,
        value: 0.08 + Math.random() * 0.05,
        threshold: 0.15,
        message: "Position within allocation limits",
      },
      {
        checkName: "Drawdown Limit",
        passed: Math.random() > 0.1,
        value: 0.05 + Math.random() * 0.08,
        threshold: 0.15,
        message: "Drawdown within acceptable range",
      },
      {
        checkName: "Margin Requirement",
        passed: true,
        value: 0.25 + Math.random() * 0.15,
        threshold: 0.35,
        message: "Sufficient margin available",
      },
    ];

    const riskMetrics: RiskMetrics = {
      currentExposure: 0.07 + Math.random() * 0.06,
      exposureLimit: 0.15,
      varContribution: 150 + Math.random() * 250,
      sharpeRatio: 0.8 + Math.random() * 1.2,
      drawdownRisk: 0.04 + Math.random() * 0.08,
      riskChecks,
      allChecksPassed: riskChecks.every((c) => c.passed),
    };

    const finalAction: FinalAction = {
      actionType: (["buy", "sell", "hold"] as const)[i % 3],
      size: 0.5 + Math.random() * 2.5,
      limitPrice: basePrice + (Math.random() - 0.5) * 100,
      stopPrice: basePrice - 200 - Math.random() * 400,
      timeInForce: (["immediate-or-cancel", "fill-or-kill", "good-for-day"] as const)[
        i % 3
      ],
      orderType: (["market", "limit"] as const)[i % 2],
    };

    const timingInfo: TimingInfo = {
      signalTimestamp: timestamp,
      decisionTimestamp: timestamp + Math.random() * 50,
      submissionTimestamp: timestamp + 50 + Math.random() * 30,
      latencyBreakdown: {
        strategyEvaluationMs: 8 + Math.random() * 12,
        riskCheckMs: 5 + Math.random() * 8,
        orderConstructionMs: 3 + Math.random() * 5,
        networkDelayMs: 2 + Math.random() * 8,
        totalMs: 18 + Math.random() * 20,
      },
    };

    const packet = builder.createPacket(
      `trade_${symbol}_${i}`,
      symbol,
      marketSnapshot,
      strategyState,
      regimeContext,
      orderFlowFeatures,
      modelScores,
      riskMetrics,
      finalAction,
      timingInfo,
      `Mock packet ${i + 1} for ${symbol}`,
      { source: "mock_generator", batchId: "batch_001" }
    );

    packets.push(packet);
  }

  return packets;
}
