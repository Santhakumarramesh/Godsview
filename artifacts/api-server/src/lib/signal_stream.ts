/**
 * signal_stream.ts — SSE broadcast hub for live signals, candles & system events.
 *
 * Central fan-out: any module can publish events, all connected SSE clients receive them.
 * Used by:
 *   - /api/signals/stream   → live signal decisions (APPLY/VETO/REVIEW)
 *   - /api/candles/stream   → real-time candle updates from alpaca_stream
 *   - /api/alerts/stream    → triggered alert notifications
 *
 * Lifecycle:
 *   - Server boot:     import { signalHub } from "./lib/signal_stream"
 *   - Server shutdown:  closeAllClients() to drain SSE connections gracefully
 */

import type { Response } from "express";
import { logger } from "./logger";

// ── Event types that flow through the hub ────────────────────────
export type StreamEventType =
  | "signal"        // New signal decision
  | "candle"        // Live candle update
  | "alert"         // Triggered alert
  | "trade"         // Trade executed / closed
  | "breaker"       // Drawdown breaker level change
  | "system"        // System status change (kill switch, mode change)
  | "heartbeat";    // Keep-alive ping

export interface StreamEvent {
  type: StreamEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface SSEClient {
  id: string;
  res: Response;
  connectedAt: number;
  filter?: StreamEventType[];  // if set, only receive these event types
  lastEventId: number;
}

// ── Hub singleton ────────────────────────────────────────────────
class SignalStreamHub {
  private clients = new Map<string, SSEClient>();
  private eventCounter = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private recentEvents: Array<StreamEvent & { id: number }> = [];
  private static readonly MAX_RECENT = 200;
  private static readonly HEARTBEAT_MS = 15_000;

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Register a new SSE client. Sets up headers, sends initial connection event,
   * and handles client disconnect cleanup.
   */
  addClient(res: Response, filter?: StreamEventType[]): string {
    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const client: SSEClient = { id, res, connectedAt: Date.now(), filter, lastEventId: this.eventCounter };
    this.clients.set(id, client);

    // Send connection confirmation
    this.sendToClient(client, {
      type: "system",
      timestamp: new Date().toISOString(),
      payload: { action: "connected", clientId: id, filterActive: !!filter },
    });

    // Cleanup on disconnect
    res.on("close", () => {
      this.clients.delete(id);
      logger.debug({ clientId: id }, "SSE client disconnected");
    });

    logger.info({ clientId: id, filter: filter ?? "all" }, "SSE client connected");
    return id;
  }

  /** Remove a specific client by ID */
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      try { client.res.end(); } catch { /* already closed */ }
      this.clients.delete(id);
    }
  }

  /** Broadcast an event to all connected clients (respecting filters) */
  publish(event: StreamEvent): void {
    this.eventCounter++;
    const numbered = { ...event, id: this.eventCounter };

    // Store in recent buffer for replay on reconnect
    this.recentEvents.push(numbered);
    if (this.recentEvents.length > SignalStreamHub.MAX_RECENT) {
      this.recentEvents = this.recentEvents.slice(-SignalStreamHub.MAX_RECENT);
    }

    let sent = 0;
    for (const client of this.clients.values()) {
      if (client.filter && !client.filter.includes(event.type)) continue;
      this.sendToClient(client, event);
      client.lastEventId = this.eventCounter;
      sent++;
    }

    if (event.type !== "heartbeat") {
      logger.debug({ type: event.type, clients: sent, total: this.clients.size }, "Event broadcast");
    }
  }

  /** Replay missed events for a reconnecting client (Last-Event-ID support) */
  replay(clientId: string, afterEventId: number): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const missed = this.recentEvents.filter((e) => e.id > afterEventId);
    for (const event of missed) {
      if (client.filter && !client.filter.includes(event.type)) continue;
      this.sendToClient(client, event);
    }
    client.lastEventId = this.eventCounter;
    logger.info({ clientId, replayed: missed.length, fromId: afterEventId }, "SSE replay sent");
  }

  /** Get hub status for monitoring */
  status() {
    return {
      connectedClients: this.clients.size,
      totalEventsPublished: this.eventCounter,
      recentBufferSize: this.recentEvents.length,
      clients: [...this.clients.values()].map((c) => ({
        id: c.id,
        connectedAt: new Date(c.connectedAt).toISOString(),
        filter: c.filter ?? "all",
        lastEventId: c.lastEventId,
      })),
    };
  }

  /** Gracefully close all SSE connections (called on shutdown) */
  closeAll(): void {
    logger.info({ clients: this.clients.size }, "Closing all SSE clients");
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.clients.values()) {
      try {
        // Send goodbye event before closing
        this.sendToClient(client, {
          type: "system",
          timestamp: new Date().toISOString(),
          payload: { action: "shutdown", reason: "server_stopping" },
        });
        client.res.end();
      } catch { /* already closed */ }
    }
    this.clients.clear();
  }

  // ── Private helpers ──────────────────────────────────────────
  private sendToClient(client: SSEClient, event: StreamEvent): void {
    try {
      const data = JSON.stringify(event);
      client.res.write(`id: ${this.eventCounter}\n`);
      client.res.write(`event: ${event.type}\n`);
      client.res.write(`data: ${data}\n\n`);
      if (typeof (client.res as any).flush === "function") {
        (client.res as any).flush();
      }
    } catch {
      // Client disconnected — remove
      this.clients.delete(client.id);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.publish({
        type: "heartbeat",
        timestamp: new Date().toISOString(),
        payload: { clients: this.clients.size, uptime: process.uptime() },
      });
    }, SignalStreamHub.HEARTBEAT_MS);
    // Don't prevent process exit
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }
}

// ── Singleton + exported convenience functions ───────────────────
export const signalHub = new SignalStreamHub();

/** Publish an event to all connected SSE clients */
export function publishEvent(event: StreamEvent): void {
  signalHub.publish(event);
}

/** Close all SSE clients — called during graceful shutdown */
export function closeAllClients(): void {
  signalHub.closeAll();
}

/** Convenience: publish a signal decision event */
export function publishSignal(payload: Record<string, unknown>): void {
  signalHub.publish({ type: "signal", timestamp: new Date().toISOString(), payload });
}

/** Convenience: publish a candle update event */
export function publishCandle(symbol: string, timeframe: string, candle: Record<string, unknown>): void {
  signalHub.publish({ type: "candle", timestamp: new Date().toISOString(), payload: { symbol, timeframe, ...candle } });
}

/** Convenience: publish an alert event */
export function publishAlert(payload: Record<string, unknown>): void {
  signalHub.publish({ type: "alert", timestamp: new Date().toISOString(), payload });
}

/**
 * Legacy broadcast() — used by alerts.ts which sends { type, data } shaped events.
 * Maps to the unified SSE hub format.
 */
export function broadcast(event: { type: string; data: Record<string, unknown> }): void {
  signalHub.publish({
    type: event.type === "si_decision" ? "signal" : "alert",
    timestamp: new Date().toISOString(),
    payload: event.data,
  });
}
