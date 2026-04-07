/**
 * Phase 96 — Broker Bridge
 *
 * Unified broker integration layer that abstracts the specifics of
 * different brokers (Alpaca, Interactive Brokers, etc.) behind a
 * common interface. Handles order routing, fill confirmation,
 * and account state synchronization.
 */

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit" | "trailing_stop";
export type OrderTimeInForce = "day" | "gtc" | "ioc" | "fok";
export type OrderStatus = "new" | "partially_filled" | "filled" | "cancelled" | "rejected" | "expired" | "pending_cancel";
export type PositionSide = "long" | "short";

export interface BrokerCredentials {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  paperTrading: boolean;
}

export interface BrokerOrder {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: OrderTimeInForce;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  trailPercent?: number;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  submittedAt: Date;
  filledAt?: Date;
  cancelledAt?: Date;
  commission: number;
  metadata: Record<string, string>;
}

export interface BrokerPosition {
  symbol: string;
  side: PositionSide;
  quantity: number;
  avgEntryPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  currentPrice: number;
  costBasis: number;
  lastUpdated: Date;
}

export interface AccountState {
  accountId: string;
  cash: number;
  portfolioValue: number;
  buyingPower: number;
  equity: number;
  longMarketValue: number;
  shortMarketValue: number;
  dayTradeCount: number;
  patternDayTrader: boolean;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  lastUpdated: Date;
}

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  timeInForce: OrderTimeInForce;
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  trailPercent?: number;
  clientOrderId?: string;
  metadata?: Record<string, string>;
}

export interface FillEvent {
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  commission: number;
  ts: Date;
  isPartial: boolean;
}

export interface BrokerBridgeEvents {
  onFill: (fill: FillEvent) => void;
  onOrderUpdate: (order: BrokerOrder) => void;
  onAccountUpdate: (account: AccountState) => void;
  onError: (error: Error) => void;
}

/**
 * BrokerBridge — unified broker abstraction
 *
 * Provides a consistent API regardless of which broker is being used.
 * Handles order lifecycle, position tracking, and account state.
 */
export class BrokerBridge {
  private credentials: BrokerCredentials;
  private orders: Map<string, BrokerOrder> = new Map();
  private positions: Map<string, BrokerPosition> = new Map();
  private accountState: AccountState;
  private eventHandlers: Partial<BrokerBridgeEvents> = {};
  private isConnected = false;
  private orderCounter = 0;

  constructor(credentials: BrokerCredentials) {
    this.credentials = credentials;
    this.accountState = {
      accountId: "",
      cash: 0,
      portfolioValue: 0,
      buyingPower: 0,
      equity: 0,
      longMarketValue: 0,
      shortMarketValue: 0,
      dayTradeCount: 0,
      patternDayTrader: false,
      tradingBlocked: false,
      accountBlocked: false,
      lastUpdated: new Date(),
    };
  }

  /** Register event handlers */
  on<K extends keyof BrokerBridgeEvents>(event: K, handler: BrokerBridgeEvents[K]): void {
    this.eventHandlers[event] = handler;
  }

  /** Connect to broker */
  async connect(): Promise<void> {
    // In production, this establishes WebSocket connections
    // and fetches initial account state
    this.isConnected = true;
    await this.syncAccountState();
    await this.syncPositions();
  }

  /** Submit an order */
  async submitOrder(request: OrderRequest): Promise<BrokerOrder> {
    if (!this.isConnected) throw new Error("Broker not connected");
    if (this.accountState.tradingBlocked) throw new Error("Trading is blocked");

    // Validate order
    this.validateOrder(request);

    this.orderCounter++;
    const orderId = `order_${Date.now()}_${this.orderCounter}`;
    const clientOrderId = request.clientOrderId ?? `gv_${orderId}`;

    const order: BrokerOrder = {
      orderId,
      clientOrderId,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      timeInForce: request.timeInForce,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      stopPrice: request.stopPrice,
      trailPercent: request.trailPercent,
      status: "new",
      filledQty: 0,
      avgFillPrice: 0,
      submittedAt: new Date(),
      commission: 0,
      metadata: request.metadata ?? {},
    };

    this.orders.set(orderId, order);
    this.eventHandlers.onOrderUpdate?.(order);

    return order;
  }

  /** Cancel an order */
  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;
    if (order.status === "filled" || order.status === "cancelled") return false;

