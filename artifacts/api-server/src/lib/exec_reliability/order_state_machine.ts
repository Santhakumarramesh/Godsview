import { EventEmitter } from 'events';

export type OrderState =
  | 'CREATED'
  | 'VALIDATING'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIAL_FILL'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED';

export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type OrderSide = 'buy' | 'sell';

export interface StateTransition {
  state: OrderState;
  timestamp: number;
  reason: string;
}

export interface ManagedOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  filledQuantity: number;
  price?: number;
  stopPrice?: number;
  state: OrderState;
  stateHistory: StateTransition[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  brokerId?: string;
  venue: string;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  retryableErrors: string[];
}

export interface BrokerConfig {
  brokerId: string;
  venue: string;
  retryPolicy: RetryPolicy;
}

interface IdempotencyEntry {
  orderId: string;
  expiresAt: number;
}

interface CancelRequest {
  orderId: string;
  requestedAt: number;
  reason: string;
  confirmed?: boolean;
}

export class OrderStateMachine extends EventEmitter {
  private orders = new Map<string, ManagedOrder>();
  private idempotencyKeys = new Map<string, IdempotencyEntry>();
  private cancelRequests = new Map<string, CancelRequest>();
  private brokerConfigs = new Map<string, BrokerConfig>();
  private positions = new Map<string, { symbol: string; quantity: number; venue: string }>();
  private reconciliationInterval: NodeJS.Timeout | null = null;

  private readonly DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly CANCEL_TIMEOUT_MS = 5000; // 5 seconds
  private readonly RECONCILIATION_INTERVAL_MS = 60000; // 60 seconds

  private readonly NON_RETRYABLE_ERRORS = [
    'insufficient_funds',
    'invalid_symbol',
    'market_closed',
    'invalid_quantity',
  ];

