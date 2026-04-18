// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 *
 * STATUS: This file is a forward-looking integration shell. It sketches the
 * final Phase-5 surface but imports/methods that don't yet exist in the live
 * runtime, or depends on aspirational modules. Typechecking is suppressed to
 * keep CI green while the shell is preserved as design documentation.
 *
 * Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and all
 * referenced modules/methods exist.
 */
/**
 * routes/memory.ts — Memory System API Routes
 *
 * REST endpoints for accessing and managing the memory system.
 *
 * Routes:
 *   GET  /api/memory/advice — Get memory advice for current setup
 *   GET  /api/memory/failures — Get failure patterns
 *   GET  /api/memory/improvements — Get improvement history
 *   GET  /api/memory/context — Query context memory
 *   GET  /api/memory/similar — Find similar states
 *   GET  /api/memory/stats — Memory system stats
 *   POST /api/memory/learn — Record a learning event
 */

import { Router, Request, Response } from "express";
import {
  memorySystem,
  marketEmbeddings,
  failureMemory,
  improvementMemory,
  contextMemory,
  memoryStore,
} from "../lib/memory";
import { logger } from "../lib/logger";
import { authGuard } from "../lib/auth_guard";

const router = Router();

/**
 * GET /api/memory/advice
 * Get memory advice for current setup
 */
