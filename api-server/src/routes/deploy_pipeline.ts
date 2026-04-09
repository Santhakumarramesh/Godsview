import { Router, Request, Response } from "express";
import { deployController } from "../lib/deploy_pipeline";

const router = Router();

// POST /deploy-pipeline/releases - Create new release
router.post("/releases", (req: Request, res: Response) => {
  const { version, tag, created_by, changelog, environment } = req.body;
  if (!version || !tag || !created_by || !changelog || !environment) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = deployController.createRelease(version, tag, created_by, changelog, environment);
  res.status(result.success ? 201 : 400).json(result);
});

// GET /deploy-pipeline/releases - Get all releases
router.get("/releases", (_req: Request, res: Response) => {
  const result = deployController.getAllReleases();
  res.status(200).json(result);
});

// GET /deploy-pipeline/releases/:id - Get single release
router.get("/releases/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = deployController.getRelease(id);
  res.status(result.success ? 200 : 404).json(result);
});

// GET /deploy-pipeline/releases/version/:version - Get release by version
router.get("/releases/version/:version", (req: Request, res: Response) => {
  const { version } = req.params;
  const result = deployController.getReleaseByVersion(version);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /deploy-pipeline/releases/:id/stage - Stage release
router.post("/releases/:id/stage", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = deployController.stageRelease(id);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /deploy-pipeline/releases/:id/deploy - Deploy release
router.post("/releases/:id/deploy", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = deployController.deployRelease(id);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /deploy-pipeline/releases/:id/gate - Update deploy gate
router.post("/releases/:id/gate", (req: Request, res: Response) => {
  const { id } = req.params;
  const { gate_name, passed, details } = req.body;
  if (!gate_name) {
    return res.status(400).json({ success: false, error: "Missing gate_name" });
  }
  const result = deployController.updateGate(id, gate_name, passed, details);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /deploy-pipeline/releases/:id/rollback - Rollback release
router.post("/releases/:id/rollback", (req: Request, res: Response) => {
  const { id } = req.params;
  const { to_version, reason, initiated_by } = req.body;
  if (!to_version || !reason || !initiated_by) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = deployController.rollbackRelease(id, to_version, reason, initiated_by);
  res.status(result.success ? 200 : 400).json(result);
});

// GET /deploy-pipeline/releases/:id/rollback-history - Get rollback history
router.get("/releases/:id/rollback-history", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = deployController.getRollbackHistory(id);
  res.status(200).json(result);
});

// POST /deploy-pipeline/environments/:env/lock - Lock environment
router.post("/environments/:env/lock", (req: Request, res: Response) => {
  const { env } = req.params;
  const { locked_by, reason } = req.body;
  if (!locked_by || !reason) {
    return res.status(400).json({ success: false, error: "Missing locked_by or reason" });
  }
  const result = deployController.lockEnvironment(env as any, locked_by, reason);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /deploy-pipeline/environments/:env/unlock - Unlock environment
router.post("/environments/:env/unlock", (req: Request, res: Response) => {
  const { env } = req.params;
  const result = deployController.unlockEnvironment(env as any);
  res.status(result.success ? 200 : 400).json(result);
});

// GET /deploy-pipeline/environments - Get all environments
router.get("/environments", (_req: Request, res: Response) => {
  const result = deployController.getAllEnvironments();
  res.status(200).json(result);
});

// GET /deploy-pipeline/environments/:env - Get single environment
router.get("/environments/:env", (req: Request, res: Response) => {
  const { env } = req.params;
  const result = deployController.getEnvironment(env as any);
  res.status(result.success ? 200 : 404).json(result);
});

export default router;
