/**
 * slo_monitoring/index.ts — Phase 61: SLO + Burn-Rate Monitoring
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. SLORegistry          — service-level objectives with targets.
 *   2. ErrorBudgetEngine    — rolling-window error-budget accounting.
 *   3. BurnRateAlertEngine  — multi-window burn-rate alerts (Google SRE style).
 *   4. DashboardBuilder     — compose widgets into dashboard JSON.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── SLOs ────────────────────────────────────────────────────────────────────

export type SLOKind = "availability" | "latency" | "correctness" | "freshness";

export interface SLO {
  id: string;
  name: string;
  kind: SLOKind;
  target: number;           // e.g. 0.999 availability or 200 ms p95 latency.
  windowDays: number;       // rolling window.
  service: string;
  description: string;
  createdAt: number;
}

export class SLORegistry {
  private readonly slos = new Map<string, SLO>();

  register(params: Omit<SLO, "id" | "createdAt">): SLO {
    const id = `slo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const slo: SLO = { id, createdAt: Date.now(), ...params };
    this.slos.set(id, slo);
    logger.info({ sloId: id, name: params.name }, "[SLO] Registered");
    return slo;
  }

  list(): SLO[] {
    return Array.from(this.slos.values());
  }

  get(id: string): SLO | null {
    return this.slos.get(id) ?? null;
  }

  byService(service: string): SLO[] {
    return Array.from(this.slos.values()).filter((s) => s.service === service);
  }

  delete(id: string): boolean {
    return this.slos.delete(id);
  }
}

// ── Error Budget ───────────────────────────────────────────────────────────

export interface Observation {
  sloId: string;
  at: number;
  good: number;
  total: number;
}

export interface BudgetReport {
  sloId: string;
  windowMs: number;
  target: number;
  observed: number;       // fraction good / total (or p95 etc depending on SLO kind)
  budgetRemaining: number; // 0-1
  budgetBurnedPct: number; // 0-100
  samples: number;
}

export class ErrorBudgetEngine {
  private readonly observations: Observation[] = [];
  private readonly maxObservations = 100_000;

  constructor(private readonly registry: SLORegistry) {}

  observe(sloId: string, good: number, total: number): void {
    if (total <= 0) return;
    this.observations.push({ sloId, at: Date.now(), good, total });
    if (this.observations.length > this.maxObservations) {
      this.observations.splice(0, this.observations.length - this.maxObservations);
    }
  }

  report(sloId: string): BudgetReport | null {
    const slo = this.registry.get(sloId);
    if (!slo) return null;
    const windowMs = slo.windowDays * 24 * 60 * 60 * 1000;
    const since = Date.now() - windowMs;
    const filtered = this.observations.filter((o) => o.sloId === sloId && o.at >= since);
    if (filtered.length === 0) {
      return { sloId, windowMs, target: slo.target, observed: 1, budgetRemaining: 1, budgetBurnedPct: 0, samples: 0 };
    }
    const totalGood = filtered.reduce((s, o) => s + o.good, 0);
    const totalAll = filtered.reduce((s, o) => s + o.total, 0);
    const observed = totalAll > 0 ? totalGood / totalAll : 1;
    const allowedBadFraction = Math.max(0, 1 - slo.target);
    const actualBadFraction = Math.max(0, 1 - observed);
    const burned = allowedBadFraction > 0 ? Math.min(1, actualBadFraction / allowedBadFraction) : actualBadFraction > 0 ? 1 : 0;
    return {
      sloId,
      windowMs,
      target: slo.target,
      observed,
      budgetRemaining: Math.max(0, 1 - burned),
      budgetBurnedPct: burned * 100,
      samples: filtered.length,
    };
  }

  reportAll(): BudgetReport[] {
    return this.registry.list()
      .map((s) => this.report(s.id))
      .filter((r): r is BudgetReport => r !== null);
  }
}

// ── Burn-Rate Alerts ───────────────────────────────────────────────────────

export type BurnSeverity = "page" | "ticket" | "info";

export interface BurnRateAlert {
  id: string;
  sloId: string;
  severity: BurnSeverity;
  shortWindowMin: number;
  longWindowMin: number;
  observedBurnRate: number;
  threshold: number;
  firedAt: number;
  message: string;
}

export class BurnRateAlertEngine {
  private readonly alerts: BurnRateAlert[] = [];

  constructor(
    private readonly registry: SLORegistry,
    private readonly budget: ErrorBudgetEngine,
  ) {}

  // SRE-style multi-window: fast burn (2% budget in 1h) → page; slow burn (10% in 6h) → ticket.
  evaluate(sloId: string): BurnRateAlert[] {
    const slo = this.registry.get(sloId);
    if (!slo) return [];
    const fired: BurnRateAlert[] = [];
    const short = this._windowBurnRate(sloId, 60 * 60 * 1000);  // 1h
    const long = this._windowBurnRate(sloId, 6 * 60 * 60 * 1000); // 6h
    const windowHours = slo.windowDays * 24;

    // Page: burning at ≥ 14.4x (2% of 30d budget in 1h)
    const pageThreshold = windowHours / 50;
    // Ticket: burning at ≥ 6x (10% of 30d budget in 6h)
    const ticketThreshold = windowHours / 120;

    if (short > pageThreshold && long > pageThreshold / 3) {
      fired.push(this._fire(sloId, "page", 60, 360, short, pageThreshold));
    } else if (long > ticketThreshold) {
      fired.push(this._fire(sloId, "ticket", 60, 360, long, ticketThreshold));
    }
    return fired;
  }

  evaluateAll(): BurnRateAlert[] {
    const all: BurnRateAlert[] = [];
    for (const slo of this.registry.list()) {
      all.push(...this.evaluate(slo.id));
    }
    return all;
  }

  recent(limit = 50): BurnRateAlert[] {
    return this.alerts.slice(-limit).reverse();
  }

  private _windowBurnRate(sloId: string, windowMs: number): number {
    const slo = this.registry.get(sloId);
    if (!slo) return 0;
    const since = Date.now() - windowMs;
    const obs = (this.budget as unknown as { observations: Observation[] }).observations
      .filter((o) => o.sloId === sloId && o.at >= since);
    if (obs.length === 0) return 0;
    const good = obs.reduce((s, o) => s + o.good, 0);
    const total = obs.reduce((s, o) => s + o.total, 0);
    const badFrac = total > 0 ? 1 - good / total : 0;
    const allowedBad = Math.max(1e-9, 1 - slo.target);
    return badFrac / allowedBad;
  }

  private _fire(
    sloId: string,
    severity: BurnSeverity,
    shortWindowMin: number,
    longWindowMin: number,
    observed: number,
    threshold: number,
  ): BurnRateAlert {
    const alert: BurnRateAlert = {
      id: `bra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      sloId,
      severity,
      shortWindowMin,
      longWindowMin,
      observedBurnRate: observed,
      threshold,
      firedAt: Date.now(),
      message: `[${severity.toUpperCase()}] SLO ${sloId} burning at ${observed.toFixed(2)}x (threshold ${threshold.toFixed(2)}x)`,
    };
    this.alerts.push(alert);
    if (this.alerts.length > 1000) this.alerts.splice(0, this.alerts.length - 1000);
    logger.warn({ alert }, "[BurnRate] Alert fired");
    return alert;
  }
}

// ── Dashboards ─────────────────────────────────────────────────────────────

export type WidgetKind = "slo_summary" | "metric_line" | "metric_bar" | "alert_feed" | "text" | "table";

export interface DashboardWidget {
  id: string;
  kind: WidgetKind;
  title: string;
  config: Record<string, unknown>;
  position: { row: number; col: number; w: number; h: number };
}

export interface Dashboard {
  id: string;
  name: string;
  description: string;
  widgets: DashboardWidget[];
  createdAt: number;
  updatedAt: number;
}

export class DashboardBuilder {
  private readonly dashboards = new Map<string, Dashboard>();

  create(params: { name: string; description?: string }): Dashboard {
    const id = `dash_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const dash: Dashboard = {
      id,
      name: params.name,
      description: params.description ?? "",
      widgets: [],
      createdAt: now,
      updatedAt: now,
    };
    this.dashboards.set(id, dash);
    return dash;
  }

  addWidget(dashId: string, widget: Omit<DashboardWidget, "id">): DashboardWidget | null {
    const dash = this.dashboards.get(dashId);
    if (!dash) return null;
    const w: DashboardWidget = { id: `wgt_${Math.random().toString(36).slice(2, 8)}`, ...widget };
    dash.widgets.push(w);
    dash.updatedAt = Date.now();
    return w;
  }

  removeWidget(dashId: string, widgetId: string): boolean {
    const dash = this.dashboards.get(dashId);
    if (!dash) return false;
    const before = dash.widgets.length;
    dash.widgets = dash.widgets.filter((w) => w.id !== widgetId);
    dash.updatedAt = Date.now();
    return dash.widgets.length < before;
  }

  get(id: string): Dashboard | null {
    return this.dashboards.get(id) ?? null;
  }

  list(): Dashboard[] {
    return Array.from(this.dashboards.values());
  }

  delete(id: string): boolean {
    return this.dashboards.delete(id);
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const sloRegistry = new SLORegistry();
export const errorBudgetEngine = new ErrorBudgetEngine(sloRegistry);
export const burnRateAlertEngine = new BurnRateAlertEngine(sloRegistry, errorBudgetEngine);
export const dashboardBuilder = new DashboardBuilder();
