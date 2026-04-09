import { Router, Request, Response } from "express";
import {
  registerSubsystem,
  updateSubsystemHealth,
  getSubsystem,
  getAllSubsystems,
  generateManifest,
  setConfig,
  getConfig,
  getAllConfig,
  deleteConfig,
  getDependencyGraph,
  checkDependencyHealth,
  SubsystemEntry,
  HealthStatus,
} from "../lib/system_manifest";

const router = Router();

// POST /api/manifest/subsystems
router.post("/subsystems", (req: Request<{}, {}, Omit<SubsystemEntry, "id">>, res: Response) => {
  try {
    const subsystem = registerSubsystem(req.body);
    res.status(201).json({ success: true, data: subsystem });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: msg });
  }
});

// PATCH /api/manifest/subsystems/:id/health
router.patch("/subsystems/:id/health", (req: Request<{ id: string }, {}, { health: HealthStatus; status?: string }>, res: Response) => {
  try {
    const result = updateSubsystemHealth(req.params.id, req.body.health, req.body.status);
    if (result.success) {
      const sub = getSubsystem(req.params.id);
      res.json({ success: true, data: sub });
    } else {
      res.status(404).json({ success: false, error: result.error });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/manifest/subsystems/:id
router.get("/subsystems/:id", (req: Request, res: Response) => {
  try {
    const subsystem = getSubsystem(req.params.id);
    if (subsystem) {
      res.json({ success: true, data: subsystem });
    } else {
      res.status(404).json({ success: false, error: "Subsystem not found" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/manifest/subsystems
router.get("/subsystems", (req: Request, res: Response) => {
  try {
    const subsystems = getAllSubsystems();
    res.json({ success: true, data: subsystems });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/manifest
router.get("/", (req: Request, res: Response) => {
  try {
    const manifest = generateManifest();
    res.json({ success: true, data: manifest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// POST /api/manifest/config
router.post("/config", (req: Request<{}, {}, { key: string; value: any; category: string; description: string; sensitive?: boolean }>, res: Response) => {
  try {
    const entry = setConfig(req.body.key, req.body.value, {
      category: req.body.category,
      description: req.body.description,
      sensitive: req.body.sensitive,
    });
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: msg });
  }
});

// GET /api/manifest/config/:key
router.get("/config/:key", (req: Request, res: Response) => {
  try {
    const include_sensitive = req.query.sensitive === "true";
    const entry = getConfig(req.params.key, include_sensitive);
    if (entry) {
      res.json({ success: true, data: entry });
    } else {
      res.status(404).json({ success: false, error: "Config not found" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/manifest/config
router.get("/config", (req: Request, res: Response) => {
  try {
    const include_sensitive = req.query.sensitive === "true";
    const entries = getAllConfig(include_sensitive);
    res.json({ success: true, data: entries });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// DELETE /api/manifest/config/:key
router.delete("/config/:key", (req: Request, res: Response) => {
  try {
    const result = deleteConfig(req.params.key);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: result.error });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/manifest/dependencies
router.get("/dependencies", (req: Request, res: Response) => {
  try {
    const graph = getDependencyGraph();
    res.json({ success: true, data: graph });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/manifest/subsystems/:id/dependencies
router.get("/subsystems/:id/dependencies", (req: Request, res: Response) => {
  try {
    const result = checkDependencyHealth(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
