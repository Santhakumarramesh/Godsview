import { Router, Request, Response } from "express";
import {
  createShadowSession,
  recordShadowTrade,
  completeShadowSession,
  pauseShadowSession,
  resumeShadowSession,
  abortShadowSession,
  getShadowSession,
  getActiveSessions,
  getAllSessions,
  getSessionsByStrategy,
  compareShadowToLive,
  runStatisticalTest,
  type ShadowConfig,
  type ShadowTrade,
} from "../lib/shadow_trading";

const router = Router();

// POST /sessions - create session
router.post("/sessions", (req: Request, res: Response) => {
  try {
    const { strategy_id, strategy_name, config } = req.body;

    if (!strategy_id || !strategy_name || !config) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: strategy_id, strategy_name, config",
      });
    }

    const session = createShadowSession({
      strategy_id,
      strategy_name,
      config: config as ShadowConfig,
    });

    return res.status(201).json({
      success: true,
      data: session,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /sessions - list sessions
router.get("/sessions", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : undefined;

    const sessions = getAllSessions(limit);

    return res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /sessions/active - active sessions
router.get("/sessions/active", (req: Request, res: Response) => {
  try {
    const sessions = getActiveSessions();

    return res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /sessions/:id - single session
router.get("/sessions/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const session = getShadowSession(id);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: `Session ${id} not found`,
      });
    }

    return res.json({
      success: true,
      data: session,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /sessions/strategy/:strategy_id - by strategy
router.get("/sessions/strategy/:strategy_id", (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.params;
    const sessions = getSessionsByStrategy(strategy_id);

    return res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/trade - record shadow trade
router.post("/sessions/:id/trade", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      signal_timestamp,
      symbol,
      side,
      quantity,
      signal_price,
      market_price_at_signal,
      market_price_after_1m,
      market_price_after_5m,
      decision_rationale,
      would_have_pnl,
    } = req.body;

    if (
      !signal_timestamp ||
      !symbol ||
      !side ||
      quantity === undefined ||
      signal_price === undefined ||
      market_price_at_signal === undefined ||
      market_price_after_1m === undefined ||
      market_price_after_5m === undefined ||
      !decision_rationale
    ) {
      return res.status(400).json({
        success: false,
        error: "Missing required trade fields",
      });
    }

    const result = recordShadowTrade(id, {
      signal_timestamp,
      symbol,
      side,
      quantity,
      signal_price,
      market_price_at_signal,
      market_price_after_1m,
      market_price_after_5m,
      decision_rationale,
      would_have_pnl,
    } as Omit<
      ShadowTrade,
      "id" | "session_id" | "would_have_pnl" | "slippage_estimate_bps"
    > & { would_have_pnl?: number });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/complete - complete session
router.post("/sessions/:id/complete", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = completeShadowSession(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/pause - pause
router.post("/sessions/:id/pause", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = pauseShadowSession(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/resume - resume
router.post("/sessions/:id/resume", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = resumeShadowSession(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/abort - abort
router.post("/sessions/:id/abort", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = abortShadowSession(id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/compare - compare to live
router.post("/sessions/:id/compare", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { live_pnl, live_trades } = req.body;

    if (live_pnl === undefined || live_trades === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: live_pnl, live_trades",
      });
    }

    const result = compareShadowToLive(id, live_pnl, live_trades);

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /sessions/:id/stat-test - statistical test
router.post("/sessions/:id/stat-test", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { pnl, win_rate, sharpe } = req.body;

    if (pnl === undefined || win_rate === undefined || sharpe === undefined) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: pnl, win_rate, sharpe",
      });
    }

    const tests = runStatisticalTest(id, {
      pnl,
      win_rate,
      sharpe,
    });

    return res.json({
      success: true,
      data: tests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
