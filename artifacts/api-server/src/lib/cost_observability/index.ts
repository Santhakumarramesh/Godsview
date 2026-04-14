/**
 * cost_observability/index.ts — Phase 67: Cost Observability
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. CostMeter          — record cost events with dimensions.
 *   2. CostAllocator      — aggregate by user / strategy / org / resource.
 *   3. BudgetManager      — per-dimension budgets with alerts.
 *   4. CostForecaster     — month-end projection from current run-rate.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Cost Meter ─────────────────────────────────────────────────────────────

export type CostDimension = "user" | "strategy" | "org" | "resource" | "feature" | "broker";

export type CostResource =
  | "market_data"
  | "compute"
  | "storage"
  | "network"
  | "llm_inference"
  | "commission"
  | "slippage"
  | "third_party_api";

export interface CostEvent {
  id: string;
  at: number;
  resource: CostResource;
  amountUSD: number;
  dimensions: Partial<Record<CostDimension, string>>;
  description: string;
}

export class CostMeter {
  private readonly events: CostEvent[] = [];
  private readonly maxEvents = 500_000;

  record(params: Omit<CostEvent, "id" | "at">): CostEvent {
    const id = `cst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const event: CostEvent = { id, at: Date.now(), ...params };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    return event;
  }

  query(params?: {
    since?: number;
    until?: number;
    resource?: CostResource;
    dimension?: CostDimension;
    dimensionValue?: string;
  }): CostEvent[] {
    return this.events.filter((e) => {
      if (params?.since && e.at < params.since) return false;
      if (params?.until && e.at > params.until) return false;
      if (params?.resource && e.resource !== params.resource) return false;
      if (params?.dimension && params.dimensionValue) {
        const v = e.dimensions[params.dimension];
        if (v !== params.dimensionValue) return false;
      }
      return true;
    });
  }

  total(params?: Parameters<CostMeter["query"]>[0]): number {
    return this.query(params).reduce((s, e) => s + e.amountUSD, 0);
  }

  size(): number {
    return this.events.length;
  }
}

// ── Cost Allocator ─────────────────────────────────────────────────────────

export interface AllocationRow {
  key: string;
  amount: number;
  count: number;
}

export class CostAllocator {
  constructor(private readonly meter: CostMeter) {}

  byDimension(dimension: CostDimension, since?: number): AllocationRow[] {
    const events = this.meter.query({ since });
    const map = new Map<string, AllocationRow>();
    for (const e of events) {
      const key = e.dimensions[dimension] ?? "_unallocated";
      const row = map.get(key) ?? { key, amount: 0, count: 0 };
      row.amount += e.amountUSD;
      row.count++;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }

  byResource(since?: number): AllocationRow[] {
    const events = this.meter.query({ since });
    const map = new Map<string, AllocationRow>();
    for (const e of events) {
      const row = map.get(e.resource) ?? { key: e.resource, amount: 0, count: 0 };
      row.amount += e.amountUSD;
      row.count++;
      map.set(e.resource, row);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }

  topN(dimension: CostDimension, n = 10, since?: number): AllocationRow[] {
    return this.byDimension(dimension, since).slice(0, n);
  }
}

// ── Budgets ────────────────────────────────────────────────────────────────

export type BudgetPeriod = "daily" | "weekly" | "monthly";

export interface Budget {
  id: string;
  name: string;
  amountUSD: number;
  period: BudgetPeriod;
  dimension?: CostDimension;
  dimensionValue?: string;
  alertThresholdPct: number; // 0-100, warn when spend > this fraction
  createdAt: number;
  active: boolean;
}

export interface BudgetStatus {
  budgetId: string;
  budget: Budget;
  currentSpend: number;
  periodStart: number;
  periodEnd: number;
  percentUsed: number;
  status: "ok" | "warning" | "exceeded";
}

export class BudgetManager {
  private readonly budgets = new Map<string, Budget>();

  constructor(private readonly meter: CostMeter) {}

  create(params: Omit<Budget, "id" | "createdAt" | "active">): Budget {
    const id = `bud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const budget: Budget = {
      id,
      ...params,
      createdAt: Date.now(),
      active: true,
    };
    this.budgets.set(id, budget);
    return budget;
  }

  disable(id: string): boolean {
    const b = this.budgets.get(id);
    if (!b) return false;
    b.active = false;
    return true;
  }

  list(): Budget[] {
    return Array.from(this.budgets.values());
  }

  status(id: string): BudgetStatus | null {
    const b = this.budgets.get(id);
    if (!b) return null;
    const now = Date.now();
    const { periodStart, periodEnd } = this._period(b.period, now);
    const currentSpend = this.meter.total({
      since: periodStart,
      until: periodEnd,
      dimension: b.dimension,
      dimensionValue: b.dimensionValue,
    });
    const percentUsed = b.amountUSD > 0 ? (currentSpend / b.amountUSD) * 100 : 0;
    const status: BudgetStatus["status"] =
      percentUsed >= 100 ? "exceeded" :
      percentUsed >= b.alertThresholdPct ? "warning" :
      "ok";
    if (status === "exceeded") logger.warn({ budget: b.name, spend: currentSpend }, "[Cost] Budget exceeded");
    return { budgetId: id, budget: b, currentSpend, periodStart, periodEnd, percentUsed, status };
  }

  statusAll(): BudgetStatus[] {
    return this.list()
      .filter((b) => b.active)
      .map((b) => this.status(b.id))
      .filter((s): s is BudgetStatus => s !== null);
  }

  private _period(period: BudgetPeriod, now: number): { periodStart: number; periodEnd: number } {
    const d = new Date(now);
    if (period === "daily") {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      return { periodStart: start, periodEnd: start + 24 * 60 * 60 * 1000 };
    }
    if (period === "weekly") {
      const dayOfWeek = d.getDay();
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dayOfWeek).getTime();
      return { periodStart: start, periodEnd: start + 7 * 24 * 60 * 60 * 1000 };
    }
    // monthly
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return { periodStart: start, periodEnd: end };
  }
}

// ── Forecaster ─────────────────────────────────────────────────────────────

export interface CostForecast {
  runRatePerDay: number;
  monthEndProjection: number;
  nextMonthProjection: number;
  basis: { days: number; totalSpend: number };
}

export class CostForecaster {
  constructor(private readonly meter: CostMeter) {}

  forecast(windowDays = 7): CostForecast {
    const now = Date.now();
    const since = now - windowDays * 24 * 60 * 60 * 1000;
    const total = this.meter.total({ since, until: now });
    const runRatePerDay = total / Math.max(1, windowDays);
    const d = new Date(now);
    const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    const daysLeft = Math.max(0, (endOfMonth - now) / (24 * 60 * 60 * 1000));
    const currentMonthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const currentMonthSpend = this.meter.total({ since: currentMonthStart, until: now });
    const monthEndProjection = currentMonthSpend + runRatePerDay * daysLeft;
    const nextMonthProjection = runRatePerDay * 30;
    return {
      runRatePerDay,
      monthEndProjection,
      nextMonthProjection,
      basis: { days: windowDays, totalSpend: total },
    };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const costMeter = new CostMeter();
export const costAllocator = new CostAllocator(costMeter);
export const budgetManager = new BudgetManager(costMeter);
export const costForecaster = new CostForecaster(costMeter);
