/**
 * Phase 103 — Broker Execution Reality Layer
 * ==========================================
 * Order lifecycle finite-state machine that models the full
 * Order → Pending → PartialFill → Filled / Cancelled / Rejected / Expired
 * journey with deterministic transitions, slippage computation, and audit hooks.
 *
 * This module is broker-agnostic: it accepts events from any adapter
 * (Alpaca, simulated paper, multi-broker router) and produces a single
 * canonical lifecycle that downstream reconciliation, PnL, and explainability
 * layers can rely on.
 */

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";

export type OrderState =
  | "new"
  | "pending"
  | "accepted"
  | "partial"
  | "filled"
  | "cancelled"
  | "rejected"
  | "expired";

export interface OrderRequest {
  client_order_id: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  type: OrderType;
  tif: TimeInForce;
  limit_price?: number;
  stop_price?: number;
  /** Decision time mid/last reference for slippage attribution. */
  reference_price?: number;
  /** Source agent / strategy that originated the order. */
  source?: string;
  /** Optional decision_id linkage to fusion/explain layer. */
  decision_id?: string;
  created_at?: number;
}

export interface FillEvent {
  fill_id: string;
  qty: number;
  price: number;
  timestamp: number;
  liquidity?: "maker" | "taker";
  venue?: string;
}

export interface OrderEvent {
  type:
    | "submitted"
    | "accepted"
    | "rejected"
    | "partial_fill"
    | "filled"
    | "cancelled"
    | "expired";
  timestamp: number;
  reason?: string;
  fill?: FillEvent;
}

export interface OrderRecord {
  request: OrderRequest;
  broker_order_id?: string;
  state: OrderState;
  filled_qty: number;
  remaining_qty: number;
  avg_fill_price: number;
  fills: FillEvent[];
  events: OrderEvent[];
  realized_slippage_bps?: number;
  realized_slippage_dollars?: number;
  notional_filled: number;
  last_update: number;
  created_at: number;
  closed_at?: number;
  reject_reason?: string;
}

export interface LifecycleConfig {
  /** Maximum acceptable slippage (in bps) before flagging a fill anomaly. */
  slippage_alert_bps?: number;
  /** Stale order detection threshold in milliseconds. */
  stale_order_ms?: number;
}

const DEFAULT_CFG: Required<LifecycleConfig> = {
  slippage_alert_bps: 25,
  stale_order_ms: 30_000,
};

/** Allowed state transitions — strict FSM. */
const TRANSITIONS: Record<OrderState, OrderState[]> = {
  new: ["pending", "rejected"],
  pending: ["accepted", "rejected", "cancelled", "expired"],
  accepted: ["partial", "filled", "cancelled", "expired", "rejected"],
  partial: ["partial", "filled", "cancelled", "expired"],
  filled: [],
  cancelled: [],
  rejected: [],
  expired: [],
};

export class OrderLifecycle {
  private readonly cfg: Required<LifecycleConfig>;
  private readonly orders = new Map<string, OrderRecord>();
  private readonly listeners = new Set<
    (id: string, record: OrderRecord, evt: OrderEvent) => void
  >();

  constructor(cfg: LifecycleConfig = {}) {
    this.cfg = { ...DEFAULT_CFG, ...cfg };
  }

