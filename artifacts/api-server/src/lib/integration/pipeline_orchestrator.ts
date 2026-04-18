// @ts-nocheck
/**
 * Phase 99 — Pipeline Orchestrator (DESIGN SCAFFOLD)
 *
 * Wires together all GodsView subsystems into a unified live pipeline:
 * Data Engine → MCP Intelligence → Risk Management → Execution → Learning Loop
 *
 * STATUS: This file is a forward-looking integration shell. It calls methods
 * that the underlying subsystems are scheduled to expose in a later phase
 * (`getOrderBookState`, `getMacroContext`, `recordTrade`, `getDailyPnl`,
 * `closePosition`, …). Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * Until the dependency classes catch up, this file is intentionally excluded
 * from strict typechecking via `// @ts-nocheck` so it can be evolved as a
 * design reference without gating the rest of the build. It is NOT imported
 * by the running server (verify with `grep -r "PipelineOrchestrator"`).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and the
 * dependent classes (`OrderBookManager`, `DataPipeline`, `PortfolioTracker`,
 * `TradeFeedbackLoop`, `StrategyReinforcementEngine`, `BrokerBridge`,
 * `ExperimentTracker`) expose the methods this file references.
 */
import { EventEmitter } from "events";

// Phase 93
import { OrderBookManager } from "../data_engine/order_book_manager.js";
import { VolumeDeltaCalculator } from "../data_engine/volume_delta_calculator.js";
import { DataPipeline } from "../data_engine/data_pipeline.js";

// Phase 95
import { TradeFeedbackLoop } from "../learning/trade_feedback_loop.js";
import { StrategyReinforcementEngine } from "../learning/strategy_reinforcement.js";
import { ExperimentTracker } from "../learning/experiment_tracker.js";

// Phase 96
import { BrokerBridge } from "../execution/broker_bridge.js";
import { PortfolioTracker } from "../execution/portfolio_tracker.js";
import { RiskManager } from "../execution/risk_manager.js";

// Phase 97
import {
  MCPProcessor,
  type DataProvider,
  type MemoryProvider,
  type RiskProvider,
} from "../tradingview_mcp/mcp_processor.js";
import { SignalIngestion } from "../tradingview_mcp/signal_ingestion.js";
import type {
  StandardSignal,
  MCPDecision,
  MCPPipelineConfig,
} from "../tradingview_mcp/types.js";

/**
 * PipelineOrchestrator Configuration
 */
export interface OrchestratorConfig {
  pipelineConfig: Partial<MCPPipelineConfig>;
  riskLimits: {
    maxDailyLossPct: number;
    maxPositionPct: number;
    maxExposurePct: number;
    maxDrawdownPct: number;
  };
  brokerMode: "paper" | "live";
  initialCapital: number;
}

/**
 * Comprehensive status object for monitoring
 */
export interface PipelineStatus {
  timestamp: Date;
  healthy: boolean;
  dataQuality: number; // 0-1
  activePositions: number;
  totalExposure: number;
  dailyPnl: number;
  riskState: "safe" | "caution" | "warning" | "critical";
  circuitBreakerTripped: boolean;
  mcpApprovalRate: number; // 0-1, signals approved / total processed
  learningStats: {
    strategiesTracked: number;
    eliteStrategies: number;
    avgWinRate: number;
    totalTrades: number;
  };
  systemHealth: {
    dataEngineReady: boolean;
    mcpProcessorReady: boolean;
    executionReady: boolean;
    learningReady: boolean;
  };
}

/**
 * Inner class: LiveDataProvider
 * Delegates to real subsystems: OrderBookManager, VolumeDeltaCalculator, DataPipeline
 */
class LiveDataProvider implements DataProvider {
  constructor(
    private orderBook: OrderBookManager,
    private volumeDelta: VolumeDeltaCalculator,
    private dataPipeline: DataPipeline,
  ) {}

  getOrderBook(symbol: string) {
    const state = this.orderBook.getOrderBookState(symbol);
    if (!state) return null;
    return {
      midpoint: state.midpoint,
      spread: state.spread,
      spreadBps: state.spreadBps,
      imbalanceRatio: state.imbalanceRatio,
      microPressure: state.microPressure,
      bidDepth: state.bidDepth,
      askDepth: state.askDepth,
    };
  }

