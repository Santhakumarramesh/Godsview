import { Router, Request, Response } from "express";
import {
  registerEngine,
  setEngineState,
  heartbeat,
  executeCommand,
  getEngine,
  listEngines,
  getSystemHealth,
  getOrchestratorSnapshot,
  resetOrchestrator,
} from "../lib/system_orchestrator.js";

const router = Router();

router.get("/orchestrator/snapshot", (_req: Request, res: Response) => {
  res.json(getOrchestratorSnapshot());
});

router.get("/orchestrator/health", (_req: Request, res: Response) => {
  res.json(getSystemHealth());
});

router.get("/orchestrator/engines", (_req: Request, res: Response) => {
  res.json(listEngines());
});

router.get("/orchestrator/engine/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const eng = getEngine(id);
  if (!eng) { res.status(404).json({ error: "Engine not found" }); return; }
  res.json(eng);
});

router.post("/orchestrator/register", (req: Request, res: Response) => {
  try {
    const eng = registerEngine(req.body);
    res.json(eng);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/orchestrator/state", (req: Request, res: Response) => {
  try {
    const { engineId, state, error } = req.body;
    const eng = setEngineState(engineId, state, error);
    res.json(eng);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/orchestrator/heartbeat", (req: Request, res: Response) => {
  try {
    const eng = heartbeat(req.body.engineId);
    res.json(eng);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/orchestrator/command", (req: Request, res: Response) => {
  try {
    const { engineId, command } = req.body;
    const result = executeCommand(engineId, command);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/orchestrator/reset", (_req: Request, res: Response) => {
  resetOrchestrator();
  res.json({ status: "orchestrator_reset" });
});

export default router;
