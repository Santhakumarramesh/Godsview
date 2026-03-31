/**
 * WebSocket Relay — Client-facing WS server that relays live price
 * ticks, SI decisions, and engine events to dashboard clients.
 *
 * Protocol:
 *   Client → Server:
 *     { action: "subscribe",   channels: ["prices:BTCUSD", "signals", "ops"] }
 *     { action: "unsubscribe", channels: ["prices:BTCUSD"] }
 *     { action: "ping" }
 *
 *   Server → Client:
 *     { channel: "prices:BTCUSD", data: { price, candle, timestamp } }
 *     { channel: "signals",       data: { ...signal } }
 *     { channel: "ops",           data: { ...snapshot } }
 *     { channel: "system",        data: { type: "pong" } }
 */

import { type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "./logger";
import { alpacaStream, type TickPayload } from "./alpaca_stream";
import { getOpsSnapshot } from "./ops_monitor";

// ── Client tracking ────────────────────────────────────────────────────────

interface ClientState {
  ws: WebSocket;
  subscriptions: Set<string>;
  connectedAt: number;
}

const clients = new Map<WebSocket, ClientState>();
const MAX_CLIENTS = 100;
const HEARTBEAT_MS = 25_000;
const OPS_BROADCAST_MS = 10_000;

// Track price listeners so we can unsubscribe when no clients need a symbol
const priceListeners = new Map<string, (payload: TickPayload) => void>();

// ── Message handler ────────────────────────────────────────────────────────

function handleMessage(ws: WebSocket, raw: string): void {
  try {
    const msg = JSON.parse(raw);
    const client = clients.get(ws);
    if (!client) return;

    switch (msg.action) {
      case "subscribe":
        if (Array.isArray(msg.channels)) {
          for (const ch of msg.channels) {
            client.subscriptions.add(ch);
            maybeSubscribePrice(ch);
          }
          send(ws, { channel: "system", data: { type: "subscribed", channels: Array.from(client.subscriptions) } });
        }
        break;

      case "unsubscribe":
        if (Array.isArray(msg.channels)) {
          for (const ch of msg.channels) {
            client.subscriptions.delete(ch);
            maybeUnsubscribePrice(ch);
          }
          send(ws, { channel: "system", data: { type: "unsubscribed", channels: msg.channels } });
        }
        break;

      case "ping":
        send(ws, { channel: "system", data: { type: "pong", ts: Date.now() } });
        break;

      default:
        send(ws, { channel: "system", data: { type: "error", message: `Unknown action: ${msg.action}` } });
    }
  } catch {
    send(ws, { channel: "system", data: { type: "error", message: "Invalid JSON" } });
  }
}

// ── Price subscription management ──────────────────────────────────────────

function maybeSubscribePrice(channel: string): void {
  if (!channel.startsWith("prices:")) return;
  const symbol = channel.slice(7).toUpperCase();
  if (priceListeners.has(symbol)) return; // already subscribed

  const listener = (payload: TickPayload) => {
    broadcastToChannel(`prices:${symbol}`, {
      price: payload.price,
      candle: payload.candle,
      timestamp: payload.timestamp,
    });
  };

  priceListeners.set(symbol, listener);
  alpacaStream.subscribe(symbol, "5Min", listener);
  logger.info(`[ws-relay] Subscribed to price feed: ${symbol}`);
}

function maybeUnsubscribePrice(channel: string): void {
  if (!channel.startsWith("prices:")) return;
  const symbol = channel.slice(7).toUpperCase();

  // Check if any client still needs this symbol
  for (const [, client] of clients) {
    if (client.subscriptions.has(`prices:${symbol}`)) return;
  }

  const listener = priceListeners.get(symbol);
  if (listener) {
    alpacaStream.unsubscribe(symbol, "5Min", listener);
    priceListeners.delete(symbol);
    logger.info(`[ws-relay] Unsubscribed from price feed: ${symbol}`);
  }
}

// ── Broadcasting ───────────────────────────────────────────────────────────

function send(ws: WebSocket, data: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToChannel(channel: string, data: any): void {
  for (const [, client] of clients) {
    if (client.subscriptions.has(channel) && client.ws.readyState === WebSocket.OPEN) {
      send(client.ws, { channel, data });
    }
  }
}

/** Broadcast to all clients on a channel (used by external emitters) */
export function relayBroadcast(channel: string, data: any): void {
  broadcastToChannel(channel, data);
}

/** Get connected WS client count */
export function getWSClientCount(): number {
  return clients.size;
}

// ── Server setup ───────────────────────────────────────────────────────────

export function attachWSRelay(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    if (clients.size >= MAX_CLIENTS) {
      ws.close(1013, "Max clients reached");
      return;
    }

    const state: ClientState = {
      ws,
      subscriptions: new Set(),
      connectedAt: Date.now(),
    };
    clients.set(ws, state);

    send(ws, {
      channel: "system",
      data: {
        type: "connected",
        clients: clients.size,
        available_channels: ["prices:<SYMBOL>", "signals", "ops"],
      },
    });

    ws.on("message", (raw) => handleMessage(ws, String(raw)));

    ws.on("close", () => {
      const client = clients.get(ws);
      if (client) {
        // Cleanup price subscriptions
        for (const ch of client.subscriptions) {
          if (ch.startsWith("prices:")) {
            maybeUnsubscribePrice(ch);
          }
        }
        clients.delete(ws);
      }
    });

    ws.on("error", (err) => {
      logger.error(`[ws-relay] Client error: ${err.message}`);
      clients.delete(ws);
    });
  });

  // Heartbeat
  setInterval(() => {
    const msg = JSON.stringify({ channel: "system", data: { type: "heartbeat", ts: Date.now(), clients: clients.size } });
    for (const [ws] of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      } else {
        clients.delete(ws);
      }
    }
  }, HEARTBEAT_MS);

  // Periodic ops broadcast to subscribers
  setInterval(() => {
    try {
      const snapshot = getOpsSnapshot();
      broadcastToChannel("ops", snapshot);
    } catch { /* non-critical */ }
  }, OPS_BROADCAST_MS);

  logger.info(`[ws-relay] WebSocket relay attached at /ws (max ${MAX_CLIENTS} clients)`);
  return wss;
}