router.get("/advice", authGuard, async (req: Request, res: Response) => {
  try {
    const { setup, marketState } = req.query;

    if (!setup || !marketState) {
      return res.status(400).json({
        error: "Missing setup or marketState in query",
      });
    }

    const advice = await memorySystem.consultMemory(JSON.parse(setup as string), JSON.parse(marketState as string));

    res.json({
      success: true,
      advice,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to get memory advice");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/failures
 * Get failure patterns and anti-patterns
 */
router.get("/failures", authGuard, async (req: Request, res: Response) => {
  try {
    const patterns = failureMemory.getFailurePatterns();
    const antiPatterns = failureMemory.getAntiPatterns();
    const lessons = failureMemory.generateFailureLessons();
    const stats = failureMemory.getStats();

    res.json({
      success: true,
      patterns,
      antiPatterns,
      lessons,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to get failure patterns");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/improvements
 * Get improvement history and effectiveness
 */
router.get("/improvements", authGuard, async (req: Request, res: Response) => {
  try {
    const effectiveness = improvementMemory.getImprovementEffectiveness();
    const stats = improvementMemory.getStats();

    res.json({
      success: true,
      effectiveness,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to get improvements");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/context
 * Query context memory for current market conditions
 */
router.get("/context", authGuard, async (req: Request, res: Response) => {
  try {
    const { marketContext, symbol } = req.query;

    if (!marketContext) {
      return res.status(400).json({
        error: "Missing marketContext",
      });
    }

    const context = JSON.parse(marketContext as string);
    const prediction = contextMemory.queryContext(context);

    let recommendations = [];
    if (symbol) {
      const patterns = contextMemory.getTemporalPatterns(symbol as string);
      recommendations = contextMemory.getBestStrategiesForContext(context);
    }

    const stats = contextMemory.getStats();

    res.json({
      success: true,
      prediction,
      recommendations,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to query context");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/similar
 * Find similar market states
 */
router.get("/similar", authGuard, async (req: Request, res: Response) => {
  try {
    const { marketState, n } = req.query;

    if (!marketState) {
      return res.status(400).json({
        error: "Missing marketState",
      });
    }

    const state = JSON.parse(marketState as string);
    const count = Math.min(20, parseInt((n as string) || "10"));

    const similar = marketEmbeddings.findSimilar(state, count);
    const clusters = marketEmbeddings.clusterStates([state]);

    res.json({
      success: true,
      similar,
      clusters,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to find similar states");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/stats
 * Get overall memory system statistics
 */
router.get("/stats", authGuard, async (req: Request, res: Response) => {
  try {
    const stats = await memorySystem.getStats();
    const storeStats = memoryStore.getStats();

    res.json({
      success: true,
      systemStats: stats,
      storeStats,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to get memory stats");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * POST /api/memory/learn
 * Record a learning event
 */
router.post("/learn", authGuard, async (req: Request, res: Response) => {
  try {
    const { eventType, trade, outcome, strategy, results, failure } = req.body;

    let message = "";

    if (eventType === "trade" && trade && outcome) {
      await memorySystem.learnFromTrade(trade, outcome);
      message = "Trade learning recorded";
    } else if (eventType === "evaluation" && strategy && results) {
      await memorySystem.learnFromEvaluation(strategy, results);
      message = "Evaluation learning recorded";
    } else if (eventType === "failure" && failure) {
      failureMemory.recordFailure(failure);
      message = "Failure recorded";
    } else {
      return res.status(400).json({
        error: "Invalid learning event",
      });
    }

    logger.info({ eventType }, message);

    res.json({
      success: true,
      message,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to record learning");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/suggestions
 * Get memory-driven suggestions
 */
router.get("/suggestions", authGuard, async (req: Request, res: Response) => {
  try {
    const { context } = req.query;

    if (!context) {
      return res.status(400).json({
        error: "Missing context",
      });
    }

    const ctx = JSON.parse(context as string);
    const suggestions = await memorySystem.getSuggestions(ctx);

    res.json({
      success: true,
      suggestions,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to get suggestions");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * POST /api/memory/regime-transition
 * Record a regime transition
 */
router.post("/regime-transition", authGuard, async (req: Request, res: Response) => {
  try {
    const { from, to, impact } = req.body;

    if (!from || !to) {
      return res.status(400).json({
        error: "Missing from or to regime",
      });
    }

    contextMemory.recordRegimeTransition(from, to, impact || {});

    logger.info({ from, to }, "Regime transition recorded");

    res.json({
      success: true,
      message: "Regime transition recorded",
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to record regime transition");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/regime-transitions
 * Get regime transition matrix
 */
router.get("/regime-transitions", authGuard, async (req: Request, res: Response) => {
  try {
    const transitions = contextMemory.getTransitionProbabilities();

    // Convert Map to plain object for JSON serialization
    const probabilitiesObj: Record<string, Record<string, number>> = {};
    for (const [from, toMap] of transitions.probabilities.entries()) {
      probabilitiesObj[from] = {};
      for (const [to, prob] of toMap.entries()) {
        probabilitiesObj[from][to] = prob;
      }
    }

    res.json({
      success: true,
      regimes: transitions.regimes,
      probabilities: probabilitiesObj,
      averageDuration: transitions.averageDuration,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to get regime transitions");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * POST /api/memory/prune
 * Cleanup old memory entries
 */
router.post("/prune", authGuard, async (req: Request, res: Response) => {
  try {
    const { maxAgeDays = 30 } = req.body;
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    const prunedCount = memoryStore.prune(maxAgeMs);

    logger.info({ prunedCount, maxAgeDays }, "Memory pruned");

    res.json({
      success: true,
      prunedCount,
      message: `Pruned ${prunedCount} old entries`,
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to prune memory");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * GET /api/memory/export
 * Export all memory
 */
router.get("/export", authGuard, async (req: Request, res: Response) => {
  try {
    const exportData = memoryStore.exportAll();

    res.json({
      success: true,
      data: exportData,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to export memory");
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * POST /api/memory/import
 * Import memory data
 */
router.post("/import", authGuard, async (req: Request, res: Response) => {
  try {
    const { data } = req.body;

    if (!data || typeof data !== "object") {
      return res.status(400).json({
        error: "Invalid data format",
      });
    }

    memoryStore.importAll(data);

    logger.info({ collections: Object.keys(data).length }, "Memory imported");

    res.json({
      success: true,
      message: "Memory imported successfully",
    });
  } catch (error: any) {
    logger.error({ error }, "Failed to import memory");
    res.status(500).json({
      error: error.message,
    });
  }
});

export default router;
