/**
 * demo_mode.ts — Phase 2 demo-data gating helpers.
 *
 * Goal: stop pretending. Routes that historically returned hardcoded
 * mock data must now:
 *   1. In production, return real data (or 503 if no broker is wired).
 *   2. In development/test, optionally return demo data, but stamp every
 *      response with `_demo: true` and an `X-Demo-Data: true` header so
 *      the dashboard can flag fixture data clearly.
 *
 * This module is the single source of truth for that decision.
 */
import type { Response } from "express";
import { runtimeConfig } from "./runtime_config";

/**
 * True only when this process is running in production AND the operator
 * has wired real broker credentials. In all other cases callers should
 * return either explicit-empty real data or stamped demo data.
 */
export function hasLiveBroker(): boolean {
  return runtimeConfig.nodeEnv === "production" && runtimeConfig.hasAlpacaKeys;
}

/** True when callers may serve demo/fixture data (dev/test only). */
export function demoDataAllowed(): boolean {
  return runtimeConfig.nodeEnv !== "production";
}

/**
 * Stamp the response with the demo-data marker. Call this before sending
 * a body that contains fixture/seed data so the UI can render a banner.
 */
export function markDemoResponse(res: Response): void {
  res.setHeader("X-Demo-Data", "true");
}

/** Convenience: send a stamped JSON body with `_demo: true` injected. */
export function sendDemo<T extends Record<string, unknown>>(
  res: Response,
  body: T,
): Response {
  markDemoResponse(res);
  return res.json({ ...body, _demo: true });
}

/**
 * Convenience: production guard that 503s if a broker-required route is
 * called without live credentials. Returns true if the caller should
 * stop processing (a response was already sent).
 */
export function require503IfNoBroker(res: Response, module: string): boolean {
  if (runtimeConfig.nodeEnv === "production" && !runtimeConfig.hasAlpacaKeys) {
    res.status(503).json({
      error: "broker_not_configured",
      module,
      message:
        "ALPACA_API_KEY/ALPACA_SECRET_KEY are required to serve real data " +
        "from this endpoint in production.",
    });
    return true;
  }
  return false;
}
