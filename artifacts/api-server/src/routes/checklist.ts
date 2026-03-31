/**
 * routes/checklist.ts — Pre-Trade Discipline Gate Endpoints
 *
 * Provides HTTP endpoints for:
 *   POST /checklist/evaluate — Manual checklist evaluation
 *   POST /checklist/auto/:symbol — Auto-filled checklist using SMC + regime data
 *   GET /checklist/:symbol — Retrieve cached result
 *   GET /checklist/template — Get template structure
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  evaluateChecklist,
  autoEvaluateChecklist,
  CHECKLIST_TEMPLATE,
  getCachedChecklist,
  cacheChecklist,
  type ChecklistResult,
  type EvaluateChecklistInput,
} from "../lib/checklist_engine";
import { computeSMCState, type SMCBar } from "../lib/smc_engine";
import { getBars } from "../lib/alpaca";

const router: IRouter = Router();

// ── GET /checklist/template ────────────────────────────────────────────────────

/**
 * Returns the checklist template structure.
 */
router.get("/template", (_req: Request, res: Response<any>): void => {
  res.json({
    template: CHECKLIST_TEMPLATE,
    total_items: CHECKLIST_TEMPLATE.length,
    required_items: CHECKLIST_TEMPLATE.filter((i) => i.required).length,
  });
});

// ── POST /checklist/evaluate ───────────────────────────────────────────────────

/**
 * Manually evaluate a checklist with explicit boolean values.
 *
 * Body: {
 *   symbol: string,
 *   setup_type: string,
 *   session: string,
 *   htf_bias_aligned: boolean,
 *   liquidity_swept: boolean,
 *   structure_shift: boolean,
 *   displacement_confirmed: boolean,
 *   entry_zone_touched: boolean,
 *   rr_minimum_met: boolean,
 *   session_valid: boolean,
 *   no_news_lockout: boolean
 * }
 */
router.post("/evaluate", (req: Request, res: Response<any>): void => {
  try {
    const input = req.body as EvaluateChecklistInput;

    // Validate required fields
    if (
      !input.symbol ||
      !input.setup_type ||
      !input.session ||
      typeof input.htf_bias_aligned !== "boolean" ||
      typeof input.liquidity_swept !== "boolean" ||
      typeof input.structure_shift !== "boolean" ||
      typeof input.displacement_confirmed !== "boolean" ||
      typeof input.entry_zone_touched !== "boolean" ||
      typeof input.rr_minimum_met !== "boolean" ||
      typeof input.session_valid !== "boolean" ||
      typeof input.no_news_lockout !== "boolean"
    ) {
      res.status(400).json({
        error: "Invalid input",
        message:
          "All checklist fields (symbol, setup_type, session, and 8 boolean fields) are required",
      });
      return;
    }

    const result: ChecklistResult = evaluateChecklist(input);
    cacheChecklist(input.symbol, result);

    logger.info(`[CHECKLIST] Evaluated ${input.symbol}: ${result.passed ? "PASSED" : "BLOCKED"} score=${result.score}`);

    res.json(result);
  } catch (err) {
    logger.error(`[CHECKLIST] /evaluate error: ${err instanceof Error ? err.message : "unknown"}`);
    res.status(500).json({
      error: "Evaluation failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── POST /checklist/auto/:symbol ───────────────────────────────────────────────

/**
 * Auto-evaluate checklist using SMC engine and regime data.
 *
 * Query params:
 *   - timeframe (optional, default: "1h" for multi-timeframe SMC)
 *   - session (optional, default: "london_ny_overlap")
 *   - setup_type (optional, default: "smc")
 */
router.post("/auto/:symbol", async (req: Request, res: Response<any>): Promise<void> => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();
    const timeframe: string = String(req.query.timeframe ?? "1Min");
    const session: string = String(req.query.session ?? "london_ny_overlap");
    const setupType: string = String(req.query.setup_type ?? "smc");

    if (!symbol || symbol.length === 0) {
      res.status(400).json({ error: "Symbol required" });
      return;
    }

    // Check cache first
    const cached = getCachedChecklist(symbol);
    if (cached) {
      logger.info(`[CHECKLIST] Cache hit for ${symbol}`);
      res.json(cached);
      return;
    }

    // Fetch bars for SMC computation
    let bars: any[];
    try {
      bars = await getBars(symbol, timeframe as "1Min" | "5Min" | "15Min" | "1Hour" | "1Day", 500);
    } catch (err) {
      logger.error(`[CHECKLIST] Failed to fetch bars for ${symbol}: ${err instanceof Error ? err.message : "unknown"}`);
      res.status(500).json({
        error: "Failed to fetch market data",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (!bars || bars.length === 0) {
      res.status(404).json({
        error: "No bars available",
        message: `No OHLCV data found for ${symbol} on ${timeframe}`,
      });
      return;
    }

    // Compute SMC state
    let smcState: any;
    try {
      const smcBars: SMCBar[] = bars.map((b: any) => ({
        Open: Number(b.o ?? b.Open ?? 0),
        High: Number(b.h ?? b.High ?? 0),
        Low: Number(b.l ?? b.Low ?? 0),
        Close: Number(b.c ?? b.Close ?? 0),
        Volume: Number(b.v ?? b.Volume ?? 0),
        Timestamp: b.t ?? b.Timestamp ?? new Date().toISOString(),
      }));
      smcState = computeSMCState(symbol, smcBars, smcBars);
    } catch (err) {
      logger.error(`[CHECKLIST] Failed to compute SMC for ${symbol}: ${err instanceof Error ? err.message : "unknown"}`);
      res.status(500).json({
        error: "SMC computation failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Placeholder: regime state can be fetched from regime_engine if needed
    const regimeState: any = {};

    // Auto-evaluate
    const result: ChecklistResult = autoEvaluateChecklist(
      symbol,
      smcState,
      regimeState,
      session,
      setupType,
    );

    cacheChecklist(symbol, result);

    logger.info(`[CHECKLIST] Auto-evaluated ${symbol}: ${result.passed ? "PASSED" : "BLOCKED"} score=${result.score}`);

    res.json(result);
  } catch (err) {
    logger.error(`[CHECKLIST] /auto/:symbol error: ${err instanceof Error ? err.message : "unknown"}`);
    res.status(500).json({
      error: "Auto-evaluation failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── GET /checklist/:symbol ─────────────────────────────────────────────────────

/**
 * Retrieve cached checklist result for a symbol.
 * Returns 404 if not cached or cache expired.
 */
router.get("/:symbol", (req: Request, res: Response<any>): void => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase().trim();

    if (!symbol || symbol.length === 0) {
      res.status(400).json({ error: "Symbol required" });
      return;
    }

    const cached = getCachedChecklist(symbol);
    if (!cached) {
      res.status(404).json({
        error: "Not found",
        message: `No cached checklist for ${symbol}. Call /auto/:symbol to evaluate.`,
      });
      return;
    }

    res.json(cached);
  } catch (err) {
    logger.error(`[CHECKLIST] /:symbol error: ${err instanceof Error ? err.message : "unknown"}`);
    res.status(500).json({
      error: "Retrieval failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