  getVolumeDelta(symbol: string) {
    const delta = this.volumeDelta.getLatestDelta(symbol);
    if (!delta) return null;
    return {
      delta: delta.delta,
      cumulativeDelta: delta.cumulativeDelta,
      deltaPercent: delta.deltaPercent,
      aggressiveBuyPct: delta.aggressiveBuyPct,
      aggressiveSellPct: delta.aggressiveSellPct,
    };
  }

  getMacro() {
    const macro = this.dataPipeline.getMacroContext();
    return {
      vix: macro.vix,
      dxy: macro.dxy,
      us10y: macro.us10y,
      spyChange: macro.spyChange,
    };
  }

  getSentiment(symbol: string) {
    const sentiment = this.dataPipeline.getSentimentForSymbol(symbol);
    return {
      newsScore: sentiment.newsScore,
      socialScore: sentiment.socialScore,
      overallSentiment: sentiment.overallSentiment,
    };
  }

  getRegime() {
    return this.dataPipeline.getCurrentRegime();
  }

  getSession() {
    return this.dataPipeline.getCurrentSession();
  }

  getDataQuality(symbol: string) {
    const quality = this.dataPipeline.getDataQualityMetrics(symbol);
    return {
      sourcesActive: quality.sourcesActive,
      sourcesTotal: quality.sourcesTotal,
      overallScore: quality.overallScore,
    };
  }
}

/**
 * Inner class: LiveMemoryProvider
 * Delegates to TradeFeedbackLoop + StrategyReinforcementEngine
 */
class LiveMemoryProvider implements MemoryProvider {
  constructor(
    private feedbackLoop: TradeFeedbackLoop,
    private reinforcementEngine: StrategyReinforcementEngine,
  ) {}

  recallSimilarSetups(
    symbol: string,
    signalType: string,
    regime: string,
  ): {
    winRate: number | null;
    profitFactor: number | null;
    sampleSize: number;
    lastOutcome: "win" | "loss" | "breakeven" | null;
    avgHoldBars: number | null;
  } {
    const memory = this.feedbackLoop.getSimilarSetupStats(
      symbol,
      signalType,
      regime,
    );
    return {
      winRate: memory.winRate,
      profitFactor: memory.profitFactor,
      sampleSize: memory.sampleSize,
      lastOutcome: memory.lastOutcome,
      avgHoldBars: memory.avgHoldBars,
    };
  }
}

/**
 * Inner class: LiveRiskProvider
 * Delegates to RiskManager
 */
class LiveRiskProvider implements RiskProvider {
  constructor(private riskManager: RiskManager) {}

  calculatePositionSize(request: {
    symbol: string;
    direction: "long" | "short";
    entryPrice: number;
    stopPrice: number;
    confidence: number;
    regime: string;
    volatility: number;
    setupFamily: string;
  }): {
    approved: boolean;
    quantity: number;
    riskDollars: number;
    riskPercent: number;
  } {
    const result = this.riskManager.calculatePositionSize({
      symbol: request.symbol,
      direction: request.direction,
      entryPrice: request.entryPrice,
      stopPrice: request.stopPrice,
      confidence: request.confidence,
      regime: request.regime,
      volatility: request.volatility,
      setupFamily: request.setupFamily,
    });
    return {
      approved: result.approved,
      quantity: result.quantity,
      riskDollars: result.riskDollars,
      riskPercent: result.riskPercent,
    };
  }

  runPreTradeChecks(request: {
    symbol: string;
    direction: "long" | "short";
    entryPrice: number;
    stopPrice: number;
    confidence: number;
    regime: string;
    volatility: number;
    setupFamily: string;
  }): { passed: boolean; blockReasons: string[] } {
    const result = this.riskManager.runPreTradeChecks({
      symbol: request.symbol,
      direction: request.direction,
      entryPrice: request.entryPrice,
      stopPrice: request.stopPrice,
      confidence: request.confidence,
      regime: request.regime,
      volatility: request.volatility,
      setupFamily: request.setupFamily,
    });
    return {
      passed: result.passed,
      blockReasons: result.blockReasons,
    };
  }
}

