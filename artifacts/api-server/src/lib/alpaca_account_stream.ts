/**
 * alpaca_account_stream.ts — Phase 12A
 *
 * Real-time Alpaca account WebSocket stream.
 * Connects to wss://api.alpaca.markets/stream (or paper equivalent),
 * subscribes to "trade_updates", and pushes fill events directly to:
 *   1. fill_reconciler (bypasses the 10s poll — 0-latency reconciliation)
 *   2. brain_event_bus (so brain panels see fills immediately)
 *   3. brain_alerts (slHit / tpHit logic triggered by fill reason)
 *
 * The polling reconciler remains as a safety net for any fills missed by WS.
 *
 * Reconnects with exponential backoff (1s → 32s max).
 * Gracefully falls back to polling-only if the account stream is unavailable.
 */

import WebSocket from "ws";
import { logger } from "./logger.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const KEY_ID = process.env.ALPACA_API_KEY ?? process.env.ALPACA_KEY_ID ?? "";
const SECRET_KEY = process.env.ALPACA_SECRET_KEY ?? "";
const IS_PAPER = String(process.env.ALPACA_PAPER ?? "true").toLowerCase() !== "false";

const LIVE_WS = "wss://api.alpaca.markets/stream";
const PAPER_WS = "wss://paper-api.alpaca.markets/stream";
const WS_URL = IS_PAPER ? PAPER_WS : LIVE_WS;

// ── Types ──────────────────────────────────────────────────────────────────────

export type FillEvent = {
  event: "fill" | "partial_fill";
  execution_id: string;
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  position_qty: number;
  timestamp: string;
  order?: {
    id: string;
    client_order_id: string;
    status: string;
    qty: string;
    filled_qty: string;
    filled_avg_price: string;
    order_type: string;
    time_in_force: string;
  };
};

export type OrderEvent = {
  event: "new" | "pending_new" | "accepted" | "rejected" | "canceled" | "expired" | "replaced" |
         "pending_cancel" | "pending_replace" | "calculated" | "done_for_day" | "stopped";
  order_id: string;
  symbol: string;
  timestamp: string;
};

export type TradeUpdatePayload = FillEvent | OrderEvent;
export type FillListener = (fill: FillEvent) => void;
export type OrderEventListener = (event: OrderEvent) => void;

// ── Account Stream Manager ─────────────────────────────────────────────────────

class AlpacaAccountStream {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1_000;
  private stopped = false;

  private fillListeners = new Set<FillListener>();
  private orderListeners = new Set<OrderEventListener>();

  // Metrics
  private totalFills = 0;
  private totalOrders = 0;
  private connectedAt: number | null = null;
  private disconnectCount = 0;

  // ── Public API ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.ws || this.stopped) return;
    if (!KEY_ID || !SECRET_KEY) {
      logger.warn("[AccountStream] No Alpaca keys configured — account stream disabled");
      return;
    }
    this._connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    logger.info("[AccountStream] Stopped");
  }

  onFill(listener: FillListener): () => void {
    this.fillListeners.add(listener);
    return () => this.fillListeners.delete(listener);
  }

  onOrderEvent(listener: OrderEventListener): () => void {
    this.orderListeners.add(listener);
    return () => this.orderListeners.delete(listener);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  status() {
    return {
      connected: this.isConnected(),
      authenticated: this.authenticated,
      connectedAt: this.connectedAt ? new Date(this.connectedAt).toISOString() : null,
      uptimeSeconds: this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) : 0,
      totalFills: this.totalFills,
      totalOrders: this.totalOrders,
      disconnectCount: this.disconnectCount,
      wsUrl: WS_URL,
      mode: IS_PAPER ? "paper" : "live",
    };
  }

  // ── WebSocket internals ────────────────────────────────────────────────────

  private _connect(): void {
    if (this.stopped) return;
    logger.info({ url: WS_URL }, "[AccountStream] Connecting…");

    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.on("open", () => {
      logger.info("[AccountStream] Connected — authenticating…");
      ws.send(JSON.stringify({
        action: "authenticate",
        data: { key_id: KEY_ID, secret_key: SECRET_KEY },
      }));
    });

    ws.on("message", (raw: Buffer) => {
      this._handleMessage(raw.toString());
    });

    ws.on("close", (code, reason) => {
      this.authenticated = false;
      this.connectedAt = null;
      this.disconnectCount++;
      this.ws = null;
      logger.warn({ code, reason: reason.toString(), delay: this.reconnectDelay }, "[AccountStream] Disconnected — scheduling reconnect");
      this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "[AccountStream] WebSocket error");
      // close handler will reconnect
    });
  }

  private _handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { stream?: string; data?: unknown };

      // Auth response
      if (msg.stream === "authorization") {
        const data = msg.data as { action?: string; status?: string };
        if (data?.status === "authorized") {
          this.authenticated = true;
          this.connectedAt = Date.now();
          this.reconnectDelay = 1_000; // reset backoff on successful auth
          logger.info("[AccountStream] Authenticated — subscribing to trade_updates");
          this.ws?.send(JSON.stringify({ action: "listen", data: { streams: ["trade_updates"] } }));
        } else {
          logger.error({ data }, "[AccountStream] Authentication failed");
        }
        return;
      }

      // Subscription confirmation
      if (msg.stream === "listening") {
        const streams = (msg.data as { streams?: string[] })?.streams ?? [];
        logger.info({ streams }, "[AccountStream] Subscription confirmed");
        return;
      }

      // Trade updates
      if (msg.stream === "trade_updates") {
        const event = msg.data as { event?: string } & Record<string, unknown>;
        this._dispatchTradeUpdate(event);
        return;
      }

    } catch (err) {
      logger.warn({ err, raw: raw.slice(0, 200) }, "[AccountStream] Failed to parse message");
    }
  }

  private _dispatchTradeUpdate(event: { event?: string } & Record<string, unknown>): void {
    const eventType = event.event as string;

    if (eventType === "fill" || eventType === "partial_fill") {
      const order = event.order as Record<string, string> | undefined;
      const fill: FillEvent = {
        event: eventType,
        execution_id: (event.execution_id as string) ?? "",
        order_id: (event.order_id as string) ?? order?.id ?? "",
        symbol: (event.symbol as string) ?? order?.symbol ?? "UNKNOWN",
        side: (event.side as "buy" | "sell") ?? "buy",
        qty: Number(event.qty) || 0,
        price: Number(event.price) || 0,
        position_qty: Number(event.position_qty) || 0,
        timestamp: (event.timestamp as string) ?? new Date().toISOString(),
        order: order as FillEvent["order"],
      };

      this.totalFills++;
      logger.info({ symbol: fill.symbol, side: fill.side, qty: fill.qty, price: fill.price }, "[AccountStream] Fill event");

      for (const listener of this.fillListeners) {
        try { listener(fill); } catch (err) { logger.error({ err }, "[AccountStream] Fill listener error"); }
      }
    } else {
      const orderEvent: OrderEvent = {
        event: eventType as OrderEvent["event"],
        order_id: (event.order_id as string) ?? "",
        symbol: (event.symbol as string) ?? ((event.order as Record<string, string>)?.symbol ?? "UNKNOWN"),
        timestamp: (event.timestamp as string) ?? new Date().toISOString(),
      };

      this.totalOrders++;
      logger.debug({ eventType, symbol: orderEvent.symbol }, "[AccountStream] Order event");

      for (const listener of this.orderListeners) {
        try { listener(orderEvent); } catch (err) { logger.error({ err }, "[AccountStream] Order listener error"); }
      }
    }
  }

  private _scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 32_000);
  }
}

