/**
 * routes/feature_flags.ts — Phase 63 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  flagRegistry,
  rolloutController,
  experimentTracker,
  type FlagKind,
  type FlagStatus,
  type Context,
} from "../lib/feature_flags";

const router = Router();

// ── Flags ───────────────────────────────────────────────────────────────────

router.post("/api/flags", (req: Request, res: Response) => {
  const { key, kind, description, defaultValue, percentage, variants } = req.body ?? {};
  if (!key || !kind) return res.status(400).json({ error: "Missing key or kind" });
  const flag = flagRegistry.upsert({
    key: String(key),
    kind: kind as FlagKind,
    description,
    defaultValue,
    percentage,
    variants,
  });
  return res.status(201).json(flag);
});

router.get("/api/flags", (_req: Request, res: Response) => {
  res.json({ flags: flagRegistry.list() });
});

router.get("/api/flags/:key", (req: Request, res: Response) => {
  const flag = flagRegistry.get(String(req.params.key));
  if (!flag) return res.status(404).json({ error: "Not found" });
  return res.json(flag);
});

router.patch("/api/flags/:key/status", (req: Request, res: Response) => {
  const { status } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const flag = flagRegistry.setStatus(String(req.params.key), status as FlagStatus);
  if (!flag) return res.status(404).json({ error: "Not found" });
  return res.json(flag);
});

router.patch("/api/flags/:key/percentage", (req: Request, res: Response) => {
  const { percentage } = req.body ?? {};
  if (percentage === undefined) return res.status(400).json({ error: "Missing percentage" });
  const flag = flagRegistry.setPercentage(String(req.params.key), Number(percentage));
  if (!flag) return res.status(404).json({ error: "Not found" });
  return res.json(flag);
});

router.post("/api/flags/:key/rules", (req: Request, res: Response) => {
  const flag = flagRegistry.addRule(String(req.params.key), req.body);
  if (!flag) return res.status(404).json({ error: "Not found" });
  return res.status(201).json(flag);
});

router.delete("/api/flags/:key/rules", (req: Request, res: Response) => {
  const flag = flagRegistry.clearRules(String(req.params.key));
  if (!flag) return res.status(404).json({ error: "Not found" });
  return res.json(flag);
});

router.post("/api/flags/:key/evaluate", (req: Request, res: Response) => {
  const ctx: Context = req.body ?? {};
  res.json(rolloutController.evaluate(String(req.params.key), ctx));
});

// ── Experiments ───────────────────────────────────────────────────────────

router.post("/api/experiments", (req: Request, res: Response) => {
  const { flagKey, name, variants } = req.body ?? {};
  if (!flagKey || !name || !Array.isArray(variants)) {
    return res.status(400).json({ error: "Missing flagKey, name, or variants[]" });
  }
  return res.status(201).json(experimentTracker.start({ flagKey, name, variants }));
});

router.get("/api/experiments", (_req: Request, res: Response) => {
  res.json({ experiments: experimentTracker.list() });
});

router.post("/api/experiments/:id/expose", (req: Request, res: Response) => {
  const { variant } = req.body ?? {};
  experimentTracker.expose(String(req.params.id), String(variant));
  res.json({ ok: true });
});

router.post("/api/experiments/:id/convert", (req: Request, res: Response) => {
  const { variant } = req.body ?? {};
  experimentTracker.convert(String(req.params.id), String(variant));
  res.json({ ok: true });
});

router.post("/api/experiments/:id/stop", (req: Request, res: Response) => {
  const e = experimentTracker.stop(String(req.params.id));
  if (!e) return res.status(404).json({ error: "Not found" });
  return res.json(e);
});

export default router;
