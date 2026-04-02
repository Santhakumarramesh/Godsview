/**
 * Express middleware that records HTTP request metrics for Prometheus.
 */
import type { Request, Response, NextFunction } from "express";
import {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
} from "../lib/metrics";

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc();

  res.on("finish", () => {
    httpRequestsInFlight.dec();

    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    httpRequestsTotal.inc({
      method: req.method,
      path: normalizePath(req.route?.path ?? req.path),
      status: String(res.statusCode),
    });

    httpRequestDuration.observe(durationSec);
  });

  next();
}

/** Collapse path params to prevent cardinality explosion */
function normalizePath(raw: string): string {
  return raw
    .replace(/\/[0-9a-f]{8,}/gi, "/:id") // UUIDs / hex IDs
    .replace(/\/\d+/g, "/:id")            // Numeric IDs
    .replace(/\?.*/g, "");                  // Strip query strings
}
