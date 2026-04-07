/**
 * fill_simulator.ts — Realistic Fill Behavior Simulator
 *
 * Model realistic market microstructure:
 *   - Slippage: based on order size, spread, and volatility
 *   - Market impact: large orders move price proportionally
 *   - Partial fills: probability of full execution
 *   - Latency: configurable delay between signal and execution
 *   - Volume check: ensure order size is reasonable
 *
 * Bridges gap between ideal backtest and real trading.
 */

import { logger } from "../logger";
import { OHLCVBar } from "../backtest_engine";

// ── Types ──────────────────────────────────────────────────────────────────

/** Fill configuration */
export interface FillConfig {
  spreadBps: number; // Bid-ask spread in basis points
  slippageModel: "fixed" | "volume_based" | "volatility_based" | "hybrid";
  slippageBps: number; // Base slippage in bps (for fixed model)
  latencyMs: number; // Execution delay (50-500ms typical)
  marketImpactFactor: number; // Multiplier for order size / volume impact
  partialFillProbability: number; // P(full fill), 0-1
  minOrderSize: number; // Minimum order size in contracts/shares
  maxOrderSize: number; // Maximum per order (as % of avg volume)
}

/** Fill result */
export interface FillResult {
  requested: {
    size: number;
    side: "buy" | "sell";
    price: number;
    timestamp: string;
  };
  filled: {
    size: number;
    price: number;
    timestamp: string;
    partial: boolean;
  };
  slippage: {
    bps: number; // Total slippage in basis points
    components: {
      spread: number;
      latency: number;
      marketImpact: number;
      volatility: number;
    };
  };
  executed: boolean; // false if no fill
  reason?: string;
}

// ── Fill Simulator ──────────────────────────────────────────────────────────

export class FillSimulator {
  /**
   * Simulate a fill with realistic market conditions
   */
  simulateFill(
    requestBar: OHLCVBar,
    executionBar: OHLCVBar,
    orderSize: number,
    side: "buy" | "sell",
    requestPrice: number,
    config: FillConfig,
    avgVolume: number,
  ): FillResult {
    // Volume check
    if (orderSize < config.minOrderSize) {
      return {
        requested: {
          size: orderSize,
          side,
          price: requestPrice,
          timestamp: requestBar.Timestamp,
        },
        filled: {
          size: 0,
          price: 0,
          timestamp: "",
          partial: false,
        },
        slippage: {
          bps: 0,
          components: {
            spread: 0,
            latency: 0,
            marketImpact: 0,
            volatility: 0,
          },
        },
        executed: false,
        reason: "Order below minimum size",
      };
    }

    const maxSize = avgVolume * (config.maxOrderSize / 100);
    if (orderSize > maxSize) {
      return {
        requested: {
          size: orderSize,
          side,
          price: requestPrice,
          timestamp: requestBar.Timestamp,
        },
        filled: {
          size: 0,
          price: 0,
          timestamp: "",
          partial: false,
        },
        slippage: {
          bps: 0,
          components: {
            spread: 0,
            latency: 0,
            marketImpact: 0,
            volatility: 0,
          },
        },
        executed: false,
        reason: `Order exceeds maximum size (${orderSize} > ${maxSize.toFixed(0)})`,
      };
    }

    // Calculate slippage components
    const spreadSlippage = config.spreadBps / 2; // Half spread for market order

    // Latency impact: use price movement during latency
    const priceMovement = executionBar.Close - requestBar.Close;
    const latencySlippage = side === "buy"
      ? Math.max(0, (priceMovement / requestPrice) * 10000) // Convert to bps
      : Math.max(0, (-priceMovement / requestPrice) * 10000);

    // Market impact: larger orders move price
    const volumeRatio = orderSize / Math.max(avgVolume, 1);
    const marketImpactSlippage = volumeRatio * config.marketImpactFactor * 100; // Convert to bps

    // Volatility-based slippage
    const volatility = (executionBar.High - executionBar.Low) / executionBar.Close;
    const volatilitySlippage = volatility * 100; // Convert to bps

    // Compute total slippage based on model
    let totalSlippage = 0;
    switch (config.slippageModel) {
      case "fixed":
        totalSlippage = config.slippageBps;
        break;
      case "volume_based":
        totalSlippage = spreadSlippage + marketImpactSlippage;
        break;
      case "volatility_based":
        totalSlippage = spreadSlippage + volatilitySlippage;
        break;
      case "hybrid":
        totalSlippage = spreadSlippage + latencySlippage + marketImpactSlippage + volatilitySlippage;
        break;
    }

    // Convert slippage from bps to price
    const slippagePrice = (totalSlippage / 10000) * executionBar.Close;
    const executionPrice = side === "buy"
      ? executionBar.Close + slippagePrice
      : executionBar.Close - slippagePrice;

    // Partial fill probability
    const rng = Math.random();
    const partialFill = rng > config.partialFillProbability;
    const filledSize = partialFill ? orderSize * (0.5 + Math.random() * 0.5) : orderSize;

    return {
      requested: {
        size: orderSize,
        side,
        price: requestPrice,
        timestamp: requestBar.Timestamp,
      },
      filled: {
        size: filledSize,
        price: executionPrice,
        timestamp: executionBar.Timestamp,
        partial: partialFill,
      },
      slippage: {
        bps: totalSlippage,
        components: {
          spread: spreadSlippage,
          latency: latencySlippage,
          marketImpact: marketImpactSlippage,
          volatility: volatilitySlippage,
        },
      },
      executed: true,
    };
  }

