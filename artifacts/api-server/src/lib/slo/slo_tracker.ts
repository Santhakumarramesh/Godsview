/**
 * SLO Tracker (Phase 6)
 *
 * In-process singleton that records request observations and computes burn
 * rate against the codified SLOs in `slo_definitions.ts`.
 *
 * The tracker maintains a ring buffer of observations per SLO (capped to
 * `SLO_OBS_MAX` = 5000 entries) so memory is bounded even under sustained
 * traffic. Burn rate is the consumed-fraction of the error budget over the
 * SLO's window divided by the rate at which the budget is permitted to
 * be spent.
 *
 * No external dependencies; safe to import from the SSE alert router and
 * the /api/slo route handlers.
 */

import { logger } from "../logger";
import {
  SLO_DEFINITIONS,
  type SLODefinition,
  findSLOsForPath,
} from "./slo_definitions";

const SLO_OBS_MAX = Math.max(
  500,
  parseInt(process.env["SLO_OBSERVATION_MAX"] ?? "5000", 10) || 5000,
);

interface Observation {
  /** Epoch ms when the request finished */
  ts: number;
  /** Latency in ms */
  latencyMs: number;
  /** HTTP status code */
  status: number;
  /** Whether this observation satisfies the SLO target */
  good: boolean;
  /** Path prefix for diagnostics */
  path: string;
}

interface BurnRateReport {
  sloId: string;
  windowMs: number;
  windowSampleCount: number;
  /** Fraction of observations that satisfy the SLO (0-1) */
  successRate: number;
  /** Configured objective (e.g. 0.99) */
  objective: number;
  /** errorBudgetRemaining = (successRate - objective) / (1 - objective); 1 = full budget, 0 = exhausted */
  errorBudgetRemaining: number;
  /** Burn rate vs alertBurnRate threshold */
  burnRate: number;
  alertBurnRate: number;
  alerting: boolean;
  lastSampleTs: number | null;
  /** Tier copied from definition for convenient client rendering */
  tier: SLODefinition["tier"];
}

class SLOTracker {
  private static instance: SLOTracker | null = null;
  private observations = new Map<string, Observation[]>();
  private freshnessLastTick = new Map<string, number>();

  private constructor() {
    for (const slo of SLO_DEFINITIONS) {
      this.observations.set(slo.id, []);
    }
  }

  static getInstance(): SLOTracker {
    if (!SLOTracker.instance) SLOTracker.instance = new SLOTracker();
    return SLOTracker.instance;
  }

  /**
   * Record a completed HTTP request against every applicable SLO.
   * Called from the SLO middleware on `res.on("finish")`.
   */
  recordRequest(path: string, status: number, latencyMs: number): void {
    const ts = Date.now();
    const slos = findSLOsForPath(path);
    for (const slo of slos) {
      const good = this.isObservationGood(slo, status, latencyMs);
      const buf = this.observations.get(slo.id);
      if (!buf) continue;
      buf.push({ ts, latencyMs, status, good, path });
      if (buf.length > SLO_OBS_MAX) buf.shift();
    }
  }

  /** Record that a scheduler completed a cycle — drives the freshness SLO. */
  recordSchedulerTick(schedulerId: string): void {
    this.freshnessLastTick.set(schedulerId, Date.now());
  }

  /**
   * Record a freshness observation derived from a known scheduler.
   * `expectedIntervalMs` is the scheduler's configured cadence; "good" means
   * the elapsed time is within `target × expectedIntervalMs`.
   */
  recordFreshnessObservation(
    sloId: string,
    schedulerId: string,
    expectedIntervalMs: number,
  ): void {
    const slo = SLO_DEFINITIONS.find((s) => s.id === sloId);
    if (!slo || slo.kind !== "freshness") return;
    const lastTick = this.freshnessLastTick.get(schedulerId);
    if (!lastTick) return;
    const elapsed = Date.now() - lastTick;
    const ratio = elapsed / expectedIntervalMs;
    const good = ratio <= slo.target;
    const buf = this.observations.get(slo.id);
    if (!buf) return;
    buf.push({ ts: Date.now(), latencyMs: elapsed, status: 0, good, path: schedulerId });
    if (buf.length > SLO_OBS_MAX) buf.shift();
  }

