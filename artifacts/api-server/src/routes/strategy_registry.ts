/**
 * strategy_registry.ts — Strategy Registry API (Phase 50)
 */

import { Router, type Request, type Response } from "express";
import {
  registerStrategy,
  promoteStrategy,
  updateStrategyVersion,
  updateStrategyPerformance,
  getStrategy,
  listStrategies,
  getLiveStrategies,
  getRegistrySnapshot,
  resetRegistry,
  type StrategyState,
} from "../lib/strategy_registry.js";

// In-memory strategy Map for promotion state tracking
interface InMemoryStrategy {
  id: string;
  name: string;
  state: "draft" | "testing" | "live";
  promotedAt?: number;
  winRate?: number;
}

const strategyMap = new Map<string, InMemoryStrategy>();

const router = Router();

// GET /api/strategy-registry/snapshot
router.get("/api/strategy-registry/snapshot", async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, snapshot: getRegistrySnapshot() });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// GET /api/strategy-registry/list
router.get("/api/strategy-registry/list", async (req: Request, res: Response) => {
  try {
    const state = req.query.state ? String(req.query.state) as StrategyState : undefined;
    const tag = req.query.tag ? String(req.query.tag) : undefined;
    const author = req.query.author ? String(req.query.author) : undefined;
    res.json({ ok: true, strategies: listStrategies({ state, tag, author }) });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// GET /api/strategy-registry/live
router.get("/api/strategy-registry/live", async (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, strategies: getLiveStrategies() });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// GET /api/strategy-registry/:id
router.get("/api/strategy-registry/:id", async (req: Request, res: Response) => {
  try {
    const entry = getStrategy(String(req.params.id));
    if (!entry) { res.status(404).json({ ok: false, error: "Strategy not found" }); return; }
    res.json({ ok: true, strategy: entry });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/strategy-registry/register
router.post("/api/strategy-registry/register", async (req: Request, res: Response) => {
  try {
    const { name, description, author, tags, parameters } = req.body;
    if (!name) { res.status(400).json({ ok: false, error: "name required" }); return; }
    const entry = registerStrategy({ name, description, author, tags, parameters });
    res.json({ ok: true, strategy: entry });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/strategy-registry/:id/promote
router.post("/api/strategy-registry/:id/promote", async (req: Request, res: Response) => {
  try {
    const { targetState, reason } = req.body;
    if (!targetState) { res.status(400).json({ ok: false, error: "targetState required" }); return; }
    const entry = promoteStrategy(String(req.params.id), targetState as StrategyState, reason);
    res.json({ ok: true, strategy: entry });
  } catch (err: any) {
    const status = err.message?.includes("not found") ? 404 : err.message?.includes("Invalid transition") ? 400 : 500;
    res.status(status).json({ ok: false, error: String(err.message ?? err) });
  }
});

// POST /api/strategy-registry/:id/version
router.post("/api/strategy-registry/:id/version", async (req: Request, res: Response) => {
  try {
    const { parameters, changelog } = req.body;
    if (!parameters || !changelog) { res.status(400).json({ ok: false, error: "parameters and changelog required" }); return; }
    const entry = updateStrategyVersion(String(req.params.id), { parameters, changelog });
    res.json({ ok: true, strategy: entry });
  } catch (err: any) {
    const status = err.message?.includes("not found") ? 404 : 500;
    res.status(status).json({ ok: false, error: String(err.message ?? err) });
  }
});

// POST /api/strategy-registry/:id/performance
router.post("/api/strategy-registry/:id/performance", async (req: Request, res: Response) => {
  try {
    const entry = updateStrategyPerformance(String(req.params.id), req.body);
    res.json({ ok: true, strategy: entry });
  } catch (err: any) {
    const status = err.message?.includes("not found") ? 404 : 500;
    res.status(status).json({ ok: false, error: String(err.message ?? err) });
  }
});

// POST /api/strategy-registry/reset
router.post("/api/strategy-registry/reset", async (_req: Request, res: Response) => {
  try {
    resetRegistry();
    strategyMap.clear();
    res.json({ ok: true, message: "Strategy registry reset" });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/strategy-registry/:id/promote-track
// Track strategy promotion state in-memory (draft -> testing -> live)
router.post("/api/strategy-registry/:id/promote-track", async (req: Request, res: Response) => {
  try {
    const { newState, winRate } = req.body;
    const strategyId = String(req.params.id);
    
    if (!["draft", "testing", "live"].includes(newState)) {
      res.status(400).json({ ok: false, error: "Invalid state" });
      return;
    }

    let strategy = strategyMap.get(strategyId);
    if (!strategy) {
      strategy = {
        id: strategyId,
        name: `Strategy ${strategyId}`,
        state: "draft",
      };
    }

    const validStates = ["draft", "testing", "live"] as const;
    const currentIndex = validStates.indexOf(strategy.state as any);
    const newIndex = validStates.indexOf(newState as any);

    if (newIndex < currentIndex) {
      res.status(400).json({ ok: false, error: "Cannot demote strategy" });
      return;
    }

    strategy.state = newState;
    strategy.promotedAt = Date.now();
    if (typeof winRate === "number") {
      strategy.winRate = winRate;
    }

    strategyMap.set(strategyId, strategy);

    res.json({
      ok: true,
      strategy,
      message: `Strategy promoted to ${newState}`,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// GET /api/strategy-registry/states
// Get all in-memory strategy promotion states
router.get("/api/strategy-registry/states", async (_req: Request, res: Response) => {
  try {
    const strategies = Array.from(strategyMap.values());
    const byState = {
      draft: strategies.filter(s => s.state === "draft"),
      testing: strategies.filter(s => s.state === "testing"),
      live: strategies.filter(s => s.state === "live"),
    };

    res.json({
      ok: true,
      count: strategies.length,
      byState,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

export default router;
