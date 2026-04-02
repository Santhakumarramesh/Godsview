import { DecisionContractSchema, DecisionContract } from "./schemas";
import Anthropic from "@anthropic-ai/sdk";
import pTimeout from "p-timeout";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

/**
 * HEURISTIC REASONING (The "Safety Net")
 * Zero-latency, purely deterministic logic that follows strict ICT rules.
 */
export function getHeuristicReasoning(input: {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  direction: string;
  regime: string;
}): Omit<DecisionContract, "signalId" | "symbol" | "suggestedQty"> {
  const { structure_score: s, order_flow_score: o, recall_score: r, direction, regime } = input;

  // Weights based on regime
  const isTrending = regime.includes("trending");
  const quality = isTrending
    ? (s * 0.5 + o * 0.3 + r * 0.2)
    : (s * 0.3 + o * 0.5 + r * 0.2);

  const approved = quality >= 0.70;

  return {
    approved,
    rejectionReason: approved ? undefined : "Heuristic: Combined quality below 70%",
    quality,
    winProbability: 0.5 + (quality - 0.5) * 0.5, // Conservative estimate
    kellyFraction: approved ? 0.01 : 0,
    reasonSource: "heuristic",
  };
}

/**
 * Robustly extract a JSON object from a Claude response.
 * Handles: raw JSON, ```json code blocks, ``` code blocks, inline JSON.
 */
function extractJSON(text: string): Record<string, unknown> {
  // 1. Try stripping markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }

  // 2. Try finding a bare JSON object
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try { return JSON.parse(objectMatch[0]); } catch { /* fall through */ }
  }

  // 3. Try parsing the whole response
  try { return JSON.parse(text.trim()); } catch { /* fall through */ }

  return {};
}

/**
 * CLAUDE REASONING (The "Surgical Probe")
 * Deep multi-vector reasoning with ICT/SMC domain expertise.
 * Uses the latest Claude model with structured output enforcement.
 */
export async function getClaudeReasoning(input: any): Promise<Omit<DecisionContract, "signalId" | "symbol" | "suggestedQty">> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing Anthropic API Key");
  }

  const prompt = `You are an expert ICT/SMC trading analyst for the GodsView system.
Analyze this trading signal and return ONLY a valid JSON object — no explanation, no markdown.

Signal data:
${JSON.stringify(input, null, 2)}

Return exactly this JSON structure:
{
  "approved": <boolean>,
  "rejectionReason": <string or null>,
  "quality": <number 0-1>,
  "winProbability": <number 0-1>,
  "kellyFraction": <number 0-0.05>
}

ICT/SMC criteria:
- Approved if: quality ≥ 0.68, structure supports trend continuation, order flow aligned, confluence present
- winProbability: realistic estimate based on setup quality (0.50-0.80 range)
- kellyFraction: use quarter-Kelly (max 0.03 for excellent setups, 0 if rejected)
- Consider regime: trending = trust structure more, ranging = trust order flow more, chop = reject`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const content = (response.content[0] as any).text ?? "";
  const parsed = extractJSON(content);

  return {
    approved: Boolean(parsed.approved),
    rejectionReason: (parsed.rejectionReason as string) || undefined,
    quality: Math.min(1, Math.max(0, Number(parsed.quality ?? 0.5))),
    winProbability: Math.min(1, Math.max(0, Number(parsed.winProbability ?? 0.5))),
    kellyFraction: Math.min(0.05, Math.max(0, Number(parsed.kellyFraction ?? 0))),
    reasonSource: "claude",
  };
}

/**
 * HARDENED REASONING HUB
 * Attempts Claude reasoning with a strict timeout, falling back to heuristics
 * to ensure the trading system never stalls or returns invalid data.
 */
export async function reasonTradeDecision(
  signalId: number,
  symbol: string,
  input: any
): Promise<DecisionContract> {
  try {
    // Attempt Claude with a 10s timeout
    const claudeResult = await pTimeout(getClaudeReasoning(input), {
      milliseconds: 10000,
      fallback: () => { throw new Error("Claude Timeout"); }
    });

    return DecisionContractSchema.parse({
      ...claudeResult,
      signalId,
      symbol,
      suggestedQty: 0, // Calculated later by SI
    });
  } catch (err) {
    console.warn(`[Reasoning] Claude failed/timed out, falling back to heuristics. Symbol: ${symbol}`);
    const heuristic = getHeuristicReasoning(input);

    return DecisionContractSchema.parse({
      ...heuristic,
      signalId,
      symbol,
      suggestedQty: 0,
    });
  }
}
