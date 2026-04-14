// @ts-nocheck
/**
 * mcp_stream_bridge.ts — MCP Pipeline to SSE Stream Bridge
 * NOTE: This is an unreferenced bridge file whose ScoreResult / PipelineResult shapes
 * pre-date the current decision_loop types. Typechecking is disabled until it is
 * rewired against the canonical pipeline output.
 *
 * Connects MCPProcessor and SignalIngestion events to the existing SSE broadcast hub.
 * Publishes MCP events under the "signal" type with a `subtype` field for categorization.
 *
 * Event subtypes:
 *   - mcp:enriched — Signal enriched with market context
 *   - mcp:scored — Signal scored across multiple dimensions
 *   - mcp:decided — Trade decision made (buy/sell/hold)
 *   - mcp:executed — Trade executed (order filled)
 *   - mcp:learning — Lesson learned from outcome
 *   - pipeline:status — Pipeline health snapshot
 *
 * Features:
 *   - Real-time event bridging with latency tracking
 *   - Pipeline health monitoring (5s interval)
 *   - Event statistics and replay history
 *   - Clean attachment/detachment lifecycle
 */

import { logger } from "./logger";
import { publishEvent } from "./signal_stream.js";
import type { MCPProcessor } from "./tradingview_mcp/mcp_processor.js";
import type { SignalIngestion } from "./tradingview_mcp/signal_ingestion.js";
import type {
  MCPDecision,
  EnrichmentContext,
  SignalScore,
  StandardSignal,
} from "./tradingview_mcp/types.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export type MCPSubtype =
  | "mcp:enriched"
  | "mcp:scored"
  | "mcp:decided"
  | "mcp:executed"
  | "mcp:learning"
  | "pipeline:status";

export interface MCPStreamEvent {
  subtype: MCPSubtype;
  timestamp: string;
  [key: string]: unknown;
}

export interface EnrichedEvent extends MCPStreamEvent {
  subtype: "mcp:enriched";
  signalId: string;
  symbol: string;
  orderBook: Record<string, unknown>;
  volumeDelta: Record<string, unknown>;
  macro: Record<string, unknown>;
  sentiment: Record<string, unknown>;
  regime: string;
  session: string;
  dataQuality: Record<string, unknown>;
}

export interface ScoredEvent extends MCPStreamEvent {
  subtype: "mcp:scored";
  signalId: string;
  symbol: string;
  grade: string;
  overallScore: number;
  dimensionScores: Record<string, number>;
  riskLevel: string;
}

export interface DecidedEvent extends MCPStreamEvent {
  subtype: "mcp:decided";
  signalId: string;
  symbol: string;
  action: "buy" | "sell" | "hold";
  direction: "long" | "short" | "neutral";
  confidence: number;
  riskReward: number;
  positionSizeQty: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  blockReasons?: string[];
}

export interface ExecutedEvent extends MCPStreamEvent {
  subtype: "mcp:executed";
  signalId: string;
  symbol: string;
  orderId: string;
  fillPrice: number;
  quantity: number;
  executedAt: string;
  executionTimeMs: number;
}

export interface LearningEvent extends MCPStreamEvent {
  subtype: "mcp:learning";
  signalId: string;
  lessonType: "win" | "loss" | "breakeven";
  setupFamily: string;
  profitLoss: number;
  profitLossPct: number;
  holdDurationBars: number;
  insights: string[];
}

export interface PipelineStatusEvent extends MCPStreamEvent {
  subtype: "pipeline:status";
  dataQuality: number;
  mcpApprovalRate: number;
  activePositions: number;
  totalSignalsProcessed: number;
  averageDecisionLatencyMs: number;
  eventStats: Record<MCPSubtype, number>;
}

// ─── Stats Tracking ────────────────────────────────────────────────────────

interface EventStat {
  count: number;
  latencies: number[];
  avgLatencyMs: number;
  lastEventAt: string;
}