  /** Subscribe to lifecycle events. Returns unsubscribe fn. */
  on(
    listener: (id: string, record: OrderRecord, evt: OrderEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Submit a new order request. Idempotent on client_order_id. */
  submit(request: OrderRequest): OrderRecord {
    const existing = this.orders.get(request.client_order_id);
    if (existing) return existing;

    const now = request.created_at ?? Date.now();
    const record: OrderRecord = {
      request,
      state: "new",
      filled_qty: 0,
      remaining_qty: request.qty,
      avg_fill_price: 0,
      fills: [],
      events: [],
      notional_filled: 0,
      last_update: now,
      created_at: now,
    };
    this.orders.set(request.client_order_id, record);
    this.recordEvent(record, { type: "submitted", timestamp: now });
    this.transition(record, "pending", "submitted");
    return record;
  }

  /** Broker acknowledged the order. */
  accept(client_order_id: string, broker_order_id: string, ts = Date.now()): OrderRecord {
    const r = this.require(client_order_id);
    r.broker_order_id = broker_order_id;
    this.transition(r, "accepted", "broker_ack", ts);
    return r;
  }

  /** Broker rejected the order. */
  reject(client_order_id: string, reason: string, ts = Date.now()): OrderRecord {
    const r = this.require(client_order_id);
    r.reject_reason = reason;
    r.closed_at = ts;
    this.transition(r, "rejected", reason, ts);
    return r;
  }

  /** Apply a fill (full or partial). */
  applyFill(client_order_id: string, fill: FillEvent): OrderRecord {
    const r = this.require(client_order_id);
    if (r.state === "filled" || r.state === "cancelled" || r.state === "rejected") {
      throw new Error(`Cannot apply fill to ${r.state} order ${client_order_id}`);
    }
    if (fill.qty <= 0) throw new Error("Fill qty must be > 0");
    if (fill.qty > r.remaining_qty + 1e-9) {
      throw new Error(
        `Overfill on ${client_order_id}: fill=${fill.qty} remaining=${r.remaining_qty}`,
      );
    }

    r.fills.push(fill);
    const newFilled = r.filled_qty + fill.qty;
    const newNotional = r.notional_filled + fill.qty * fill.price;
    r.avg_fill_price = newNotional / newFilled;
    r.filled_qty = newFilled;
    r.remaining_qty = Math.max(0, r.request.qty - newFilled);
    r.notional_filled = newNotional;

    if (r.request.reference_price && r.request.reference_price > 0) {
      const sign = r.request.side === "buy" ? 1 : -1;
      const slip = (r.avg_fill_price - r.request.reference_price) * sign;
      r.realized_slippage_dollars = slip * r.filled_qty;
      r.realized_slippage_bps =
        (slip / r.request.reference_price) * 10_000;
    }

    const evt: OrderEvent = {
      type: r.remaining_qty <= 1e-9 ? "filled" : "partial_fill",
      timestamp: fill.timestamp,
      fill,
    };
    this.recordEvent(r, evt);
    if (r.remaining_qty <= 1e-9) {
      r.closed_at = fill.timestamp;
      this.transition(r, "filled", "fully_filled", fill.timestamp);
    } else {
      this.transition(r, "partial", "partial_fill", fill.timestamp);
    }
    return r;
  }

  /** Cancel an order. */
  cancel(client_order_id: string, reason = "user_cancel", ts = Date.now()): OrderRecord {
    const r = this.require(client_order_id);
    if (r.state === "filled" || r.state === "cancelled" || r.state === "rejected") {
      return r;
    }
    r.closed_at = ts;
    this.transition(r, "cancelled", reason, ts);
    return r;
  }

  /** Mark order expired (TIF reached). */
  expire(client_order_id: string, ts = Date.now()): OrderRecord {
    const r = this.require(client_order_id);
    if (r.state === "filled" || r.state === "cancelled" || r.state === "rejected") {
      return r;
    }
    r.closed_at = ts;
    this.transition(r, "expired", "tif_expired", ts);
    return r;
  }

  get(client_order_id: string): OrderRecord | undefined {
    return this.orders.get(client_order_id);
  }

  list(): OrderRecord[] {
    return Array.from(this.orders.values());
  }

  /** Orders still open (pre-terminal). */
  openOrders(): OrderRecord[] {
    return this.list().filter(
      (o) =>
        o.state !== "filled" &&
        o.state !== "cancelled" &&
        o.state !== "rejected" &&
        o.state !== "expired",
    );
  }

  /** Orders past stale_order_ms with no fill activity. */
  staleOrders(now = Date.now()): OrderRecord[] {
    return this.openOrders().filter(
      (o) => now - o.last_update > this.cfg.stale_order_ms,
    );
  }

  /** Aggregate slippage stats across closed orders. */
  slippageStats(): {
    count: number;
    avg_bps: number;
    p95_bps: number;
    total_dollars: number;
    alerts: number;
  } {
    const closed = this.list().filter(
      (o) => o.realized_slippage_bps !== undefined && o.filled_qty > 0,
    );
    const bps = closed
      .map((o) => o.realized_slippage_bps as number)
      .sort((a, b) => a - b);
    const dollars = closed
      .map((o) => o.realized_slippage_dollars ?? 0)
      .reduce((a, b) => a + b, 0);
    const avg =
      bps.length > 0 ? bps.reduce((a, b) => a + b, 0) / bps.length : 0;
    const p95 =
      bps.length > 0
        ? bps[Math.min(bps.length - 1, Math.floor(bps.length * 0.95))]!
        : 0;
    const alerts = closed.filter(
      (o) => Math.abs(o.realized_slippage_bps ?? 0) >= this.cfg.slippage_alert_bps,
    ).length;
    return { count: closed.length, avg_bps: avg, p95_bps: p95, total_dollars: dollars, alerts };
  }

  /** Reset internal state. Test/dev convenience. */
  reset(): void {
    this.orders.clear();
  }

  private require(id: string): OrderRecord {
    const r = this.orders.get(id);
    if (!r) throw new Error(`Unknown order ${id}`);
    return r;
  }

  private transition(
    r: OrderRecord,
    next: OrderState,
    reason: string,
    ts = Date.now(),
  ): void {
    const allowed = TRANSITIONS[r.state];
    if (!allowed.includes(next) && r.state !== next) {
      throw new Error(
        `Illegal transition for ${r.request.client_order_id}: ${r.state} → ${next}`,
      );
    }
    r.state = next;
    r.last_update = ts;
    if (reason) {
      const evt: OrderEvent = mapStateToEvent(next, reason, ts);
      // Avoid double-emitting fill events (already pushed in applyFill).
      if (next !== "filled" && next !== "partial") {
        this.recordEvent(r, evt);
      }
    }
  }

  private recordEvent(r: OrderRecord, evt: OrderEvent): void {
    r.events.push(evt);
    for (const l of this.listeners) {
      try {
        l(r.request.client_order_id, r, evt);
      } catch {
        /* listener failures must not break lifecycle */
      }
    }
  }
}

function mapStateToEvent(state: OrderState, reason: string, ts: number): OrderEvent {
  switch (state) {
    case "accepted":
      return { type: "accepted", timestamp: ts, reason };
    case "rejected":
      return { type: "rejected", timestamp: ts, reason };
    case "cancelled":
      return { type: "cancelled", timestamp: ts, reason };
    case "expired":
      return { type: "expired", timestamp: ts, reason };
    case "filled":
      return { type: "filled", timestamp: ts, reason };
    case "partial":
      return { type: "partial_fill", timestamp: ts, reason };
    default:
      return { type: "submitted", timestamp: ts, reason };
  }
}

/** Singleton lifecycle for the running process. */
let SINGLETON: OrderLifecycle | undefined;
export function getOrderLifecycle(): OrderLifecycle {
  if (!SINGLETON) SINGLETON = new OrderLifecycle();
  return SINGLETON;
}
