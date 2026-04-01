/**
 * war_room.ts — Multi-agent War Room reasoning engine for GodsView
 *
 * Five independent agents evaluate trading setups:
 *   1. Structure Agent: BOS/CHoCH, trend, pattern strength
 *   2. Liquidity Agent: Pool sweeps, order blocks, FVG fills
 *   3. Microstructure Agent: Orderflow, delta, CVD, quote imbalance
 *   4. Risk Agent: Volatility, spreads, session state
 *   5. Judge Agent: Weighted consensus + final decision
 *
 * All agents are pure functions returning scores (0-1) and reasoning.
 * Results cached per symbol with 1-minute TTL.
 */

import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AgentVerdict {
  agent: string;
  score: number;
  bias: "bullish" | "bearish" | "neutral";
  reasoning: string;
  confidence: number;
}

export interface WarRoomVerdict {
  symbol: string;
  agents: AgentVerdict[];
  finalDecision: "approved" | "blocked" | "caution";
  finalScore: number;
  confidence: number;
  reasoning: string;
  evaluatedAt: string;
}

export interface SMCState {
  symbol: string;
  structureScore: number;
  bos: boolean;
  choch: boolean;
  trend: "uptrend" | "downtrend" | "range";
  pattern?: string;
  activeOBs: Array<{ high: number; low: number }>;
  unfilledFVGs: Array<{ high: number; low: number }>;
  sweptPools: number;
  totalPools: number;
}

export interface OrderflowState {
  delta: number;
  cvd: number;
  cvdSlope: number;
  quoteImbalance: number;
  aggressionScore: number;
  orderflowBias: "bullish" | "bearish" | "neutral";
  orderflowScore: number;
}

export interface RiskInput {
  volatilityRegime: "low" | "normal" | "high" | "extreme";
  spreadBps: number;
  maxLossToday: number;
  sessionActive: boolean;
}

// ── Cache ──────────────────────────────────────────────────────────────────────

interface CacheEntry {
  verdict: WarRoomVerdict;
  timestamp: number;
}

const warRoomCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

function getCached(symbol: string): WarRoomVerdict | null {
  const entry = warRoomCache.get(symbol);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > CACHE_TTL_MS) {
    warRoomCache.delete(symbol);
    return null;
  }

  return entry.verdict;
}

function setCached(symbol: string, verdict: WarRoomVerdict): void {
  warRoomCache.set(symbol, {
    verdict,
    timestamp: Date.now(),
  });
}

// ── Agent 1: Structure Agent ───────────────────────────────────────────────────

function structureAgent(smcState: SMCState): AgentVerdict {
  const {
    structureScore,
    bos,
    choch,
    trend,
    pattern,
  } = smcState;

  // Score: structureScore (0.5) + BOS bonus (0.2) + CHoCH bonus (0.15) + trend bonus (0.15)
  let score = structureScore * 0.5;
  if (bos) score += 0.2;
  if (choch) score += 0.15;
  if (trend !== "range") score += 0.15;

  score = Math.min(1, score); // clamp to 0-1

  // Bias from trend
  const bias = trend === "uptrend" ? "bullish" : trend === "downtrend" ? "bearish" : "neutral";

  // Reasoning
  const reasoningParts: string[] = [];
  reasoningParts.push(`Structure score: ${(structureScore * 100).toFixed(0)}%`);
  if (bos) reasoningParts.push("Break of Structure confirmed");
  if (choch) reasoningParts.push("Change of Character detected");
  reasoningParts.push(`Market in ${trend}`);
  if (pattern) reasoningParts.push(`Pattern: ${pattern}`);

  return {
    agent: "structure",
    score,
    bias,
    reasoning: reasoningParts.join("; "),
    confidence: 0.85,
  };
}

// ── Agent 2: Liquidity Agent ───────────────────────────────────────────────────