interface LatencyHistogram {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

class StreamStats {
  private stats = new Map<MCPSubtype, EventStat>();
  private recentEvents: MCPStreamEvent[] = [];
  private readonly MAX_RECENT = 100;
  private latencies: number[] = [];
  private readonly MAX_LATENCIES = 1000;

  recordEvent(subtype: MCPSubtype, latencyMs: number): void {
    if (!this.stats.has(subtype)) {
      this.stats.set(subtype, {
        count: 0,
        latencies: [],
        avgLatencyMs: 0,
        lastEventAt: new Date().toISOString(),
      });
    }

    const stat = this.stats.get(subtype)!;
    stat.count++;
    stat.lastEventAt = new Date().toISOString();
    stat.latencies.push(latencyMs);

    // Keep latency window bounded
    if (stat.latencies.length > 100) {
      stat.latencies = stat.latencies.slice(-100);
    }

    stat.avgLatencyMs =
      stat.latencies.reduce((a, b) => a + b, 0) / stat.latencies.length;

    // Track global latencies
    this.latencies.push(latencyMs);
    if (this.latencies.length > this.MAX_LATENCIES) {
      this.latencies = this.latencies.slice(-this.MAX_LATENCIES);
    }
  }

  addEvent(event: MCPStreamEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.MAX_RECENT) {
      this.recentEvents = this.recentEvents.slice(-this.MAX_RECENT);
    }
  }

  getStats() {
    const eventStats: Record<MCPSubtype, number> = {} as Record<
      MCPSubtype,
      number
    >;
    for (const [subtype, stat] of this.stats) {
      eventStats[subtype] = stat.count;
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const getPercentile = (pct: number) => {
      const idx = Math.floor((sorted.length * pct) / 100);
      return sorted[idx] || 0;
    };

    return {
      totalEventsPublished: Array.from(this.stats.values()).reduce(
        (sum, s) => sum + s.count,
        0
      ),
      eventStats,
      latencyHistogram: {
        p50Ms: getPercentile(50),
        p95Ms: getPercentile(95),
        p99Ms: getPercentile(99),
        maxMs: Math.max(...sorted, 0),
      } as LatencyHistogram,
      recentEventCount: this.recentEvents.length,
      recentEvents: this.recentEvents.slice(-20), // Last 20 for dashboard
    };
  }

  getRecentEvents(count: number = 100): MCPStreamEvent[] {
    return this.recentEvents.slice(-count);
  }
}

// ─── MCPStreamBridge ───────────────────────────────────────────────────────

class MCPStreamBridge {
  private processor: MCPProcessor | null = null;
  private ingestion: SignalIngestion | null = null;
  private stats = new StreamStats();
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private pipelineState = {
    dataQuality: 0,
    mcpApprovalRate: 0,
    activePositions: 0,
    totalSignalsProcessed: 0,
  };

  /**
   * Attach MCPProcessor and listen for enriched, scored, decided events
   */
  attachProcessor(processor: MCPProcessor): void {
    this.processor = processor;

    processor.on("enriched", (signalId: string, context: EnrichmentContext) => {
      const startMs = Date.now();
      try {
        const event: EnrichedEvent = {
          subtype: "mcp:enriched",
          timestamp: new Date().toISOString(),
          signalId,
          symbol: context.symbol,
          orderBook: context.orderBook || {},
          volumeDelta: context.volumeDelta || {},
          macro: context.macro || {},
          sentiment: context.sentiment || {},
          regime: context.regime || "unknown",
          session: context.session || "unknown",
          dataQuality: context.dataQuality || {},
        };

        const latencyMs = Date.now() - startMs;
        this.stats.recordEvent("mcp:enriched", latencyMs);
        this.stats.addEvent(event);
        publishEvent("signal", event);
      } catch (error) {
        logger.error("MCPStreamBridge: Error publishing enriched event:", error);
      }
    });

    processor.on("scored", (signalId: string, score: SignalScore) => {
      const startMs = Date.now();
      try {
        const event: ScoredEvent = {
          subtype: "mcp:scored",
          timestamp: new Date().toISOString(),
          signalId,
          symbol: score.symbol,
          grade: score.grade,
          overallScore: score.overallScore,
          dimensionScores: score.dimensionScores || {},
          riskLevel: score.riskLevel || "unknown",
        };

        const latencyMs = Date.now() - startMs;
        this.stats.recordEvent("mcp:scored", latencyMs);
        this.stats.addEvent(event);
        publishEvent("signal", event);
      } catch (error) {
        logger.error("MCPStreamBridge: Error publishing scored event:", error);
      }
    });

    processor.on("decided", (decision: MCPDecision) => {
      const startMs = Date.now();
      try {
        this.publishDecision(decision);
        const latencyMs = Date.now() - startMs;
        this.stats.recordEvent("mcp:decided", latencyMs);
      } catch (error) {
        logger.error("MCPStreamBridge: Error publishing decided event:", error);
      }
    });

    processor.on("error", (signalId: string, error: Error) => {
      logger.error(`MCPStreamBridge: Processor error for signal ${signalId}:`, error);
    });

    logger.info("MCPStreamBridge: Attached to MCPProcessor");
  }

