/**
 * claude.ts — Claude Reasoning Veto Layer (v2 — Accuracy Upgrade)
 *
 * Uses Anthropic Claude Sonnet to evaluate trading setups and issue
 * APPROVED / VETOED verdicts with structured reasoning.
 *
 * v2 Changes:
 * - Upgraded model: claude-haiku-4-5 → claude-sonnet-4-5-20241022 (deeper reasoning)
 * - Enhanced system prompt with explicit veto checklist and scoring rubric
 * - Added pre-call heuristic checks that can hard-veto without API call
 * - Stricter conflict detection (SK bias, CVD divergence, regime mismatch)
 * - Added indicator alignment context to the prompt
 * - Configurable model via CLAUDE_VETO_MODEL env var
 */

export type ClaudeVerdict = "APPROVED" | "VETOED" | "CAUTION";

export interface ClaudeVetoResult {
  verdict: ClaudeVerdict;
  confidence: number;
  claude_score: number;
  reasoning: string;
  key_factors: string[];
  latency_ms: number;
  hard_veto?: boolean;
}

export interface SetupContext {
  instrument: string;
  setup_type: string;
  direction: "long" | "short";
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  quality_threshold: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  regime: string;
  sk_bias: string;
  sk_in_zone: boolean;
  sk_sequence_stage: string;
  sk_correction_complete: boolean;
  cvd_slope: number;
  cvd_divergence: boolean;
  buy_volume_ratio: number;
  wick_ratio: number;
  momentum_1m: number;
  trend_slope_5m: number;
  atr_pct: number;
  consec_bullish: number;
  consec_bearish: number;
}

const SYSTEM_PROMPT = `You are the Claude Reasoning Veto Layer in a professional trading system (Godsview — SK System).

Your role: Layer 5 — final contextual gate before a setup is approved for execution. You are the LAST LINE OF DEFENSE. Your job is to PROTECT CAPITAL by catching setups that the quantitative layers missed.

You receive structured market analysis and must issue one of three verdicts:
- APPROVED: setup has genuine edge, all major signals aligned, execute at full size
- CAUTION: setup has merit but one conflicting factor — reduce size to 50%
- VETOED: signals conflict, context is unfavourable, or risk/reward doesn't justify entry — SKIP

## VETO CHECKLIST (any single item = VETO):
1. SK bias OPPOSES direction (e.g., bias=bear but direction=long) AND quality < 0.75
2. CVD divergence is TRUE and direction follows price (not flow)
3. Regime is "volatile" or "chop" and quality < 0.78
4. R:R < 1.5 with quality < 0.75
5. Structure and Order Flow scores disagree by > 25 percentage points
6. Direction is LONG but consecutive bearish candles >= 3 (or SHORT with consec bull >= 3)
7. ATR% > 3% (extreme volatility) unless quality > 0.80

## CAUTION CHECKLIST (any single item = CAUTION at minimum):
1. Quality is within 5% of threshold (borderline)
2. Buy volume ratio is between 45-55% (no clear aggressor)
3. SK not in zone OR correction not complete
4. One timeframe trend disagrees with direction

## APPROVE ONLY WHEN:
- Quality >= threshold + 0.05 (comfort margin)
- SK bias aligns with direction
- CVD flow supports direction (buy ratio > 55% for longs, < 45% for shorts)
- No items from veto checklist triggered
- R:R >= 2.0 preferred

## SCORING RUBRIC for claude_score:
- 0.85-1.00: Perfect alignment, all signals confirm, high conviction
- 0.70-0.84: Strong setup with minor reservations
- 0.55-0.69: Borderline — proceed with reduced size only
- 0.30-0.54: Significant conflicts — should not trade
- 0.00-0.29: Clear counter-signal — strong veto

Rules:
- Be concise and decisive. No hedging.
- Reference SPECIFIC NUMBERS from the data in your reasoning.
- Err on the side of VETOING — capital preservation beats opportunity cost.
- Never mention Claude, Anthropic, or AI. Speak as a professional quant analyst.
- If in doubt, VETO. There will always be another setup.

Respond ONLY with valid JSON matching this exact schema:
{
  "verdict": "APPROVED" | "VETOED" | "CAUTION",
  "confidence": 0.0-1.0,
  "claude_score": 0.0-1.0,
  "reasoning": "2-3 sentence explanation referencing specific data points",
  "key_factors": ["factor 1", "factor 2", "factor 3", "factor 4"]
}`;

