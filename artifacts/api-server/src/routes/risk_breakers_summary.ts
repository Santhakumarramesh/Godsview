/**
 * Phase 97 — Unified risk-breakers summary
 *
 * GET /api/risk/breakers
 *   Aggregates the three layers of risk gates into a single envelope:
 *     - circuit_breaker  (rolling-loss CB from lib/circuit_breaker)
 *     - drawdown_breaker (DD halt from lib/drawdown_breaker)
 *     - kill_switch      (operator/manual halt from lib/circuit_breaker.kill_switch)
 *
 *   Closes the "individual breaker reachable" gap from
 *   PRODUCTION_READINESS_SCORECARD gate B.
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getCircuitBreakerSnapshot } from "../lib/circuit_breaker";
import { getBreakerSnapshot as getDrawdownSnapshot } from "../lib/drawdown_breaker";

const router: Router = Router();

router.get("/api/risk/breakers", (_req: Request, res: Response): void => {
  try {
    const cb = getCircuitBreakerSnapshot();
    const dd = getDrawdownSnapshot();

    const cbBreakerOpen = cb?.breaker?.state === "OPEN";
    const ddTripped = !!(dd as { tripped?: boolean })?.tripped;
    const ksActive = !!cb?.killSwitch?.active;
    const tripped = cbBreakerOpen || ddTripped || ksActive;

    res.json({
      ok: true,
      tripped,
      tradingAllowed: !!cb?.tradingAllowed,
      circuit_breaker: cb?.breaker,
      drawdown_breaker: dd,
      kill_switch: cb?.killSwitch,
      rate_limiter: cb?.rateLimiter,
      total_trips: cb?.totalTrips ?? 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "risk/breakers summary failed");
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "internal_error",
    });
  }
});

export default router;