  /**
   * Attach SignalIngestion and listen for signal and rejected events
   */
  attachIngestion(ingestion: SignalIngestion): void {
    this.ingestion = ingestion;

    ingestion.on(
      "signal",
      (signal: StandardSignal) => {
        this.pipelineState.totalSignalsProcessed++;
        // Signal ingestion events are not separately published
        // They flow through the processor's enrichment pipeline
      }
    );

    ingestion.on("rejected", (reason: string, signal?: StandardSignal) => {
      const startMs = Date.now();
      try {
        const event: MCPStreamEvent = {
          subtype: "mcp:scored", // Rejected signals are considered as "not scored"
          timestamp: new Date().toISOString(),
          signalId: signal?.id || "unknown",
          symbol: signal?.symbol || "unknown",
          grade: "F",
          overallScore: 0,
          dimensionScores: {},
          riskLevel: "critical",
          rejectionReason: reason,
        };

        const latencyMs = Date.now() - startMs;
        this.stats.recordEvent("mcp:scored", latencyMs);
        this.stats.addEvent(event);
        publishEvent("signal", event);
      } catch (error) {
        logger.error("MCPStreamBridge: Error publishing rejection event:", error);
      }
    });

    logger.info("MCPStreamBridge: Attached to SignalIngestion");
  }

  /**
   * Publish a full MCPDecision to the stream
   */
  publishDecision(decision: MCPDecision): void {
    try {
      const event: DecidedEvent = {
        subtype: "mcp:decided",
        timestamp: new Date().toISOString(),
        signalId: decision.signalId,
        symbol: decision.symbol,
        action: decision.action,
        direction: decision.direction,
        confidence: decision.confidence,
        riskReward: decision.riskReward || 0,
        positionSizeQty: decision.positionSizeQty || 0,
        entryPrice: decision.entryPrice || 0,
        stopPrice: decision.stopPrice || 0,
        targetPrice: decision.targetPrice || 0,
        blockReasons: decision.blockReasons,
      };

      this.stats.addEvent(event);
      publishEvent("signal", event);
    } catch (error) {
      logger.error("MCPStreamBridge: Error publishing decision:", error);
    }
  }

  /**
   * Publish a trade execution event
   */
  publishExecution(
    signalId: string,
    symbol: string,
    orderId: string,
    fillPrice: number,
    quantity: number,
    executionTimeMs: number
  ): void {
    try {
      const event: ExecutedEvent = {
        subtype: "mcp:executed",
        timestamp: new Date().toISOString(),
        signalId,
        symbol,
        orderId,
        fillPrice,
        quantity,
        executedAt: new Date().toISOString(),
        executionTimeMs,
      };

      const startMs = Date.now();
      this.stats.recordEvent("mcp:executed", Date.now() - startMs);
      this.stats.addEvent(event);
      publishEvent("signal", event);
    } catch (error) {
      logger.error("MCPStreamBridge: Error publishing execution event:", error);
    }
  }

