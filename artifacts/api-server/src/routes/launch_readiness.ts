/**
 * routes/launch_readiness.ts — Phase 60 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  stagingEnvironmentManager,
  launchChecklistEngine,
  goNoGoEngine,
  launchRehearsalEngine,
  type ChecklistItemStatus,
  type StagingEnvironment,
} from "../lib/launch_readiness";

const router = Router();

// ── Staging ────────────────────────────────────────────────────────────────

router.post("/api/launch/staging", (req: Request, res: Response) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  return res.status(201).json(stagingEnvironmentManager.create(String(name)));
});

router.get("/api/launch/staging", (_req: Request, res: Response) => {
  res.json({ environments: stagingEnvironmentManager.list() });
});

router.post("/api/launch/staging/:id/deploy", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { version } = req.body ?? {};
  if (!version) return res.status(400).json({ error: "Missing version" });
  const env = stagingEnvironmentManager.deploy(id, String(version));
  if (!env) return res.status(404).json({ error: "Not found" });
  return res.json(env);
});

router.post("/api/launch/staging/:id/activate", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { health } = req.body ?? {};
  const env = stagingEnvironmentManager.markActive(id, (health as StagingEnvironment["health"]) ?? "healthy");
  if (!env) return res.status(404).json({ error: "Not found" });
  return res.json(env);
});

router.post("/api/launch/staging/:id/rollback", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const env = stagingEnvironmentManager.rollback(id);
  if (!env) return res.status(404).json({ error: "Not found" });
  return res.json(env);
});

// ── Checklists ─────────────────────────────────────────────────────────────

router.post("/api/launch/checklists", (req: Request, res: Response) => {
  const { name } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  return res.status(201).json(launchChecklistEngine.create(String(name)));
});

router.get("/api/launch/checklists", (_req: Request, res: Response) => {
  res.json({ checklists: launchChecklistEngine.list() });
});

router.get("/api/launch/checklists/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const list = launchChecklistEngine.get(id);
  if (!list) return res.status(404).json({ error: "Not found" });
  return res.json({ checklist: list, summary: launchChecklistEngine.summary(id) });
});

router.patch("/api/launch/checklists/:id/items/:itemId", (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  const { status, notes } = req.body ?? {};
  if (!status) return res.status(400).json({ error: "Missing status" });
  const item = launchChecklistEngine.setItem(
    String(id),
    String(itemId),
    status as ChecklistItemStatus,
    notes,
  );
  if (!item) return res.status(404).json({ error: "Not found" });
  return res.json(item);
});

// ── Go / No-Go ─────────────────────────────────────────────────────────────

router.post("/api/launch/go-no-go", (req: Request, res: Response) => {
  const { checklistId, stagingId, resilienceScore, openIncidents, marketOpen } = req.body ?? {};
  const checklistSummary = checklistId ? launchChecklistEngine.summary(String(checklistId)) : null;
  const staging = stagingId ? stagingEnvironmentManager.get(String(stagingId)) : null;
  const assessment = goNoGoEngine.assess({
    checklistSummary,
    stagingHealth: staging?.health,
    resilienceScore: typeof resilienceScore === "number" ? resilienceScore : undefined,
    openIncidents: typeof openIncidents === "number" ? openIncidents : 0,
    marketOpen: Boolean(marketOpen),
  });
  return res.json(assessment);
});

// ── Rehearsals ─────────────────────────────────────────────────────────────

router.post("/api/launch/rehearsals", (req: Request, res: Response) => {
  const { launchName, scenarios } = req.body ?? {};
  if (!launchName || !Array.isArray(scenarios)) {
    return res.status(400).json({ error: "Missing launchName or scenarios[]" });
  }
  const rehearsal = launchRehearsalEngine.record(String(launchName), scenarios);
  return res.status(201).json(rehearsal);
});

router.get("/api/launch/rehearsals", (_req: Request, res: Response) => {
  res.json({ rehearsals: launchRehearsalEngine.list() });
});

router.get("/api/launch/rehearsals/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const r = launchRehearsalEngine.get(id);
  if (!r) return res.status(404).json({ error: "Not found" });
  return res.json(r);
});

export default router;
