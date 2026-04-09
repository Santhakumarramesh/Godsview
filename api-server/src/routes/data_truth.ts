/**
 * Data Truth + Latency Observability Routes — Phase 29
 *
 * Endpoints:
 * - POST /timestamp-chain — record a timestamp chain for a decision
 * - POST /quality-check/:symbol — run quality checks for a symbol
 * - POST /score/:symbol — compute truth score for symbol
 * - GET /scores — list all truth scores (latest per symbol)
 * - GET /scores/:symbol — get truth score for symbol
 * - GET /latency — get latency metrics summary
 * - GET /degraded — get list of degraded symbols
 * - GET /summary — overall data truth system summary
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  recordTimestampChain,
  computeLatencyMetrics,
  runQualityChecks,
  computeTruthScore,
  getTruthScore,
  getLatestTruthScores,
  getDegradedSymbols,
  getDataTruthSummary,
  type TimestampChain,
  type DataQualityCheck,
} from "../lib/data_truth";

const router: IRouter = Router();

// ── Response Wrapper ─────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function sendSuccess<T>(res: Response, data: T, status: number = 200): void {
  res.status(status).json({ success: true, data } as ApiResponse<T>);
}

function sendError(res: Response, error: string, status: number = 400): void {
  res.status(status).json({ success: false, error } as ApiResponse<unknown>);
}

// ── POST /timestamp-chain ────────────────────────────

/**
 * Record timestamps in a chain (feed_ts, ingest_ts, decision_ts, order_submit_ts, broker_ack_ts, fill_ts)
 * Body: { chain_id, feed_ts?, ingest_ts?, decision_ts?, order_submit_ts?, broker_ack_ts?, fill_ts? }
 */
router.post("/timestamp-chain", (req: Request, res: Response): void => {
  const { chain_id, feed_ts, ingest_ts, decision_ts, order_submit_ts, broker_ack_ts, fill_ts } = req.body;

  if (!chain_id) {
    sendError(res, "chain_id is required");
    return;
  }

  const updates: Partial<TimestampChain> = {};
  if (feed_ts) updates.feed_ts = new Date(feed_ts);
  if (ingest_ts) updates.ingest_ts = new Date(ingest_ts);
  if (decision_ts) updates.decision_ts = new Date(decision_ts);
  if (order_submit_ts) updates.order_submit_ts = new Date(order_submit_ts);
  if (broker_ack_ts) updates.broker_ack_ts = new Date(broker_ack_ts);
  if (fill_ts) updates.fill_ts = new Date(fill_ts);

  const chain = recordTimestampChain(chain_id, updates);
  sendSuccess(res, { chain_id, chain });
});

// ── POST /quality-check/:symbol ──────────────────────

/**
 * Run quality checks on market data candles for a symbol
 * Body: { candles: [{ open, high, low, close, volume, timestamp }] }
 */
router.post("/quality-check/:symbol", (req: Request, res: Response): void => {
  const { symbol } = req.params;
  const { candles } = req.body;

  if (!symbol) {
    sendError(res, "symbol parameter is required");
    return;
  }

  if (!Array.isArray(candles)) {
    sendError(res, "candles must be an array");
    return;
  }

  // Parse candles with timestamp conversion
  const parsedCandles = candles.map((c: Record<string, unknown>) => ({
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
    timestamp: new Date(c.timestamp as string),
  }));

  const qualityCheck = runQualityChecks(symbol, parsedCandles);
  sendSuccess(res, qualityCheck);
});

// ── POST /score/:symbol ──────────────────────────────

/**
 * Compute truth score for a symbol
 * Body: { session_id, quality_check, timestamp_chain, latency_metrics? }
 * Returns: DataTruthScore
 */
