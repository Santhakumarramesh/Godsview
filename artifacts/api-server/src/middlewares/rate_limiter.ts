/**
 * In-memory sliding-window rate limiter.
 * No external dependency (no Redis needed for single-instance deployment).
 */
import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

interface WindowEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  /** Window size in milliseconds */
  windowMs: number;
  /** Max requests per window */
  maxRequests: number;
  /** Key extractor — defaults to IP */
  keyFn?: (req: Request) => string;
  /** Custom message */
  message?: string;
}

const stores = new Map<string, Map<string, WindowEntry>>();

function getClientKey(req: Request): string {
  // Support proxied requests (X-Forwarded-For) and direct connections
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

/**
 * Creates a rate-limiting middleware.
 */
export function rateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, message } = config;
  const keyFn = config.keyFn ?? getClientKey;
  const storeName = `rl_${windowMs}_${maxRequests}`;

  if (!stores.has(storeName)) {
    stores.set(storeName, new Map());
  }
  const store = stores.get(storeName)!;

  // Periodic cleanup every 60s
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, 60_000);
  cleanup.unref(); // Don't block process exit

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyFn(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // Slide the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil(windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(maxRequests));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));

      logger.warn({ key, maxRequests, windowMs }, "Rate limit exceeded");
      res.status(429).json({
        error: message ?? "Too many requests — please try again later",
        retryAfter,
      });
      return;
    }

    entry.timestamps.push(now);

    // Set rate limit headers on all responses
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(maxRequests - entry.timestamps.length));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));

    next();
  };
}

/* ── Pre-configured limiters ──────────────────────────────────────── */

/** General API: 100 req/min per IP */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  maxRequests: 100,
});

/** Signal processing: 20 req/min per IP (expensive AI pipeline) */
export const signalLimiter = rateLimit({
  windowMs: 60_000,
  maxRequests: 20,
  message: "Signal processing rate limit exceeded — max 20 per minute",
});

/** Backtest: 5 req/min per IP (heavy computation) */
export const backtestLimiter = rateLimit({
  windowMs: 60_000,
  maxRequests: 5,
  message: "Backtest rate limit exceeded — max 5 per minute",
});

/** Retrain: 2 req/5min per IP */
export const retrainLimiter = rateLimit({
  windowMs: 300_000,
  maxRequests: 2,
  message: "Retrain rate limit exceeded — max 2 per 5 minutes",
});
