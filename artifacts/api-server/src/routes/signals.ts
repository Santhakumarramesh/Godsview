/**
 * signals.ts — Signal management routes
 *
 * POST /signals now calls claudeVeto() (Layer 6) to produce a real claude_score
 * and verdict, replacing the hardcoded stub in strategy_engine.ts.
 *
 * The final_quality formula remains:
 *   0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * claude
 * but `claude` is now the live claude_score returned by the API.
 */

import { Router, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, signalsTable } from "@workspace/db";
import { CreateSignalBody, GetSignalsQueryParams } from "@workspace/api-zod";
import { claudeVeto, isClaudeAvailable, type SetupContext } from "../lib/claude";
import { logger } from "../lib/logger";

export const signalsRouter = Router();

// ─── GET /signals ────────────────────────────────────────────────────────────

signalsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const query = GetSignalsQueryParams.parse(req.query);

    const conditions = [];
    if (query.setup_type) conditions.push(eq(signalsTable.setup_type, query.setup_type));
    if (query.instrument) conditions.push(eq(signalsTable.instrument, query.instrument));
    if (query.status)     conditions.push(eq(signalsTable.status, query.status));

    const rows = await db
      .select()
      .from(signalsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(signalsTable.created_at))
      .limit(query.limit ?? 50);

    res.json({ signals: rows, count: rows.length });
  } catch (err) {
    logger.error({ err }, "[signals] GET / error");
    res.status(500).json({ error: "Failed to fetch signals" });
  }
});

// ─── POST /signals ───────────────────────────────────────────────────────────

signalsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = CreateSignalBody.parse(req.body) as any; // extra fields (direction, sk_bias, cvd_slope, etc.) used for SetupContext (Claude veto)

    const structure  = Number(body.structure_score   ?? 0);
    const orderFlow  = Number(body.order_flow_score  ?? 0);
    const recall     = Number(body.recall_score      ?? 0);
    const ml         = Number(body.ml_probability    ?? 0.52);
    const threshold  = Number(body.quality_threshold ?? 0.65);

    // ── Layer 6: Claude Reasoning Veto ───────────────────────────────────────
    // Build SetupContext from signal body and call claudeVeto().
    // Falls back gracefully if ANTHROPIC_API_KEY is not set.
    const setupCtx: SetupContext = {
      instrument:              body.instrument          ?? "UNKNOWN",
      setup_type:              body.setup_type          ?? "unknown",
      direction:               (body.direction as "long" | "short") ?? "long",
      structure_score:         structure,
      order_flow_score:        orderFlow,
      recall_score:            recall,
      final_quality:           0.30 * structure + 0.25 * orderFlow + 0.20 * recall + 0.15 * ml + 0.10 * 0.52,
      quality_threshold:       threshold,
      entry_price:             Number(body.entry_price  ?? 0),
      stop_loss:               Number(body.stop_loss    ?? 0),
      take_profit:             Number(body.take_profit  ?? 0),
      regime:                  body.regime              ?? "unknown",
      sk_bias:                 body.sk_bias             ?? "neutral",
      sk_in_zone:              Boolean(body.sk_in_zone),
      sk_sequence_stage:       body.sk_sequence_stage   ?? "unknown",
      sk_correction_complete:  Boolean(body.sk_correction_complete),
      cvd_slope:               Number(body.cvd_slope    ?? 0),
      cvd_divergence:          Boolean(body.cvd_divergence),
      buy_volume_ratio:        Number(body.buy_volume_ratio ?? 0.5),
      wick_ratio:              Number(body.wick_ratio   ?? 0),
      momentum_1m:             Number(body.momentum_1m  ?? 0),
      trend_slope_5m:          Number(body.trend_slope_5m ?? 0),
      atr_pct:                 Number(body.atr_pct      ?? 0),
      consec_bullish:          Number(body.consec_bullish ?? 0),
      consec_bearish:          Number(body.consec_bearish ?? 0),
    };

    const vetoResult = await claudeVeto(setupCtx);

    logger.info(
      {
        instrument:       setupCtx.instrument,
        setup_type:       setupCtx.setup_type,
        verdict:          vetoResult.verdict,
        confidence:       vetoResult.confidence,
        latency_ms:       vetoResult.latency_ms,
        claude_available: isClaudeAvailable(),
      },
      "[claude-veto] verdict issued"
    );

    // ── Final quality score (with live claude_score) ──────────────────────────
    const claudeScore   = vetoResult.claude_score;
    const final_quality =
      0.30 * structure +
      0.25 * orderFlow +
      0.20 * recall    +
      0.15 * ml        +
      0.10 * claudeScore;

    // ── Map verdict → signal status ───────────────────────────────────────────
    // APPROVED  → pending  (ready to execute)
    // CAUTION   → pending  (execute with reduced size — downstream decides)
    // VETOED    → rejected (do not execute)
    const status =
      vetoResult.verdict === "VETOED" ? "rejected" : "pending";

    const [created] = await db
      .insert(signalsTable)
      .values({
        ...body,
        ml_probability:   ml,
        claude_score:     String(claudeScore),
        claude_verdict:   vetoResult.verdict,
        claude_reasoning: vetoResult.reasoning,
        final_quality:    String(final_quality),
        status,
      })
      .returning();

    res.status(201).json({
      signal: created,
      claude: {
        verdict:      vetoResult.verdict,
        confidence:   vetoResult.confidence,
        claude_score: vetoResult.claude_score,
        reasoning:    vetoResult.reasoning,
        key_factors:  vetoResult.key_factors,
        latency_ms:   vetoResult.latency_ms,
        available:    isClaudeAvailable(),
      },
    });
  } catch (err) {
    logger.error({ err }, "[signals] POST / error");
    res.status(500).json({ error: "Failed to create signal" });
  }
});

// ─── GET /signals/:id ────────────────────────────────────────────────────────

signalsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [signal] = await db
      .select()
      .from(signalsTable)
      .where(eq(signalsTable.id, Number(id)))
      .limit(1);

    if (!signal) {
      return res.status(404).json({ error: "Signal not found" });
    }

    return res.json({ signal });
  } catch (err) {
    logger.error({ err }, "[signals] GET /:id error");
    return res.status(500).json({ error: "Failed to fetch signal" });
  }
});

export default signalsRouter;