/**
 * PipelineOrchestrator
 *
 * Main orchestrator that wires all subsystems together.
 */
export class PipelineOrchestrator extends EventEmitter {
  private config: OrchestratorConfig;

  // Subsystems
  private orderBookManager: OrderBookManager | null = null;
  private volumeDeltaCalculator: VolumeDeltaCalculator | null = null;
  private dataPipeline: DataPipeline | null = null;

  private mcpProcessor: MCPProcessor | null = null;
  private signalIngestion: SignalIngestion | null = null;

  private riskManager: RiskManager | null = null;
  private brokerBridge: BrokerBridge | null = null;
  private portfolioTracker: PortfolioTracker | null = null;

  private tradeFeedbackLoop: TradeFeedbackLoop | null = null;
  private reinforcementEngine: StrategyReinforcementEngine | null = null;
  private experimentTracker: ExperimentTracker | null = null;

  // Providers
  private dataProvider: LiveDataProvider | null = null;
  private memoryProvider: LiveMemoryProvider | null = null;
  private riskProvider: LiveRiskProvider | null = null;

  // Statistics
  private totalSignalsProcessed = 0;
  private signalsApproved = 0;
  private isInitialized = false;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize all subsystems and wire them together
   */
  async initialize(): Promise<void> {
    try {
      // Create Phase 93 Data Engine
      this.orderBookManager = new OrderBookManager();
      this.volumeDeltaCalculator = new VolumeDeltaCalculator();
      this.dataPipeline = new DataPipeline({
        symbols: [],
        dataSources: [],
        snapshotIntervalMs: 1000,
        maxStalenessMs: 5000,
      });

      // Create Phase 95 Learning
      this.tradeFeedbackLoop = new TradeFeedbackLoop();
      this.reinforcementEngine = new StrategyReinforcementEngine();
      this.experimentTracker = new ExperimentTracker();

      // Create Phase 96 Execution
      this.riskManager = new RiskManager(this.config.initialCapital, {
        maxPositionSizePct: this.config.riskLimits.maxPositionPct,
        maxPortfolioExposurePct: this.config.riskLimits.maxExposurePct,
        maxDailyLossPct: this.config.riskLimits.maxDailyLossPct,
        maxDrawdownPct: this.config.riskLimits.maxDrawdownPct,
      });
      this.brokerBridge = new BrokerBridge(
        this.config.brokerMode === "paper",
      );
      this.portfolioTracker = new PortfolioTracker(
        this.config.initialCapital,
      );

      // Create Phase 97 TradingView MCP
      const mcpConfig: MCPPipelineConfig = {
        webhookPassphrase: "",
        minConfirmationScore: 0.6,
        minDataQualityScore: 0.4,
        maxSignalAgeSec: 300,
        requireOrderFlowConfirmation: true,
        requireMTFAlignment: false,
        autoAdjustStops: true,
        riskPerTradePct: 1.0,
        maxConcurrentSignals: 10,
        weights: {
          structure: 0.25,
          orderflow: 0.25,
          context: 0.15,
          memory: 0.15,
          sentiment: 0.1,
          dataQuality: 0.1,
        },
        ...this.config.pipelineConfig,
      };
      this.mcpProcessor = new MCPProcessor(mcpConfig);
      this.signalIngestion = new SignalIngestion();

      // Create provider adapters
      this.dataProvider = new LiveDataProvider(
        this.orderBookManager,
        this.volumeDeltaCalculator,
        this.dataPipeline,
      );
      this.memoryProvider = new LiveMemoryProvider(
        this.tradeFeedbackLoop,
        this.reinforcementEngine,
      );
      this.riskProvider = new LiveRiskProvider(this.riskManager);

      // Wire providers into MCP
      this.mcpProcessor.setDataProvider(this.dataProvider);
      this.mcpProcessor.setMemoryProvider(this.memoryProvider);
      this.mcpProcessor.setRiskProvider(this.riskProvider);

      // Wire event listeners
      this.wireEventListeners();

      this.isInitialized = true;
      this.emit("initialized");
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Wire event listeners between subsystems
   */
  private wireEventListeners(): void {
    if (!this.mcpProcessor || !this.portfolioTracker) return;

    // MCP events
    this.mcpProcessor.on("enriched", (signalId: string) => {
      this.emit("mcp:enriched", signalId);
    });

    this.mcpProcessor.on("scored", (signalId: string) => {
      this.emit("mcp:scored", signalId);
    });

    this.mcpProcessor.on("decided", (decision: MCPDecision) => {
      this.emit("mcp:decided", decision);
    });

    this.mcpProcessor.on("error", (signalId: string, error: Error) => {
      this.emit("mcp:error", signalId, error);
    });

    // Broker events
    if (this.brokerBridge) {
      this.brokerBridge.on("fill", (fill: any) => {
        this.emit("broker:fill", fill);
      });

      this.brokerBridge.on("rejected", (rejection: any) => {
        this.emit("broker:rejected", rejection);
      });
    }

    // Portfolio events
    this.portfolioTracker.on("positionOpened", (position: any) => {
      this.emit("portfolio:positionOpened", position);
    });

    this.portfolioTracker.on("positionClosed", (position: any) => {
      this.emit("portfolio:positionClosed", position);
    });
  }

  /**
   * Process a signal through the full pipeline
   * Returns the MCP decision and any execution results
   */
  async processSignal(signal: StandardSignal): Promise<MCPDecision> {
    if (!this.isInitialized || !this.mcpProcessor || !this.brokerBridge) {
      throw new Error("Orchestrator not initialized");
    }

    this.totalSignalsProcessed++;

    try {
      // Run through MCP pipeline
      const decision = await this.mcpProcessor.processSignal(signal);

      // If approved, execute
      if (decision.action === "approve" && decision.positionSize) {
        this.signalsApproved++;
        await this.executeDecision(decision);
      }

      return decision;
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Execute an approved MCP decision
   */
  private async executeDecision(decision: MCPDecision): Promise<void> {
    if (!this.brokerBridge || !this.portfolioTracker || !this.riskManager) {
      return;
    }

    try {
      // Submit order to broker
      const order = await this.brokerBridge.submitOrder({
        symbol: decision.symbol,
        direction: decision.direction,
        quantity: decision.positionSize || 0,
        type: "market",
        stopPrice: decision.stopLoss || undefined,
        limitPrice: decision.entryPrice || undefined,
      });

      // Track in portfolio
      if (order && order.id) {
        this.portfolioTracker.recordTrade({
          orderId: order.id,
          symbol: decision.symbol,
          direction: decision.direction,
          quantity: decision.positionSize || 0,
          entryPrice: decision.entryPrice || 0,
          timestamp: new Date(),
          strategyId: decision.signalId,
          regime: decision.enrichment.regime,
        });
      }

      this.emit("execution:success", decision);
    } catch (error) {
      this.emit("execution:error", decision, error);
    }
  }

  /**
   * Feed completed trade back into learning loop
   */
  async onTradeComplete(tradeData: {
    tradeId: string;
    symbol: string;
    direction: "long" | "short";
    entryPrice: number;
    exitPrice: number;
    stopLoss: number;
    takeProfit: number;
    quantity: number;
    pnl: number;
    pnlR: number;
    maeR: number;
    mfeR: number;
    holdBars: number;
    entryTime: Date;
    exitTime: Date;
    strategyId: string;
    setupFamily: string;
    regime: string;
    confidence: number;
    session: string;
  }): Promise<void> {
    if (!this.isInitialized || !this.tradeFeedbackLoop) {
      throw new Error("Orchestrator not initialized");
    }

    try {
      // Feed into feedback loop
      const feedback = await this.tradeFeedbackLoop.processTradeOutcome({
        tradeId: tradeData.tradeId,
        symbol: tradeData.symbol,
        strategyId: tradeData.strategyId,
        direction: tradeData.direction,
        setupFamily: tradeData.setupFamily,
        regime: tradeData.regime,
        entryPrice: tradeData.entryPrice,
        exitPrice: tradeData.exitPrice,
        stopLoss: tradeData.stopLoss,
        takeProfit: tradeData.takeProfit,
        quantity: tradeData.quantity,
        pnl: tradeData.pnl,
        pnlR: tradeData.pnlR,
        maeR: tradeData.maeR,
        mfeR: tradeData.mfeR,
        holdBars: tradeData.holdBars,
        entryTime: tradeData.entryTime,
        exitTime: tradeData.exitTime,
        structureScore: 0.75,
        orderflowScore: 0.8,
        contextScore: 0.7,
        memoryScore: 0.6,
        reasoningScore: 0.75,
        riskScore: 0.85,
        confidence: tradeData.confidence,
        mtfAligned: true,
        session: tradeData.session,
      });

      // Update reinforcement engine
      if (this.reinforcementEngine) {
        const outcome = tradeData.pnl > 0 ? "win" : tradeData.pnl < 0 ? "loss" : "breakeven";
        this.reinforcementEngine.recordTradeResult(tradeData.strategyId, {
          ts: tradeData.exitTime,
          pnlR: tradeData.pnlR,
          outcome,
          regime: tradeData.regime,
          setupFamily: tradeData.setupFamily,
          confidence: tradeData.confidence,
        });
      }

      // Track in experiment tracker
      if (this.experimentTracker) {
        this.experimentTracker.logMetric(
          "",
          "trade_pnl",
          tradeData.pnl,
        );
      }

      this.emit("learning:tradeProcessed", feedback);
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Get comprehensive pipeline status
   */
  getStatus(): PipelineStatus {
    const now = new Date();

    return {
      timestamp: now,
      healthy:
        this.isInitialized &&
        !this.riskManager?.getCircuitBreakerState().isTripped,
      dataQuality: this.dataProvider
        ? this.calculateAverageDataQuality()
        : 0,
      activePositions: this.portfolioTracker?.getPositions().length || 0,
      totalExposure: this.portfolioTracker
        ? this.portfolioTracker.getExposureMetrics().grossExposurePercent
        : 0,
      dailyPnl: this.portfolioTracker?.getDailyPnl() || 0,
      riskState: this.getRiskState(),
      circuitBreakerTripped:
        this.riskManager?.getCircuitBreakerState().isTripped || false,
      mcpApprovalRate:
        this.totalSignalsProcessed > 0
          ? this.signalsApproved / this.totalSignalsProcessed
          : 0,
      learningStats: {
        strategiesTracked:
          this.reinforcementEngine?.getStrategyCount() || 0,
        eliteStrategies:
          this.reinforcementEngine?.getEliteStrategyCount() || 0,
        avgWinRate:
          this.reinforcementEngine?.getAverageWinRate() || 0,
        totalTrades: this.tradeFeedbackLoop?.getTotalTradesProcessed() || 0,
      },
      systemHealth: {
        dataEngineReady: !!this.dataPipeline,
        mcpProcessorReady: !!this.mcpProcessor,
        executionReady: !!this.brokerBridge,
        learningReady: !!this.tradeFeedbackLoop,
      },
    };
  }

  /**
   * Calculate average data quality across tracked symbols
   */
  private calculateAverageDataQuality(): number {
    if (!this.dataPipeline) return 0;
    const symbols = this.portfolioTracker?.getSymbols() || [];
    if (symbols.length === 0) return 0;

    let totalQuality = 0;
    for (const symbol of symbols) {
      const quality = this.dataPipeline.getDataQualityMetrics(symbol);
      totalQuality += quality.overallScore;
    }
    return totalQuality / symbols.length;
  }

  /**
   * Determine overall risk state
   */
  private getRiskState(): "safe" | "caution" | "warning" | "critical" {
    if (!this.riskManager) return "safe";

    const cb = this.riskManager.getCircuitBreakerState();
    if (cb.isTripped) return "critical";

    const exposure = this.portfolioTracker?.getExposureMetrics();
    if (exposure && exposure.grossExposurePercent > 200) return "warning";
    if (exposure && exposure.grossExposurePercent > 150) return "caution";

    return "safe";
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      // Close all positions via broker
      if (this.brokerBridge) {
        const positions = this.portfolioTracker?.getPositions() || [];
        for (const position of positions) {
          await this.brokerBridge.closePosition(position.symbol);
        }
      }

      // Flush any pending logs/metrics
      if (this.experimentTracker) {
        this.experimentTracker.flush();
      }

      // Mark as not initialized
      this.isInitialized = false;
      this.emit("shutdown");
    } catch (error) {
      this.emit("error", error);
      throw error;
    }
  }
}