function liquidityAgent(smcState: SMCState): AgentVerdict {
  const {
    sweptPools,
    totalPools,
    activeOBs,
    unfilledFVGs,
  } = smcState;

  // Score: swept pools ratio (0.4) + active OBs bonus (0.3) + unfilled FVGs bonus (0.3)
  const sweptRatio = totalPools > 0 ? sweptPools / totalPools : 0;
  let score = sweptRatio * 0.4;

  if (activeOBs.length > 0) score += 0.3;
  if (unfilledFVGs.length > 0) score += 0.3;

  score = Math.min(1, score);

  // Bias from structure (more swept pools = bullish momentum)
  const bias = sweptRatio > 0.5 ? "bullish" : sweptRatio < 0.3 ? "bearish" : "neutral";

  const reasoningParts: string[] = [];
  reasoningParts.push(`Swept pools: ${sweptPools}/${totalPools} (${(sweptRatio * 100).toFixed(0)}%)`);
  if (activeOBs.length > 0) reasoningParts.push(`${activeOBs.length} active order block(s)`);
  if (unfilledFVGs.length > 0) reasoningParts.push(`${unfilledFVGs.length} unfilled FVG(s)`);

  return {
    agent: "liquidity",
    score,
    bias,
    reasoning: reasoningParts.join("; "),
    confidence: 0.8,
  };
}

// ── Agent 3: Microstructure Agent ──────────────────────────────────────────────

function microstructureAgent(orderflowState: OrderflowState): AgentVerdict {
  const {
    orderflowScore,
    aggressionScore,
    quoteImbalance,
    orderflowBias,
  } = orderflowState;

  // Score: orderflowScore (0.5) + aggressionScore (0.3) + quote imbalance bonus (0.2)
  let score = orderflowScore * 0.5;
  score += aggressionScore * 0.3;

  const absImbalance = Math.abs(quoteImbalance);
  if (absImbalance > 0.3) score += 0.2;

  score = Math.min(1, score);

  const reasoningParts: string[] = [];
  reasoningParts.push(`Orderflow score: ${(orderflowScore * 100).toFixed(0)}%`);
  reasoningParts.push(`Aggression: ${(aggressionScore * 100).toFixed(0)}%`);
  reasoningParts.push(`Quote imbalance: ${(Math.abs(quoteImbalance) * 100).toFixed(1)}%`);
  reasoningParts.push(`Bias: ${orderflowBias}`);

  return {
    agent: "microstructure",
    score,
    bias: orderflowBias,
    reasoning: reasoningParts.join("; "),
    confidence: 0.82,
  };
}

// ── Agent 4: Risk Agent ────────────────────────────────────────────────────────

function riskAgent(riskInput: RiskInput): AgentVerdict {
  const {
    volatilityRegime,
    spreadBps,
    maxLossToday,
    sessionActive,
  } = riskInput;

  let score = 1.0;

  // Penalize for extreme conditions
  if (volatilityRegime === "extreme") score -= 0.3;
  if (volatilityRegime === "high") score -= 0.15;

  if (spreadBps > 50) score -= 0.2;

  if (maxLossToday > 500) score -= 0.3;

  if (!sessionActive) score -= 0.2;

  score = Math.max(0, Math.min(1, score)); // clamp to 0-1

  const bias = score > 0.6 ? "bullish" : score < 0.4 ? "bearish" : "neutral";

  const reasoningParts: string[] = [];
  reasoningParts.push(`Volatility: ${volatilityRegime}`);
  reasoningParts.push(`Spread: ${spreadBps}bps`);
  reasoningParts.push(`Max loss today: $${maxLossToday}`);
  reasoningParts.push(`Session: ${sessionActive ? "active" : "inactive"}`);

  return {
    agent: "risk",
    score,
    bias,
    reasoning: reasoningParts.join("; "),
    confidence: 0.88,
  };
}

// ── Agent 5: Judge Agent ───────────────────────────────────────────────────────