    order.status = "cancelled";
    order.cancelledAt = new Date();
    this.eventHandlers.onOrderUpdate?.(order);
    return true;
  }

  /** Cancel all open orders */
  async cancelAllOrders(symbol?: string): Promise<number> {
    let cancelled = 0;
    for (const order of this.orders.values()) {
      if (order.status === "new" || order.status === "partially_filled") {
        if (!symbol || order.symbol === symbol) {
          order.status = "cancelled";
          order.cancelledAt = new Date();
          cancelled++;
        }
      }
    }
    return cancelled;
  }

  /** Simulate a fill (for paper trading / testing) */
  simulateFill(orderId: string, price: number, quantity?: number): void {
    const order = this.orders.get(orderId);
    if (!order) return;

    const fillQty = quantity ?? order.quantity;
    order.filledQty += fillQty;
    order.avgFillPrice = price;
    order.commission = 1.0; // flat commission
    order.status = order.filledQty >= order.quantity ? "filled" : "partially_filled";
    order.filledAt = new Date();

    // Update position
    this.updatePositionFromFill(order, price, fillQty);

    const fill: FillEvent = {
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      quantity: fillQty,
      price,
      commission: order.commission,
      ts: new Date(),
      isPartial: order.status === "partially_filled",
    };

    this.eventHandlers.onFill?.(fill);
    this.eventHandlers.onOrderUpdate?.(order);
  }

  /** Update position from a fill */
  private updatePositionFromFill(order: BrokerOrder, price: number, qty: number): void {
    const existing = this.positions.get(order.symbol);

    if (order.side === "buy") {
      if (existing && existing.side === "short") {
        // Closing short
        existing.quantity -= qty;
        if (existing.quantity <= 0) {
          this.positions.delete(order.symbol);
        }
      } else {
        // Opening or adding to long
        const pos = existing ?? {
          symbol: order.symbol,
          side: "long" as PositionSide,
          quantity: 0,
          avgEntryPrice: 0,
          marketValue: 0,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          currentPrice: price,
          costBasis: 0,
          lastUpdated: new Date(),
        };
        const totalCost = pos.avgEntryPrice * pos.quantity + price * qty;
        pos.quantity += qty;
        pos.avgEntryPrice = pos.quantity > 0 ? totalCost / pos.quantity : 0;
        pos.currentPrice = price;
        pos.marketValue = pos.quantity * price;
        pos.costBasis = pos.quantity * pos.avgEntryPrice;
        pos.lastUpdated = new Date();
        this.positions.set(order.symbol, pos);
      }
    } else {
      if (existing && existing.side === "long") {
        // Closing long
        existing.quantity -= qty;
        if (existing.quantity <= 0) {
          this.positions.delete(order.symbol);
        }
      } else {
        // Opening or adding to short
        const pos = existing ?? {
          symbol: order.symbol,
          side: "short" as PositionSide,
          quantity: 0,
          avgEntryPrice: 0,
          marketValue: 0,
          unrealizedPnl: 0,
          unrealizedPnlPercent: 0,
          currentPrice: price,
          costBasis: 0,
          lastUpdated: new Date(),
        };
        const totalCost = pos.avgEntryPrice * pos.quantity + price * qty;
        pos.quantity += qty;
        pos.avgEntryPrice = pos.quantity > 0 ? totalCost / pos.quantity : 0;
        pos.currentPrice = price;
        pos.marketValue = pos.quantity * price;
        pos.costBasis = pos.quantity * pos.avgEntryPrice;
        pos.lastUpdated = new Date();
        this.positions.set(order.symbol, pos);
      }
    }
  }

  /** Validate order before submission */
  private validateOrder(request: OrderRequest): void {
    if (request.quantity <= 0) throw new Error("Quantity must be positive");
    if (request.type === "limit" && !request.limitPrice) throw new Error("Limit price required for limit orders");
    if (request.type === "stop" && !request.stopPrice) throw new Error("Stop price required for stop orders");
    if (request.type === "stop_limit" && (!request.stopPrice || !request.limitPrice)) {
      throw new Error("Both stop and limit prices required for stop-limit orders");
    }

    // Check buying power
    const estimatedCost = request.quantity * (request.limitPrice ?? request.stopPrice ?? 0);
    if (estimatedCost > this.accountState.buyingPower) {
      throw new Error(`Insufficient buying power: need ${estimatedCost}, have ${this.accountState.buyingPower}`);
    }
  }

  /** Sync account state from broker */
  async syncAccountState(): Promise<AccountState> {
    // In production, this calls the broker API
    this.accountState.lastUpdated = new Date();
    return this.accountState;
  }

  /** Sync positions from broker */
  async syncPositions(): Promise<BrokerPosition[]> {
    return Array.from(this.positions.values());
  }

  /** Set account state (for initialization/testing) */
  setAccountState(state: Partial<AccountState>): void {
    Object.assign(this.accountState, state, { lastUpdated: new Date() });
  }

  /** Get current account state */
  getAccountState(): AccountState {
    return { ...this.accountState };
  }

  /** Get all positions */
  getPositions(): BrokerPosition[] {
    return Array.from(this.positions.values());
  }

  /** Get position for a symbol */
  getPosition(symbol: string): BrokerPosition | undefined {
    return this.positions.get(symbol);
  }

  /** Get all orders */
  getOrders(status?: OrderStatus): BrokerOrder[] {
    const all = Array.from(this.orders.values());
    return status ? all.filter((o) => o.status === status) : all;
  }

  /** Get order by ID */
  getOrder(orderId: string): BrokerOrder | undefined {
    return this.orders.get(orderId);
  }

  /** Check if connected */
  get connected(): boolean {
    return this.isConnected;
  }

  /** Check if paper trading */
  get isPaperTrading(): boolean {
    return this.credentials.paperTrading;
  }

  /** Disconnect */
  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
}