  private isObservationGood(slo: SLODefinition, status: number, latencyMs: number): boolean {
    if (slo.kind === "availability") {
      return status < 500;
    }
    if (slo.kind === "latency") {
      return latencyMs <= slo.target;
    }
    // freshness/throughput handled separately
    return status < 500;
  }

  /** Compute current burn rate report for a single SLO. */
  getBurnRate(sloId: string): BurnRateReport | null {
    const slo = SLO_DEFINITIONS.find((s) => s.id === sloId);
    if (!slo) return null;
    const buf = this.observations.get(sloId) ?? [];
    const cutoff = Date.now() - slo.windowMs;
    const window = buf.filter((o) => o.ts >= cutoff);
    if (window.length === 0) {
      return {
        sloId,
        windowMs: slo.windowMs,
        windowSampleCount: 0,
        successRate: 1,
        objective: slo.objective,
        errorBudgetRemaining: 1,
        burnRate: 0,
        alertBurnRate: slo.alertBurnRate,
        alerting: false,
        lastSampleTs: null,
        tier: slo.tier,
      };
    }
    const goods = window.filter((o) => o.good).length;
    const successRate = goods / window.length;
    const errorRate = 1 - successRate;
    const allowedErrorRate = 1 - slo.objective;
    const errorBudgetRemaining = allowedErrorRate === 0
      ? (errorRate === 0 ? 1 : 0)
      : Math.max(0, Math.min(1, 1 - errorRate / allowedErrorRate));
    const burnRate = allowedErrorRate === 0 ? 0 : errorRate / allowedErrorRate;
    const lastSampleTs = window[window.length - 1]?.ts ?? null;
    return {
      sloId,
      windowMs: slo.windowMs,
      windowSampleCount: window.length,
      successRate,
      objective: slo.objective,
      errorBudgetRemaining,
      burnRate,
      alertBurnRate: slo.alertBurnRate,
      alerting: burnRate >= slo.alertBurnRate,
      lastSampleTs,
      tier: slo.tier,
    };
  }

  getAllBurnRates(): BurnRateReport[] {
    return SLO_DEFINITIONS
      .map((s) => this.getBurnRate(s.id))
      .filter((r): r is BurnRateReport => r !== null);
  }

  /** Diagnostic snapshot used by /api/slo/budgets */
  getBudgetSnapshot() {
    return {
      slos: SLO_DEFINITIONS.map((slo) => {
        const burn = this.getBurnRate(slo.id);
        return {
          id: slo.id,
          title: slo.title,
          description: slo.description,
          tier: slo.tier,
          kind: slo.kind,
          target: slo.target,
          percentile: slo.percentile,
          objective: slo.objective,
          windowMs: slo.windowMs,
          alertBurnRate: slo.alertBurnRate,
          routePrefixes: slo.routePrefixes ?? [],
          burn,
        };
      }),
    };
  }

  /** Reset tracker state — only used in tests / forced ops. */
  reset(): void {
    for (const slo of SLO_DEFINITIONS) {
      this.observations.set(slo.id, []);
    }
    this.freshnessLastTick.clear();
  }

  /** Internal hook used by the alert router to enumerate alerting SLOs. */
  getAlertingSLOs(): BurnRateReport[] {
    return this.getAllBurnRates().filter((r) => r.alerting);
  }
}

export const sloTracker: SLOTracker = SLOTracker.getInstance();

/**
 * Express middleware: records latency + status against the SLO tracker.
 * Mounted in app.ts after the existing prometheus middleware so the path
 * has already been resolved.
 */
import type { Request, Response, NextFunction } from "express";

export function sloMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      const path = (req.route?.path ?? req.path ?? "").toString();
      sloTracker.recordRequest(path, res.statusCode, latencyMs);
    } catch (err: any) {
      // Never throw from the middleware — log and move on.
      logger.warn({ err: err?.message }, "SLO middleware record failed");
    }
  });
  next();
}

export type { BurnRateReport };
