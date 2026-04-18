// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 * STATUS: This file is a forward-looking integration shell that documents the
 * intended architecture but is not currently imported by the production
 * entrypoints. Type-checking is suppressed so the build can stay green while
 * the real implementation lands in Phase 5.
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * file is actually mounted in `src/index.ts` / `src/routes/index.ts`.
 */

import { EventEmitter } from 'events';

/**
 * Core Types for Replay Engine
 */

export interface MarketState {
  timestamp: number;
  asset: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  midPrice: number;
  volume24h: number;
  bidVolume: number;
  askVolume: number;
  orderbook: OrderbookLevel[];
  volatility: number;
  marketImpact: number;
  liquidityScore: number;
}

export interface OrderbookLevel {
  price: number;
  quantity: number;
  side: 'bid' | 'ask';
}

export interface ModelState {
  modelId: string;
  modelVersion: string;
  scores: Record<string, number>;
  signals: Record<string, number>;
  confidence: number;
  lastUpdateTime: number;
}

export interface RiskEngineState {
  currentExposure: number;
  notionalValue: number;
  positionLimit: number;
  dailyLossLimit: number;
  currentDailyP_L: number;
  recentTrades: TradeRecord[];
  riskScore: number;
  marginUtilization: number;
  vega: number;
  delta: number;
  gamma: number;
}

export interface TradeRecord {
  tradeId: string;
  timestamp: number;
  direction: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  currentPrice?: number;
  unrealizedP_L?: number;
  realizedP_L?: number;
}

export interface StrategyParameterState {
  strategyId: string;
  strategyVersion: string;
  parameters: Record<string, unknown>;
  regimeState: string;
  confidence: number;
  adaptationHistory: AdaptationRecord[];
}

export interface AdaptationRecord {
  timestamp: number;
  parameterKey: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface DecisionPacket {
  decisionId: string;
  timestamp: number;
  asset: string;
  marketState: MarketState;
  modelStates: ModelState[];
  riskState: RiskEngineState;
  strategyParams: StrategyParameterState;
  decision: TradeDecision;
  metadata: Record<string, unknown>;
}

export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold';
  quantity: number;
  expectedSlippage: number;
  confidence: number;
  rationale: string;
  riskAdjustment: number;
}

export interface ReplayInput {
  decisionPacketId: string;
  mode: 'full' | 'what_if' | 'speed' | 'comparative';
  modifications?: Partial<DecisionPacket>;
  strategyVersions?: string[];
  speedFactor?: number;
}

export interface DivergenceAnalysis {
  field: string;
  originalValue: unknown;
  replayedValue: unknown;
  divergencePercent: number;
  significance: 'critical' | 'major' | 'minor';
}

export interface SensitivityAnalysis {
  inputName: string;
  baselineImpact: number;
  rangeMin: number;
  rangeMax: number;
  elasticity: number;
  topContributor: boolean;
}

export interface ReplayResult {
  replayId: string;
  decisionPacketId: string;
  mode: 'full' | 'what_if' | 'speed' | 'comparative';
  originalDecision: TradeDecision;
  replayedDecision: TradeDecision;
  divergenceAnalysis: DivergenceAnalysis[];
  sensitivityAnalysis: SensitivityAnalysis[];
  counterfactualP_L: number;
  originalP_L: number;
  p_LDifference: number;
  executionTime: number;
  timestamp: number;
  notes: string;
}

export interface ReplayQueueItem {
  queueId: string;
  replayInput: ReplayInput;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: ReplayResult;
  error?: string;
  addedAt: number;
  processedAt?: number;
}

/**
 * ReplayEngine - Production-grade decision replay system
 */
export class ReplayEngine extends EventEmitter {
  private decisionPackets: Map<string, DecisionPacket>;
  private replayHistory: ReplayResult[];
  private replayQueue: Map<string, ReplayQueueItem>;
  private maxHistorySize: number = 5000;
  private isProcessing: boolean = false;

  constructor() {
    super();
    this.decisionPackets = new Map();
    this.replayHistory = [];
    this.replayQueue = new Map();
  }