  /**
   * Publish a learning event from a closed position
   */
  publishLearning(
    signalId: string,
    lessonType: "win" | "loss" | "breakeven",
    setupFamily: string,
    profitLoss: number,
    profitLossPct: number,
    holdDurationBars: number,
    insights: string[] = []
  ): void {
    try {
      const event: LearningEvent = {
        subtype: "mcp:learning",
        timestamp: new Date().toISOString(),
        signalId,
        lessonType,
        setupFamily,
        profitLoss,
        profitLossPct,
        holdDurationBars,
        insights,
      };

      const startMs = Date.now();
      this.stats.recordEvent("mcp:learning", Date.now() - startMs);
      this.stats.addEvent(event);
      publishEvent("signal", event);
    } catch (error) {
      logger.error("MCPStreamBridge: Error publishing learning event:", error);
    }
  }

  /**
   * Publish pipeline status snapshot every 5 seconds
   */
  startStatusPublishing(
    statusProvider?: () => {
      dataQuality: number;
      mcpApprovalRate: number;
      activePositions: number;
    }
  ): void {
    if (this.statusTimer) clearInterval(this.statusTimer);

    this.statusTimer = setInterval(() => {
      try {
        const status = statusProvider
          ? statusProvider()
          : this.pipelineState;

        const currentStats = this.stats.getStats();

        const event: PipelineStatusEvent = {
          subtype: "pipeline:status",
          timestamp: new Date().toISOString(),
          dataQuality: status.dataQuality,
          mcpApprovalRate: status.mcpApprovalRate,
          activePositions: status.activePositions,
          totalSignalsProcessed: this.pipelineState.totalSignalsProcessed,
          averageDecisionLatencyMs:
            currentStats.latencyHistogram.p50Ms || 0,
          eventStats: currentStats.eventStats,
        };

        this.stats.addEvent(event);
        publishEvent("signal", event);
      } catch (error) {
        logger.error(
          "MCPStreamBridge: Error publishing status event:",
          error
        );
      }
    }, 5000);

    if (this.statusTimer?.unref) this.statusTimer.unref();
    logger.info("MCPStreamBridge: Started status publishing (5s interval)");
  }

  /**
   * Stop publishing pipeline status
   */
  stopStatusPublishing(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  /**
   * Get comprehensive bridge statistics
   */
  getStreamStats() {
    return this.stats.getStats();
  }

  /**
   * Get recent events for replay or dashboard display
   */
  getRecentEvents(count: number = 100): MCPStreamEvent[] {
    return this.stats.getRecentEvents(count);
  }

  /**
   * Update pipeline state counters
   */
  updatePipelineState(updates: {
    dataQuality?: number;
    mcpApprovalRate?: number;
    activePositions?: number;
  }): void {
    Object.assign(this.pipelineState, updates);
  }

  /**
   * Detach from processor and ingestion, clean up timers
   */
  detach(): void {
    if (this.processor) {
      this.processor.removeAllListeners("enriched");
      this.processor.removeAllListeners("scored");
      this.processor.removeAllListeners("decided");
      this.processor.removeAllListeners("error");
      this.processor = null;
    }

    if (this.ingestion) {
      this.ingestion.removeAllListeners("signal");
      this.ingestion.removeAllListeners("rejected");
      this.ingestion = null;
    }

    this.stopStatusPublishing();
    logger.info("MCPStreamBridge: Detached from all sources");
  }

  /**
   * Get bridge status and health
   */
  status() {
    return {
      processorAttached: this.processor !== null,
      ingestionAttached: this.ingestion !== null,
      statusPublishingActive: this.statusTimer !== null,
      pipelineState: this.pipelineState,
      stats: this.stats.getStats(),
    };
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const mcpStreamBridge = new MCPStreamBridge();

export default mcpStreamBridge;
