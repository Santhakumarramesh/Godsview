/**
 * signal_stream.ts — Central SSE Broadcast Hub
 *
 * Manages Server-Sent Event connections for real-time signal, candle,
 * alert, and trade data streaming to dashboard clients.
 *
 * Features:
 *   - Typed event publishing with filters
 *   - Last-Event-ID replay for reconnecting clients
 *   - 15-second heartbeat keepalive
 *   - Graceful shutdown with client cleanup
 */

import type { Response } from "express";

// ─── Event Types ───────────────────────────────────────────────────────────

export type StreamEventType =
  | "signal"
  | "si_decision"
  | "candle"
  | "alert"
  | "trade"
  | "breaker"
  | "system"
  | "heartbeat";

export interface StreamEvent {
  id: string;
  type: StreamEventType;
  data: unknown;
  timestamp: string;
}

interface SSEClient {
  id: string;
  res: Response;
  filter?: StreamEventType[];
  connectedAt: number;
}

let eventCounter = 0;
function nextEventId(): string {
  return `evt-${Date.now()}-${++eventCounter}`;
}

// ─── Hub ───────────────────────────────────────────────────────────────────

class SignalStreamHub {
  private clients = new Map<string, SSEClient>();
  private recentEvents: StreamEvent[] = [];
  private readonly MAX_RECENT = 200;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.heartbeatTimer = setInterval(() => {
      this.publish({ id: nextEventId(), type: "heartbeat", data: { ts: Date.now() }, timestamp: new Date().toISOString() });
    }, 15_000);
    if (this.heartbeatTimer?.unref) this.heartbeatTimer.unref();
  }

  addClient(res: Response, filter?: StreamEventType[]): string {
    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`);

    this.clients.set(id, { id, res, filter, connectedAt: Date.now() });

    res.on("close", () => this.clients.delete(id));

    return id;
  }

  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      try { client.res.end(); } catch { /* ignore */ }
      this.clients.delete(id);
    }
  }

  publish(event: StreamEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.MAX_RECENT) {
      this.recentEvents = this.recentEvents.slice(-this.MAX_RECENT);
    }

    const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

    for (const client of this.clients.values()) {
      if (client.filter && !client.filter.includes(event.type) && event.type !== "heartbeat") continue;
      try { client.res.write(payload); } catch { this.clients.delete(client.id); }
    }
  }

  replay(clientId: string, afterEventId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    const idx = this.recentEvents.findIndex((e) => e.id === afterEventId);
    const missed = idx >= 0 ? this.recentEvents.slice(idx + 1) : this.recentEvents;
    for (const event of missed) {
      if (client.filter && !client.filter.includes(event.type)) continue;
      const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
      try { client.res.write(payload); } catch { break; }
    }
  }

  status() {
    return {
      clientCount: this.clients.size,
      recentEventCount: this.recentEvents.length,
      clients: [...this.clients.values()].map((c) => ({
        id: c.id,
        filter: c.filter ?? "all",
        connectedAt: c.connectedAt,
      })),
    };
  }

  closeAll(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const goodbye = `event: system\ndata: ${JSON.stringify({ msg: "server_shutdown" })}\n\n`;
    for (const client of this.clients.values()) {
      try {
        client.res.write(goodbye);
        client.res.end();
      } catch { /* ignore */ }
    }
    this.clients.clear();
  }
}

// ─── Singleton & Convenience Exports ───────────────────────────────────────

export const signalStreamHub = new SignalStreamHub();

export function publishEvent(type: StreamEventType, data: unknown): void {
  signalStreamHub.publish({
    id: nextEventId(),
    type,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function closeAllClients(): void {
  signalStreamHub.closeAll();
}

export function publishSignal(data: unknown): void { publishEvent("signal", data); }
export function publishCandle(data: unknown): void { publishEvent("candle", data); }
export function publishAlert(data: unknown): void { publishEvent("alert", data); }

// ─── Compat aliases used by routes ─────────────────────────────────────────

/** Alias so `import { signalHub }` works (streaming.ts) */
export const signalHub = signalStreamHub;

/** Add an SSE client — returns client id (super_intelligence.ts) */
export function addSSEClient(res: Response, filter?: StreamEventType[]): string {
  return signalStreamHub.addClient(res, filter);
}

/** Current SSE client count (super_intelligence.ts) */
export function getSSEClientCount(): number {
  return signalStreamHub.status().clientCount;
}

/**
 * Emit an SI decision as a dedicated "si_decision" SSE event.
 * The dashboard's /super-intelligence page listens for this exact event type.
 * Also aliased into the "signal" stream for backward compatibility.
 */
export function emitSIDecision(data: unknown): void {
  publishEvent("si_decision", data);
}

/**
 * Legacy broadcast() — maps old-style { type, data } calls from alerts.ts
 * to the new unified hub format.
 */
export function broadcast(msg: { type: string; data: unknown }): void {
  const typeMap: Record<string, StreamEventType> = {
    si_decision: "si_decision",
    alert: "alert",
    trade: "trade",
    breaker: "breaker",
  };
  const eventType: StreamEventType = typeMap[msg.type] ?? "system";
  publishEvent(eventType, msg.data);
}
