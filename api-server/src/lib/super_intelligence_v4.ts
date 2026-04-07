// super_intelligence_v4.ts - Extends V3 with full quant intelligence layer
// Integrates memory, causal reasoning, self-refusal, calibration, and bounded authority

import { logger } from "./logger";
import { SuperIntelligenceV3, V3Prediction, SIFeatures } from './super_intelligence_v3';
import { MemorySystem, MemoryContext, SimilarSetup } from './memory_system';
import { CausalReasoningEngine, CausalEdge } from './causal_reasoning';
import { CalibrationTracker, CalibrationMetrics } from './calibration_tracker';
import { AutonomousOperations, AutonomousMode, RefusalReason } from './autonomous_ops';
import { StrategyDSL } from './strategy_lab';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface V4Prediction extends V3Prediction {
  memoryContext: MemoryContextData;
  causalEdge: CausalEdgeData;
  refusalCheck: RefusalCheckData;
  calibrationAdj: CalibrationAdjData;
  authorityCheck: AuthorityCheckData;
  v4Score: number;
  v4Reasoning: string;
}

export interface MemoryContextData {
  similarSetups: SimilarSetup[];
  successRate: number;
  relevantFailures: SimilarSetup[];
  suggestion: string;
  regimeContext: string;
}

export interface CausalEdgeData {
  mechanism: string;
  confidence: number;
  persistence: number;
  decayRate: number;
  isStructural: boolean;
}

export interface RefusalCheckData {
  refused: boolean;
  reasons: RefusalReason[];
  suggestedMode: AutonomousMode;
  conditions: string[];
}

export interface CalibrationAdjData {
  rawConfidence: number;
  adjustedConfidence: number;
  calibrationScore: number;
  adjustmentFactor: number;
  backTestVsLiveDeviation: number;
}

export interface AuthorityCheckData {
  authorized: boolean;
  mode: AutonomousMode;
  bounds: PositionBounds;
  violations: string[];
}

export interface PositionBounds {
  maxPosition: number;
  maxDaily: number;
  maxLeverage: number;
  allowedSymbols: string[];
  allowedSectors?: string[];
}

export interface V4Config {
  enableMemory: boolean;
  enableCausal: boolean;
  enableRefusal: boolean;
  enableCalibration: boolean;
  enableAuthority: boolean;
  memoryConsultThreshold: number;
  causalConfidenceThreshold: number;
}

export interface OutcomeRecord {
  predictionId: string;
  v3Confidence: number;
  v4Score: number;
  actualPnl: number;
  actualPnlPercent: number;
  symbol: string;
  timestamp: number;
  holdDuration: number;
}

export interface V4Status {
  memory_healthy: boolean;
  causal_healthy: boolean;
  refusal_healthy: boolean;
  calibration_healthy: boolean;
  authority_healthy: boolean;
  total_predictions: number;
  total_outcomes_recorded: number;
  average_v4_score: number;
  last_update: number;
}

// ============================================================================
// SuperIntelligenceV4 Class
// ============================================================================

export class SuperIntelligenceV4 {
  private v3: SuperIntelligenceV3;
  private memory: MemorySystem;
  private causal: CausalReasoningEngine;
  private calibration: CalibrationTracker;
  private autonomous: AutonomousOperations;
  private config: V4Config;
  private predictionCount: number = 0;
  private outcomeCount: number = 0;
  private scoreAccumulator: number = 0;

  constructor(
    v3: SuperIntelligenceV3,
    memory: MemorySystem,
    causal: CausalReasoningEngine,
    calibration: CalibrationTracker,
    autonomous: AutonomousOperations,
    config?: Partial<V4Config>
  ) {
    this.v3 = v3;
    this.memory = memory;
    this.causal = causal;
    this.calibration = calibration;
    this.autonomous = autonomous;
    this.config = {
      enableMemory: true,
      enableCausal: true,
      enableRefusal: true,
      enableCalibration: true,
      enableAuthority: true,
      memoryConsultThreshold: 0.4,
      causalConfidenceThreshold: 0.5,
      ...config
    };
  }