  /**
   * Default fill configuration (realistic for forex)
   */
  defaultConfig(): FillConfig {
    return {
      spreadBps: 2, // 0.02% for EURUSD
      slippageModel: "hybrid",
      slippageBps: 1,
      latencyMs: 100, // 100ms typical
      marketImpactFactor: 0.5,
      partialFillProbability: 0.95, // 95% chance of full fill
      minOrderSize: 1,
      maxOrderSize: 5, // Max 5% of average volume
    };
  }

  /**
   * Aggressive fill configuration (crypto/futures)
   */
  aggressiveConfig(): FillConfig {
    return {
      spreadBps: 5,
      slippageModel: "hybrid",
      slippageBps: 3,
      latencyMs: 500,
      marketImpactFactor: 1.0,
      partialFillProbability: 0.85,
      minOrderSize: 1,
      maxOrderSize: 2,
    };
  }

  /**
   * Conservative fill configuration (equities)
   */
  conservativeConfig(): FillConfig {
    return {
      spreadBps: 1,
      slippageModel: "volume_based",
      slippageBps: 0.5,
      latencyMs: 50,
      marketImpactFactor: 0.3,
      partialFillProbability: 0.98,
      minOrderSize: 10,
      maxOrderSize: 10,
    };
  }

  /**
   * Analyze fill quality over multiple fills
   */
  analyzeFillQuality(
    fills: FillResult[],
  ): {
    totalRequested: number;
    totalFilled: number;
    fillRate: number;
    averageSlippageBps: number;
    maxSlippageBps: number;
    partialFills: number;
    failedFills: number;
    averageFillPrice: number;
  } {
    const executed = fills.filter((f) => f.executed);
    const total = executed.reduce((sum, f) => sum + f.requested.size, 0);
    const filled = executed.reduce((sum, f) => sum + f.filled.size, 0);
    const avgSlippage = executed.length > 0
      ? executed.reduce((sum, f) => sum + f.slippage.bps, 0) / executed.length
      : 0;
    const maxSlippage = executed.length > 0
      ? Math.max(...executed.map((f) => f.slippage.bps))
      : 0;
    const partialCount = executed.filter((f) => f.filled.partial).length;
    const failedCount = fills.filter((f) => !f.executed).length;
    const avgFillPrice = executed.length > 0
      ? executed.reduce((sum, f) => sum + f.filled.price, 0) / executed.length
      : 0;

    return {
      totalRequested: total,
      totalFilled: filled,
      fillRate: total > 0 ? filled / total : 0,
      averageSlippageBps: avgSlippage,
      maxSlippageBps: maxSlippage,
      partialFills: partialCount,
      failedFills: failedCount,
      averageFillPrice: avgFillPrice,
    };
  }
}

// Export singleton
export const fillSimulator = new FillSimulator();
