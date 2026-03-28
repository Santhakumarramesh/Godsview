/**
 * claude.ts — Claude Reasoning Veto Layer
 *
 * Uses Anthropic claude-3-5-haiku to evaluate trading setups and issue
 * APPROVED / VETOED verdicts with structured reasoning.
 *
 * This is Layer 6 in the 6-layer hybrid AI pipeline.
 * It acts as a final contextual gate before a setup is marked high-conviction.
 *
 * Veto triggers:
 *  - Setup scores are borderline (0.55–0.70) but signals conflict
 *  - CVD diverges from price direction
 *  - SK bias opposes the setup direction
 *  - Regime is unfavourable for the setup type
 *  - Multiple no-trade signals are present simultaneously
 */

import Anthropic from "@anthropic-ai/sdk";

export type ClaudeVerdict = "APPROVED" | "VETOED" | "CAUTION";

export interface ClaudeVetoResult {
  verdict:      ClaudeVerdict;
  confidence:   number;          // 0–1
  claude_score: number;          // 0–1 (used in final_quality weighting)
  reasoning:    string;          // 2-3 sentence explanation
  key_factors:  string[];        // up to 4 bullet points
  latency_ms:   number;
}

export interface SetupContext {
  instrument:       string;
  setup_type:       string;
  direction:        "long" | "short";
  structure_score:  number;
  order_flow_score: number;
  recall_score:     number;
  final_quality:    number;
  quality_threshold:number;
  entry_price:      number;
  stop_loss:        number;
  take_profit:      number;
  regime:           string;
  sk_bias:          string;
  sk_in_zone:       boolean;
  sk_sequence_stage:string;
  sk_correction_complete: boolean;
  cvd_slope:        number;
  cvd_divergence:   boolean;
  buy_volume_ratio: number;
  wick_ratio:       number;
  momentum_1m:      number;
  trend_slope_5m:   number;
  atr_pct:          number;
  consec_bullish:   number;
  consec_bearish:   number;
}

const SYSTEM_PROMPT = `You are the Claude Reasoning Veto Layer in a professional crypto trading system (Godsview — SK System).

Your role is Layer 6: final contextual gate before a setup is approved for execution.
You receive structured market analysis and must issue one of three verdicts:
- APPROVED: setup has genuine edge, signals are aligned, execute
- CAUTION: setup has merit but one conflicting factor — reduce size
- VETOED: signals conflict or context is unfavourable — skip this setup

Rules:
- Be concise and decisive. No hedging.
- Reference specific numbers from the data.
- VETO when: CVD diverges from direction, SK bias opposes direction, regime doesn't suit setup, quality is below 0.65 with any conflict.
- APPROVE when: all major signals align, quality ≥ 0.70, SK zone + bias + CVD in agreement.
- CAUTION for everything borderline.
- Never mention Claude, Anthropic, or AI. Speak as a professional quant analyst.

Respond ONLY with valid JSON matching this exact schema:
{
  "verdict": "APPROVED" | "VETOED" | "CAUTION",
  "confidence": 0.0–1.0,
  "claude_score": 0.0–1.0,
  "reasoning": "2-3 sentence explanation",
  "key_factors": ["factor 1", "factor 2", "factor 3"]
}`;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}

export function isClaudeAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function claudeVeto(ctx: SetupContext): Promise<ClaudeVetoResult> {
  const t0 = Date.now();
  const claude = getClient();

  if (!claude) {
    // Passthrough when no key — use final_quality as claude_score
    return {
      verdict:      ctx.final_quality >= ctx.quality_threshold ? "APPROVED" : "CAUTION",
      confidence:   ctx.final_quality,
      claude_score: ctx.final_quality,
      reasoning:    "Claude reasoning layer inactive — ANTHROPIC_API_KEY not configured.",
      key_factors:  [],
      latency_ms:   0,
    };
  }

  const userPrompt = `
Evaluate this ${ctx.instrument} ${ctx.direction.toUpperCase()} setup:

SETUP: ${ctx.setup_type.replace(/_/g, " ").toUpperCase()}
Entry: $${ctx.entry_price.toFixed(2)} | SL: $${ctx.stop_loss.toFixed(2)} | TP: $${ctx.take_profit.toFixed(2)}
R:R: ${ctx.stop_loss > 0 ? Math.abs((ctx.take_profit - ctx.entry_price) / (ctx.entry_price - ctx.stop_loss)).toFixed(2) : "N/A"}

SCORES:
- Structure: ${(ctx.structure_score * 100).toFixed(0)}%
- Order Flow: ${(ctx.order_flow_score * 100).toFixed(0)}%
- Recall: ${(ctx.recall_score * 100).toFixed(0)}%
- Final Quality: ${(ctx.final_quality * 100).toFixed(0)}% (threshold: ${(ctx.quality_threshold * 100).toFixed(0)}%)

MARKET CONTEXT:
- Regime: ${ctx.regime}
- SK Bias: ${ctx.sk_bias} | In Zone: ${ctx.sk_in_zone} | Stage: ${ctx.sk_sequence_stage} | Correction Complete: ${ctx.sk_correction_complete}
- CVD Slope: ${ctx.cvd_slope.toFixed(6)} | CVD Divergence: ${ctx.cvd_divergence}
- Buy Volume Ratio: ${(ctx.buy_volume_ratio * 100).toFixed(0)}%
- 1m Momentum: ${(ctx.momentum_1m * 100).toFixed(3)}% | 5m Trend: ${(ctx.trend_slope_5m * 100).toFixed(3)}%
- ATR%: ${(ctx.atr_pct * 100).toFixed(2)}%
- Consec Bull: ${ctx.consec_bullish} | Consec Bear: ${ctx.consec_bearish}
- Wick Ratio: ${(ctx.wick_ratio * 100).toFixed(0)}%

Issue your verdict.`.trim();

  try {
    const msg = await claude.messages.create({
      model:      "claude-3-5-haiku-20241022",
      max_tokens: 300,
      messages:   [{ role: "user", content: userPrompt }],
      system:     SYSTEM_PROMPT,
    });

    const raw = (msg.content[0] as { type: string; text: string }).text.trim();

    // Strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(jsonStr) as {
      verdict:      ClaudeVerdict;
      confidence:   number;
      claude_score: number;
      reasoning:    string;
      key_factors:  string[];
    };

    return {
      verdict:      parsed.verdict ?? "CAUTION",
      confidence:   Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
      claude_score: Math.min(1, Math.max(0, Number(parsed.claude_score ?? 0.5))),
      reasoning:    String(parsed.reasoning ?? ""),
      key_factors:  (parsed.key_factors ?? []).slice(0, 4),
      latency_ms:   Date.now() - t0,
    };
  } catch (err) {
    // Graceful fallback — never block the pipeline
    console.error("[claude] veto error:", err);
    return {
      verdict:      "CAUTION",
      confidence:   0.5,
      claude_score: ctx.final_quality * 0.9,
      reasoning:    `Claude reasoning error: ${String(err).slice(0, 120)}`,
      key_factors:  [],
      latency_ms:   Date.now() - t0,
    };
  }
}