router.post("/score/:symbol", (req: Request, res: Response): void => {
  const { symbol } = req.params;
  const { session_id, quality_check, timestamp_chain, latency_metrics } = req.body;

  if (!symbol) {
    sendError(res, "symbol parameter is required");
    return;
  }

  if (!session_id) {
    sendError(res, "session_id is required");
    return;
  }

  if (!quality_check) {
    sendError(res, "quality_check is required");
    return;
  }

  if (!timestamp_chain) {
    sendError(res, "timestamp_chain is required");
    return;
  }

  // Parse timestamp chain
  const parsedChain: TimestampChain = {};
  if (timestamp_chain.feed_ts) parsedChain.feed_ts = new Date(timestamp_chain.feed_ts);
  if (timestamp_chain.ingest_ts) parsedChain.ingest_ts = new Date(timestamp_chain.ingest_ts);
  if (timestamp_chain.decision_ts) parsedChain.decision_ts = new Date(timestamp_chain.decision_ts);
  if (timestamp_chain.order_submit_ts) parsedChain.order_submit_ts = new Date(timestamp_chain.order_submit_ts);
  if (timestamp_chain.broker_ack_ts) parsedChain.broker_ack_ts = new Date(timestamp_chain.broker_ack_ts);
  if (timestamp_chain.fill_ts) parsedChain.fill_ts = new Date(timestamp_chain.fill_ts);

  // Parse latency metrics or compute from chain
  const metrics = latency_metrics || computeLatencyMetrics(parsedChain);

  const truthScore = computeTruthScore(
    symbol,
    session_id,
    quality_check as DataQualityCheck,
    metrics,
    parsedChain
  );

  sendSuccess(res, truthScore, 201);
});

// ── GET /scores ──────────────────────────────────────

/**
 * Get all latest truth scores (one per symbol)
 * Query: limit (default 100)
 */
router.get("/scores", (req: Request, res: Response): void => {
  const limit = Math.min(Number(req.query?.limit) || 100, 500);
  const scores = getLatestTruthScores(limit);
  sendSuccess(res, { total: scores.length, scores });
});

// ── GET /scores/:symbol ──────────────────────────────

/**
 * Get truth score for a specific symbol
 */
router.get("/scores/:symbol", (req: Request, res: Response): void => {
  const { symbol } = req.params;

  if (!symbol) {
    sendError(res, "symbol parameter is required");
    return;
  }

  const score = getTruthScore(symbol);
  if (!score) {
    sendError(res, `No truth score found for symbol ${symbol}`, 404);
    return;
  }

  sendSuccess(res, score);
});

// ── GET /latency ─────────────────────────────────────

/**
 * Get summary of latency metrics across all symbols
 */
router.get("/latency", (req: Request, res: Response): void => {
  const scores = getLatestTruthScores(1000);

  const latencies = {
    market_data_lag_ms: [] as number[],
    decision_latency_ms: [] as number[],
    order_routing_latency_ms: [] as number[],
    fill_latency_ms: [] as number[],
  };

  for (const score of scores) {
    const { latency_metrics } = score;
    if (latency_metrics.market_data_lag_ms !== undefined) {
      latencies.market_data_lag_ms.push(latency_metrics.market_data_lag_ms);
    }
    if (latency_metrics.decision_latency_ms !== undefined) {
      latencies.decision_latency_ms.push(latency_metrics.decision_latency_ms);
    }
    if (latency_metrics.order_routing_latency_ms !== undefined) {
      latencies.order_routing_latency_ms.push(latency_metrics.order_routing_latency_ms);
    }
    if (latency_metrics.fill_latency_ms !== undefined) {
      latencies.fill_latency_ms.push(latency_metrics.fill_latency_ms);
    }
  }

  const computeStats = (values: number[]) => {
    if (values.length === 0) return null;
    const sorted = values.sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  };

  sendSuccess(res, {
    market_data_lag_ms: computeStats(latencies.market_data_lag_ms),
    decision_latency_ms: computeStats(latencies.decision_latency_ms),
    order_routing_latency_ms: computeStats(latencies.order_routing_latency_ms),
    fill_latency_ms: computeStats(latencies.fill_latency_ms),
  });
});

// ── GET /degraded ────────────────────────────────────

/**
 * Get list of symbols with degraded or offline data
 */
router.get("/degraded", (req: Request, res: Response): void => {
  const degradedSymbols = getDegradedSymbols();
  const scores = degradedSymbols.map((symbol) => getTruthScore(symbol)).filter(Boolean);

  sendSuccess(res, {
    total_degraded: scores.length,
    symbols: degradedSymbols,
    details: scores,
  });
});

// ── GET /summary ─────────────────────────────────────

/**
 * Get overall data truth system summary
 */
router.get("/summary", (req: Request, res: Response): void => {
  const summary = getDataTruthSummary();
  sendSuccess(res, summary);
});

export default router;
