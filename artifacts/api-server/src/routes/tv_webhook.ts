/**
 * tv_webhook.ts — TradingView Webhook Endpoint
 *
 * Receives JSON alerts from TradingView Pine scripts and converts them to internal signals.
 * Features:
 *  - Bearer token authentication
 *  - Deduplication by alert hash (symbol+action+timeframe+minute)
 *  - Signal broadcasting via WebSocket
 *  - Signal persistence in circular buffer
 *  - Statistics tracking
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { logger } from "../lib/logger";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────

interface TradingViewWebhookPayload {
  symbol?: string;
  signal?: string;
  timeframe?: string;
  price?: number;
  timestamp?: number;
  direction?: "long" | "short";
  stop_loss?: number;
  take_profit?: number;
  strategy_name?: string;
  passphrase?: string;
  setup_type?: string;
  entry?: number;
  stop?: number;
  target?: number;
  confidence?: number;
}

interface InternalSignal {
  id: string;
  symbol: string;
  action: string;
  timeframe: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  direction: "long" | "short";
  setup_type: string;
  confidence: number;
  source: "tradingview";
  strategy_name: string;
  timestamp: number;
}

interface WebhookStats {
  total_received: number;
  total_deduplicated: number;
  total_errors: number;
  last_signal_time?: number;
  last_error?: string;
  last_error_time?: number;
}

// ─── State Management ───────────────────────────────────────────────────────

class DeduplicationManager {
  private store = new Map<string, { timestamp: number }>();
  private ttlMs = 60000; // 60 seconds

  makeHash(
    symbol: string,
    action: string,
    timeframe: string,
    timestamp: number,
  ): string {
    // Round timestamp to nearest minute for deduplication
    const minuteTimestamp = Math.floor(timestamp / 60000) * 60000;
    const str = `${symbol}|${action}|${timeframe}|${minuteTimestamp}`;
    return createHash("sha256").update(str).digest("hex");
  }

  isDuplicate(hash: string, now: number): boolean {
    const entry = this.store.get(hash);
    if (!entry) return false;
    if (now - entry.timestamp > this.ttlMs) {
      this.store.delete(hash);
      return false;
    }
    return true;
  }

  markSeen(hash: string, now: number): void {
    this.store.set(hash, { timestamp: now });
  }

  cleanup(): void {
    const now = Date.now();
    for (const [hash, entry] of this.store.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.store.delete(hash);
      }
    }
  }
}

class SignalBuffer {
  private buffer: InternalSignal[] = [];
  private maxSize = 500;

  add(signal: InternalSignal): void {
    this.buffer.unshift(signal);
    if (this.buffer.length > this.maxSize) {
      this.buffer.pop();
    }
  }

  getLast(count: number): InternalSignal[] {
    return this.buffer.slice(0, count);
  }

  getAll(): InternalSignal[] {
    return [...this.buffer];
  }
}

const dedup = new DeduplicationManager();
const signalBuffer = new SignalBuffer();
let stats: WebhookStats = {
  total_received: 0,
  total_deduplicated: 0,
  total_errors: 0,
};

// ─── Authentication Middleware ──────────────────────────────────────────────

function validateWebhookAuth(req: Request): boolean {
  const secret = process.env.TV_WEBHOOK_SECRET || "default_secret";
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");

  return bearerToken === secret;
}

// ─── Signal Conversion ───────────────────────────────────────────────────────

function convertToInternalSignal(
  payload: TradingViewWebhookPayload,
): InternalSignal {
  const now = Date.now();
  const symbol = String(payload.symbol || "").toUpperCase();
  const action = payload.signal || payload.setup_type || "unknown_action";
  const direction =
    (payload.direction as "long" | "short") || "long";

  return {
    id: randomUUID(),
    symbol,
    action,
    timeframe: payload.timeframe || "1H",
    entry_price: Number(payload.entry || payload.price || 0),
    stop_loss: Number(payload.stop || payload.stop_loss || 0),
    take_profit: Number(payload.target || payload.take_profit || 0),
    direction,
    setup_type: payload.setup_type || action,
    confidence: Number(payload.confidence || 0.75),
    source: "tradingview",
    strategy_name: payload.strategy_name || "TradingView Alert",
    timestamp: payload.timestamp || now,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateSignal(signal: InternalSignal): {
  valid: boolean;
  error?: string;
} {
  if (!signal.symbol) return { valid: false, error: "Missing symbol" };
  if (!signal.action) return { valid: false, error: "Missing action" };
  if (signal.entry_price <= 0)
    return { valid: false, error: "Invalid entry price" };
  if (signal.stop_loss <= 0)
    return { valid: false, error: "Invalid stop loss" };
  if (signal.take_profit <= 0)
    return { valid: false, error: "Invalid take profit" };
  return { valid: true };
}

// ─── Signal Broadcasting (TODO: integrate with WebSocket) ──────────────────

async function broadcastSignal(signal: InternalSignal): Promise<void> {
  try {
    // Broadcast to connected WebSocket clients
    // TODO: integrate with your WebSocket handler
    logger.info(
      { signal_id: signal.id, symbol: signal.symbol },
      "Signal ready for broadcast",
    );
  } catch (err) {
    logger.error({ err }, "Failed to broadcast signal");
  }
}

// ─── Internal Signal Queue (TODO: integrate with Python brain) ────────────

async function pushToSignalQueue(signal: InternalSignal): Promise<void> {
  try {
    const apiUrl = process.env.GODSVIEW_API_URL || "http://localhost:3000/api";
    const response = await fetch(
      `${apiUrl}/v2/signals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signal),
      },
    );

    if (!response.ok) {
      logger.warn(
        {
          signal_id: signal.id,
          status: response.status,
        },
        "Failed to push signal to queue",
      );
    }
  } catch (err) {
    logger.warn(
      { signal_id: signal.id, err },
      "Could not reach signal queue endpoint",
    );
  }
}

// ─── Routes ────────────────────────────────────────────────────────────────

/**
 * POST /api/tv-webhook
 *
 * Receive TradingView webhook alerts. Expects:
 *  - Authorization: Bearer {TV_WEBHOOK_SECRET}
 *  - JSON payload with: symbol, action, timeframe, entry, stop, target, confidence
 */
