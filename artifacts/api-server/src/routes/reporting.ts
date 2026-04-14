/**
 * routes/reporting.ts — Phase 84 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  templateStore,
  reportRenderer,
  reportScheduleEngine,
  reportDistributor,
  type ReportFormat,
  type DeliveryRecord,
} from "../lib/reporting";

const router = Router();

// ── Templates ──────────────────────────────────────────────────────────────

router.post("/api/reports/templates", (req: Request, res: Response) => {
  const { name, description, format, template } = req.body ?? {};
  if (!name || !format || !template) return res.status(400).json({ error: "Missing name, format, or template" });
  return res.status(201).json(templateStore.upsert({
    name: String(name),
    description,
    format: format as ReportFormat,
    template: String(template),
  }));
});

router.get("/api/reports/templates", (_req: Request, res: Response) => {
  res.json({ templates: templateStore.list() });
});

router.get("/api/reports/templates/:id", (req: Request, res: Response) => {
  const t = templateStore.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  return res.json(t);
});

router.delete("/api/reports/templates/:id", (req: Request, res: Response) => {
  const ok = templateStore.delete(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

// ── Render ─────────────────────────────────────────────────────────────────

router.post("/api/reports/render", (req: Request, res: Response) => {
  const { templateId, templateName, data, asHTML, asCSV } = req.body ?? {};
  const tpl = templateId
    ? templateStore.get(String(templateId))
    : templateName ? templateStore.byNameLookup(String(templateName)) : null;
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  const rendered = reportRenderer.render(tpl, data ?? {});
  if (asHTML && rendered.format === "markdown") {
    return res.json({ format: "html", content: reportRenderer.toHTML(rendered.content) });
  }
  if (asCSV && Array.isArray(data?.rows)) {
    return res.json({ format: "csv", content: reportRenderer.toCSV(data.rows) });
  }
  return res.json(rendered);
});

router.post("/api/reports/csv", (req: Request, res: Response) => {
  const { rows } = req.body ?? {};
  if (!Array.isArray(rows)) return res.status(400).json({ error: "Missing rows[]" });
  return res.json({ csv: reportRenderer.toCSV(rows) });
});

// ── Schedules ──────────────────────────────────────────────────────────────

router.post("/api/reports/schedules", (req: Request, res: Response) => {
  const { templateId, cron, recipients } = req.body ?? {};
  if (!templateId || !cron || !Array.isArray(recipients)) {
    return res.status(400).json({ error: "Missing templateId, cron, or recipients[]" });
  }
  return res.status(201).json(reportScheduleEngine.create({
    templateId: String(templateId),
    cron: String(cron),
    recipients,
  }));
});

router.get("/api/reports/schedules", (_req: Request, res: Response) => {
  res.json({ schedules: reportScheduleEngine.list() });
});

router.patch("/api/reports/schedules/:id/enabled", (req: Request, res: Response) => {
  const { enabled } = req.body ?? {};
  if (enabled === undefined) return res.status(400).json({ error: "Missing enabled" });
  const s = reportScheduleEngine.setEnabled(String(req.params.id), Boolean(enabled));
  if (!s) return res.status(404).json({ error: "Not found" });
  return res.json(s);
});

router.delete("/api/reports/schedules/:id", (req: Request, res: Response) => {
  const ok = reportScheduleEngine.delete(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

// ── Deliveries ────────────────────────────────────────────────────────────

router.post("/api/reports/deliveries", (req: Request, res: Response) => {
  const { reportId, templateId, recipient, channel, bytes, status, error } = req.body ?? {};
  if (!reportId || !templateId || !recipient || !channel || bytes === undefined || !status) {
    return res.status(400).json({ error: "Missing delivery fields" });
  }
  return res.status(201).json(reportDistributor.recordDelivery({
    reportId: String(reportId),
    templateId: String(templateId),
    recipient: String(recipient),
    channel: channel as DeliveryRecord["channel"],
    bytes: Number(bytes),
    status: status as DeliveryRecord["status"],
    error,
  }));
});

router.get("/api/reports/deliveries", (_req: Request, res: Response) => {
  res.json({ deliveries: reportDistributor.recent(200) });
});

export default router;
