/**
 * ws_server.ts — Phase 124: Unified WebSocket Server
 *
 * Consolidates all real-time communication into a single WS endpoint.
 * Works alongside the existing SSE signalHub — same events, dual transport.
 *
 * Client protocol:
 *   ws://host:3001/ws
 *   → Send: { action: "subscribe", channels: ["signal","candle","alert"] }
 *   → Send: { action: "unsubscribe", channels: ["candle"] }
 *   → Receive: { id, type, data, timestamp }
 *
 * Features:
 *   - Per-client channel subscriptions (same types as SSE)
 *   - 30s ping/pong keepalive with auto-disconnect on timeout
 *   - JSON message framing with error resilience
 *   - Connection metrics exposed via getStats()
 *   - Graceful shutdown integration
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { logger as _logger } from "./logger";
import type { StreamEventType, StreamEvent } from "./signal_stream";

const logger = _logger.child({ module: "ws-server" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface WSClient {
  id: string;
  ws: WebSocket;
  channels: Set<StreamEventType>;
  connectedAt: number;
  lastPong: number;
  messagesSent: number;
}

interface ClientMessage {
  action: "subscribe" | "unsubscribe" | "ping";
  channels?: StreamEventType[];
}

const VALID_CHANNELS = new Set<StreamEventType>([
  "signal", "candle", "alert", "trade",
  "breaker", "system", "heartbeat",
]);

// ─── WebSocket Manager ──────────────────────────────────────────────────────

let clientCounter = 0;

class GodsviewWSServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WSClient>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private totalConnections = 0;
  private totalMessages = 0;

  /**
   * Attach to an existing HTTP server and start accepting WS connections.
   */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      const clientId = `ws-${Date.now()}-${++clientCounter}`;
      const client: WSClient = {
        id: clientId,
        ws,
        channels: new Set(["signal", "alert", "trade", "breaker", "system"]),
        connectedAt: Date.now(),
        lastPong: Date.now(),
        messagesSent: 0,
      };

      this.clients.set(clientId, client);
      this.totalConnections++;

      logger.info(
        { clientId, remoteAddr: req.socket.remoteAddress, total: this.clients.size },
        "WS client connected",
      );

      // Send welcome message
      this.sendToClient(client, {
        id: `welcome-${clientId}`,
        type: "system",
        data: { clientId, channels: Array.from(client.channels), serverTime: Date.now() },
        timestamp: new Date().toISOString(),
      });

      ws.on("message", (raw: RawData) => {
        try {
          const msg: ClientMessage = JSON.parse(raw.toString());
          this.handleMessage(client, msg);
        } catch {
          this.sendToClient(client, {
            id: `err-${Date.now()}`,
            type: "system",
            data: { error: "Invalid JSON message" },
            timestamp: new Date().toISOString(),
          });
        }
      });

      ws.on("pong", () => {
        client.lastPong = Date.now();
      });

      ws.on("close", () => {
        this.clients.delete(clientId);
        logger.debug({ clientId, remaining: this.clients.size }, "WS client disconnected");
      });

      ws.on("error", (err) => {
        logger.warn({ clientId, err: err.message }, "WS client error");
        this.clients.delete(clientId);
      });
    });

    // Ping/pong keepalive every 30s, disconnect stale clients after 60s
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of this.clients) {
        if (now - client.lastPong > 60_000) {
          logger.debug({ clientId: id }, "WS client timed out, terminating");
          client.ws.terminate();
          this.clients.delete(id);
        } else {
          client.ws.ping();
        }
      }
    }, 30_000);
    if (this.pingInterval.unref) this.pingInterval.unref();

    logger.info("WebSocket server attached at /ws");
  }

  /**
   * Handle incoming client messages (subscribe/unsubscribe/ping).
   */
  private handleMessage(client: WSClient, msg: ClientMessage): void {
    switch (msg.action) {
      case "subscribe": {
        const channels = (msg.channels ?? []).filter((c) => VALID_CHANNELS.has(c));
        for (const ch of channels) client.channels.add(ch);
        this.sendToClient(client, {
          id: `ack-${Date.now()}`,
          type: "system",
          data: { subscribed: channels, allChannels: Array.from(client.channels) },
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case "unsubscribe": {
        const channels = msg.channels ?? [];
        for (const ch of channels) client.channels.delete(ch);
        this.sendToClient(client, {
          id: `ack-${Date.now()}`,
          type: "system",
          data: { unsubscribed: channels, allChannels: Array.from(client.channels) },
          timestamp: new Date().toISOString(),
        });
        break;
      }
      case "ping":
        this.sendToClient(client, {
          id: `pong-${Date.now()}`,
          type: "heartbeat",
          data: { pong: true, serverTime: Date.now() },
          timestamp: new Date().toISOString(),
        });
        break;
      default:
        break;
    }
  }

  /**
   * Send a single event to one client.
   */
  private sendToClient(client: WSClient, event: StreamEvent): void {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    try {
      client.ws.send(JSON.stringify(event));
      client.messagesSent++;
      this.totalMessages++;
    } catch {
      // Client disconnected mid-send, ignore
    }
  }

  /**
   * Broadcast an event to all connected WS clients whose channel filter matches.
   * Called by the signalHub bridge so WS and SSE get the same events.
   */
  broadcast(event: StreamEvent): void {
    for (const client of this.clients.values()) {
      if (client.channels.has(event.type)) {
        this.sendToClient(client, event);
      }
    }
  }

  /**
   * Get connection stats for monitoring.
   */
  getStats(): {
    connectedClients: number;
    totalConnections: number;
    totalMessages: number;
    clients: Array<{ id: string; channels: string[]; connectedAt: number; messagesSent: number }>;
  } {
    return {
      connectedClients: this.clients.size,
      totalConnections: this.totalConnections,
      totalMessages: this.totalMessages,
      clients: Array.from(this.clients.values()).map((c) => ({
        id: c.id,
        channels: Array.from(c.channels),
        connectedAt: c.connectedAt,
        messagesSent: c.messagesSent,
      })),
    };
  }

  /**
   * Graceful shutdown — close all connections and stop the WS server.
   */
  shutdown(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    for (const client of this.clients.values()) {
      try {
        client.ws.close(1001, "Server shutting down");
      } catch { /* ignore */ }
    }
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    logger.info("WebSocket server shut down");
  }
}

export const wsServer = new GodsviewWSServer();
