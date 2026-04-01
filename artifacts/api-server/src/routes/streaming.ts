/**
 * streaming.ts — SSE streaming endpoints for live market data & signals.
 *
 * Endpoints:
 *   GET /api/signals/stream    → Live signal decisions (APPLY/VETO/REVIEW)
 *   GET /api/candles/stream    → Real-time candle updates per symbol+timeframe
 *   GET /api/stream            → Unified event stream (all types, filterable)
 *   GET /api/stream/status     → Hub connection stats
 *
 * All SSE endpoints support:
 *   - ?filter=signal,candle,alert   — comma-separated event type filter
 *   - Last-Event-ID header          — replay missed events on reconnect
 */

import { Router } from "express";
import { signalHub, type StreamEventType } from "../lib/signal_stream";
import { alpacaStream } from "../lib/alpaca_stream";
import { publishCandle } from "../lib/signal_stream";
import { logger } from "../lib/logger";

const router = Router();

const VALID_TYPES = new Set<StreamEventType>([
  "signal", "candle", "alert", "trade",
  "breaker", "system", "heartbeat",
]);

function parseFilter(raw?: string): StreamEventType[] | undefined {
  if (!raw) return undefined;
  const types = raw.split(",").map((t) => t.trim()).filter((t) => VALID_TYPES.has(t as StreamEventType));
  return types.length > 0 ? (types as StreamEventType[]) : undefined;
}

// ── GET /api/signals/stream — Signal-only SSE ────────────────────
router.get("/api/signals/stream", (req, res) => {
  const clientId = signalHub.addClient(res, ["signal"]);

  // Replay missed events if Last-Event-ID header present
  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, parseInt(String(lastId), 10) || 0);
  }
});

// ── GET /api/candles/stream — Live candle SSE per symbol ─────────
router.get("/api/candles/stream", (req, res) => {
  const symbol = String(req.query.symbol ?? "BTCUSD").toUpperCase();
  const timeframe = String(req.query.timeframe ?? "5Min");

  // Register SSE client filtered to candle events only
  const clientId = signalHub.addClient(res, ["candle"]);

  // Subscribe to alpaca_stream ticks and broadcast as candle events
  const listener = (payload: { symbol: string; price: number; timestamp: string; candle: Record<string, unknown> }) => {
    publishCandle(payload.symbol, timeframe, payload.candle);
  };

  alpacaStream.subscribe(symbol, timeframe, listener);

  // Cleanup on disconnect
  res.on("close", () => {
    alpacaStream.unsubscribe(symbol, timeframe, listener);
    signalHub.removeClient(clientId);
    logger.debug({ clientId, symbol, timeframe }, "Candle stream client disconnected");
  });

  // Replay if reconnecting
  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, parseInt(String(lastId), 10) || 0);
  }
});

// ── GET /api/stream — Unified event stream (all or filtered) ─────
router.get("/api/stream", (req, res) => {
  const filter = parseFilter(String(req.query.filter ?? ""));
  const clientId = signalHub.addClient(res, filter);

  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, parseInt(String(lastId), 10) || 0);
  }
});

// ── GET /api/stream/status — Hub stats (REST, not SSE) ───────────
router.get("/api/stream/status", (_req, res) => {
  res.json(signalHub.status());
});

// ── GET /api/alerts/stream — Alert-only SSE ──────────────────────
router.get("/api/alerts/stream", (req, res) => {
  const clientId = signalHub.addClient(res, ["alert"]);

  const lastId = req.headers["last-event-id"];
  if (lastId) {
    signalHub.replay(clientId, parseInt(String(lastId), 10) || 0);
  }
});

export default router;
