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
// MOCK DATA GENERATOR - DEPRECATED
// ============================================================================

export function generateMockDecisionPackets(builder: DecisionPacketBuilder): DecisionPacket[] {
  // Mock data generation is disabled for production library.
  // Decision packets should be created from real trading decisions via createPacket().
  return [];
}
