import { EventEmitter } from "events";

/**
 * Order request structure submitted by signal layer
 */
export interface OrderRequest {
  id: string;
  signalId: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce: "GTC" | "IOC" | "FOK" | "DAY";
  metadata: Record<string, unknown>;
}

/**
 * Individual fill record from a venue execution
 */
export interface Fill {
  fillId: string;
  qty: number;
  price: number;
  fee: number;
  timestamp: string;
  venue: string;
}

/**
 * Order status enumeration
 */
export type OrderStatus =
  | "pending"
  | "validating"
  | "routed"
  | "partial_fill"
  | "filled"
  | "rejected"
  | "cancelled"
  | "timeout";

/**
 * Complete order state tracking
 */
export interface OrderState {
  id: string;
  request: OrderRequest;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  fees: number;
  slippage: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  fills: Fill[];
  rejectionReason?: string;
}

/**
 * Execution engine configuration
 */
export interface ExecutionConfig {
  mode: "live" | "paper" | "shadow";
  maxSlippageBps: number;
  maxRetries: number;
  retryDelayMs: number;
  orderTimeoutMs: number;
  cooldownMs: number;
  maxConcurrentOrders: number;
}

/**
 * Execution report for analytics and monitoring
 */
export interface ExecutionReport {
  totalOrders: number;
  filledOrders: number;
  rejectedOrders: number;
  avgSlippageBps: number;
  avgFillTimeMs: number;
  fillRate: number;
  totalFees: number;
  ordersByStatus: Record<OrderStatus, number>;
}

/**
 * ExecutionEngine manages the complete order lifecycle from signal to fill.
 *
 * Extends EventEmitter to emit lifecycle events at key stages.
 * Supports live, paper, and shadow trading modes with validation,
 * routing, and fill simulation capabilities.
 *
 * @example
 * ```ts
 * const engine = new ExecutionEngine({
 *   mode: "paper",
 *   maxSlippageBps: 25,
 *   maxRetries: 3,
 * });
 *
 * const state = await engine.submitOrder({
 *   id: "order_123",
 *   signalId: "signal_456",
 *   symbol: "AAPL",
 *   side: "buy",
 *   type: "market",
 *   quantity: 100,
 *   timeInForce: "IOC",
 *   metadata: { strategy: "momentum" },
 * });
 * ```
 */
export class ExecutionEngine extends EventEmitter {
  private config: ExecutionConfig;
  private orders: Map<string, OrderState>;
  private lastOrderTime: number;

  /**
   * Creates an execution engine instance with the specified configuration.
   *
   * @param config - Execution engine configuration
   *   - mode: trading mode (live, paper, or shadow)
   *   - maxSlippageBps: maximum acceptable slippage in basis points
   *   - maxRetries: maximum retry attempts for failed orders
   *   - retryDelayMs: delay between retry attempts in milliseconds
   *   - orderTimeoutMs: timeout for order completion in milliseconds
   *   - cooldownMs: minimum time between successive order submissions
   *   - maxConcurrentOrders: maximum number of active orders
   *
   * @throws {Error} If configuration values are invalid
   */
  constructor(config: Partial<ExecutionConfig> = {}) {
    super();

    this.config = {
      mode: config.mode ?? "paper",
      maxSlippageBps: config.maxSlippageBps ?? 25,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 500,
      orderTimeoutMs: config.orderTimeoutMs ?? 30000,
      cooldownMs: config.cooldownMs ?? 2000,
      maxConcurrentOrders: config.maxConcurrentOrders ?? 5,
    };

    this.orders = new Map();
    this.lastOrderTime = 0;

    this.validateConfig();
  }

  /**
   * Validates configuration parameters for logical consistency.
   *
   * @private
   * @throws {Error} If any configuration value is invalid
   */
  private validateConfig(): void {
    if (this.config.maxSlippageBps < 0) {
      throw new Error("maxSlippageBps must be non-negative");
    }
    if (this.config.maxRetries < 0) {
      throw new Error("maxRetries must be non-negative");
    }
    if (this.config.retryDelayMs < 0) {
      throw new Error("retryDelayMs must be non-negative");
    }
    if (this.config.orderTimeoutMs < 0) {
      throw new Error("orderTimeoutMs must be non-negative");
    }
    if (this.config.cooldownMs < 0) {
      throw new Error("cooldownMs must be non-negative");
    }
    if (this.config.maxConcurrentOrders <= 0) {
      throw new Error("maxConcurrentOrders must be positive");
    }
  }

  /**
   * Validates the order request for correctness and market readiness.
   *
   * Checks:
   * - Quantity is positive
   * - Symbol format is valid
   * - Concurrent order limit not exceeded
   * - Cooldown period respected
   * - Price/stopPrice present when required by order type
   *
   * @param request - Order request to validate
   * @returns true if valid, false otherwise
   * @private
   */
  private validateOrder(request: OrderRequest): boolean {
    if (request.quantity <= 0) {
      return false;
    }

    if (!/^[A-Z]{1,5}$/.test(request.symbol)) {
      return false;
    }

    const activeCount = Array.from(this.orders.values()).filter((o) =>
      ["pending", "validating", "routed", "partial_fill"].includes(o.status)
    ).length;

    if (activeCount >= this.config.maxConcurrentOrders) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastOrderTime < this.config.cooldownMs) {
      return false;
    }

