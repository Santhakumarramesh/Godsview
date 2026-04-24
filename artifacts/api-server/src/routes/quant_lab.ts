import { Router, type Request, type Response } from "express";
import {
  runLabExperiment,
  getExperiment,
  getRecentExperiments,
  getStrategy,
  getAllStrategies,
  getLabSummary,
  parseStrategyPrompt,
} from "../lib/quant_lab_engine";

const router = Router();

// POST /run — submit a natural-language strategy prompt → parse + backtest + grade
router.post("/run", (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required (string)" });
      return;
    }
    const experiment = runLabExperiment(prompt);
    res.json({ ok: true, experiment });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// POST /parse — parse a prompt into a StrategySpec without running backtest
router.post("/parse", (req: Request, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "prompt is required (string)" });
      return;
    }
    const spec = parseStrategyPrompt(prompt);
    res.json({ ok: true, strategy: spec });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// GET /experiments — list recent experiments
router.get("/experiments", (_req: Request, res: Response) => {
  try {
    const limit = parseInt((_req.query.limit as string) || "20", 10);
    const experiments = getRecentExperiments(limit);
    res.json({ ok: true, count: experiments.length, experiments });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// GET /experiment/:id — single experiment detail
router.get("/experiment/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const experiment = getExperiment(id);
    if (!experiment) { res.status(404).json({ error: "experiment not found" }); return; }
    res.json({ ok: true, experiment });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// GET /strategies — list all parsed strategies
router.get("/strategies", (_req: Request, res: Response) => {
  try {
    const strategies = getAllStrategies();
    res.json({ ok: true, count: strategies.length, strategies });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// GET /strategy/:id — single strategy detail
router.get("/strategy/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const strategy = getStrategy(id);
    if (!strategy) { res.status(404).json({ error: "strategy not found" }); return; }
    res.json({ ok: true, strategy });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// GET /summary — lab-wide summary stats
router.get("/summary", (_req: Request, res: Response) => {
  try {
    const summary = getLabSummary();
    res.json({ ok: true, summary });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// GET /health — quant lab health check
router.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "quant-lab-engine", status: "operational", ts: new Date().toISOString() });
});

export default router;
