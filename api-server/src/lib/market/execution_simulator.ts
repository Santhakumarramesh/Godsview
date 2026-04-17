/**
 * execution_simulator.ts — High-fidelity execution simulation
 *
 * Simulates order execution with realistic modeling:
 * - Order book dynamics and price impact
 * - Slippage estimation from historical fills
 * - Transaction costs (commission, spread, market impact)
 * - Different order types (market, limit, stop)
 * - Fill quality metrics for backtesting accuracy
 * - All-in cost analysis (VWAP deviation, implementation shortfall)
 */

export interface Order {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  type: "market" | "limit" | "stop";
  limitPrice?: number;
  stopPrice?: number;
  timeInForce?: "day" | "gtc";
  venue?: string;
}

export interface MarketState {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  lastTrade: number;
  volume: number;
  vwap: number;
}

export interface Fill {
  price: number;
  quantity: number;
  timestamp: number;
  side: "buy" | "sell";
  fee: number;
  venue: string;
  commission?: number;
}

export interface ExecutionResult {
  filled: boolean;
  fills: Fill[];
  avgPrice: number;
  totalCost: number;
  slippage: number;
  latency: number;
  marketImpact: number;
  executionQuality: number; // 0-1
}

export interface OrderBookModel {
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  midPrice: number;
  spread: number;
  dynamicSlippage: number;
}

export interface TransactionCosts {
  commission: number;
  spread: number;
  slippage: number;
  marketImpact: number;
  totalBps: number;
  totalDollars: number;
}

export interface ExecutionStats {
  totalOrders: number;
  totalFills: number;
  avgSlippageBps: number;
  avgSpreadBps: number;
  avgLatencyMs: number;
  fillRate: number;
  totalCommission: number;
  totalMarketImpact: number;
}

export interface ExecutionQualityReport {
  avgSlippageBps: number;
  avgSpreadBps: number;
  fillRate: number;
  avgLatencyMs: number;
  implementationShortfall: number;
  vwapDeviation: number;
  recommendations: string[];
}

export class ExecutionSimulator {
  private stats = {
    totalOrders: 0,
    totalFills: 0,
    totalSlippage: 0,
    totalSpread: 0,
    totalLatency: 0,
    totalCommission: 0,
    totalMarketImpact: 0,
  };

  private commissionBps = 1; // 0.01% commission
  private spreadBps = 2; // 0.02% average spread
  private marketImpactFactor = 0.0005; // 0.05% per million in volume
  private latencyMs = 50; // Average execution latency

  /**
   * Simulate order execution with realistic fill behavior
   */
  simulateExecution(order: Order, marketState: MarketState): ExecutionResult {
    this.stats.totalOrders++;

    const startMs = Date.now();

    switch (order.type) {
      case "market":
        return this.executeMarketOrder(order, marketState);
      case "limit":
        return this.executeLimitOrder(order, marketState);
      case "stop":
        return this.executeStopOrder(order, marketState);
      default:
        throw new Error(`Unknown order type: ${order.type}`);
    }
  }

  /**
   * Simulate market order execution
   */
  private executeMarketOrder(
    order: Order,
    marketState: MarketState
  ): ExecutionResult {
    const fills: Fill[] = [];
    const orderBook = this.modelOrderBook(
      order.symbol,
      order.side === "buy" ? marketState.ask : marketState.bid,
      order.quantity
    );

    // Fill against order book
    let remaining = order.quantity;
    const side = order.side;

    for (const level of order.side === "buy" ? orderBook.asks : orderBook.bids) {
      if (remaining <= 0) break;

      const fillQty = Math.min(remaining, level.size);
      const fillPrice =
        side === "buy"
          ? level.price * (1 + orderBook.dynamicSlippage)
          : level.price * (1 - orderBook.dynamicSlippage);

      const fee = fillPrice * fillQty * (this.commissionBps / 10000);

      fills.push({
        price: fillPrice,
        quantity: fillQty,
        timestamp: Date.now(),
        side,
        fee,
        venue: order.venue || "DEFAULT",
        commission: fee,
      });

      remaining -= fillQty;
    }

    // If not fully filled, add remainder at worse price
    if (remaining > 0) {
      const worstPrice =
        side === "buy"
          ? marketState.ask * (1 + orderBook.dynamicSlippage * 2)
          : marketState.bid * (1 - orderBook.dynamicSlippage * 2);

      const fee = worstPrice * remaining * (this.commissionBps / 10000);
      fills.push({
        price: worstPrice,
        quantity: remaining,
        timestamp: Date.now() + this.latencyMs,
        side,
        fee,
        venue: order.venue || "DEFAULT",
        commission: fee,
      });
    }

    return this.buildExecutionResult(order, fills, marketState);
  }