type AnthropicMessageResult = {
  content: Array<{ type: string; text: string }>;
};

type AnthropicClient = {
  messages: {
    create: (args: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: "user"; content: string }>;
      system: string;
    }) => Promise<AnthropicMessageResult>;
  };
};

let client: AnthropicClient | null = null;
let clientLoading: Promise<AnthropicClient | null> | null = null;

async function getClient(): Promise<AnthropicClient | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (client) return client;
  if (clientLoading) return clientLoading;

  clientLoading = (async () => {
    try {
      const importer = new Function("mod", "return import(mod);") as (mod: string) => Promise<unknown>;
      const mod = await importer("@anthropic-ai/sdk") as { default?: new (args: { apiKey: string }) => AnthropicClient };
      if (!mod.default) return null;
      client = new mod.default({ apiKey: key });
      return client;
    } catch {
      return null;
    } finally {
      clientLoading = null;
    }
  })();

  return clientLoading;
}

export function isClaudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ─── Pre-Call Heuristic Hard-Veto ──────────────────────────────────────────────

function preCallHardVeto(ctx: SetupContext): ClaudeVetoResult | null {
  const rr =
    ctx.stop_loss > 0
      ? Math.abs((ctx.take_profit - ctx.entry_price) / (ctx.entry_price - ctx.stop_loss))
      : 0;

  // Hard veto 1: SK bias directly opposes direction + low quality
  const skBiasOpposes =
    (ctx.direction === "long" && ctx.sk_bias === "bear") ||
    (ctx.direction === "short" && ctx.sk_bias === "bull");
  if (skBiasOpposes && ctx.final_quality < 0.72) {
    return {
      verdict: "VETOED", confidence: 0.85, claude_score: 0.25,
      reasoning: `Hard veto: SK bias (${ctx.sk_bias}) directly opposes ${ctx.direction} direction with quality at ${(ctx.final_quality * 100).toFixed(0)}%.`,
      key_factors: ["SK bias conflict", `Quality ${(ctx.final_quality * 100).toFixed(0)}% insufficient to override`],
      latency_ms: 0, hard_veto: true,
    };
  }

  // Hard veto 2: Chop regime
  if (ctx.regime === "chop") {
    return {
      verdict: "VETOED", confidence: 0.95, claude_score: 0.10,
      reasoning: "Hard veto: Chop regime detected — no directional edge exists.",
      key_factors: ["Chop regime", "No directional edge"],
      latency_ms: 0, hard_veto: true,
    };
  }

  // Hard veto 3: Extreme ATR with low quality
  if (ctx.atr_pct > 0.035 && ctx.final_quality < 0.80) {
    return {
      verdict: "VETOED", confidence: 0.80, claude_score: 0.20,
      reasoning: `Hard veto: Extreme volatility (ATR ${(ctx.atr_pct * 100).toFixed(2)}%) with quality ${(ctx.final_quality * 100).toFixed(0)}%.`,
      key_factors: ["Extreme ATR", "Insufficient quality for volatility level"],
      latency_ms: 0, hard_veto: true,
    };
  }

  // Hard veto 4: R:R too low
  if (rr < 1.2 && ctx.final_quality < 0.80) {
    return {
      verdict: "VETOED", confidence: 0.75, claude_score: 0.30,
      reasoning: `Hard veto: R:R of ${rr.toFixed(2)} is below minimum threshold with quality at ${(ctx.final_quality * 100).toFixed(0)}%.`,
      key_factors: [`R:R ${rr.toFixed(2)} too low`, "Negative expectancy"],
      latency_ms: 0, hard_veto: true,
    };
  }

  // Hard veto 5: Momentum strongly opposes direction
  const opposingMomentum =
    (ctx.direction === "long" && ctx.consec_bearish >= 4) ||
    (ctx.direction === "short" && ctx.consec_bullish >= 4);
  if (opposingMomentum && ctx.final_quality < 0.75) {
    const count = ctx.direction === "long" ? ctx.consec_bearish : ctx.consec_bullish;
    return {
      verdict: "VETOED", confidence: 0.78, claude_score: 0.28,
      reasoning: `Hard veto: ${count} consecutive opposing candles against ${ctx.direction} direction.`,
      key_factors: [`${count} opposing candles`, "Momentum against direction"],
      latency_ms: 0, hard_veto: true,
    };
  }

  return null;
}