  private readonly VALID_TRANSITIONS: Record<OrderState, OrderState[]> = {
    CREATED: ['VALIDATING'],
    VALIDATING: ['SUBMITTED', 'FAILED'],
    SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'FAILED'],
    ACKNOWLEDGED: ['PARTIAL_FILL', 'CANCELLED', 'FILLED', 'REJECTED'],
    PARTIAL_FILL: ['FILLED', 'CANCELLED', 'PARTIAL_FILL'],
    FILLED: ['EXPIRED'],
    CANCELLED: ['EXPIRED'],
    REJECTED: ['EXPIRED'],
    EXPIRED: [],
    FAILED: ['EXPIRED'],
  };

  constructor() {
    super();
    this.initializeBrokerConfigs();
    this.startReconciliation();
  }

  private initializeBrokerConfigs(): void {
    this.brokerConfigs.set('alpaca', {
      brokerId: 'alpaca',
      venue: 'ALPACA',
      retryPolicy: {
        maxRetries: 3,
        backoffMs: 1000,
        retryableErrors: ['connection_error', 'timeout', 'rate_limit'],
      },
    });

    this.brokerConfigs.set('iex', {
      brokerId: 'iex',
      venue: 'IEX',
      retryPolicy: {
        maxRetries: 2,
        backoffMs: 500,
        retryableErrors: ['connection_error', 'timeout'],
      },
    });

    this.brokerConfigs.set('darkpool', {
      brokerId: 'darkpool',
      venue: 'DARKPOOL',
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 2000,
        retryableErrors: ['connection_error'],
      },
    });
  }

  private startReconciliation(): void {
    this.reconciliationInterval = setInterval(() => {
      this.reconcileOrphanPositions();
    }, this.RECONCILIATION_INTERVAL_MS);
  }

  submitOrder(
    clientOrderId: string,
    symbol: string,
    side: OrderSide,
    type: OrderType,
    quantity: number,
    brokerId: string = 'alpaca',
    price?: number,
    stopPrice?: number,
  ): ManagedOrder {
    // Check for duplicate submission
    const existingEntry = this.idempotencyKeys.get(clientOrderId);
    if (existingEntry && existingEntry.expiresAt > Date.now()) {
      const existingOrder = this.orders.get(existingEntry.orderId);
      if (existingOrder) {
        this.emit('duplicate:rejected', { clientOrderId, orderId: existingEntry.orderId });
        return existingOrder;
      }
    }

    // Create new order
    const orderId = this.generateOrderId();
    const now = Date.now();
    const order: ManagedOrder = {
      id: orderId,
      clientOrderId,
      symbol,
      side,
      type,
      quantity,
      filledQuantity: 0,
      price,
      stopPrice,
      state: 'CREATED',
      stateHistory: [{ state: 'CREATED', timestamp: now, reason: 'Order created' }],
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.DEFAULT_EXPIRY_MS,
      brokerId,
      venue: this.brokerConfigs.get(brokerId)?.venue || 'UNKNOWN',
      retryCount: 0,
      maxRetries: this.brokerConfigs.get(brokerId)?.retryPolicy.maxRetries || 0,
    };

    this.orders.set(orderId, order);
    this.idempotencyKeys.set(clientOrderId, {
      orderId,
      expiresAt: now + this.IDEMPOTENCY_TTL_MS,
    });

    this.emit('order:created', order);
    return order;
  }

  transitionOrder(
    orderId: string,
    newState: OrderState,
    reason: string = '',
    filledQuantity?: number,
  ): ManagedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const currentState = order.state;

    // Validate transition
    if (!this.VALID_TRANSITIONS[currentState].includes(newState)) {
      throw new Error(`Invalid transition: ${currentState} → ${newState}`);
    }

    // Update order
    const now = Date.now();
    order.state = newState;
    order.updatedAt = now;
    if (filledQuantity !== undefined) {
      order.filledQuantity = filledQuantity;
    }

    order.stateHistory.push({
      state: newState,
      timestamp: now,
      reason,
    });

    this.emit('order:state-change', {
      orderId,
      from: currentState,
      to: newState,
      reason,
      timestamp: now,
    });

    if (newState === 'FILLED') {
      this.emit('order:filled', order);
      this.createPosition(orderId, order);
    } else if (newState === 'CANCELLED') {
      this.emit('order:cancelled', order);
    } else if (newState === 'FAILED') {
      this.emit('order:failed', order);
    }

    return order;
  }

  cancelOrder(orderId: string, reason: string = 'User requested'): CancelRequest {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (!['ACKNOWLEDGED', 'PARTIAL_FILL'].includes(order.state)) {
      throw new Error(`Cannot cancel order in state: ${order.state}`);
    }

    const now = Date.now();
    const cancelRequest: CancelRequest = {
      orderId,
      requestedAt: now,
      reason,
    };

    this.cancelRequests.set(orderId, cancelRequest);

    // Set timeout for cancel confirmation
    setTimeout(() => {
      const req = this.cancelRequests.get(orderId);
      if (req && !req.confirmed) {
        this.transitionOrder(orderId, 'FAILED', 'Cancel confirmation timeout exceeded');
      }
    }, this.CANCEL_TIMEOUT_MS);

    return cancelRequest;
  }

  confirmCancelOrder(orderId: string): ManagedOrder {
    const cancelRequest = this.cancelRequests.get(orderId);
    if (!cancelRequest) {
      throw new Error(`No cancel request found for order: ${orderId}`);
    }

    cancelRequest.confirmed = true;
    return this.transitionOrder(orderId, 'CANCELLED', cancelRequest.reason);
  }

  replaceOrder(
    orderId: string,
    updates: Partial<ManagedOrder>,
  ): { cancelledOrder: ManagedOrder; newOrder: ManagedOrder } {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Cancel existing order
    const cancelledOrder = this.transitionOrder(
      orderId,
      'CANCELLED',
      'Replaced by cancel-and-replace',
    );

    // Create new order with updated parameters
    const newOrder = this.submitOrder(
      `${order.clientOrderId}-REPLACE`,
      updates.symbol || order.symbol,
      updates.side || order.side,
      updates.type || order.type,
      updates.quantity || order.quantity,
      updates.brokerId || order.brokerId,
      updates.price || order.price,
      updates.stopPrice || order.stopPrice,
    );

    return { cancelledOrder, newOrder };
  }

  retryOrder(orderId: string): ManagedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.retryCount >= order.maxRetries) {
      throw new Error(`Max retries exceeded for order: ${orderId}`);
    }

    const isRetryable = !this.isNonRetryableError(order.lastError);
    if (!isRetryable) {
      throw new Error(`Error is not retryable: ${order.lastError}`);
    }

    order.retryCount += 1;
    this.emit('retry:attempt', {
      orderId,
      retryCount: order.retryCount,
      maxRetries: order.maxRetries,
      timestamp: Date.now(),
    });

    return this.transitionOrder(
      orderId,
      'VALIDATING',
      `Retry attempt ${order.retryCount}/${order.maxRetries}`,
    );
  }

  private isNonRetryableError(error?: string): boolean {
    if (!error) return false;
    return this.NON_RETRYABLE_ERRORS.some((err) => error.toLowerCase().includes(err));
  }

  getBackoffDelay(orderId: string): number {
    const order = this.orders.get(orderId);
    if (!order) return 0;

    const brokerConfig = this.brokerConfigs.get(order.brokerId || 'alpaca');
    if (!brokerConfig) return 0;

    const baseDelay = brokerConfig.retryPolicy.backoffMs;
    const exponentialDelay = baseDelay * Math.pow(2, order.retryCount - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay;

    return exponentialDelay + jitter;
  }

  getOrder(orderId: string): ManagedOrder | undefined {
    return this.orders.get(orderId);
  }

  getOrderByClientId(clientOrderId: string): ManagedOrder | undefined {
    const entry = this.idempotencyKeys.get(clientOrderId);
    if (!entry) return undefined;
    return this.orders.get(entry.orderId);
  }

  getAllOrders(state?: OrderState): ManagedOrder[] {
    const orders = Array.from(this.orders.values());
    if (state) {
      return orders.filter((o) => o.state === state);
    }
    return orders;
  }

  getOrphanPositions(): Array<{ symbol: string; quantity: number; venue: string }> {
    const orphans: Array<{ symbol: string; quantity: number; venue: string }> = [];

    for (const position of this.positions.values()) {
      const matchingOrders = this.getAllOrders('FILLED').filter(
        (o) => o.symbol === position.symbol && o.venue === position.venue,
      );

      if (matchingOrders.length === 0) {
        orphans.push(position);
        this.emit('orphan:detected', {
          type: 'position',
          symbol: position.symbol,
          quantity: position.quantity,
          venue: position.venue,
        });
      }
    }

    return orphans;
  }

  getOrphanOrders(): ManagedOrder[] {
    const orphans: ManagedOrder[] = [];

    const filledOrders = this.getAllOrders('FILLED');
    for (const order of filledOrders) {
      const matchingPosition = Array.from(this.positions.values()).find(
        (p) => p.symbol === order.symbol && p.venue === order.venue,
      );

      if (!matchingPosition) {
        orphans.push(order);
        this.emit('orphan:detected', {
          type: 'order',
          orderId: order.id,
          symbol: order.symbol,
          venue: order.venue,
          filledQuantity: order.filledQuantity,
        });
      }
    }

    return orphans;
  }

  private createPosition(orderId: string, order: ManagedOrder): void {
    const positionKey = `${order.symbol}:${order.venue}`;
    const existing = this.positions.get(positionKey);

    if (existing) {
      if (order.side === 'buy') {
        existing.quantity += order.filledQuantity;
      } else {
        existing.quantity -= order.filledQuantity;
      }
    } else {
      this.positions.set(positionKey, {
        symbol: order.symbol,
        quantity: order.side === 'buy' ? order.filledQuantity : -order.filledQuantity,
        venue: order.venue,
      });
    }
  }

  private reconcileOrphanPositions(): void {
    this.getOrphanPositions();
    this.getOrphanOrders();
  }

  expireOrder(orderId: string): ManagedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    const canExpire = !['EXPIRED', 'FILLED', 'CANCELLED', 'REJECTED', 'FAILED'].includes(
      order.state,
    );
    if (!canExpire) {
      throw new Error(`Cannot expire order in state: ${order.state}`);
    }

    return this.transitionOrder(orderId, 'EXPIRED', 'Order expired');
  }

  markOrderFailed(orderId: string, error: string): ManagedOrder {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    order.lastError = error;
    return this.transitionOrder(orderId, 'FAILED', `Error: ${error}`);
  }

  private generateOrderId(): string {
    return `ORD-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  loadMockOrders(): void {
    // No mock orders — real orders come from execution engine via submitOrder()
  }

  destroy(): void {
    if (this.reconciliationInterval) {
      clearInterval(this.reconciliationInterval);
    }
    this.removeAllListeners();
  }
}