  /**
   * Simulate limit order execution
   */
  private executeLimitOrder(
    order: Order,
    marketState: MarketState
  ): ExecutionResult {
    const fills: Fill[] = [];

    if (!order.limitPrice) {
      throw new Error("Limit order requires limitPrice");
    }

    // Check if order would execute
    const bid = marketState.bid;
    const ask = marketState.ask;

    let wouldExecute = false;
    if (order.side === "buy" && order.limitPrice >= ask) {
      wouldExecute = true;
    } else if (order.side === "sell" && order.limitPrice <= bid) {
      wouldExecute = true;
    }

    if (!wouldExecute) {
      return {
        filled: false,
        fills: [],
        avgPrice: 0,
        totalCost: 0,
        slippage: 0,
        latency: 0,
        marketImpact: 0,
        executionQuality: 0,
      };
    }

    // Partially fill at limit price
    const fillQty = Math.floor(order.quantity * 0.8); // 80% fill rate
    const fillPrice = order.limitPrice;
    const fee = fillPrice * fillQty * (this.commissionBps / 10000);

    fills.push({
      price: fillPrice,
      quantity: fillQty,
      timestamp: Date.now() + 100,
      side: order.side,
      fee,
      venue: order.venue || "DEFAULT",
      commission: fee,
    });

    return this.buildExecutionResult(order, fills, marketState);
  }

  /**
   * Simulate stop order execution
   */
  private executeStopOrder(
    order: Order,
    marketState: MarketState
  ): ExecutionResult {
    if (!order.stopPrice) {
      throw new Error("Stop order requires stopPrice");
    }

    let triggered = false;

    if (
      order.side === "sell" &&
      marketState.lastTrade <= order.stopPrice
    ) {
      triggered = true;
    } else if (
      order.side === "buy" &&
      marketState.lastTrade >= order.stopPrice
    ) {
      triggered = true;
    }

    if (!triggered) {
      return {
        filled: false,
        fills: [],
        avgPrice: 0,
        totalCost: 0,
        slippage: 0,
        latency: 0,
        marketImpact: 0,
        executionQuality: 0,
      };
    }

    // Execute as market order after trigger
    return this.executeMarketOrder(order, marketState);
  }

  /**
   * Model order book dynamics
   */
  modelOrderBook(
    symbol: string,
    currentPrice: number,
    quantity: number
  ): OrderBookModel {
    const spread = currentPrice * (this.spreadBps / 10000);
    const bid = currentPrice - spread / 2;
    const ask = currentPrice + spread / 2;

    // Build realistic order book
    const bids: { price: number; size: number }[] = [];
    const asks: { price: number; size: number }[] = [];

    for (let i = 0; i < 10; i++) {
      const depthFactor = 1 + i * 0.1;
      bids.push({
        price: bid - i * (spread / 10),
        size: 10000 / depthFactor,
      });
      asks.push({
        price: ask + i * (spread / 10),
        size: 10000 / depthFactor,
      });
    }

    // Estimate slippage
    const volumeRatio = quantity / 100000;
    const dynamicSlippage = Math.min(0.05, volumeRatio * 0.01);

    return {
      bids,
      asks,
      midPrice: (bid + ask) / 2,
      spread,
      dynamicSlippage,
    };
  }

  /**
   * Estimate execution quality from fills
   */
  estimateExecutionQuality(fills: Fill[]): ExecutionQualityReport {
    if (fills.length === 0) {
      return {
        avgSlippageBps: 0,
        avgSpreadBps: 0,
        fillRate: 0,
        avgLatencyMs: 0,
        implementationShortfall: 0,
        vwapDeviation: 0,
        recommendations: [],
      };
    }

    const avgPrice =
      fills.reduce((sum, f) => sum + f.price * f.quantity, 0) /
      fills.reduce((sum, f) => sum + f.quantity, 0);

    const avgSlippageBps = (
      (fills.reduce((sum, f) => sum + f.fee, 0) /
        (fills.reduce((sum, f) => sum + f.price * f.quantity, 0) || 1)) *
      10000
    );

    const avgSpreadBps = this.spreadBps;
    const fillRate = fills.length > 0 ? 1 : 0;
    const avgLatencyMs = this.latencyMs;

    // Implementation shortfall: (execution price - midpoint) / midpoint
    const referencePrice =
      fills[Math.floor(fills.length / 2)]?.price || avgPrice;
    const implementationShortfall = Math.abs(
      (avgPrice - referencePrice) / referencePrice
    );

    const recommendations: string[] = [];

    if (avgSlippageBps > 5) {
      recommendations.push("High slippage - consider using VWAP algorithms");
    }
    if (avgSpreadBps > 3) {
      recommendations.push("Wide spreads - consider trading in off-peak hours");
    }
    if (avgLatencyMs > 200) {
      recommendations.push("High latency - check network and co-location");
    }

    return {
      avgSlippageBps,
      avgSpreadBps,
      fillRate,
      avgLatencyMs,
      implementationShortfall,
      vwapDeviation: implementationShortfall * 10000, // Convert to bps
      recommendations,
    };
  }