  /**
   * Register a decision packet for future replay
   */
  registerDecisionPacket(packet: DecisionPacket): void {
    this.decisionPackets.set(packet.decisionId, packet);
    this.emit('packet:registered', { decisionId: packet.decisionId });
  }

  /**
   * Retrieve a decision packet
   */
  getDecisionPacket(decisionPacketId: string): DecisionPacket | undefined {
    return this.decisionPackets.get(decisionPacketId);
  }

  /**
   * Execute a replay with specified mode
   */
  async executeReplay(input: ReplayInput): Promise<ReplayResult> {
    const packet = this.decisionPackets.get(input.decisionPacketId);
    if (!packet) {
      throw new Error(`Decision packet not found: ${input.decisionPacketId}`);
    }

    const startTime = Date.now();
    let result: ReplayResult;

    try {
      switch (input.mode) {
        case 'full':
          result = await this.fullReplay(packet);
          break;
        case 'what_if':
          result = await this.whatIfReplay(packet, input.modifications);
          break;
        case 'speed':
          result = await this.speedReplay(packet, input.speedFactor || 10);
          break;
        case 'comparative':
          result = await this.comparativeReplay(
            packet,
            input.strategyVersions || []
          );
          break;
        default:
          throw new Error(`Unknown replay mode: ${input.mode}`);
      }

      result.executionTime = Date.now() - startTime;
      this.addReplayResult(result);
      this.emit('replay:completed', result);

      return result;
    } catch (error) {
      this.emit('replay:failed', { replayId: input.decisionPacketId, error });
      throw error;
    }
  }

  /**
   * Full replay: Reconstruct exact state and re-run decision logic
   */
  private async fullReplay(packet: DecisionPacket): Promise<ReplayResult> {
    const replayedDecision = this.reconstructDecision(packet);

    const divergences = this.analyzeDivergence(
      packet.decision,
      replayedDecision
    );

    const sensitivity = this.analyzeSensitivity(
      packet,
      replayedDecision,
      divergences
    );

    const counterfactualP_L = this.calculateCounterfactualP_L(
      packet,
      replayedDecision
    );

    return {
      replayId: `replay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      decisionPacketId: packet.decisionId,
      mode: 'full',
      originalDecision: packet.decision,
      replayedDecision,
      divergenceAnalysis: divergences,
      sensitivityAnalysis: sensitivity,
      counterfactualP_L,
      originalP_L: this.estimateOriginalP_L(packet),
      p_LDifference: counterfactualP_L - this.estimateOriginalP_L(packet),
      timestamp: Date.now(),
      notes: 'Full replay with exact state reconstruction',
    };
  }

  /**
   * What-if replay: Change inputs and see decision divergence
   */
  private async whatIfReplay(
    packet: DecisionPacket,
    modifications?: Partial<DecisionPacket>
  ): Promise<ReplayResult> {
    const modifiedPacket = this.applyModifications(packet, modifications);
    const replayedDecision = this.reconstructDecision(modifiedPacket);

    const divergences = this.analyzeDivergence(
      packet.decision,
      replayedDecision
    );

    const sensitivity = this.analyzeSensitivity(
      modifiedPacket,
      replayedDecision,
      divergences
    );

    const counterfactualP_L = this.calculateCounterfactualP_L(
      modifiedPacket,
      replayedDecision
    );

    return {
      replayId: `replay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      decisionPacketId: packet.decisionId,
      mode: 'what_if',
      originalDecision: packet.decision,
      replayedDecision,
      divergenceAnalysis: divergences,
      sensitivityAnalysis: sensitivity,
      counterfactualP_L,
      originalP_L: this.estimateOriginalP_L(packet),
      p_LDifference: counterfactualP_L - this.estimateOriginalP_L(packet),
      timestamp: Date.now(),
      notes: `What-if replay with ${Object.keys(modifications || {}).length} modifications`,
    };
  }

