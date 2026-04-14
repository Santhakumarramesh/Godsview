/**
 * routes/disaster_recovery.ts — Phase 66 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  backupManager,
  restoreEngine,
  rpoTracker,
  rtoSimulator,
  type BackupKind,
  type DrillResult,
} from "../lib/disaster_recovery";

const router = Router();

// ── Backups ────────────────────────────────────────────────────────────────

router.post("/api/dr/backups", (req: Request, res: Response) => {
  const { workload, kind, retentionDays, parentBackupId, metadata } = req.body ?? {};
  if (!workload || !kind) return res.status(400).json({ error: "Missing workload or kind" });
  return res.status(201).json(backupManager.start({
    workload: String(workload),
    kind: kind as BackupKind,
    retentionDays,
    parentBackupId,
    metadata,
  }));
});

router.post("/api/dr/backups/:id/complete", (req: Request, res: Response) => {
  const { sizeBytes, content } = req.body ?? {};
  if (sizeBytes === undefined || content === undefined) {
    return res.status(400).json({ error: "Missing sizeBytes or content" });
  }
  const b = backupManager.complete(String(req.params.id), Number(sizeBytes), String(content));
  if (!b) return res.status(404).json({ error: "Not found" });
  return res.json(b);
});

router.post("/api/dr/backups/:id/fail", (req: Request, res: Response) => {
  const { reason } = req.body ?? {};
  const b = backupManager.fail(String(req.params.id), String(reason ?? "unspecified"));
  if (!b) return res.status(404).json({ error: "Not found" });
  return res.json(b);
});

router.post("/api/dr/backups/:id/verify", (req: Request, res: Response) => {
  const { content } = req.body ?? {};
  if (content === undefined) return res.status(400).json({ error: "Missing content" });
  const b = backupManager.verify(String(req.params.id), String(content));
  if (!b) return res.status(404).json({ error: "Not found" });
  return res.json(b);
});

router.get("/api/dr/backups", (req: Request, res: Response) => {
  const workload = req.query.workload ? String(req.query.workload) : undefined;
  res.json({ backups: backupManager.list(workload) });
});

router.post("/api/dr/backups/expire", (_req: Request, res: Response) => {
  res.json(backupManager.expire());
});

// ── Restores ───────────────────────────────────────────────────────────────

router.post("/api/dr/restores", (req: Request, res: Response) => {
  const { backupId, target } = req.body ?? {};
  if (!backupId || !target) return res.status(400).json({ error: "Missing backupId or target" });
  const job = restoreEngine.start(String(backupId), String(target));
  if (!job) return res.status(404).json({ error: "Backup not found" });
  return res.status(201).json(job);
});

router.post("/api/dr/restores/:id/progress", (req: Request, res: Response) => {
  const { bytesRestored } = req.body ?? {};
  const job = restoreEngine.progress(String(req.params.id), Number(bytesRestored ?? 0));
  if (!job) return res.status(404).json({ error: "Not found" });
  return res.json(job);
});

router.post("/api/dr/restores/:id/complete", (req: Request, res: Response) => {
  const { content } = req.body ?? {};
  if (content === undefined) return res.status(400).json({ error: "Missing content" });
  const job = restoreEngine.complete(String(req.params.id), String(content));
  if (!job) return res.status(404).json({ error: "Not found" });
  return res.json(job);
});

router.get("/api/dr/restores", (_req: Request, res: Response) => {
  res.json({ restores: restoreEngine.list() });
});

// ── RPO / RTO ──────────────────────────────────────────────────────────────

router.post("/api/dr/rpo-policies", (req: Request, res: Response) => {
  const { workload, maxDataLossMinutes, maxRecoveryMinutes } = req.body ?? {};
  if (!workload || maxDataLossMinutes === undefined || maxRecoveryMinutes === undefined) {
    return res.status(400).json({ error: "Missing workload, maxDataLossMinutes, or maxRecoveryMinutes" });
  }
  rpoTracker.setPolicy({
    workload: String(workload),
    maxDataLossMinutes: Number(maxDataLossMinutes),
    maxRecoveryMinutes: Number(maxRecoveryMinutes),
  });
  return res.json({ ok: true });
});

router.get("/api/dr/rpo-status", (req: Request, res: Response) => {
  const workload = req.query.workload ? String(req.query.workload) : undefined;
  if (workload) {
    const status = rpoTracker.status(workload);
    if (!status) return res.status(404).json({ error: "No policy for workload" });
    return res.json(status);
  }
  return res.json({ statuses: rpoTracker.statusAll() });
});

// ── Drills ─────────────────────────────────────────────────────────────────

router.post("/api/dr/drills", (req: Request, res: Response) => {
  const { workload, scenario, actualRecoveryMinutes, findings } = req.body ?? {};
  if (!workload || !scenario || actualRecoveryMinutes === undefined) {
    return res.status(400).json({ error: "Missing workload, scenario, or actualRecoveryMinutes" });
  }
  return res.status(201).json(rtoSimulator.simulate({
    workload: String(workload),
    scenario: scenario as DrillResult["scenario"],
    actualRecoveryMinutes: Number(actualRecoveryMinutes),
    findings,
  }));
});

router.get("/api/dr/drills", (_req: Request, res: Response) => {
  res.json({ drills: rtoSimulator.list() });
});

export default router;