  /**
   * predict: Extended prediction with memory, causal, refusal, calibration, authority checks
   */
  async predict(
    features: SIFeatures,
    strategy?: StrategyDSL,
    symbol?: string
  ): Promise<V4Prediction> {
    const predictionId = this.generatePredictionId();
    const startTime = Date.now();

    try {
      // 1. Get V3 prediction as baseline
      const v3Pred = this.v3.predict(features, strategy, symbol);

      // 2. Memory-informed prediction
      const memoryContext = this.config.enableMemory
        ? await this.consultMemory(features, v3Pred, strategy)
        : this.getDefaultMemoryContext();

      // 3. Causal edge scoring
      const causalEdge = this.config.enableCausal
        ? this.scoreCausalEdge(v3Pred, features, strategy)
        : this.getDefaultCausalEdge();

      // 4. Self-refusal gate
      const refusalCheck = this.config.enableRefusal
        ? await this.checkSelfRefusal(v3Pred, strategy, features)
        : this.getDefaultRefusalCheck();

      // 5. Calibration adjustment
      const calibrationAdj = this.config.enableCalibration
        ? this.adjustCalibration(v3Pred, strategy)
        : this.getDefaultCalibrationAdj(v3Pred);

      // 6. Bounded authority check
      const authorityCheck = this.config.enableAuthority
        ? await this.checkBoundedAuthority(v3Pred, strategy, symbol)
        : this.getDefaultAuthorityCheck();

      // 7. Compute composite V4 score
      const v4Score = this.computeV4Score(
        v3Pred,
        memoryContext,
        causalEdge,
        calibrationAdj,
        authorityCheck
      );

      // 8. Determine final shouldTrade based on all checks
      const shouldTrade =
        v3Pred.shouldTrade &&
        !refusalCheck.refused &&
        authorityCheck.authorized &&
        v4Score > 50;

      // 9. Generate V4 reasoning
      const v4Reasoning = this.generateV4Reasoning(
        v3Pred,
        memoryContext,
        causalEdge,
        refusalCheck,
        calibrationAdj,
        v4Score
      );

      // 10. Increment prediction count
      this.predictionCount++;
      this.scoreAccumulator += v4Score;

      // Return full V4 prediction
      const v4Pred: V4Prediction = {
        ...v3Pred,
        memoryContext,
        causalEdge,
        refusalCheck,
        calibrationAdj,
        authorityCheck,
        v4Score,
        v4Reasoning,
        shouldTrade,
        confidence: calibrationAdj.adjustedConfidence,
        reasoning: v4Reasoning
      };

      return v4Pred;
    } catch (error) {
      throw new Error(
        `V4 prediction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * recordOutcome: Updates memory, calibration, outcome tracking
   */
  async recordOutcome(
    prediction: V4Prediction,
    actualResult: { pnl: number; pnlPercent: number; symbol: string; holdDuration: number }
  ): Promise<void> {
    try {
      // 1. Record in memory system
      await this.memory.recordOutcome(
        prediction,
        actualResult.pnl,
        actualResult.pnlPercent,
        prediction.memoryContext
      );

      // 2. Update calibration tracker
      this.calibration.recordTrade(
        {
          symbol: actualResult.symbol,
          entryPrice: 0,
          exitPrice: 0,
          quantity: 0,
          pnl: actualResult.pnl,
          pnlPercent: actualResult.pnlPercent,
          holdDurationMs: actualResult.holdDuration,
          slippage: 0,
          timestamp: Date.now()
        },
        prediction.calibrationAdj.rawConfidence,
        prediction.confidence
      );

      // 3. Update causal persistence (edge decays if trade failed)
      if (actualResult.pnlPercent < 0) {
        this.causal.updatePersistenceOnFailure(
          prediction.causalEdge.mechanism,
          actualResult.pnlPercent
        );
      }

      // 4. Increment outcome count
      this.outcomeCount++;

      // 5. Log outcome record
      const outcome: OutcomeRecord = {
        predictionId: prediction.id,
        v3Confidence: prediction.calibrationAdj.rawConfidence,
        v4Score: prediction.v4Score,
        actualPnl: actualResult.pnl,
        actualPnlPercent: actualResult.pnlPercent,
        symbol: actualResult.symbol,
        timestamp: Date.now(),
        holdDuration: actualResult.holdDuration
      };

      // Store outcome for analysis
      await this.logOutcomeRecord(outcome);
    } catch (error) {
      logger.error('Failed to record outcome:', error);
    }
  }

  /**
   * getV4Status: Health of all V4 components
   */
  async getV4Status(): Promise<V4Status> {
    const avgScore =
      this.predictionCount > 0 ? this.scoreAccumulator / this.predictionCount : 0;

    return {
      memory_healthy: this.memory.isHealthy(),
      causal_healthy: this.causal.isHealthy(),
      refusal_healthy: true, // Autonomous ops health
      calibration_healthy: this.calibration.isHealthy(),
      authority_healthy: this.autonomous.isHealthy(),
      total_predictions: this.predictionCount,
      total_outcomes_recorded: this.outcomeCount,
      average_v4_score: avgScore,
      last_update: Date.now()
    };
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  private async consultMemory(
    features: SIFeatures,
    v3Pred: V3Prediction,
    strategy?: StrategyDSL
  ): Promise<MemoryContextData> {
    try {
      const similar = await this.memory.findSimilarSetups(features, strategy);

      if (similar.length === 0) {
        return this.getDefaultMemoryContext();
      }

      const successCount = similar.filter((s) => s.pnl > 0).length;
      const successRate = (successCount / similar.length) * 100;
      const failures = similar.filter((s) => s.pnl < 0);

      return {
        similarSetups: similar,
        successRate,
        relevantFailures: failures,
        suggestion: this.generateMemorySuggestion(similar, successRate, v3Pred),
        regimeContext: await this.memory.getRegimeContext()
      };
    } catch (error) {
      logger.error('Memory consultation failed:', error);
      return this.getDefaultMemoryContext();
    }
  }

  private scoreCausalEdge(
    v3Pred: V3Prediction,
    features: SIFeatures,
    strategy?: StrategyDSL
  ): CausalEdgeData {
    try {
      const edge = this.causal.analyze(v3Pred, features, strategy);

      // Score decays if no plausible mechanism
      let confidence = edge.confidence;
      if (!edge.mechanism || edge.mechanism === 'Unknown') {
        confidence *= 0.5;
      }

      // Score boosts if structural edge identified
      if (edge.is_structural) {
        confidence *= 1.2;
      }

      return {
        mechanism: edge.mechanism,
        confidence: Math.min(1.0, confidence),
        persistence: edge.persistence,
        decayRate: edge.decay_rate,
        isStructural: edge.is_structural
      };
    } catch (error) {
      logger.error('Causal edge scoring failed:', error);
      return this.getDefaultCausalEdge();
    }
  }

  private async checkSelfRefusal(
    v3Pred: V3Prediction,
    strategy?: StrategyDSL,
    features?: SIFeatures
  ): Promise<RefusalCheckData> {
    try {
      const reasons = await this.autonomous.checkRefusal(v3Pred, strategy, features);

      if (reasons.length === 0) {
        return {
          refused: false,
          reasons: [],
          suggestedMode: 'AUTONOMOUS',
          conditions: []
        };
      }

      return {
        refused: true,
        reasons,
        suggestedMode: 'ASSISTED',
        conditions: this.autonomous.getConditionSummary(reasons)
      };
    } catch (error) {
      logger.error('Self-refusal check failed:', error);
      return this.getDefaultRefusalCheck();
    }
  }

  private adjustCalibration(
    v3Pred: V3Prediction,
    strategy?: StrategyDSL
  ): CalibrationAdjData {
    try {
      const metrics = this.calibration.getMetrics(strategy?.id);

      // Adjustment factor: 1.0 = perfect calibration, <1.0 = overconfident
      const adjustmentFactor = metrics.calibration_score / 100;
      const adjustedConfidence = Math.min(
        1.0,
        v3Pred.confidence * adjustmentFactor
      );
      const deviation = Math.abs(v3Pred.confidence - adjustedConfidence);

      return {
        rawConfidence: v3Pred.confidence,
        adjustedConfidence,
        calibrationScore: metrics.calibration_score,
        adjustmentFactor,
        backTestVsLiveDeviation: metrics.backtest_vs_live_deviation
      };
    } catch (error) {
      logger.error('Calibration adjustment failed:', error);
      return this.getDefaultCalibrationAdj(v3Pred);
    }
  }

  private async checkBoundedAuthority(
    v3Pred: V3Prediction,
    strategy?: StrategyDSL,
    symbol?: string
  ): Promise<AuthorityCheckData> {
    try {
      const mode = this.autonomous.getCurrentMode();
      const bounds = this.autonomous.getBounds(mode);
      const violations = this.autonomous.checkViolations(v3Pred, bounds, strategy);

      const authorized = violations.length === 0;

      return {
        authorized,
        mode,
        bounds,
        violations
      };
    } catch (error) {
      logger.error('Authority check failed:', error);
      return this.getDefaultAuthorityCheck();
    }
  }

  private computeV4Score(
    v3Pred: V3Prediction,
    memory: MemoryContextData,
    causal: CausalEdgeData,
    calibration: CalibrationAdjData,
    authority: AuthorityCheckData
  ): number {
    // Weighted composite score
    const weights = {
      v3Confidence: 0.35,
      memorySuccess: 0.2,
      causalConfidence: 0.2,
      calibration: 0.15,
      authority: 0.1
    };

    const score =
      (v3Pred.confidence * 100 * weights.v3Confidence) +
      (memory.successRate * weights.memorySuccess) +
      (causal.confidence * 100 * weights.causalConfidence) +
      (calibration.calibrationScore * weights.calibration) +
      (authority.authorized ? 100 * weights.authority : 0);

    return Math.min(100, Math.max(0, score));
  }

  private generateV4Reasoning(
    v3Pred: V3Prediction,
    memory: MemoryContextData,
    causal: CausalEdgeData,
    refusal: RefusalCheckData,
    calibration: CalibrationAdjData,
    v4Score: number
  ): string {
    const parts: string[] = [];

    // V3 baseline
    parts.push(`V3 baseline: ${v3Pred.reasoning}`);

    // Memory enhancement
    if (memory.similarSetups.length > 0) {
      parts.push(
        `Memory context: ${memory.similarSetups.length} similar setups with ${memory.successRate.toFixed(1)}% success rate`
      );
    }

    // Causal reasoning
    if (causal.mechanism && causal.mechanism !== 'Unknown') {
      parts.push(
        `Causal mechanism: ${causal.mechanism} (confidence: ${(causal.confidence * 100).toFixed(0)}%)`
      );
    }

    // Refusal status
    if (refusal.refused) {
      parts.push(`Self-refusal triggered: ${refusal.reasons.join(', ')}`);
    }

    // Calibration adjustment
    if (calibration.adjustmentFactor !== 1.0) {
      parts.push(
        `Calibration adjustment: ${(calibration.adjustmentFactor * 100).toFixed(0)}% (backtest-to-live deviation: ${(calibration.backTestVsLiveDeviation * 100).toFixed(1)}%)`
      );
    }

    // Final score
    parts.push(`V4 composite score: ${v4Score.toFixed(1)}`);

    return parts.join(' | ');
  }

  private generateMemorySuggestion(
    similar: SimilarSetup[],
    successRate: number,
    v3Pred: V3Prediction
  ): string {
    if (similar.length === 0) return 'No historical context available';

    const recent = similar.slice(0, 3);
    const recentSuccess = recent.filter((s) => s.pnl > 0).length;

    let suggestion = `Found ${similar.length} similar setups (${successRate.toFixed(0)}% historical success).`;

    if (recentSuccess === recent.length) {
      suggestion += ' Recent repetitions all profitable - strong pattern.';
    } else if (recentSuccess === 0) {
      suggestion += ' Recent repetitions all failed - consider caution.';
    }

    return suggestion;
  }

  private getDefaultMemoryContext(): MemoryContextData {
    return {
      similarSetups: [],
      successRate: 50,
      relevantFailures: [],
      suggestion: 'Memory system unavailable',
      regimeContext: 'Unknown'
    };
  }

  private getDefaultCausalEdge(): CausalEdgeData {
    return {
      mechanism: 'Unknown',
      confidence: 0.5,
      persistence: 0.5,
      decayRate: 0.1,
      isStructural: false
    };
  }

  private getDefaultRefusalCheck(): RefusalCheckData {
    return {
      refused: false,
      reasons: [],
      suggestedMode: 'AUTONOMOUS',
      conditions: []
    };
  }

  private getDefaultCalibrationAdj(v3Pred: V3Prediction): CalibrationAdjData {
    return {
      rawConfidence: v3Pred.confidence,
      adjustedConfidence: v3Pred.confidence,
      calibrationScore: 50,
      adjustmentFactor: 1.0,
      backTestVsLiveDeviation: 0
    };
  }

  private getDefaultAuthorityCheck(): AuthorityCheckData {
    return {
      authorized: true,
      mode: 'AUTONOMOUS',
      bounds: {
        maxPosition: 100,
        maxDaily: 500,
        maxLeverage: 2,
        allowedSymbols: []
      },
      violations: []
    };
  }

  private generatePredictionId(): string {
    return `v4_pred_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async logOutcomeRecord(outcome: OutcomeRecord): Promise<void> {
    // Could store in database or file system
    logger.info(
      `Outcome recorded: ${outcome.symbol} ${outcome.v4Score.toFixed(1)} -> ${outcome.actualPnlPercent.toFixed(2)}%`
    );
  }
}

export default SuperIntelligenceV4;