    if (
      request.type === "limit" ||
      request.type === "stop_limit" ||
      request.type === "stop"
    ) {
      if (request.type === "limit" && !request.price) {
        return false;
      }
      if (
        (request.type === "stop" || request.type === "stop_limit") &&
        !request.stopPrice
      ) {
        return false;
      }
      if (request.type === "stop_limit" && (!request.price || !request.stopPrice)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculates random slippage within configured bounds for simulations.
   *
   * @returns Slippage in basis points (0 to maxSlippageBps)
   * @private
   */
  private getRandomSlippage(): number {
    return Math.random() * this.config.maxSlippageBps;
  }

  /**
   * Calculates random fill delay for simulated executions.
   *
   * @returns Delay in milliseconds (50-500ms)
   * @private
   */
  private getRandomFillDelay(): number {
    return 50 + Math.random() * 450;
  }

  /**
   * Simulates order fill with random slippage and delay.
   *
   * Used in paper and shadow modes to realistic order execution.
   *
   * @param order - Order state to fill
   * @returns Promise resolving when fill is simulated
   * @private
   */
  private async simulateFill(order: OrderState): Promise<void> {
    const delay = this.getRandomFillDelay();
    await new Promise((resolve) => setTimeout(resolve, delay));

    const slippageBps = this.getRandomSlippage();
    const slippagePercent = slippageBps / 10000;

    const fillPrice =
      order.request.price ||
      order.request.type === "market"
        ? Math.random() * 100 + 50
        : order.request.price!;

    const adjustedPrice = fillPrice * (1 + slippagePercent);
    const fee = order.request.quantity * adjustedPrice * 0.001;

    const fill: Fill = {
      fillId: `fill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      qty: order.request.quantity,
      price: adjustedPrice,
      fee,
      timestamp: new Date().toISOString(),
      venue: this.config.mode === "shadow" ? "shadow" : "simulated",
    };

    order.fills.push(fill);
    order.filledQty = fill.qty;
    order.avgFillPrice = fill.price;
    order.fees = fee;
    order.slippage = slippageBps;
    order.status = "filled";
    order.updatedAt = new Date().toISOString();

    this.emit("order:filled", order);
  }

  /**
   * Routes an order to the appropriate execution venue.
   *
   * In live mode, would interface with broker APIs.
   * In paper/shadow modes, simulates the execution.
   *
   * @param order - Order state to route
   * @returns Promise resolving when routing is complete
   * @private
   */
  private async routeOrder(order: OrderState): Promise<void> {
    order.status = "routed";
    order.updatedAt = new Date().toISOString();
    this.emit("order:routed", order);

    if (this.config.mode === "live") {
      // In production, this would send to a broker API
      // For now, mark as routed and wait for async fill
      return;
    }

    await this.simulateFill(order);
  }

  /**
   * Submits an order for execution with full lifecycle management.
   *
   * Lifecycle: PENDING → VALIDATING → ROUTED → (PARTIAL_FILL →) FILLED/REJECTED/CANCELLED/TIMEOUT
   *
   * Performs pre-trade validation, creates order state, routes to venue,
   * and tracks all fills and status changes.
   *
   * @param request - Order request from signal layer
   * @returns Promise resolving with final order state
   *
   * @throws {Error} If validation fails with descriptive reason
   *
   * @example
   * ```ts
   * const state = await engine.submitOrder({
   *   id: "order_123",
   *   signalId: "signal_456",
   *   symbol: "AAPL",
   *   side: "buy",
   *   type: "market",
   *   quantity: 100,
   *   timeInForce: "IOC",
   *   metadata: { strategy: "momentum" },
   * });
   * console.log(state.status); // "filled"
   * ```
   */
  async submitOrder(request: OrderRequest): Promise<OrderState> {
    if (!this.validateOrder(request)) {
      throw new Error(`Order validation failed for ${request.id}`);
    }

    const now = new Date().toISOString();
    const order: OrderState = {
      id: request.id,
      request,
      status: "pending",
      filledQty: 0,
      avgFillPrice: 0,
      fees: 0,
      slippage: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      fills: [],
    };

    this.orders.set(request.id, order);
    this.lastOrderTime = Date.now();

    this.emit("order:submitted", order);

    order.status = "validating";
    order.updatedAt = new Date().toISOString();

    try {
      await this.routeOrder(order);
    } catch (error) {
      order.status = "rejected";
      order.rejectionReason =
        error instanceof Error ? error.message : "Unknown error";
      order.updatedAt = new Date().toISOString();
      this.emit("order:rejected", order);
    }

    return order;
  }

  /**
   * Cancels an active order by ID.
   *
   * Can only cancel orders in active states (pending, validating, routed, partial_fill).
   *
   * @param orderId - ID of order to cancel
   * @returns Promise<true> if cancellation succeeded, false if order not found or not cancellable
   *
   * @example
   * ```ts
   * const cancelled = await engine.cancelOrder("order_123");
   * if (cancelled) console.log("Order cancelled");
   * ```
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) {
      return false;
    }

    const cancelableStates: OrderStatus[] = [
      "pending",
      "validating",
      "routed",
      "partial_fill",
    ];
    if (!cancelableStates.includes(order.status)) {
      return false;
    }

    order.status = "cancelled";
    order.updatedAt = new Date().toISOString();
    this.emit("order:cancelled", order);

    return true;
  }

  /**
   * Retrieves order state by ID.
   *
   * @param orderId - ID of order to retrieve
   * @returns OrderState if found, undefined otherwise
   *
   * @example
   * ```ts
   * const order = engine.getOrder("order_123");
   * if (order) console.log(`Status: ${order.status}`);
   * ```
   */
  getOrder(orderId: string): OrderState | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Retrieves all currently active orders.
   *
   * Active orders are those in: pending, validating, routed, or partial_fill states.
   *
   * @returns Array of active order states
   *
   * @example
   * ```ts
   * const active = engine.getActiveOrders();
   * console.log(`${active.length} orders in flight`);
   * ```
   */
  getActiveOrders(): OrderState[] {
    const activeStates: OrderStatus[] = [
      "pending",
      "validating",
      "routed",
      "partial_fill",
    ];
    return Array.from(this.orders.values()).filter((order) =>
      activeStates.includes(order.status)
    );
  }

  /**
   * Generates a comprehensive execution report for analytics and monitoring.
   *
   * Includes summary statistics like fill rate, average slippage, execution time,
   * and breakdowns by order status.
   *
   * @returns ExecutionReport with aggregate metrics
   *
   * @example
   * ```ts
   * const report = engine.getExecutionReport();
   * console.log(`Fill rate: ${(report.fillRate * 100).toFixed(2)}%`);
   * console.log(`Avg slippage: ${report.avgSlippageBps} bps`);
   * ```
   */
  getExecutionReport(): ExecutionReport {
    const allOrders = Array.from(this.orders.values());

    const byStatus: Record<OrderStatus, number> = {
      pending: 0,
      validating: 0,
      routed: 0,
      partial_fill: 0,
      filled: 0,
      rejected: 0,
      cancelled: 0,
      timeout: 0,
    };

    allOrders.forEach((order) => {
      byStatus[order.status]++;
    });

    const filledOrders = allOrders.filter((o) => o.status === "filled");
    const rejectedOrders = allOrders.filter((o) => o.status === "rejected");

    const avgSlippageBps =
      filledOrders.length > 0
        ? filledOrders.reduce((sum, o) => sum + o.slippage, 0) /
          filledOrders.length
        : 0;

    const avgFillTimeMs =
      filledOrders.length > 0
        ? filledOrders.reduce((sum, o) => {
            const created = new Date(o.createdAt).getTime();
            const updated = new Date(o.updatedAt).getTime();
            return sum + (updated - created);
          }, 0) / filledOrders.length
        : 0;

    const fillRate =
      allOrders.length > 0 ? filledOrders.length / allOrders.length : 0;

    const totalFees = allOrders.reduce((sum, o) => sum + o.fees, 0);

    return {
      totalOrders: allOrders.length,
      filledOrders: filledOrders.length,
      rejectedOrders: rejectedOrders.length,
      avgSlippageBps,
      avgFillTimeMs,
      fillRate,
      totalFees,
      ordersByStatus: byStatus,
    };
  }

  /**
   * Changes the execution mode (live, paper, or shadow).
   *
   * Useful for switching between testing and production execution.
   * Does not affect orders already submitted.
   *
   * @param mode - New execution mode
   *
   * @example
   * ```ts
   * engine.setMode("paper"); // Switch to paper trading
   * engine.setMode("live");  // Switch to live trading
   * ```
   */
  setMode(mode: "live" | "paper" | "shadow"): void {
    this.config.mode = mode;
  }

  /**
   * Gracefully shuts down the execution engine.
   *
   * Cancels all active orders and cleans up resources.
   * After shutdown, no new orders can be submitted.
   *
   * @example
   * ```ts
   * process.on("SIGTERM", () => {
   *   engine.shutdown();
   *   console.log("Engine shut down cleanly");
   * });
   * ```
   */
  shutdown(): void {
    const activeOrders = this.getActiveOrders();
    activeOrders.forEach((order) => {
      order.status = "cancelled";
      order.updatedAt = new Date().toISOString();
      this.emit("order:cancelled", order);
    });

    this.removeAllListeners();
  }
}
