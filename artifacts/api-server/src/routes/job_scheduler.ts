/**
 * routes/job_scheduler.ts — Phase 80 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  jobQueue,
  jobWorker,
  cronScheduler,
  jobMetrics,
  type JobPriority,
  type JobStatus,
} from "../lib/job_scheduler";

const router = Router();

// ── Jobs ───────────────────────────────────────────────────────────────────

router.post("/api/jobs", (req: Request, res: Response) => {
  const { handler, payload, priority, delayMs, maxAttempts } = req.body ?? {};
  if (!handler) return res.status(400).json({ error: "Missing handler" });
  return res.status(201).json(jobQueue.enqueue({
    handler: String(handler),
    payload,
    priority: priority as JobPriority | undefined,
    delayMs,
    maxAttempts,
  }));
});

router.get("/api/jobs", (req: Request, res: Response) => {
  res.json({
    jobs: jobQueue.list({
      status: req.query.status ? (String(req.query.status) as JobStatus) : undefined,
      handler: req.query.handler ? String(req.query.handler) : undefined,
    }),
    stats: jobQueue.stats(),
  });
});

router.get("/api/jobs/:id", (req: Request, res: Response) => {
  const j = jobQueue.get(String(req.params.id));
  if (!j) return res.status(404).json({ error: "Not found" });
  return res.json(j);
});

router.post("/api/jobs/:id/retry", (req: Request, res: Response) => {
  const j = jobQueue.retryDeadLetter(String(req.params.id));
  if (!j) return res.status(404).json({ error: "Not in dead-letter" });
  return res.json(j);
});

// ── Worker ────────────────────────────────────────────────────────────────

router.post("/api/jobs/worker/run", async (req: Request, res: Response) => {
  const { workerId } = req.body ?? {};
  const result = await jobWorker.pickAndRun(String(workerId ?? "default"));
  return res.json(result);
});

router.get("/api/jobs/worker/handlers", (_req: Request, res: Response) => {
  res.json({ handlers: jobWorker.registeredHandlers() });
});

// ── Cron Schedules ────────────────────────────────────────────────────────

router.post("/api/jobs/schedules", (req: Request, res: Response) => {
  const { cron, handler, payload, priority } = req.body ?? {};
  if (!cron || !handler) return res.status(400).json({ error: "Missing cron or handler" });
  return res.status(201).json(cronScheduler.schedule({
    cron: String(cron),
    handler: String(handler),
    payload,
    priority: priority as JobPriority | undefined,
  }));
});

router.patch("/api/jobs/schedules/:id/enabled", (req: Request, res: Response) => {
  const { enabled } = req.body ?? {};
  if (enabled === undefined) return res.status(400).json({ error: "Missing enabled" });
  const s = cronScheduler.setEnabled(String(req.params.id), Boolean(enabled));
  if (!s) return res.status(404).json({ error: "Not found" });
  return res.json(s);
});

router.delete("/api/jobs/schedules/:id", (req: Request, res: Response) => {
  const ok = cronScheduler.delete(String(req.params.id));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.get("/api/jobs/schedules", (_req: Request, res: Response) => {
  res.json({ schedules: cronScheduler.list() });
});

router.post("/api/jobs/schedules/tick", (_req: Request, res: Response) => {
  res.json({ fired: cronScheduler.tick() });
});

// ── Metrics ───────────────────────────────────────────────────────────────

router.get("/api/jobs/metrics", (_req: Request, res: Response) => {
  res.json({ stats: jobMetrics.list() });
});

export default router;
