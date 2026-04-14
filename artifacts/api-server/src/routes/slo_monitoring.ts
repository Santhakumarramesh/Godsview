/**
 * routes/slo_monitoring.ts — Phase 61 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  sloRegistry,
  errorBudgetEngine,
  burnRateAlertEngine,
  dashboardBuilder,
  type SLOKind,
  type WidgetKind,
} from "../lib/slo_monitoring";

const router = Router();

// ── SLOs ────────────────────────────────────────────────────────────────────

router.post("/api/slo", (req: Request, res: Response) => {
  const { name, kind, target, windowDays, service, description } = req.body ?? {};
  if (!name || !kind || target === undefined || !windowDays || !service) {
    return res.status(400).json({ error: "Missing name, kind, target, windowDays, or service" });
  }
  const slo = sloRegistry.register({
    name: String(name),
    kind: kind as SLOKind,
    target: Number(target),
    windowDays: Number(windowDays),
    service: String(service),
    description: String(description ?? ""),
  });
  return res.status(201).json(slo);
});

router.get("/api/slo", (req: Request, res: Response) => {
  const service = req.query.service ? String(req.query.service) : undefined;
  res.json({ slos: service ? sloRegistry.byService(service) : sloRegistry.list() });
});

router.get("/api/slo/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const slo = sloRegistry.get(id);
  if (!slo) return res.status(404).json({ error: "Not found" });
  const budget = errorBudgetEngine.report(id);
  return res.json({ slo, budget });
});

router.post("/api/slo/:id/observe", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { good, total } = req.body ?? {};
  if (good === undefined || total === undefined) return res.status(400).json({ error: "Missing good or total" });
  errorBudgetEngine.observe(id, Number(good), Number(total));
  return res.json({ ok: true, report: errorBudgetEngine.report(id) });
});

// ── Error Budget ───────────────────────────────────────────────────────────

router.get("/api/slo/budget/all", (_req: Request, res: Response) => {
  res.json({ reports: errorBudgetEngine.reportAll() });
});

// ── Burn-Rate Alerts ──────────────────────────────────────────────────────

router.post("/api/slo/burn-rate/evaluate", (_req: Request, res: Response) => {
  const fired = burnRateAlertEngine.evaluateAll();
  res.json({ fired });
});

router.get("/api/slo/burn-rate/alerts", (_req: Request, res: Response) => {
  res.json({ alerts: burnRateAlertEngine.recent(100) });
});

// ── Dashboards ─────────────────────────────────────────────────────────────

router.post("/api/dashboards", (req: Request, res: Response) => {
  const { name, description } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  return res.status(201).json(dashboardBuilder.create({ name: String(name), description }));
});

router.get("/api/dashboards", (_req: Request, res: Response) => {
  res.json({ dashboards: dashboardBuilder.list() });
});

router.get("/api/dashboards/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const d = dashboardBuilder.get(id);
  if (!d) return res.status(404).json({ error: "Not found" });
  return res.json(d);
});

router.post("/api/dashboards/:id/widgets", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { kind, title, config, position } = req.body ?? {};
  if (!kind || !title || !position) return res.status(400).json({ error: "Missing kind, title, or position" });
  const widget = dashboardBuilder.addWidget(id, {
    kind: kind as WidgetKind,
    title: String(title),
    config: config ?? {},
    position,
  });
  if (!widget) return res.status(404).json({ error: "Dashboard not found" });
  return res.status(201).json(widget);
});

router.delete("/api/dashboards/:id/widgets/:widgetId", (req: Request, res: Response) => {
  const ok = dashboardBuilder.removeWidget(String(req.params.id), String(req.params.widgetId));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

export default router;
