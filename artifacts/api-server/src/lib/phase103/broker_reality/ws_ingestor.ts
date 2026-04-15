/**
 * Phase 103 — Broker WebSocket Ingestor
 * =====================================
 * Adapter-shaped helper that translates raw broker WS messages
 * (Alpaca format used as canonical baseline) into lifecycle calls.
 * Pure function surface so it can be unit-tested without a live socket.
 */

import { OrderLifecycle, FillEvent } from "./order_lifecycle.js";

export interface RawBrokerMessage {
  event: string;
  order?: {
    id: string;
    client_order_id: string;
    status: string;
    filled_qty?: string | number;
    filled_avg_price?: string | number;
    qty?: string | number;
    rejected_reason?: string;
    symbol?: string;
  };
  execution_id?: string;
  qty?: string | number;
  price?: string | number;
  timestamp?: string;
  liquidity?: "maker" | "taker";
  venue?: string;
}

export interface IngestResult {
  applied: boolean;
  reason?: string;
  client_order_id?: string;
  state?: string;
}

export class BrokerWsIngestor {
  constructor(private readonly lifecycle: OrderLifecycle) {}

  ingest(msg: RawBrokerMessage): IngestResult {
    if (!msg || !msg.event) return { applied: false, reason: "empty_message" };
    const o = msg.order;
    if (!o || !o.client_order_id) {
      return { applied: false, reason: "missing_order_id" };
    }

    const ts = msg.timestamp ? Date.parse(msg.timestamp) : Date.now();
    const cid = o.client_order_id;

    try {
      switch (msg.event) {
        case "new":
        case "accepted": {
          this.lifecycle.accept(cid, o.id, ts);
          return { applied: true, client_order_id: cid, state: "accepted" };
        }
        case "rejected": {
          this.lifecycle.reject(cid, o.rejected_reason ?? "broker_rejected", ts);
          return { applied: true, client_order_id: cid, state: "rejected" };
        }
        case "partial_fill":
        case "fill": {
          const fill: FillEvent = {
            fill_id: msg.execution_id ?? `${cid}-${ts}`,
            qty: toNum(msg.qty),
            price: toNum(msg.price),
            timestamp: ts,
            liquidity: msg.liquidity,
            venue: msg.venue,
          };
          if (fill.qty <= 0) return { applied: false, reason: "zero_qty" };
          this.lifecycle.applyFill(cid, fill);
          return {
            applied: true,
            client_order_id: cid,
            state: msg.event === "fill" ? "filled" : "partial",
          };
        }
        case "canceled":
        case "cancelled": {
          this.lifecycle.cancel(cid, "broker_cancel", ts);
          return { applied: true, client_order_id: cid, state: "cancelled" };
        }
        case "expired": {
          this.lifecycle.expire(cid, ts);
          return { applied: true, client_order_id: cid, state: "expired" };
        }
        default:
          return { applied: false, reason: `unhandled_event:${msg.event}` };
      }
    } catch (err) {
      return {
        applied: false,
        reason: err instanceof Error ? err.message : "ingest_error",
        client_order_id: cid,
      };
    }
  }
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
