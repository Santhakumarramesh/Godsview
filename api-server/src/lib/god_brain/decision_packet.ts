/**
 * Decision Packet Store — Phase 25
 *
 * Stores, queries, and replays all strategic decisions made by the God Brain.
 * Each packet is immutable and contains full context for audit, learning, and replay.
 */

import { logger } from "../logger";
import crypto from "crypto";

export type DecisionAction = "buy" | "sell" | "hold" | "reject";
export type MarketRegime = "uptrend" | "downtrend" | "choppy" | "consolidation" | "low_volume";
export type CertificationStatus = "pending" | "approved" | "flagged" | "rejected";

export interface DecisionPacket {
  packet_id: string;
  timestamp: Date;
  strategy_id: string;
  symbol: string;
  action: DecisionAction;
  market_regime: MarketRegime;
  data_truth_score: number; // 0-1 confidence in data quality
  signal_confidence: number; // 0-1 confidence in signal
  execution_truth_score: number; // 0-1 expected exec quality
  slippage_profile: {
    expected_pct: number;
    percentile_95: number;
  };
  certification_status: CertificationStatus;
  autonomy_eligibility: boolean;
  portfolio_impact: {
    notional_usd: number;
    max_loss_usd: number;
    position_size_pct: number;
  };
  final_action: DecisionAction; // After all filters applied
  reasoning: Array<{
    stage: string;
    conclusion: string;
    confidence: number;
  }>;
  risk_level: "low" | "medium" | "high" | "critical";
  created_at: Date;
  replay_marked_at?: Date;
}

// ── In-memory store ──────────────────────────────────────────────

const packets: Map<string, DecisionPacket> = new Map();

// ── ID generation ────────────────────────────────────────────────

function generatePacketId(): string {
  return `dpk_${crypto.randomBytes(8).toString("hex")}`;
}

// ── Core operations ─────────────────────────────────────────────

export function createDecisionPacket(params: {
  strategy_id: string;
  symbol: string;
  action: DecisionAction;
  market_regime: MarketRegime;
  data_truth_score: number;
  signal_confidence: number;
  execution_truth_score: number;
  slippage_profile?: { expected_pct: number; percentile_95: number };
  certification_status?: CertificationStatus;
  autonomy_eligible?: boolean;
  portfolio_impact?: {
    notional_usd: number;
    max_loss_usd: number;
    position_size_pct: number;
  };
  final_action?: DecisionAction;
  reasoning?: Array<{ stage: string; conclusion: string; confidence: number }>;
  risk_level?: "low" | "medium" | "high" | "critical";
}): DecisionPacket {
  const packet_id = generatePacketId();
  const now = new Date();

  // Clamp truth scores first
  const clamped_data_truth = Math.max(0, Math.min(1, params.data_truth_score));
  const clamped_signal_confidence = Math.max(0, Math.min(1, params.signal_confidence));
  const clamped_execution_truth = Math.max(0, Math.min(1, params.execution_truth_score));

  // Compute autonomy eligibility: all truth scores must be > 0.85, signal confidence > 0.8
  const autonomy_eligibility =
    clamped_data_truth > 0.85 &&
    clamped_execution_truth > 0.85 &&
    clamped_signal_confidence > 0.8;

  const packet: DecisionPacket = {
    packet_id,
    timestamp: now,
    strategy_id: params.strategy_id,
    symbol: params.symbol,
    action: params.action,
    market_regime: params.market_regime,
    data_truth_score: clamped_data_truth,
    signal_confidence: clamped_signal_confidence,
    execution_truth_score: clamped_execution_truth,
    slippage_profile: params.slippage_profile ?? { expected_pct: 0.05, percentile_95: 0.15 },
    certification_status: params.certification_status ?? "pending",
    autonomy_eligibility,
    portfolio_impact: params.portfolio_impact ?? {
      notional_usd: 0,
      max_loss_usd: 0,
      position_size_pct: 0,
    },
    final_action: params.final_action ?? params.action,
    reasoning: params.reasoning ?? [],
    risk_level: params.risk_level ?? "medium",
    created_at: now,
  };

  packets.set(packet_id, packet);
  logger.debug(
    { packet_id, symbol: params.symbol, action: params.action, autonomy_eligibility },
    "Decision packet created"
  );

  return packet;
}

export function getPacket(packet_id: string): DecisionPacket | undefined {
  return packets.get(packet_id);
}

export function getAllPackets(limit: number = 100): DecisionPacket[] {
  const sorted = Array.from(packets.values()).sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );
  return sorted.slice(0, limit);
}

export function queryPackets(filters: {
  strategy_id?: string;
  symbol?: string;
  action?: DecisionAction;
  certification_status?: CertificationStatus;
  autonomy_eligible?: boolean;
  risk_level?: string;
  limit?: number;
}): DecisionPacket[] {
  let results = Array.from(packets.values());

  if (filters.strategy_id) {
    results = results.filter((p) => p.strategy_id === filters.strategy_id);
  }
  if (filters.symbol) {
    results = results.filter((p) => p.symbol === filters.symbol);
  }
  if (filters.action) {
    results = results.filter((p) => p.action === filters.action);
  }
  if (filters.certification_status) {
    results = results.filter((p) => p.certification_status === filters.certification_status);
  }
  if (filters.autonomy_eligible !== undefined) {
    results = results.filter((p) => p.autonomy_eligibility === filters.autonomy_eligible);
  }
  if (filters.risk_level) {
    results = results.filter((p) => p.risk_level === filters.risk_level);
  }

  results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return results.slice(0, filters.limit ?? 100);
}

export function markForReplay(packet_id: string): DecisionPacket | undefined {
  const packet = packets.get(packet_id);
  if (!packet) return undefined;
  packet.replay_marked_at = new Date();
  logger.debug({ packet_id }, "Packet marked for replay analysis");
  return packet;
}

// ── Testing ──────────────────────────────────────────────────────

export function _clearAll(): void {
  packets.clear();
}
