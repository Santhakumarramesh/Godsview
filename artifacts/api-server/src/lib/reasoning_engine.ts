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
 * CLAUDE REASONING (The "Surgical Probe")
 * Deep multi-vector reasoning with ICT/SMC domain expertise.
 */
export async function getClaudeReasoning(input: any): Promise<Omit<DecisionContract, "signalId" | "symbol" | "suggestedQty">> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing Anthropic API Key");
  }

  const prompt = `
    Analyze this GodsView Trading Signal using ICT/SMC principles:
    Input: ${JSON.stringify(input)}
    
    Return a JSON object matching this schema:
    {
      "approved": boolean,
      "rejectionReason": string | null,
      "quality": number (0-1),
      "winProbability": number (0-1),
      "kellyFraction": number (0-1)
    }
  `;

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20240620",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const content = (response.content[0] as any).text;
  const parsed = JSON.parse(content.match(/\{.*\}/s)?.[0] || "{}");
  
  return {
    approved: Boolean(parsed.approved),
    rejectionReason: parsed.rejectionReason || undefined,
    quality: Number(parsed.quality || 0.5),
    winProbability: Number(parsed.winProbability || 0.5),
    kellyFraction: Number(parsed.kellyFraction || 0),
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
