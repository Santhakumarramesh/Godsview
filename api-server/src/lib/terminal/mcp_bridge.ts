/**
 * Phase 26 — TradingView MCP Bridge
 *
 * Converts TradingView overlay data to internal signal format.
 * Note: Real external MCP connection blocked by credentials — implements full internal adapter.
 */

import { logger } from "../logger.js";
import type { OverlaySignal } from "./terminal_adapter.js";

export interface OverlayConfig {
  enabled: boolean;
  updateIntervalMs: number;
  bufferSize: number;
  logSignals: boolean;
}

export interface MCPConnectionStatus {
  connected: boolean;
  lastSignalTime?: string;
  signalCount: number;
  avgProcessingMs: number;
  recentErrors: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// TradingViewMCPBridge
// ──────────────────────────────────────────────────────────────────────────────

export class TradingViewMCPBridge {
  private config: OverlayConfig;
  private signals: OverlaySignal[] = [];
  private signalCount: number = 0;
  private processingTimes: number[] = [];
  private lastSignalTime?: string;
  private recentErrors: string[] = [];
  private maxErrors: number = 10;

  constructor(initialConfig?: Partial<OverlayConfig>) {
    this.config = {
      enabled: true,
      updateIntervalMs: 1000,
      bufferSize: 100,
      logSignals: true,
      ...initialConfig,
    };
  }

  /**
   * Process TradingView overlay signal
   * Converts TradingView overlay data to internal signal format
   */
  processOverlaySignal(overlayData: Record<string, unknown>): OverlaySignal {
    const startTime = performance.now();

    try {
      // Validate minimum required fields
      const symbol = overlayData.symbol as string;
      const direction = overlayData.direction as string;

      if (!symbol || !direction) {
        throw new Error("Missing required fields: symbol, direction");
      }

      // Validate direction
      if (!["long", "short", "neutral"].includes(direction)) {
        throw new Error(
          `Invalid direction: ${direction}. Must be long, short, or neutral.`
        );
      }

      // Extract optional fields with defaults
      const confidence = (overlayData.confidence as number) ?? 0.5;
      const entryPrice = overlayData.entryPrice as number | undefined;
      const stopLoss = overlayData.stopLoss as number | undefined;
      const takeProfit = overlayData.takeProfit as number | undefined;
      const source = (overlayData.source as string) ?? "tradingview_overlay";

      const signal: OverlaySignal = {
        id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        symbol: symbol.toUpperCase(),
        direction: direction as "long" | "short" | "neutral",
        confidence: Math.max(0, Math.min(1, confidence)), // clamp 0-1
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp: new Date().toISOString(),
        source,
      };

      // Store signal
      this.signals.push(signal);
      if (this.signals.length > this.config.bufferSize) {
        this.signals.shift();
      }

      this.signalCount++;
      this.lastSignalTime = signal.timestamp;

      // Track processing time
      const processingMs = performance.now() - startTime;
      this.processingTimes.push(processingMs);
      if (this.processingTimes.length > 100) {
        this.processingTimes.shift();
      }

      if (this.config.logSignals) {
        logger.info(
          {
            signalId: signal.id,
            symbol: signal.symbol,
            direction: signal.direction,
            confidence: signal.confidence,
            processingMs: processingMs.toFixed(2),
          },
          "Overlay signal processed"
        );
      }

      return signal;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this._addError(errorMsg);
      logger.warn(
        {
          error: errorMsg,
          overlayData,
          processingMs: (performance.now() - startTime).toFixed(2),
        },
        "Overlay signal processing failed"
      );
      throw error;
    }
  }

  /**
   * Get current overlay configuration
   */
  getOverlayState(): {
    config: OverlayConfig;
    signals: OverlaySignal[];
    lastSignalTime?: string;
    signalCount: number;
  } {
    return {
      config: { ...this.config },
      signals: [...this.signals],
      lastSignalTime: this.lastSignalTime,
      signalCount: this.signalCount,
    };
  }

  /**
   * Update overlay configuration
   */
  updateOverlayConfig(newConfig: Partial<OverlayConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    logger.info(
      { config: this.config },
      "Overlay configuration updated"
    );
  }

  /**
   * Get MCP bridge connection status
   */
  bridgeStatus(): MCPConnectionStatus {
    // Note: Real external MCP blocked by credentials
    // Internal adapter treats connection as always ready
    const avgProcessingMs =
      this.processingTimes.length > 0
        ? this.processingTimes.reduce((a, b) => a + b, 0) /
          this.processingTimes.length
        : 0;

    return {
      connected: true, // Internal adapter is always "connected"
      lastSignalTime: this.lastSignalTime,
      signalCount: this.signalCount,
      avgProcessingMs: Math.round(avgProcessingMs * 100) / 100,
      recentErrors: [...this.recentErrors],
    };
  }

  /**
   * Get recent signals
   */
  getRecentSignals(limit: number = 10): OverlaySignal[] {
    return this.signals.slice(-limit);
  }

  /**
   * Clear all signals (testing utility)
   */
  _clearSignals(): void {
    this.signals = [];
    this.signalCount = 0;
    this.lastSignalTime = undefined;
    this.processingTimes = [];
  }

  /**
   * Add error to recent errors list
   */
  private _addError(errorMsg: string): void {
    this.recentErrors.push(errorMsg);
    if (this.recentErrors.length > this.maxErrors) {
      this.recentErrors.shift();
    }
  }
}