router.post("/api/tv-webhook", async (req: Request, res: Response) => {
  const now = Date.now();
  stats.total_received++;

  // Authentication
  if (!validateWebhookAuth(req)) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Invalid or missing Authorization header",
    });
    return;
  }

  const payload = req.body as TradingViewWebhookPayload;

  // Convert to internal signal
  let signal: InternalSignal;
  try {
    signal = convertToInternalSignal(payload);
  } catch (err) {
    stats.total_errors++;
    stats.last_error = String(err);
    stats.last_error_time = now;
    logger.error({ err, payload }, "Failed to convert webhook payload");
    res
      .status(400)
      .json({
        ok: false,
        error: "conversion_failed",
        message: String(err),
      });
    return;
  }

  // Validate
  const validation = validateSignal(signal);
  if (!validation.valid) {
    stats.total_errors++;
    stats.last_error = validation.error;
    stats.last_error_time = now;
    logger.warn(
      { signal_id: signal.id, error: validation.error },
      "Signal validation failed",
    );
    res.status(400).json({
      ok: false,
      error: "validation_failed",
      message: validation.error,
    });
    return;
  }

  // Deduplication
  const hash = dedup.makeHash(
    signal.symbol,
    signal.action,
    signal.timeframe,
    signal.timestamp,
  );

  if (dedup.isDuplicate(hash, now)) {
    stats.total_deduplicated++;
    logger.debug(
      { signal_id: signal.id, symbol: signal.symbol },
      "Duplicate signal rejected",
    );
    res.json({
      ok: true,
      received: true,
      signal_id: signal.id,
      deduplicated: true,
    });
    return;
  }

  dedup.markSeen(hash, now);

  // Store in buffer
  signalBuffer.add(signal);

  // Update stats
  stats.last_signal_time = now;

  // Broadcast and queue
  await Promise.all([broadcastSignal(signal), pushToSignalQueue(signal)]);

  logger.info(
    {
      signal_id: signal.id,
      symbol: signal.symbol,
      action: signal.action,
    },
    "Webhook signal processed",
  );

  res.json({
    ok: true,
    received: true,
    signal_id: signal.id,
    deduplicated: false,
  });
});

/**
 * GET /api/tv-webhook/history
 *
 * Returns recent signals (last N) from the circular buffer.
 * Query params:
 *  - limit: number of signals to return (default 50)
 *  - symbol: filter by symbol (optional)
 */
router.get("/api/tv-webhook/history", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit || 50), 500);
    const filterSymbol = (req.query.symbol as string || "").toUpperCase();

    let signals = signalBuffer.getLast(limit);

    if (filterSymbol) {
      signals = signals.filter((s) => s.symbol === filterSymbol);
    }

    res.json({
      ok: true,
      count: signals.length,
      signals,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch signal history");
    res
      .status(500)
      .json({
        ok: false,
        error: "history_failed",
        message: String(err),
      });
  }
});

/**
 * GET /api/tv-webhook/stats
 *
 * Returns webhook statistics.
 */
router.get("/api/tv-webhook/stats", async (req: Request, res: Response) => {
  try {
    // Run periodic cleanup
    dedup.cleanup();

    res.json({
      ok: true,
      stats: {
        ...stats,
        buffer_size: signalBuffer.getAll().length,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch webhook stats");
    res
      .status(500)
      .json({
        ok: false,
        error: "stats_failed",
        message: String(err),
      });
  }
});

export default router;
