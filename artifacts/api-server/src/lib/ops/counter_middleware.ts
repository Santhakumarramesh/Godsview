/**
 * Phase 6 — Counter observer middleware.
 *
 * Attached as the FIRST middleware after pinoHttp (so request IDs are
 * already populated). On every response it increments the global counters.
 * It does NOT modify the response or request in any way.
 */
import type { Request, Response, NextFunction } from "express";
import {
  incTotalRequests,
  incFailedRequests,
  incOrderAttempt,
  incOrderExecution,
} from "./counters.js";

export function counterMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isOrderPost =
    req.method === "POST" &&
    (req.path === "/alpaca/orders" || req.path === "/api/alpaca/orders");

  if (isOrderPost) incOrderAttempt();

  res.on("finish", () => {
    incTotalRequests();
    if (res.statusCode >= 400) incFailedRequests();
    if (isOrderPost && res.statusCode >= 200 && res.statusCode < 300) {
      incOrderExecution();
    }
  });

  next();
}
