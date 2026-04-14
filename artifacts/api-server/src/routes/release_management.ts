/**
 * routes/release_management.ts — Phase 69 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  versionRegistry,
  canaryController,
  blueGreenManager,
  releaseGate,
  type ReleaseChannel,
  type ReleaseStatus,
} from "../lib/release_management";

const router = Router();

// ── Releases ───────────────────────────────────────────────────────────────

router.post("/api/releases", (req: Request, res: Response) => {
  const { component, version, channel, commitSha, buildId, author, changelog } = req.body ?? {};
  if (!component || !version || !channel || !commitSha || !buildId || !author) {
    return res.status(400).json({ error: "Missing release fields" });
  }
  return res.status(201).json(versionRegistry.register({
    component: String(component),
    version: String(version),
    channel: channel as ReleaseChannel,
    commitSha: String(commitSha),
    buildId: String(buildId),
    author: String(author),
    changelog,
  }));
});

router.get("/api/releases", (req: Request, res: Response) => {
  res.json({
    releases: versionRegistry.list({
      component: req.query.component ? String(req.query.component) : undefined,
      channel: req.query.channel ? (String(req.query.channel) as ReleaseChannel) : undefined,
      status: req.query.status ? (String(req.query.status) as ReleaseStatus) : undefined,
    }),
  });
});

router.get("/api/releases/current/:component", (req: Request, res: Response) => {
  const r = versionRegistry.current(String(req.params.component));
  if (!r) return res.status(404).json({ error: "No stable release" });
  return res.json(r);
});

router.patch("/api/releases/:id/promote", (req: Request, res: Response) => {
  const { status } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const r = versionRegistry.promote(String(req.params.id), status as ReleaseStatus);
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json(r);
});

router.post("/api/releases/:id/rollback", (req: Request, res: Response) => {
  const { reason } = req.body ?? {};
  const r = versionRegistry.rollback(String(req.params.id), String(reason ?? "unspecified"));
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json(r);
});

// ── Canary ─────────────────────────────────────────────────────────────────

router.post("/api/releases/canary", (req: Request, res: Response) => {
  const { releaseId, component, rampSteps } = req.body ?? {};
  if (!releaseId || !component) return res.status(400).json({ error: "Missing releaseId or component" });
  return res.status(201).json(canaryController.start({
    releaseId: String(releaseId),
    component: String(component),
    rampSteps,
  }));
});

router.post("/api/releases/canary/:id/health", (req: Request, res: Response) => {
  const { passed, note } = req.body ?? {};
  const d = canaryController.healthCheck(String(req.params.id), Boolean(passed), String(note ?? ""));
  if (!d) return res.status(404).json({ error: "Not found" });
  return res.json(d);
});

router.post("/api/releases/canary/:id/advance", (req: Request, res: Response) => {
  const d = canaryController.advance(String(req.params.id));
  if (!d) return res.status(404).json({ error: "Not found" });
  return res.json(d);
});

router.post("/api/releases/canary/:id/abort", (req: Request, res: Response) => {
  const d = canaryController.abort(String(req.params.id));
  if (!d) return res.status(404).json({ error: "Not found" });
  return res.json(d);
});

router.get("/api/releases/canary", (_req: Request, res: Response) => {
  res.json({ deployments: canaryController.list() });
});

// ── Blue/Green ────────────────────────────────────────────────────────────

router.post("/api/releases/blue-green/provision", (req: Request, res: Response) => {
  const { component } = req.body ?? {};
  if (!component) return res.status(400).json({ error: "Missing component" });
  return res.status(201).json(blueGreenManager.provision(String(component)));
});

router.post("/api/releases/blue-green/deploy", (req: Request, res: Response) => {
  const { component, releaseId } = req.body ?? {};
  if (!component || !releaseId) return res.status(400).json({ error: "Missing component or releaseId" });
  const pair = blueGreenManager.deploy(String(component), String(releaseId));
  if (!pair) return res.status(404).json({ error: "Pair not provisioned" });
  return res.json(pair);
});

router.post("/api/releases/blue-green/swap", (req: Request, res: Response) => {
  const { component } = req.body ?? {};
  if (!component) return res.status(400).json({ error: "Missing component" });
  const pair = blueGreenManager.swap(String(component));
  if (!pair) return res.status(404).json({ error: "Not found" });
  return res.json(pair);
});

router.get("/api/releases/blue-green", (_req: Request, res: Response) => {
  res.json({ pairs: blueGreenManager.list() });
});

// ── Gate ──────────────────────────────────────────────────────────────────

router.post("/api/releases/gate/evaluate", (req: Request, res: Response) => {
  res.json(releaseGate.evaluate(req.body ?? {}));
});

export default router;