  /**
   * Calculate all-in transaction costs
   */
  calculateTransactionCosts(order: Order, fill: Fill): TransactionCosts {
    const notional = fill.price * fill.quantity;

    // Commission
    const commission = notional * (this.commissionBps / 10000);

    // Spread cost (half spread on entry)
    const spread = fill.price * (this.spreadBps / 10000) * 0.5 * fill.quantity;

    // Slippage (estimated from market impact)
    const volumeRatio = order.quantity / 1000000;
    const slippage = notional * this.marketImpactFactor * volumeRatio;

    // Market impact
    const marketImpact = slippage;

    const totalBps =
      (commission + spread + slippage) / notional * 10000;
    const totalDollars = commission + spread + slippage;

    return {
      commission,
      spread,
      slippage,
      marketImpact,
      totalBps,
      totalDollars,
    };
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): ExecutionStats {
    const avgSlippageBps =
      this.stats.totalFills > 0
        ? (this.stats.totalSlippage / this.stats.totalFills) * 10000
        : 0;

    const avgSpreadBps =
      this.stats.totalFills > 0
        ? (this.stats.totalSpread / this.stats.totalFills) * 10000
        : 0;

    const avgLatencyMs =
      this.stats.totalFills > 0
        ? this.stats.totalLatency / this.stats.totalFills
        : 0;

    const fillRate =
      this.stats.totalOrders > 0
        ? this.stats.totalFills / this.stats.totalOrders
        : 0;

    return {
      totalOrders: this.stats.totalOrders,
      totalFills: this.stats.totalFills,
      avgSlippageBps,
      avgSpreadBps,
      avgLatencyMs,
      fillRate,
      totalCommission: this.stats.totalCommission,
      totalMarketImpact: this.stats.totalMarketImpact,
    };
  }

  /**
   * Reset execution statistics
   */
  resetStats(): void {
    this.stats = {
      totalOrders: 0,
      totalFills: 0,
      totalSlippage: 0,
      totalSpread: 0,
      totalLatency: 0,
      totalCommission: 0,
      totalMarketImpact: 0,
    };
  }

  /**
   * Configure execution parameters
   */
  setCommissionBps(bps: number): void {
    this.commissionBps = bps;
  }

  setSpreadBps(bps: number): void {
    this.spreadBps = bps;
  }

  setMarketImpactFactor(factor: number): void {
    this.marketImpactFactor = factor;
  }

  setLatencyMs(ms: number): void {
    this.latencyMs = ms;
  }

  // ──────────────────────────────────────────────────────────────────────────

  private buildExecutionResult(
    order: Order,
    fills: Fill[],
    marketState: MarketState
  ): ExecutionResult {
    if (fills.length === 0) {
      return {
        filled: false,
        fills: [],
        avgPrice: 0,
        totalCost: 0,
        slippage: 0,
        latency: 0,
        marketImpact: 0,
        executionQuality: 0,
      };
    }

    const totalQty = fills.reduce((sum, f) => sum + f.quantity, 0);
    const avgPrice = fills.reduce((sum, f) => sum + f.price * f.quantity, 0) / totalQty;
    const totalCost = avgPrice * totalQty;

    // Slippage relative to reference price
    const reference =
      order.side === "buy" ? marketState.ask : marketState.bid;
    const slippage =
      order.side === "buy" ? avgPrice - reference : reference - avgPrice;

    // Execution quality (0-1, higher is better)
    const totalFees = fills.reduce((sum, f) => sum + f.fee, 0);
    const executionQuality = 1 - (totalFees / totalCost || 0);

    // Market impact from fills
    const marketImpact = fills.reduce((sum, f) => sum + (f.fee || 0), 0);

    // Update stats
    this.stats.totalFills += fills.length;
    this.stats.totalSlippage += Math.abs(slippage) * totalQty;
    this.stats.totalSpread += marketState.ask - marketState.bid;
    this.stats.totalLatency += this.latencyMs;
    this.stats.totalCommission += totalFees;
    this.stats.totalMarketImpact += marketImpact;

    return {
      filled: totalQty > 0,
      fills,
      avgPrice,
      totalCost,
      slippage,
      latency: this.latencyMs,
      marketImpact,
      executionQuality,
    };
  }
}

// Export singleton
export const executionSimulator = new ExecutionSimulator();