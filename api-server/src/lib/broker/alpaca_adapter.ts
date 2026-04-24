/**
 * Alpaca Markets Broker Adapter
 * REST API wrapper for order management, positions, and account info
 */
import type {
  BrokerAdapter,
  BrokerName,
  BrokerOrderRequest,
  BrokerOrderResponse,
  BrokerPosition,
  BrokerAccountInfo,
} from "./types.js";

const ALPACA_PAPER = "https://paper-api.alpaca.markets";
const ALPACA_LIVE = "https://api.alpaca.markets";

export class AlpacaAdapter implements BrokerAdapter {
  readonly name: BrokerName = "alpaca";
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(opts: {
    apiKey: string;
    secretKey: string;
    paper?: boolean;
  }) {
    this.baseUrl = opts.paper !== false ? ALPACA_PAPER : ALPACA_LIVE;
    this.headers = {
      "APCA-API-KEY-ID": opts.apiKey,
      "APCA-API-SECRET-KEY": opts.secretKey,
      "Content-Type": "application/json",
    };
  }

  async connect(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v2/account`, { headers: this.headers });
    if (!res.ok) throw new Error(`Alpaca connect failed: ${res.status}`);
  }

  async disconnect(): Promise<void> {
    /* stateless REST — no-op */
  }

  async submitOrder(req: BrokerOrderRequest): Promise<BrokerOrderResponse> {
    const body = {
      symbol: req.symbol,
      qty: String(req.qty),
      side: req.side,
      type: req.type,
      time_in_force: req.timeInForce,
      ...(req.limitPrice != null && { limit_price: String(req.limitPrice) }),
      ...(req.stopPrice != null && { stop_price: String(req.stopPrice) }),
      ...(req.clientOrderId && { client_order_id: req.clientOrderId }),
    };
    const res = await fetch(`${this.baseUrl}/v2/orders`, {
      method: "POST", headers: this.headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Alpaca submitOrder failed: ${res.status}`);
    return this.mapOrder(await res.json());
  }

  async cancelOrder(orderId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v2/orders/${orderId}`, {
      method: "DELETE", headers: this.headers,
    });
    if (!res.ok && res.status !== 404) throw new Error(`Alpaca cancelOrder failed: ${res.status}`);
  }

  async getOrder(orderId: string): Promise<BrokerOrderResponse> {
    const res = await fetch(`${this.baseUrl}/v2/orders/${orderId}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Alpaca getOrder failed: ${res.status}`);
    return this.mapOrder(await res.json());
  }

  async getOpenOrders(): Promise<BrokerOrderResponse[]> {
    const res = await fetch(`${this.baseUrl}/v2/orders?status=open`, { headers: this.headers });
    if (!res.ok) throw new Error(`Alpaca getOpenOrders failed: ${res.status}`);
    const data = await res.json();
    return (data as any[]).map((o) => this.mapOrder(o));
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const res = await fetch(`${this.baseUrl}/v2/positions`, { headers: this.headers });
    if (!res.ok) throw new Error(`Alpaca getPositions failed: ${res.status}`);
    const data = await res.json();
    return (data as any[]).map((p) => this.mapPosition(p));
  }

  async getPosition(symbol: string): Promise<BrokerPosition | null> {
    const res = await fetch(`${this.baseUrl}/v2/positions/${symbol}`, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Alpaca getPosition failed: ${res.status}`);
    return this.mapPosition(await res.json());
  }

  async closePosition(symbol: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/v2/positions/${symbol}`, {
      method: "DELETE", headers: this.headers,
    });
    if (!res.ok && res.status !== 404) throw new Error(`Alpaca closePosition failed: ${res.status}`);
  }

  async getAccountInfo(): Promise<BrokerAccountInfo> {
    const res = await fetch(`${this.baseUrl}/v2/account`, { headers: this.headers });
    if (!res.ok) throw new Error(`Alpaca getAccountInfo failed: ${res.status}`);
    const d: any = await res.json();
    return {
      id: d.id,
      currency: d.currency ?? "USD",
      cash: Number(d.cash),
      portfolioValue: Number(d.portfolio_value),
      buyingPower: Number(d.buying_power),
      daytradeCount: d.daytrade_count,
      patternDayTrader: d.pattern_day_trader,
    };
  }

  /* ── private mappers ──────────────────────────────── */
  private mapOrder(o: any): BrokerOrderResponse {
    return {
      id: o.id,
      clientOrderId: o.client_order_id,
      symbol: o.symbol,
      side: o.side,
      qty: Number(o.qty),
      filledQty: Number(o.filled_qty ?? 0),
      type: o.type,
      status: this.mapStatus(o.status),
      filledAvgPrice: o.filled_avg_price ? Number(o.filled_avg_price) : undefined,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    };
  }

  private mapPosition(p: any): BrokerPosition {
    return {
      symbol: p.symbol,
      qty: Math.abs(Number(p.qty)),
      side: Number(p.qty) >= 0 ? "long" : "short",
      avgEntryPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      unrealizedPnl: Number(p.unrealized_pl),
      marketValue: Number(p.market_value),
    };
  }

  private mapStatus(s: string): BrokerOrderResponse["status"] {
    const map: Record<string, BrokerOrderResponse["status"]> = {
      new: "new",
      accepted: "new",
      partially_filled: "partially_filled",
      filled: "filled",
      done_for_day: "filled",
      canceled: "canceled",
      expired: "expired",
      replaced: "new",
      pending_cancel: "canceled",
      pending_replace: "new",
      rejected: "rejected",
    };
    return map[s] ?? "new";
  }
}
