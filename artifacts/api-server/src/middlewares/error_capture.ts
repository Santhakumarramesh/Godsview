/**
 * Express error-capture middleware.
 *
 * Wraps every unhandled error: writes a structured event into the
 * systemMetrics ring (so /api/system/logs/recent surfaces it) and the
 * Sentry-shaped record into a separate ring for /api/system/errors.
 *
 * Does NOT call `next(err)` after capturing — it sends a sanitised JSON
 * 500 response so we never leak stack traces to clients.
 */

import type { ErrorRequestHandler, RequestHandler } from "express";
import { systemMetrics } from "../lib/system_metrics";
import { scrub } from "../lib/scrub";

export type CapturedError = {
  ts: number;
  method: string;
  path: string;
  status: number;
  message: string;
  type: string;
  stack?: string;
};

const errorRing: CapturedError[] = [];
const RING_CAP = 200;

export function recordError(e: CapturedError) {
  // Defensive: even though the path/message are usually safe, scrub for any
  // accidental token-in-URL or secret-in-message before persisting.
  const scrubbed: CapturedError = scrub({ ...e, message: e.message.slice(0, 500) });
  errorRing.push(scrubbed);
  if (errorRing.length > RING_CAP) errorRing.shift();
  systemMetrics.log("error", "request.error", {
    method: scrubbed.method, path: scrubbed.path, status: scrubbed.status,
    type: scrubbed.type, message: scrubbed.message,
  });
}

export function recentErrors(limit = 50): CapturedError[] {
  const n = Math.min(limit, errorRing.length);
  return errorRing.slice(errorRing.length - n).reverse();
}

export const errorCaptureMiddleware: ErrorRequestHandler = (err, req, res, _next) => {
  const status = (err && (err.status || err.statusCode)) || 500;
  recordError({
    ts: Date.now(),
    method: req.method,
    path: req.originalUrl || req.url,
    status,
    type: err?.constructor?.name ?? typeof err,
    message: err?.message ?? String(err),
    stack: process.env.NODE_ENV !== "production" ? err?.stack : undefined,
  });
  if (res.headersSent) return;
  res.status(status).json({
    ok: false,
    error: err?.message ?? "Internal server error",
    type: err?.constructor?.name ?? "Error",
  });
};

// Wrap async handlers so unhandled rejections still hit the middleware.
export function asyncWrap(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
