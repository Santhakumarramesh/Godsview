/**
 * routes/workflow_engine.ts — Phase 75 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  workflowStore,
  workflowRunner,
  scheduleEngine,
  type WorkflowRun,
} from "../lib/workflow_engine";

const router = Router();

// ── Definitions ────────────────────────────────────────────────────────────

router.post("/api/workflows", (req: Request, res: Response) => {
  const { name, description, tasks, schedule } = req.body ?? {};
  if (!name || !Array.isArray(tasks)) return res.status(400).json({ error: "Missing name or tasks[]" });
  try {
    const def = workflowStore.upsert({
      name: String(name),
      description: String(description ?? ""),
      tasks,
      schedule,
    });
    return res.status(201).json(def);
  } catch (err) {
    return res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/api/workflows", (_req: Request, res: Response) => {
  res.json({ workflows: workflowStore.list() });
});

router.get("/api/workflows/:id", (req: Request, res: Response) => {
  const def = workflowStore.get(String(req.params.id));
  if (!def) return res.status(404).json({ error: "Not found" });
  return res.json({
    definition: def,
    topoOrder: workflowStore.topoOrder(def),
  });
});

// ── Runs ───────────────────────────────────────────────────────────────────

router.post("/api/workflows/:id/run", async (req: Request, res: Response) => {
  const { trigger, context } = req.body ?? {};
  try {
    const run = await workflowRunner.start(
      String(req.params.id),
      (trigger as WorkflowRun["trigger"]) ?? "manual",
      context ?? {},
    );
    // Convert Map to plain object for JSON.
    return res.status(201).json({
      ...run,
      taskRuns: Object.fromEntries(run.taskRuns),
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.post("/api/workflows/runs/:id/cancel", (req: Request, res: Response) => {
  const run = workflowRunner.cancel(String(req.params.id));
  if (!run) return res.status(404).json({ error: "Not found" });
  return res.json({ ...run, taskRuns: Object.fromEntries(run.taskRuns) });
});

router.get("/api/workflows/runs", (req: Request, res: Response) => {
  const definitionId = req.query.definitionId ? String(req.query.definitionId) : undefined;
  const runs = workflowRunner.list(definitionId).map((r) => ({
    ...r,
    taskRuns: Object.fromEntries(r.taskRuns),
  }));
  res.json({ runs });
});

router.get("/api/workflows/runs/:id", (req: Request, res: Response) => {
  const run = workflowRunner.get(String(req.params.id));
  if (!run) return res.status(404).json({ error: "Not found" });
  return res.json({ ...run, taskRuns: Object.fromEntries(run.taskRuns) });
});

// ── Schedule ───────────────────────────────────────────────────────────────

router.post("/api/workflows/schedule/check", (req: Request, res: Response) => {
  const { cron, at } = req.body ?? {};
  if (!cron) return res.status(400).json({ error: "Missing cron" });
  return res.json({
    shouldRun: scheduleEngine.shouldRun(String(cron), at ? new Date(at) : new Date()),
  });
});

export default router;