export async function claudeVeto(ctx: SetupContext): Promise<ClaudeVetoResult> {
  const t0 = Date.now();

  // Step 1: Pre-call hard veto checks (free, zero latency)
  const hardVetoResult = preCallHardVeto(ctx);
  if (hardVetoResult) {
    console.log(`[claude] Hard veto: ${hardVetoResult.reasoning.slice(0, 80)}`);
    return hardVetoResult;
  }

  // Step 2: Get API client
  const claude = await getClient();

  if (!claude) {
    const skAligned =
      (ctx.direction === "long" && ctx.sk_bias === "bull") ||
      (ctx.direction === "short" && ctx.sk_bias === "bear") ||
      ctx.sk_bias === "neutral";
    const cvdAligned =
      (ctx.direction === "long" && ctx.buy_volume_ratio > 0.52) ||
      (ctx.direction === "short" && ctx.buy_volume_ratio < 0.48);
    const heuristicScore = ctx.final_quality * (skAligned ? 1.0 : 0.8) * (cvdAligned ? 1.0 : 0.85);
    return {
      verdict: heuristicScore >= ctx.quality_threshold ? "APPROVED" : "CAUTION",
      confidence: heuristicScore, claude_score: heuristicScore,
      reasoning: "Claude reasoning layer inactive — ANTHROPIC_API_KEY not configured. Using heuristic fallback.",
      key_factors: [], latency_ms: 0,
    };
  }

  // Step 3: Build enhanced prompt
  const rr = ctx.stop_loss > 0
    ? Math.abs((ctx.take_profit - ctx.entry_price) / (ctx.entry_price - ctx.stop_loss)).toFixed(2)
    : "N/A";

  const qualityVsThreshold = ctx.final_quality - ctx.quality_threshold;
  const qualityMarginLabel =
    qualityVsThreshold > 0.05 ? "ABOVE threshold (comfort margin)"
    : qualityVsThreshold > 0 ? "BARELY above threshold (borderline)"
    : "BELOW threshold (should not trade unless overridden)";

  const skBiasAlignment =
    (ctx.direction === "long" && ctx.sk_bias === "bull") ||
    (ctx.direction === "short" && ctx.sk_bias === "bear")
      ? "ALIGNED"
      : ctx.sk_bias === "neutral" ? "NEUTRAL" : "OPPOSING";

  const cvdDirectionLabel =
    (ctx.direction === "long" && ctx.buy_volume_ratio > 0.55) ? "STRONG BUY FLOW (supports long)"
    : (ctx.direction === "short" && ctx.buy_volume_ratio < 0.45) ? "STRONG SELL FLOW (supports short)"
    : (ctx.buy_volume_ratio >= 0.45 && ctx.buy_volume_ratio <= 0.55) ? "NEUTRAL FLOW (no clear aggressor)"
    : "OPPOSING FLOW (flow contradicts direction)";

  const structureOrderFlowGap = Math.abs(ctx.structure_score - ctx.order_flow_score);
  const layerConflictLabel =
    structureOrderFlowGap > 0.25 ? "HIGH CONFLICT between Structure and Order Flow"
    : structureOrderFlowGap > 0.15 ? "MODERATE disagreement" : "ALIGNED";

  const userPrompt = `
Evaluate this ${ctx.instrument} ${ctx.direction.toUpperCase()} setup:

SETUP: ${ctx.setup_type.replace(/_/g, " ").toUpperCase()}
Entry: $${ctx.entry_price.toFixed(2)} | SL: $${ctx.stop_loss.toFixed(2)} | TP: $${ctx.take_profit.toFixed(2)}
R:R: ${rr}

LAYER SCORES:
- Structure: ${(ctx.structure_score * 100).toFixed(0)}%
- Order Flow: ${(ctx.order_flow_score * 100).toFixed(0)}%
- Recall: ${(ctx.recall_score * 100).toFixed(0)}%
- Final Quality: ${(ctx.final_quality * 100).toFixed(0)}% (threshold: ${(ctx.quality_threshold * 100).toFixed(0)}%)
- Quality vs Threshold: ${qualityMarginLabel}
- Layer Conflict: ${layerConflictLabel} (gap: ${(structureOrderFlowGap * 100).toFixed(0)}%)

MARKET STRUCTURE (SK):
- SK Bias: ${ctx.sk_bias} → ${skBiasAlignment} with ${ctx.direction}
- In Zone: ${ctx.sk_in_zone} | Stage: ${ctx.sk_sequence_stage} | Correction Complete: ${ctx.sk_correction_complete}

ORDER FLOW (CVD):
- CVD Slope: ${ctx.cvd_slope.toFixed(6)} | CVD Divergence: ${ctx.cvd_divergence}
- Buy Volume Ratio: ${(ctx.buy_volume_ratio * 100).toFixed(0)}% → ${cvdDirectionLabel}

MOMENTUM & VOLATILITY:
- Regime: ${ctx.regime}
- 1m Momentum: ${(ctx.momentum_1m * 100).toFixed(3)}% | 5m Trend: ${(ctx.trend_slope_5m * 100).toFixed(3)}%
- ATR%: ${(ctx.atr_pct * 100).toFixed(2)}%
- Consec Bull: ${ctx.consec_bullish} | Consec Bear: ${ctx.consec_bearish}
- Wick Ratio: ${(ctx.wick_ratio * 100).toFixed(0)}%

Run through your veto checklist. Issue your verdict.`.trim();

  // Step 4: Call Claude API
  try {
    const model = process.env.CLAUDE_VETO_MODEL ?? "claude-sonnet-4-5-20241022";
    const msg = await claude.messages.create({
      model,
      max_tokens: 400,
      messages: [{ role: "user", content: userPrompt }],
      system: SYSTEM_PROMPT,
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();
    const jsonStr = raw
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    const parsed = JSON.parse(jsonStr) as {
      verdict: ClaudeVerdict;
      confidence: number;
      claude_score: number;
      reasoning: string;
      key_factors: string[];
    };

    const verdict = parsed.verdict ?? "CAUTION";
    const claudeScore = Math.min(1, Math.max(0, Number(parsed.claude_score ?? 0.5)));

    // Post-response sanity check
    const finalVerdict = verdict === "APPROVED" && claudeScore < 0.55 ? "CAUTION" : verdict;

    return {
      verdict: finalVerdict,
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
      claude_score: claudeScore,
      reasoning: String(parsed.reasoning ?? ""),
      key_factors: (parsed.key_factors ?? []).slice(0, 4),
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    console.error("[claude] veto error:", err);
    return {
      verdict: "CAUTION",
      confidence: 0.4,
      claude_score: ctx.final_quality * 0.75,
      reasoning: `Claude reasoning error: ${String(err).slice(0, 120)}. Defaulting to CAUTION.`,
      key_factors: ["API error — reduced confidence"],
      latency_ms: Date.now() - t0,
    };
  }
}
