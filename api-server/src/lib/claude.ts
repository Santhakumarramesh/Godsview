/**
 * claude.ts — Claude Reasoning Veto Layer (v3 — Super Intelligence Upgrade)
 *
 * Uses Anthropic Claude to evaluate trading setups and issue
 * APPROVED / VETOED verdicts with structured reasoning.
 *
 * v3 Changes (Super Intelligence Integration):
 * - Model upgraded to claude-sonnet-4-6 (latest, deepest reasoning)
 * - V3 Super Intelligence context injected: tier, anti-fragility, edge score
 * - Cross-asset correlation signals included in reasoning prompt
 * - Multi-horizon confidence (5/20/50 bar) added to context
 * - Enhanced market microstructure analysis in system prompt
 * - Regime-adaptive veto thresholds (stricter in volatile/chop)
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
  validation_status?:
    | "hard_veto"
    | "schema_valid"
    | "schema_invalid_fallback"
    | "heuristic_fallback"
    | "api_error_fallback"
    | "circuit_open";
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
  // V3 Super Intelligence context (optional — enriches reasoning when present)
  si_win_probability?: number;
  si_confidence?: number;
  si_tier?: string;
  si_edge_score?: number;
  si_antifragility?: number;
  si_regime_boost?: number;
  si_correlation_boost?: number;
  si_horizon_h5?: number;
  si_horizon_h20?: number;
  si_horizon_h50?: number;
  si_reasoning?: string[];
  correlated_symbols?: string;
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

## SUPER INTELLIGENCE CONTEXT (when provided):
If SI data is present, incorporate it into your analysis:
- SI Win Probability: ML ensemble prediction (5 sub-models). Trust it for base direction.
- SI Tier: ELITE (full size), STRONG (normal), MARGINAL (half), WEAK (skip)
- Anti-Fragility: 0-1 resilience score — low values mean fragile in adverse conditions
- Multi-Horizon: h5 (5-bar), h20 (20-bar), h50 (50-bar) confidence decay
- Cross-Asset: if correlated symbols confirm/contradict, note it
- If SI says WEAK tier → VETO unless extreme edge in other factors
- If SI anti-fragility < 0.3 AND regime is adverse → VETO

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
let claudeConsecutiveFailures = 0;
let claudeCircuitOpenUntil = 0;

const CLAUDE_MAX_RETRIES = Math.max(0, Number.parseInt(process.env.CLAUDE_VETO_MAX_RETRIES ?? "1", 10) || 0);
const CLAUDE_CIRCUIT_FAIL_THRESHOLD = Math.max(2, Number.parseInt(process.env.CLAUDE_VETO_CIRCUIT_THRESHOLD ?? "4", 10) || 4);
const CLAUDE_CIRCUIT_COOLDOWN_MS = Math.max(10_000, Number.parseInt(process.env.CLAUDE_VETO_CIRCUIT_COOLDOWN_MS ?? "120000", 10) || 120_000);

type ClaudeResponse = {
  verdict: ClaudeVerdict;
  confidence: number;
  claude_score: number;
  reasoning: string;
  key_factors: string[];
};

function nowMs(): number {
  return Date.now();
}

function isCircuitOpen(): boolean {
  return nowMs() < claudeCircuitOpenUntil;
}

function markClaudeFailure(): void {
  claudeConsecutiveFailures += 1;
  if (claudeConsecutiveFailures >= CLAUDE_CIRCUIT_FAIL_THRESHOLD) {
    claudeCircuitOpenUntil = nowMs() + CLAUDE_CIRCUIT_COOLDOWN_MS;
  }
}

function markClaudeSuccess(): void {
  claudeConsecutiveFailures = 0;
  claudeCircuitOpenUntil = 0;
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
}

function extractJsonObject(raw: string): string {
  const cleaned = stripCodeFences(raw);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }
  return cleaned;
}

function parseClaudeJson(raw: string): ClaudeResponse | null {
  try {
    const jsonStr = extractJsonObject(raw);
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const verdictRaw = String(parsed.verdict ?? "").toUpperCase();
    if (verdictRaw !== "APPROVED" && verdictRaw !== "VETOED" && verdictRaw !== "CAUTION") return null;
    const confidence = Number(parsed.confidence);
    const claudeScore = Number(parsed.claude_score);
    const reasoning = String(parsed.reasoning ?? "");
    const keyFactorsRaw = Array.isArray(parsed.key_factors) ? parsed.key_factors : [];
    const keyFactors = keyFactorsRaw.map((item) => String(item)).filter((item) => item.trim().length > 0);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    if (!Number.isFinite(claudeScore) || claudeScore < 0 || claudeScore > 1) return null;
    if (reasoning.trim().length < 8) return null;
    return {
      verdict: verdictRaw,
      confidence,
      claude_score: claudeScore,
      reasoning,
      key_factors: keyFactors,
    };
  } catch {
    return null;
  }
}

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
  return Boolean(process.env.ANTHROPIC_API_KEY) && !isCircuitOpen();
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
      latency_ms: 0, hard_veto: true, validation_status: "hard_veto",
    };
  }

  // Hard veto 2: Chop regime
  if (ctx.regime === "chop") {
    return {
      verdict: "VETOED", confidence: 0.95, claude_score: 0.10,
      reasoning: "Hard veto: Chop regime detected — no directional edge exists.",
      key_factors: ["Chop regime", "No directional edge"],
      latency_ms: 0, hard_veto: true, validation_status: "hard_veto",
    };
  }

  // Hard veto 3: Extreme ATR with low quality
  if (ctx.atr_pct > 0.035 && ctx.final_quality < 0.80) {
    return {
      verdict: "VETOED", confidence: 0.80, claude_score: 0.20,
      reasoning: `Hard veto: Extreme volatility (ATR ${(ctx.atr_pct * 100).toFixed(2)}%) with quality ${(ctx.final_quality * 100).toFixed(0)}%.`,
      key_factors: ["Extreme ATR", "Insufficient quality for volatility level"],
      latency_ms: 0, hard_veto: true, validation_status: "hard_veto",
    };
  }

  // Hard veto 4: R:R too low
  if (rr < 1.2 && ctx.final_quality < 0.80) {
    return {
      verdict: "VETOED", confidence: 0.75, claude_score: 0.30,
      reasoning: `Hard veto: R:R of ${rr.toFixed(2)} is below minimum threshold with quality at ${(ctx.final_quality * 100).toFixed(0)}%.`,
      key_factors: [`R:R ${rr.toFixed(2)} too low`, "Negative expectancy"],
      latency_ms: 0, hard_veto: true, validation_status: "hard_veto",
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
      latency_ms: 0, hard_veto: true, validation_status: "hard_veto",
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

  if (isCircuitOpen()) {
    return {
      verdict: "CAUTION",
      confidence: 0.35,
      claude_score: Math.min(1, Math.max(0, ctx.final_quality * 0.65)),
      reasoning: "Claude circuit breaker is open after repeated validation/API failures. Falling back to caution mode.",
      key_factors: ["Claude circuit open", "Heuristic degradation mode"],
      latency_ms: Date.now() - t0,
      validation_status: "circuit_open",
    };
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
      key_factors: [], latency_ms: 0, validation_status: "heuristic_fallback",
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

SUPER INTELLIGENCE (V3 Ensemble):${ctx.si_win_probability != null ? `
- Win Probability: ${(ctx.si_win_probability * 100).toFixed(1)}% | Confidence: ${((ctx.si_confidence ?? 0) * 100).toFixed(0)}%
- Signal Tier: ${ctx.si_tier ?? "N/A"} | Edge Score: ${((ctx.si_edge_score ?? 0) * 100).toFixed(0)}%
- Anti-Fragility: ${((ctx.si_antifragility ?? 0.5) * 100).toFixed(0)}%
- Regime Boost: ${((ctx.si_regime_boost ?? 0) * 100).toFixed(1)}% | Correlation Boost: ${((ctx.si_correlation_boost ?? 0) * 100).toFixed(1)}%
- Horizon: h5=${((ctx.si_horizon_h5 ?? 0) * 100).toFixed(0)}% → h20=${((ctx.si_horizon_h20 ?? 0) * 100).toFixed(0)}% → h50=${((ctx.si_horizon_h50 ?? 0) * 100).toFixed(0)}%` : `
- Not available (pre-SI pipeline)`}${ctx.correlated_symbols ? `
- Cross-Asset: ${ctx.correlated_symbols}` : ""}

Run through your veto checklist. Issue your verdict.`.trim();

  // Step 4: Call Claude API
  try {
    const model = process.env.CLAUDE_VETO_MODEL ?? "claude-sonnet-4-6";
    let parseFailReason = "";
    for (let attempt = 0; attempt <= CLAUDE_MAX_RETRIES; attempt++) {
      const attemptPrompt = attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nIMPORTANT: Your previous response was invalid JSON for the required schema. Return ONLY one strict JSON object with correct keys and value ranges.`;
      const msg = await claude.messages.create({
        model,
        max_tokens: 400,
        messages: [{ role: "user", content: attemptPrompt }],
        system: SYSTEM_PROMPT,
      });

      const raw = (msg.content[0] as { type: string; text: string }).text.trim();
      const parsed = parseClaudeJson(raw);
      if (!parsed) {
        parseFailReason = "invalid_schema_or_json";
        continue;
      }

      const claudeScore = Math.min(1, Math.max(0, parsed.claude_score));
      const finalVerdict = parsed.verdict === "APPROVED" && claudeScore < 0.55 ? "CAUTION" : parsed.verdict;
      markClaudeSuccess();
      return {
        verdict: finalVerdict,
        confidence: Math.min(1, Math.max(0, parsed.confidence)),
        claude_score: claudeScore,
        reasoning: String(parsed.reasoning ?? ""),
        key_factors: (parsed.key_factors ?? []).slice(0, 4),
        latency_ms: Date.now() - t0,
        validation_status: "schema_valid",
      };
    }

    markClaudeFailure();
    return {
      verdict: "CAUTION",
      confidence: 0.38,
      claude_score: Math.min(1, Math.max(0, ctx.final_quality * 0.72)),
      reasoning: `Claude response failed strict JSON/schema validation (${parseFailReason || "unknown"}). Falling back to caution.`,
      key_factors: ["schema_validation_failed", "fallback_caution"],
      latency_ms: Date.now() - t0,
      validation_status: "schema_invalid_fallback",
    };
  } catch (err) {
    console.error("[claude] veto error:", err);
    markClaudeFailure();
    return {
      verdict: "CAUTION",
      confidence: 0.4,
      claude_score: ctx.final_quality * 0.75,
      reasoning: `Claude reasoning error: ${String(err).slice(0, 120)}. Defaulting to CAUTION.`,
      key_factors: ["API error — reduced confidence"],
      latency_ms: Date.now() - t0,
      validation_status: "api_error_fallback",
    };
  }
}