export const alpacaAccountStream = new AlpacaAccountStream();

// ── Wire fill events to fill_reconciler + brain subsystems ────────────────────
// Called once from index.ts after startReconciler()

export function wireAccountStreamToReconciler(): void {
  alpacaAccountStream.onFill(async (fill) => {
    // 1. Push into fill reconciler (replaces polling for this fill)
    try {
      const { registerCostBasis } = await import("./fill_reconciler.js");
      // The reconciler handles deduplication via execution_id
      // We inject directly into the reconciler's tick processing:
      const reconcilerMod = await import("./fill_reconciler.js");
      const inject = (reconcilerMod as any)._injectFill;
      if (typeof inject === "function") {
        inject({
          id: fill.execution_id || fill.order_id,
          order_id: fill.order_id,
          symbol: fill.symbol,
          side: fill.side,
          qty: String(fill.qty),
          price: String(fill.price),
          transaction_time: fill.timestamp,
        });
      }
    } catch { /* fill_reconciler not loaded or _injectFill not exported */ }

    // 2. Emit to brain event bus
    try {
      const { brainEventBus } = await import("./brain_event_bus.js");
      (brainEventBus as any).emit?.("fill", {
        symbol: fill.symbol,
        side: fill.side,
        qty: fill.qty,
        price: fill.price,
        orderId: fill.order_id,
        timestamp: fill.timestamp,
      });
    } catch { /* bus not loaded */ }

    // 3. Check if this fill closes a brain position → fire alert
    try {
      const { brainPositions } = await import("./brain_execution_bridge.js");
      const { brainAlerts } = await import("./brain_alerts.js");
      const pos = brainPositions.get(fill.symbol);
      if (pos) {
        const isClose =
          (pos.direction === "long" && fill.side === "sell") ||
          (pos.direction === "short" && fill.side === "buy");
        if (isClose) {
          const slDist = Math.abs(pos.entryPrice - pos.stopLoss);
          const pnlDollar = (fill.price - pos.entryPrice) * fill.qty * (pos.direction === "long" ? 1 : -1);
          const pnlR = slDist > 0 ? pnlDollar / (slDist * fill.qty) : 0;
          // Determine if TP or SL based on fill price proximity
          const distToTP = Math.abs(fill.price - pos.takeProfit);
          const distToSL = Math.abs(fill.price - pos.stopLoss);
          if (distToTP < distToSL) {
            brainAlerts.tpHit(fill.symbol, pnlR);
          } else {
            brainAlerts.slHit(fill.symbol, pnlR);
          }
        }
      }
    } catch { /* bridge not loaded */ }
  });

  logger.info("[AccountStream] Wired to fill_reconciler + brain event bus + alerts");
}
