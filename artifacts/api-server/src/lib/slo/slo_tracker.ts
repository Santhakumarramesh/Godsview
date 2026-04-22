/**
 * SLO Tracker (Phase 6) — In-process singleton that records request
 * observations and computes burn rate against codified SLOs.
 */

import { logger } from "../logger";
import { SLO_DEFINITIONS, type SLODefinition, findSLOsForPath } from "./slo_definitions";

const SLO_OBS_MAX = Math.max(
  500, parseInt(process.env["SLO_OBSERVATION_MAX"] ?? "5000", 10) || 5000,
);

interface Observation {
  ts: number; latencyMs: number; status: number; good: boolean; path: string;
}

interface BurnRateReport {
  sloId: string; windowMs: number; windowSampleCount: number;
  successRate: number; objective: number; errorBudgetRemaining: number;
  burnRate: number; alertBurnRate: number; alerting: boolean;
  lastSampleTs: number | null; tier: SLODefinition["tier"];
}

class SLOTracker {
  private static instance: SLOTracker | null = null;
  private observations = new Map<string, Observation[]>();
  private freshnessLastTick = new Map<string, number>();

  private constructor() {
    for (const slo of SLO_DEFINITIONS) this.observations.set(slo.id, []);
  }
  static getInstance(): SLOTracker {
    if (!SLOTracker.instance) SLOTracker.instance = new SLOTracker();
    return SLOTracker.instance;
  }

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

  recordSchedulerTick(schedulerId: string): void {
    this.freshnessLastTick.set(schedulerId, Date.now());
  }

  private isObservationGood(slo: SLODefinition, status: number, latencyMs: number): boolean {
    if (slo.kind === "availability") return status < 500;
    if (slo.kind === "latency") return latencyMs <= slo.target;
    return status < 500;
  }

  getBurnRate(sloId: string): BurnRateReport | null {
    const slo = SLO_DEFINITIONS.find((s) => s.id === sloId);
    if (!slo) return null;
    const buf = this.observations.get(sloId) ?? [];
    const cutoff = Date.now() - slo.windowMs;
    const window = buf.filter((o) => o.ts >= cutoff);
    if (window.length === 0) {
      return { sloId, windowMs: slo.windowMs, windowSampleCount: 0,
        successRate: 1, objective: slo.objective, errorBudgetRemaining: 1,
        burnRate: 0, alertBurnRate: slo.alertBurnRate, alerting: false,
        lastSampleTs: null, tier: slo.tier };
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
    return { sloId, windowMs: slo.windowMs, windowSampleCount: window.length,
      successRate, objective: slo.objective, errorBudgetRemaining,
      burnRate, alertBurnRate: slo.alertBurnRate,
      alerting: burnRate >= slo.alertBurnRate, lastSampleTs, tier: slo.tier };
  }
  getAllBurnRates(): BurnRateReport[] {
    return SLO_DEFINITIONS
      .map((s) => this.getBurnRate(s.id))
      .filter((r): r is BurnRateReport => r !== null);
  }

  getBudgetSnapshot() {
    return {
      slos: SLO_DEFINITIONS.map((slo) => {
        const burn = this.getBurnRate(slo.id);
        return {
          id: slo.id, title: slo.title, description: slo.description,
          tier: slo.tier, kind: slo.kind, target: slo.target,
          percentile: slo.percentile, objective: slo.objective,
          windowMs: slo.windowMs, alertBurnRate: slo.alertBurnRate,
          routePrefixes: slo.routePrefixes ?? [], burn,
        };
      }),
    };
  }

  reset(): void {
    for (const slo of SLO_DEFINITIONS) this.observations.set(slo.id, []);
    this.freshnessLastTick.clear();
  }

  getAlertingSLOs(): BurnRateReport[] {
    return this.getAllBurnRates().filter((r) => r.alerting);
  }
}

export const sloTracker: SLOTracker = SLOTracker.getInstance();

import type { Request, Response, NextFunction } from "express";

export function sloMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      const path = (req.route?.path ?? req.path ?? "").toString();
      sloTracker.recordRequest(path, res.statusCode, latencyMs);
    } catch (err: any) {
      logger.warn({ err: err?.message }, "SLO middleware record failed");
    }
  });
  next();
}

export type { BurnRateReport };