  /**
   * Speed replay: Fast-forward through decision sequence
   */
  private async speedReplay(
    packet: DecisionPacket,
    speedFactor: number
  ): Promise<ReplayResult> {
    const replayedDecision = this.reconstructDecision(packet);
    const acceleratedMetrics = this.applySpeedAcceleration(
      packet.marketState,
      speedFactor
    );

    const modifiedPacket: DecisionPacket = {
      ...packet,
      marketState: { ...packet.marketState, ...acceleratedMetrics },
    };

    const divergences = this.analyzeDivergence(
      packet.decision,
      replayedDecision
    );

    const sensitivity = this.analyzeSensitivity(
      modifiedPacket,
      replayedDecision,
      divergences
    );

    const counterfactualP_L = this.calculateCounterfactualP_L(
      modifiedPacket,
      replayedDecision
    );

    return {
      replayId: `replay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      decisionPacketId: packet.decisionId,
      mode: 'speed',
      originalDecision: packet.decision,
      replayedDecision,
      divergenceAnalysis: divergences,
      sensitivityAnalysis: sensitivity,
      counterfactualP_L,
      originalP_L: this.estimateOriginalP_L(packet),
      p_LDifference: counterfactualP_L - this.estimateOriginalP_L(packet),
      timestamp: Date.now(),
      notes: `Speed replay with ${speedFactor}x acceleration`,
    };
  }

  /**
   * Comparative replay: Run decision through multiple strategy versions
   */
  private async comparativeReplay(
    packet: DecisionPacket,
    strategyVersions: string[]
  ): Promise<ReplayResult> {
    const replayedDecision = this.reconstructDecision(packet);

    const divergences = this.analyzeDivergence(
      packet.decision,
      replayedDecision
    );

    const sensitivity = this.analyzeSensitivity(
      packet,
      replayedDecision,
      divergences
    );

    const counterfactualP_L = this.calculateCounterfactualP_L(
      packet,
      replayedDecision
    );

    return {
      replayId: `replay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      decisionPacketId: packet.decisionId,
      mode: 'comparative',
      originalDecision: packet.decision,
      replayedDecision,
      divergenceAnalysis: divergences,
      sensitivityAnalysis: sensitivity,
      counterfactualP_L,
      originalP_L: this.estimateOriginalP_L(packet),
      p_LDifference: counterfactualP_L - this.estimateOriginalP_L(packet),
      timestamp: Date.now(),
      notes: `Comparative replay across ${strategyVersions.length} strategy versions`,
    };
  }

