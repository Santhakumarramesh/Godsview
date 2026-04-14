/**
 * routes/cost_observability.ts — Phase 67 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  costMeter,
  costAllocator,
  budgetManager,
  costForecaster,
  type CostDimension,
  type CostResource,
  type BudgetPeriod,
} from "../lib/cost_observability";

const router = Router();

router.post("/api/cost/events", (req: Request, res: Response) => {
  const { resource, amountUSD, dimensions, description } = req.body ?? {};
  if (!resource || amountUSD === undefined) {
    return res.status(400).json({ error: "Missing resource or amountUSD" });
  }
  return res.status(201).json(costMeter.record({
    resource: resource as CostResource,
    amountUSD: Number(amountUSD),
    dimensions: dimensions ?? {},
    description: String(description ?? ""),
  }));
});

router.get("/api/cost/events", (req: Request, res: Response) => {
  const events = costMeter.query({
    since: req.query.since ? Number(req.query.since) : undefined,
    until: req.query.until ? Number(req.query.until) : undefined,
    resource: req.query.resource ? (String(req.query.resource) as CostResource) : undefined,
    dimension: req.query.dimension ? (String(req.query.dimension) as CostDimension) : undefined,
    dimensionValue: req.query.dimensionValue ? String(req.query.dimensionValue) : undefined,
  });
  res.json({ events, count: events.length, total: events.reduce((s, e) => s + e.amountUSD, 0) });
});

router.get("/api/cost/allocation/:dimension", (req: Request, res: Response) => {
  const dim = String(req.params.dimension) as CostDimension;
  const since = req.query.since ? Number(req.query.since) : undefined;
  res.json({ rows: costAllocator.byDimension(dim, since) });
});

router.get("/api/cost/allocation/resource/all", (req: Request, res: Response) => {
  const since = req.query.since ? Number(req.query.since) : undefined;
  res.json({ rows: costAllocator.byResource(since) });
});

router.get("/api/cost/top/:dimension", (req: Request, res: Response) => {
  const dim = String(req.params.dimension) as CostDimension;
  const n = req.query.n ? Number(req.query.n) : 10;
  const since = req.query.since ? Number(req.query.since) : undefined;
  res.json({ rows: costAllocator.topN(dim, n, since) });
});

// ── Budgets ────────────────────────────────────────────────────────────────

router.post("/api/cost/budgets", (req: Request, res: Response) => {
  const { name, amountUSD, period, dimension, dimensionValue, alertThresholdPct } = req.body ?? {};
  if (!name || amountUSD === undefined || !period) {
    return res.status(400).json({ error: "Missing name, amountUSD, or period" });
  }
  return res.status(201).json(budgetManager.create({
    name: String(name),
    amountUSD: Number(amountUSD),
    period: period as BudgetPeriod,
    dimension: dimension as CostDimension | undefined,
    dimensionValue,
    alertThresholdPct: Number(alertThresholdPct ?? 80),
  }));
});

router.delete("/api/cost/budgets/:id", (req: Request, res: Response) => {
  const ok = budgetManager.disable(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.get("/api/cost/budgets", (_req: Request, res: Response) => {
  res.json({ statuses: budgetManager.statusAll() });
});

router.get("/api/cost/budgets/:id", (req: Request, res: Response) => {
  const status = budgetManager.status(String(req.params.id));
  if (!status) return res.status(404).json({ error: "Not found" });
  return res.json(status);
});

// ── Forecast ──────────────────────────────────────────────────────────────

router.get("/api/cost/forecast", (req: Request, res: Response) => {
  const windowDays = req.query.windowDays ? Number(req.query.windowDays) : 7;
  res.json(costForecaster.forecast(windowDays));
});

export default router;
