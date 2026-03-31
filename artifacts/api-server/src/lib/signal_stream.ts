/**
 * Signal Stream — Server-Sent Events (SSE) for real-time SI decisions
 *
 * Broadcasts Super Intelligence decisions, production gate verdicts,
 * and ensemble model updates to connected dashboard clients.
 *
 * Uses SSE instead of WebSocket for simplicity:
 * - No additional library needed
 * - Works through HTTP proxies / load balancers
 * - Auto-reconnect built into EventSource API
 * - One-directional (server → client) which is all we need
 */

import type { Response } from "express";
import type { SuperSignal } from "./super_intelligence";
import type { ProductionDecision } from "./production_gate";

// ── Types ──────────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "si_decision"; data: SIDecisionEvent }
  | { type: "production_gate"; data: ProductionGateEvent }
  | { type: "ensemble_update"; data: EnsembleUpdateEvent }
  | { type: "heartbeat"; data: { ts: string } };

export interface SIDecisionEvent {
  symbol: string;
  setup_type: string;
  direction: "long" | "short";
  approved: boolean;
  win_probability: number;
  edge_score: number;
  enhanced_quality: number;
  kelly_pct: number;
  regime: string;
  rejection_reason?: string;
  timestamp: string;
}

export interface ProductionGateEvent {
  symbol: string;
  action: string;
  quantity: number;
  dollar_risk: number;
  win_probability: number;
  edge_score: number;
  block_reasons: string[];
  timestamp: string;
}

export interface EnsembleUpdateEvent {
  ensemble_accuracy: number;
  gbm_accuracy: number;
  lr_accuracy: number;
  samples: number;
  timestamp: string;
}

// ── SSE Client Manager ─────────────────────────────────────────────────────

const clients = new Set<Response>();
const MAX_CLIENTS = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;

// Heartbeat to keep connections alive
setInterval(() => {
  const event: StreamEvent = { type: "heartbeat", data: { ts: new Date().toISOString() } };
  broadcast(event);
}, HEARTBEAT_INTERVAL_MS);

/** Register an SSE client */
export function addSSEClient(res: Response): void {
  if (clients.size >= MAX_CLIENTS) {
    // Remove oldest client
    const oldest = clients.values().next().value;
    if (oldest) {
      clients.delete(oldest);
      try { oldest.end(); } catch { /* ignore */ }
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", clients: clients.size + 1 })}\n\n`);
  clients.add(res);

  // Clean up on disconnect
  res.on("close", () => {
    clients.delete(res);
  });
}

/** Broadcast an event to all connected clients */
export function broadcast(event: StreamEvent): void {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  const dead: Response[] = [];

  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      dead.push(client);
    }
  }

  // Clean up dead connections
  for (const d of dead) {
    clients.delete(d);
    try { d.end(); } catch { /* ignore */ }
  }
}

/** Get number of connected clients */
export function getSSEClientCount(): number {
  return clients.size;
}

/** Close all SSE clients (used during graceful shutdown) */
export function closeAllClients(): void {
  for (const client of clients) {
    try {
      client.write(`event: shutdown\ndata: ${JSON.stringify({ reason: "server_shutdown" })}\n\n`);
      client.end();
    } catch { /* ignore */ }
  }
  clients.clear();
}

// ── Convenience Emitters ───────────────────────────────────────────────────

/** Emit an SI decision event */
export function emitSIDecision(
  symbol: string,
  signal: SuperSignal,
  setupType: string,
  direction: "long" | "short",
  regime: string,
): void {
  broadcast({
    type: "si_decision",
    data: {
      symbol,
      setup_type: setupType,
      direction,
      approved: signal.approved,
      win_probability: signal.win_probability,
      edge_score: signal.edge_score,
      enhanced_quality: signal.enhanced_quality,
      kelly_pct: signal.kelly_fraction * 100,
      regime,
      rejection_reason: signal.rejection_reason,
      timestamp: new Date().toISOString(),
    },
  });
}

/** Emit a production gate verdict */
export function emitProductionGate(decision: ProductionDecision, symbol: string): void {
  broadcast({
    type: "production_gate",
    data: {
      symbol,
      action: decision.action,
      quantity: decision.quantity,
      dollar_risk: decision.dollar_risk,
      win_probability: decision.meta.win_probability,
      edge_score: decision.meta.edge_score,
      block_reasons: decision.block_reasons,
      timestamp: decision.meta.timestamp,
    },
  });
}

/** Emit ensemble model update */
export function emitEnsembleUpdate(meta: {
  ensemble_accuracy: number;
  gbm_accuracy: number;
  lr_accuracy: number;
  samples: number;
}): void {
  broadcast({
    type: "ensemble_update",
    data: {
      ...meta,
      timestamp: new Date().toISOString(),
    },
  });
}