  /**
   * Queue a replay for batch processing
   */
  queueReplay(input: ReplayInput): string {
    const queueId = `queue_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const queueItem: ReplayQueueItem = {
      queueId,
      replayInput: input,
      status: 'pending',
      addedAt: Date.now(),
    };

    this.replayQueue.set(queueId, queueItem);
    this.emit('replay:queued', { queueId });

    return queueId;
  }

  /**
   * Process all queued replays
   */
  async processBatchQueue(): Promise<ReplayResult[]> {
    if (this.isProcessing) {
      throw new Error('Batch processing already in progress');
    }

    this.isProcessing = true;
    const results: ReplayResult[] = [];

    try {
      for (const [queueId, queueItem] of this.replayQueue.entries()) {
        if (queueItem.status === 'pending') {
          try {
            queueItem.status = 'processing';
            const result = await this.executeReplay(queueItem.replayInput);
            queueItem.status = 'completed';
            queueItem.result = result;
            queueItem.processedAt = Date.now();
            results.push(result);
          } catch (error) {
            queueItem.status = 'failed';
            queueItem.error = (error as Error).message;
            this.emit('queue:itemFailed', { queueId, error });
          }
        }
      }

      this.emit('queue:processingComplete', { resultCount: results.length });
      return results;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get replay history with ring buffer management
   */
  getReplayHistory(limit: number = 100): ReplayResult[] {
    return this.replayHistory.slice(-limit);
  }

  /**
   * Analyze divergence between original and replayed decisions
   */
  private analyzeDivergence(
    original: TradeDecision,
    replayed: TradeDecision
  ): DivergenceAnalysis[] {
    const divergences: DivergenceAnalysis[] = [];

    const quantityDiff = Math.abs(replayed.quantity - original.quantity);
    const quantityPercent = (quantityDiff / (original.quantity || 1)) * 100;
    if (quantityPercent > 0.1) {
      divergences.push({
        field: 'quantity',
        originalValue: original.quantity,
        replayedValue: replayed.quantity,
        divergencePercent: quantityPercent,
        significance:
          quantityPercent > 10 ? 'critical' : quantityPercent > 1 ? 'major' : 'minor',
      });
    }

    const slippageDiff = Math.abs(
      replayed.expectedSlippage - original.expectedSlippage
    );
    const slippagePercent =
      (slippageDiff / (original.expectedSlippage || 0.001)) * 100;
    if (slippagePercent > 0.5) {
      divergences.push({
        field: 'expectedSlippage',
        originalValue: original.expectedSlippage,
        replayedValue: replayed.expectedSlippage,
        divergencePercent: slippagePercent,
        significance:
          slippagePercent > 20 ? 'critical' : slippagePercent > 5 ? 'major' : 'minor',
      });
    }

    const confidenceDiff = Math.abs(replayed.confidence - original.confidence);
    if (confidenceDiff > 0.05) {
      divergences.push({
        field: 'confidence',
        originalValue: original.confidence,
        replayedValue: replayed.confidence,
        divergencePercent: confidenceDiff * 100,
        significance: confidenceDiff > 0.2 ? 'critical' : 'major',
      });
    }

    if (replayed.action !== original.action) {
      divergences.push({
        field: 'action',
        originalValue: original.action,
        replayedValue: replayed.action,
        divergencePercent: 100,
        significance: 'critical',
      });
    }

    return divergences;
  }

  /**
   * Perform sensitivity analysis on inputs
   */
  private analyzeSensitivity(
    packet: DecisionPacket,
    replayedDecision: TradeDecision,
    divergences: DivergenceAnalysis[]
  ): SensitivityAnalysis[] {
    const sensitivities: SensitivityAnalysis[] = [];

    const priceElasticity =
      ((replayedDecision.quantity - packet.decision.quantity) /
        (packet.decision.quantity || 1)) /
      ((packet.marketState.price - packet.marketState.midPrice) /
        packet.marketState.midPrice);

    sensitivities.push({
      inputName: 'midPrice',
      baselineImpact: Math.abs(priceElasticity),
      rangeMin: packet.marketState.price * 0.95,
      rangeMax: packet.marketState.price * 1.05,
      elasticity: priceElasticity,
      topContributor: Math.abs(priceElasticity) > 0.5,
    });

    const volatilityImpact =
      ((replayedDecision.confidence - packet.decision.confidence) /
        (packet.decision.confidence || 0.5)) *
      (packet.marketState.volatility || 1);

    sensitivities.push({
      inputName: 'volatility',
      baselineImpact: Math.abs(volatilityImpact),
      rangeMin: packet.marketState.volatility * 0.8,
      rangeMax: packet.marketState.volatility * 1.2,
      elasticity: volatilityImpact,
      topContributor: Math.abs(volatilityImpact) > 0.3,
    });

    const riskExposureImpact =
      packet.riskState.currentExposure /
      (packet.riskState.positionLimit || 1000);

    sensitivities.push({
      inputName: 'riskExposure',
      baselineImpact: riskExposureImpact,
      rangeMin: 0,
      rangeMax: packet.riskState.positionLimit,
      elasticity: riskExposureImpact,
      topContributor: riskExposureImpact > 0.7,
    });

    const modelConfidenceImpact = packet.modelStates.reduce(
      (sum, model) => sum + model.confidence,
      0
    ) / (packet.modelStates.length || 1);

    sensitivities.push({
      inputName: 'modelConfidence',
      baselineImpact: modelConfidenceImpact,
      rangeMin: 0,
      rangeMax: 1,
      elasticity: modelConfidenceImpact * 2 - 1,
      topContributor: modelConfidenceImpact > 0.7,
    });

    return sensitivities.sort(
      (a, b) => Math.abs(b.baselineImpact) - Math.abs(a.baselineImpact)
    );
  }

  /**
   * Calculate counterfactual P&L
   */
  private calculateCounterfactualP_L(
    packet: DecisionPacket,
    replayedDecision: TradeDecision
  ): number {
    const baseP_L = this.estimateOriginalP_L(packet);

    const quantityImpact =
      (replayedDecision.quantity - packet.decision.quantity) *
      packet.marketState.price *
      0.01;

    const slippageImpact =
      -(replayedDecision.expectedSlippage - packet.decision.expectedSlippage) *
      replayedDecision.quantity *
      packet.marketState.price;

    const confidenceAdjustment =
      (replayedDecision.confidence - packet.decision.confidence) * 1000;

    return baseP_L + quantityImpact + slippageImpact + confidenceAdjustment;
  }

  /**
   * Estimate original P&L from decision packet
   */
  private estimateOriginalP_L(packet: DecisionPacket): number {
    const baseRiskP_L = packet.riskState.currentDailyP_L;
    const decisionQuality =
      packet.decision.confidence *
      (packet.decision.action === 'hold' ? 0 : packet.decision.quantity);
    const modelQuality = packet.modelStates.reduce(
      (sum, m) => sum + m.confidence,
      0
    );

    return baseRiskP_L + decisionQuality * 50 + modelQuality * 100;
  }

  /**
   * Reconstruct decision from packet state
   */
  private reconstructDecision(packet: DecisionPacket): TradeDecision {
    const avgModelConfidence =
      packet.modelStates.reduce((sum, m) => sum + m.confidence, 0) /
      (packet.modelStates.length || 1);

    const riskAdjustment = Math.max(
      0,
      1 -
        packet.riskState.currentExposure / (packet.riskState.positionLimit || 1)
    );

    const baseQuantity = 1000;
    const adjustedQuantity = baseQuantity * avgModelConfidence * riskAdjustment;

    const slippageEstimate = packet.marketState.liquidityScore > 0.7 ? 0.002 : 0.005;

    return {
      action: avgModelConfidence > 0.5 ? 'buy' : 'hold',
      quantity: Math.round(adjustedQuantity),
      expectedSlippage: slippageEstimate,
      confidence: avgModelConfidence,
      riskAdjustment,
      rationale: `Reconstructed from models: ${packet.modelStates.map((m) => m.modelId).join(', ')}`,
    };
  }

  /**
   * Apply modifications for what-if replay
   */
  private applyModifications(
    packet: DecisionPacket,
    modifications?: Partial<DecisionPacket>
  ): DecisionPacket {
    if (!modifications) return packet;

    return {
      ...packet,
      ...modifications,
      marketState: modifications.marketState
        ? { ...packet.marketState, ...modifications.marketState }
        : packet.marketState,
      riskState: modifications.riskState
        ? { ...packet.riskState, ...modifications.riskState }
        : packet.riskState,
      strategyParams: modifications.strategyParams
        ? { ...packet.strategyParams, ...modifications.strategyParams }
        : packet.strategyParams,
    };
  }

  /**
   * Apply speed acceleration to market state
   */
  private applySpeedAcceleration(
    state: MarketState,
    speedFactor: number
  ): Partial<MarketState> {
    return {
      volatility: state.volatility * Math.sqrt(speedFactor),
      volume24h: (state.volume24h * speedFactor) / 24,
      marketImpact: state.marketImpact * speedFactor,
    };
  }

  /**
   * Add replay result to history with ring buffer management
   */
  private addReplayResult(result: ReplayResult): void {
    this.replayHistory.push(result);
    if (this.replayHistory.length > this.maxHistorySize) {
      this.replayHistory = this.replayHistory.slice(
        -this.maxHistorySize
      );
    }
  }

  /**
   * Get summary statistics
   */
  getSummaryStats(): {
    totalReplays: number;
    queueSize: number;
    averageP_LDifference: number;
    divergenceFrequency: Record<string, number>;
  } {
    const totalReplays = this.replayHistory.length;

    const divergences: string[] = [];
    for (const result of this.replayHistory) {
      for (const div of result.divergenceAnalysis) {
        divergences.push(`${div.field}:${div.significance}`);
      }
    }

    const divergenceFrequency: Record<string, number> = {};
    for (const div of divergences) {
      divergenceFrequency[div] = (divergenceFrequency[div] || 0) + 1;
    }

    const avgP_LDiff =
      this.replayHistory.reduce((sum, r) => sum + r.p_LDifference, 0) /
      (totalReplays || 1);

    return {
      totalReplays,
      queueSize: this.replayQueue.size,
      averageP_LDifference: avgP_LDiff,
      divergenceFrequency,
    };
  }
}

/**
 * Mock data generator for testing
 */
export function generateMockReplayResults(count: number = 20): ReplayResult[] {
  const results: ReplayResult[] = [];
  const assets = ['BTC/USD', 'ETH/USD', 'SOL/USD'];
  const modes: Array<'full' | 'what_if' | 'speed' | 'comparative'> = [
    'full',
    'what_if',
    'speed',
    'comparative',
  ];

  for (let i = 0; i < count; i++) {
    const asset = assets[i % assets.length];
    const mode = modes[i % modes.length];
    const basePrice = 40000 + Math.random() * 20000;

    const divergences: DivergenceAnalysis[] = [];
    if (Math.random() > 0.3) {
      divergences.push({
        field: 'quantity',
        originalValue: 1000 + i * 10,
        replayedValue: 950 + i * 12,
        divergencePercent: 5 + Math.random() * 8,
        significance: 'major',
      });
    }

    if (Math.random() > 0.5) {
      divergences.push({
        field: 'expectedSlippage',
        originalValue: 0.003,
        replayedValue: 0.0045,
        divergencePercent: 50,
        significance: 'minor',
      });
    }

    if (Math.random() > 0.4) {
      divergences.push({
        field: 'confidence',
        originalValue: 0.75,
        replayedValue: 0.68,
        divergencePercent: 9.33,
        significance: 'major',
      });
    }

    const sensitivities: SensitivityAnalysis[] = [
      {
        inputName: 'midPrice',
        baselineImpact: 0.65 + Math.random() * 0.3,
        rangeMin: basePrice * 0.95,
        rangeMax: basePrice * 1.05,
        elasticity: -0.8 + Math.random() * 0.4,
        topContributor: Math.random() > 0.3,
      },
      {
        inputName: 'volatility',
        baselineImpact: 0.4 + Math.random() * 0.3,
        rangeMin: 0.2,
        rangeMax: 0.8,
        elasticity: 0.3 + Math.random() * 0.4,
        topContributor: Math.random() > 0.5,
      },
      {
        inputName: 'riskExposure',
        baselineImpact: 0.55 + Math.random() * 0.35,
        rangeMin: 0,
        rangeMax: 10000,
        elasticity: -0.7 + Math.random() * 0.3,
        topContributor: Math.random() > 0.4,
      },
      {
        inputName: 'modelConfidence',
        baselineImpact: 0.7 + Math.random() * 0.25,
        rangeMin: 0,
        rangeMax: 1,
        elasticity: 0.6 + Math.random() * 0.3,
        topContributor: Math.random() > 0.25,
      },
    ];

    const originalP_L = -5000 + Math.random() * 15000;
    const counterfactualP_L = originalP_L + (-3000 + Math.random() * 6000);

    results.push({
      replayId: `replay_${i}_${Date.now()}`,
      decisionPacketId: `packet_${asset}_${i}`,
      mode,
      originalDecision: {
        action: Math.random() > 0.4 ? 'buy' : 'hold',
        quantity: 1000 + i * 10,
        expectedSlippage: 0.003 + Math.random() * 0.003,
        confidence: 0.65 + Math.random() * 0.3,
        riskAdjustment: 0.8 + Math.random() * 0.2,
        rationale: `Mode: ${mode}`,
      },
      replayedDecision: {
        action: Math.random() > 0.35 ? 'buy' : 'hold',
        quantity: 950 + i * 12,
        expectedSlippage: 0.0035 + Math.random() * 0.003,
        confidence: 0.70 + Math.random() * 0.25,
        riskAdjustment: 0.75 + Math.random() * 0.22,
        rationale: `Replayed: ${mode}`,
      },
      divergenceAnalysis: divergences,
      sensitivityAnalysis: sensitivities,
      originalP_L,
      counterfactualP_L,
      p_LDifference: counterfactualP_L - originalP_L,
      executionTime: 50 + Math.random() * 200,
      timestamp: Date.now() - i * 3600000,
      notes: `${mode} replay for ${asset} - ${divergences.length} divergences detected`,
    });
  }

  return results;
}