function judgeAgent(agents: AgentVerdict[]): {
  finalDecision: "approved" | "blocked" | "caution";
  finalScore: number;
  reasoning: string;
  confidence: number;
} {
  // Find agents by name
  const structureVerd = agents.find((a) => a.agent === "structure");
  const liquidityVerd = agents.find((a) => a.agent === "liquidity");
  const microVerd = agents.find((a) => a.agent === "microstructure");
  const riskVerd = agents.find((a) => a.agent === "risk");

  // Weighted combination
  const structure = structureVerd?.score ?? 0;
  const liquidity = liquidityVerd?.score ?? 0;
  const micro = microVerd?.score ?? 0;
  const risk = riskVerd?.score ?? 0;

  const finalScore =
    structure * 0.3 +
    liquidity * 0.25 +
    micro * 0.25 +
    risk * 0.2;

  // Decision logic
  let finalDecision: "approved" | "blocked" | "caution";
  if (finalScore >= 0.7) {
    finalDecision = "approved";
  } else if (finalScore >= 0.5) {
    finalDecision = "caution";
  } else {
    finalDecision = "blocked";
  }

  // Reasoning summary
  const reasoningParts: string[] = [
    `Structure (30%): ${(structure * 100).toFixed(0)}%`,
    `Liquidity (25%): ${(liquidity * 100).toFixed(0)}%`,
    `Microstructure (25%): ${(micro * 100).toFixed(0)}%`,
    `Risk (20%): ${(risk * 100).toFixed(0)}%`,
    `—`,
    `Final consensus: ${(finalScore * 100).toFixed(1)}% → ${finalDecision.toUpperCase()}`,
  ];

  return {
    finalDecision,
    finalScore,
    reasoning: reasoningParts.join("\n"),
    confidence: 0.86,
  };
}

// ── Main War Room Engine ───────────────────────────────────────────────────────

/**
 * runWarRoom — Run all 5 agents and return consensus verdict
 *
 * @param symbol Trading symbol
 * @param smcState SMC analysis state
 * @param orderflowState Orderflow analysis state
 * @param riskInput Risk parameters
 * @returns WarRoomVerdict with all agent verdicts and final decision
 */
export function runWarRoom(
  symbol: string,
  smcState: SMCState,
  orderflowState: OrderflowState,
  riskInput: RiskInput,
): WarRoomVerdict {
  // Check cache first
  const cached = getCached(symbol);
  if (cached) {
    logger.debug(`[War Room] Cache hit for ${symbol}`);
    return cached;
  }

  try {
    // Run all 5 agents
    const structVerd = structureAgent(smcState);
    const liqVerd = liquidityAgent(smcState);
    const microVerd = microstructureAgent(orderflowState);
    const riskVerd = riskAgent(riskInput);

    // Collect verdicts
    const agents = [structVerd, liqVerd, microVerd, riskVerd];

    // Judge renders final decision
    const judge = judgeAgent(agents);

    const verdict: WarRoomVerdict = {
      symbol,
      agents,
      finalDecision: judge.finalDecision,
      finalScore: judge.finalScore,
      confidence: judge.confidence,
      reasoning: judge.reasoning,
      evaluatedAt: new Date().toISOString(),
    };

    // Cache result
    setCached(symbol, verdict);

    logger.info(`[War Room] Verdict for ${symbol}: ${judge.finalDecision} (${(judge.finalScore * 100).toFixed(1)}%)`);

    return verdict;
  } catch (error) {
    logger.error(`[War Room] Error running consensus: ${error instanceof Error ? error.message : "unknown"}`);

    // Return conservative blocked verdict on error
    return {
      symbol,
      agents: [],
      finalDecision: "blocked",
      finalScore: 0,
      confidence: 0,
      reasoning: `War Room evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Clear the war room cache (useful for testing or manual refresh)
 */
export function clearWarRoomCache(symbol?: string): void {
  if (symbol) {
    warRoomCache.delete(symbol);
    logger.info(`[War Room] Cache cleared for ${symbol}`);
  } else {
    warRoomCache.clear();
    logger.info("[War Room] Cache cleared (all symbols)");
  }
}

/**
 * Get cache stats (for monitoring)
 */
export function getWarRoomCacheStats(): {
  size: number;
  entries: string[];
} {
  return {
    size: warRoomCache.size,
    entries: Array.from(warRoomCache.keys()),
  };
}
