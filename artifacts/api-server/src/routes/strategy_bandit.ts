/**
 * routes/strategy_bandit.ts — Phase 83 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  abTestRegistry,
  significanceTester,
  selectArm,
  type ABTest,
} from "../lib/strategy_bandit";

const router = Router();

router.post("/api/bandit/tests", (req: Request, res: Response) => {
  const { name, description, arms, policy, policyParams } = req.body ?? {};
  if (!name || !Array.isArray(arms) || arms.length < 2) {
    return res.status(400).json({ error: "Missing name or at least 2 arms" });
  }
  return res.status(201).json(abTestRegistry.create({
    name: String(name),
    description,
    arms,
    policy: policy as ABTest["policy"] | undefined,
    policyParams,
  }));
});

router.get("/api/bandit/tests", (_req: Request, res: Response) => {
  res.json({ tests: abTestRegistry.list() });
});

router.get("/api/bandit/tests/:id", (req: Request, res: Response) => {
  const t = abTestRegistry.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  return res.json(t);
});

router.post("/api/bandit/tests/:id/start", (req: Request, res: Response) => {
  const t = abTestRegistry.start(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  return res.json(t);
});

router.post("/api/bandit/tests/:id/pause", (req: Request, res: Response) => {
  const t = abTestRegistry.pause(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  return res.json(t);
});

router.post("/api/bandit/tests/:id/conclude", (req: Request, res: Response) => {
  const { winnerArmId } = req.body ?? {};
  const t = abTestRegistry.conclude(String(req.params.id), winnerArmId);
  if (!t) return res.status(404).json({ error: "Not found" });
  return res.json(t);
});

router.post("/api/bandit/tests/:id/select", (req: Request, res: Response) => {
  const t = abTestRegistry.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.status !== "running") return res.status(409).json({ error: "Test not running" });
  const arm = selectArm(t);
  if (!arm) return res.status(404).json({ error: "No arms" });
  return res.json({ arm });
});

router.post("/api/bandit/tests/:id/trial", (req: Request, res: Response) => {
  const { armId, reward, success } = req.body ?? {};
  if (!armId || reward === undefined) return res.status(400).json({ error: "Missing armId or reward" });
  const arm = abTestRegistry.recordTrial(
    String(req.params.id),
    String(armId),
    Number(reward),
    Boolean(success),
  );
  if (!arm) return res.status(404).json({ error: "Not found" });
  return res.json(arm);
});

router.post("/api/bandit/tests/:id/significance", (req: Request, res: Response) => {
  const t = abTestRegistry.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: "Not found" });
  const { controlArmId, treatmentArmId, alpha } = req.body ?? {};
  const control = t.arms.find((a) => a.id === controlArmId);
  const treatment = t.arms.find((a) => a.id === treatmentArmId);
  if (!control || !treatment) return res.status(400).json({ error: "Invalid armIds" });
  return res.json(significanceTester.test(t.id, control, treatment, alpha));
});

export default router;
