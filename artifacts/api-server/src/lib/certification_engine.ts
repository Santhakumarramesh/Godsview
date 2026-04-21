/**
 * Strategy Certification Engine
 *
 * Implements the formal promotion workflow for strategies.
 * A strategy must pass all evidence gates to earn a higher trust tier.
 *
 * Gates:
 * 1. Backtest — sufficient trade count, positive Sharpe, acceptable win rate
 * 2. Walk-forward — OOS degradation within bounds
 * 3. Stress test — survives Monte Carlo, regime shock, etc.
 * 4. Shadow/paper — sufficient paper trades with positive outcomes
 * 5. Alignment — backtest↔live alignment score above threshold
 * 6. Slippage — actual slippage within calibrated bounds
 * 7. Execution quality — fill rate, latency within bounds
 *
 * This is the capstone module: it queries Phase 12 (execution truth),
 * Phase 13 (alignment), and Phase 14 (ML ops) to build a complete
 * evidence packet, then makes a certification decision.
 */

import { logger } from "./logger";
import {
  db,
  strategyCertificationsTable,
} from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────

export type CertificationStatus = "initiated" | "collecting" | "review" | "certified" | "rejected" | "expired";
export type TargetTier = "paper_approved" | "live_assisted" | "autonomous_candidate";

export interface GateResult {
  gate: string;
  passed: boolean;
  details: string;
  metrics?: Record<string, number>;
}

export interface EvidencePacket {
  strategy_id: string;
  target_tier: TargetTier;
  gates: GateResult[];
  all_gates_passed: boolean;
  summary: string;
  metrics: {
    backtest_sharpe?: number;
    backtest_win_rate?: number;
    live_sharpe?: number;
    live_win_rate?: number;
    alignment_score?: number;
    avg_slippage_bps?: number;
    paper_trade_count?: number;
    paper_pnl?: number;
  };
}

// ── Certification Requirements per Tier ────────────────────────

export interface TierRequirements {
  min_backtest_sharpe: number;
  min_backtest_win_rate: number;
  min_backtest_trades: number;
  min_walkforward_pass_rate: number;
  min_stress_survival: number;
  min_paper_trades: number;
  min_paper_win_rate: number;
  min_alignment_score: number;
  max_slippage_bps: number;
  max_execution_latency_ms: number;
}

export const TIER_REQUIREMENTS: Record<TargetTier, TierRequirements> = {
  paper_approved: {
    min_backtest_sharpe: 0.5,
    min_backtest_win_rate: 0.50,
    min_backtest_trades: 50,
    min_walkforward_pass_rate: 0.60,
    min_stress_survival: 0.50,
    min_paper_trades: 0,       // no paper requirement for paper tier
    min_paper_win_rate: 0,
    min_alignment_score: 0,    // no alignment requirement yet
    max_slippage_bps: 50,
    max_execution_latency_ms: 10000,
  },
  live_assisted: {
    min_backtest_sharpe: 0.8,
    min_backtest_win_rate: 0.52,
    min_backtest_trades: 100,
    min_walkforward_pass_rate: 0.70,
    min_stress_survival: 0.60,
    min_paper_trades: 30,
    min_paper_win_rate: 0.50,
    min_alignment_score: 0.60,
    max_slippage_bps: 20,
    max_execution_latency_ms: 5000,
  },
  autonomous_candidate: {
    min_backtest_sharpe: 1.2,
    min_backtest_win_rate: 0.55,
    min_backtest_trades: 200,
    min_walkforward_pass_rate: 0.80,
    min_stress_survival: 0.70,
    min_paper_trades: 100,
    min_paper_win_rate: 0.53,
    min_alignment_score: 0.75,
    max_slippage_bps: 15,
    max_execution_latency_ms: 2000,
  },
};

// ── Gate Evaluation (Pure Functions) ───────────────────────────

/**
 * Evaluate the backtest gate.
 */
export function evaluateBacktestGate(
  reqs: TierRequirements,
  sharpe: number,
  winRate: number,
  tradeCount: number,
): GateResult {
  const checks = [
    { ok: tradeCount >= reqs.min_backtest_trades, msg: `trades ${tradeCount} >= ${reqs.min_backtest_trades}` },
    { ok: sharpe >= reqs.min_backtest_sharpe, msg: `Sharpe ${sharpe.toFixed(2)} >= ${reqs.min_backtest_sharpe}` },
    { ok: winRate >= reqs.min_backtest_win_rate, msg: `WR ${(winRate * 100).toFixed(1)}% >= ${(reqs.min_backtest_win_rate * 100).toFixed(0)}%` },
  ];
  const failed = checks.filter(c => !c.ok);
  return {
    gate: "backtest",
    passed: failed.length === 0,
    details: failed.length === 0
      ? `Passed: Sharpe=${sharpe.toFixed(2)}, WR=${(winRate * 100).toFixed(1)}%, trades=${tradeCount}`
      : `Failed: ${failed.map(f => f.msg).join("; ")}`,
    metrics: { sharpe, win_rate: winRate, trade_count: tradeCount },
  };
}

/**
 * Evaluate the walk-forward gate.
 */
export function evaluateWalkForwardGate(
  reqs: TierRequirements,
  passRate: number,
): GateResult {
  return {
    gate: "walkforward",
    passed: passRate >= reqs.min_walkforward_pass_rate,
    details: passRate >= reqs.min_walkforward_pass_rate
      ? `Passed: ${(passRate * 100).toFixed(0)}% windows pass (need ${(reqs.min_walkforward_pass_rate * 100).toFixed(0)}%)`
      : `Failed: ${(passRate * 100).toFixed(0)}% windows pass (need ${(reqs.min_walkforward_pass_rate * 100).toFixed(0)}%)`,
    metrics: { pass_rate: passRate },
  };
}

/**
 * Evaluate the stress test gate.
 */
export function evaluateStressGate(
  reqs: TierRequirements,
  survivalRate: number,
): GateResult {
  return {
    gate: "stress_test",
    passed: survivalRate >= reqs.min_stress_survival,
    details: survivalRate >= reqs.min_stress_survival
      ? `Passed: ${(survivalRate * 100).toFixed(0)}% survival (need ${(reqs.min_stress_survival * 100).toFixed(0)}%)`
      : `Failed: ${(survivalRate * 100).toFixed(0)}% survival (need ${(reqs.min_stress_survival * 100).toFixed(0)}%)`,
    metrics: { survival_rate: survivalRate },
  };
}

/**
 * Evaluate the paper/shadow trading gate.
 */
export function evaluateShadowGate(
  reqs: TierRequirements,
  paperTrades: number,
  paperWinRate: number,
  paperPnl: number,
): GateResult {
  if (reqs.min_paper_trades === 0) {
    return { gate: "shadow", passed: true, details: "No paper requirement for this tier" };
  }

  const checks = [
    { ok: paperTrades >= reqs.min_paper_trades, msg: `trades ${paperTrades} >= ${reqs.min_paper_trades}` },
    { ok: paperWinRate >= reqs.min_paper_win_rate, msg: `WR ${(paperWinRate * 100).toFixed(1)}% >= ${(reqs.min_paper_win_rate * 100).toFixed(0)}%` },
    { ok: paperPnl >= 0, msg: `PnL $${paperPnl.toFixed(2)} >= $0` },
  ];
  const failed = checks.filter(c => !c.ok);

  return {
    gate: "shadow",
    passed: failed.length === 0,
    details: failed.length === 0
      ? `Passed: ${paperTrades} trades, WR=${(paperWinRate * 100).toFixed(1)}%, PnL=$${paperPnl.toFixed(2)}`
      : `Failed: ${failed.map(f => f.msg).join("; ")}`,
    metrics: { paper_trades: paperTrades, paper_win_rate: paperWinRate, paper_pnl: paperPnl },
  };
}

/**
 * Evaluate the alignment gate.
 */
export function evaluateAlignmentGate(
  reqs: TierRequirements,
  alignmentScore: number,
): GateResult {
  if (reqs.min_alignment_score === 0) {
    return { gate: "alignment", passed: true, details: "No alignment requirement for this tier" };
  }
  return {
    gate: "alignment",
    passed: alignmentScore >= reqs.min_alignment_score,
    details: alignmentScore >= reqs.min_alignment_score
      ? `Passed: score ${alignmentScore.toFixed(2)} >= ${reqs.min_alignment_score}`
      : `Failed: score ${alignmentScore.toFixed(2)} < ${reqs.min_alignment_score}`,
    metrics: { alignment_score: alignmentScore },
  };
}

/**
 * Evaluate the slippage gate.
 */
export function evaluateSlippageGate(
  reqs: TierRequirements,
  avgSlippageBps: number,
): GateResult {
  return {
    gate: "slippage",
    passed: avgSlippageBps <= reqs.max_slippage_bps,
    details: avgSlippageBps <= reqs.max_slippage_bps
      ? `Passed: ${avgSlippageBps.toFixed(1)} bps <= ${reqs.max_slippage_bps} bps`
      : `Failed: ${avgSlippageBps.toFixed(1)} bps > ${reqs.max_slippage_bps} bps max`,
    metrics: { avg_slippage_bps: avgSlippageBps },
  };
}

/**
 * Evaluate the execution quality gate.
 */
export function evaluateExecutionQualityGate(
  reqs: TierRequirements,
  avgLatencyMs: number,
  fillRate: number,
): GateResult {
  const checks = [
    { ok: avgLatencyMs <= reqs.max_execution_latency_ms, msg: `latency ${avgLatencyMs}ms <= ${reqs.max_execution_latency_ms}ms` },
    { ok: fillRate >= 0.90, msg: `fill rate ${(fillRate * 100).toFixed(0)}% >= 90%` },
  ];
  const failed = checks.filter(c => !c.ok);
  return {
    gate: "execution_quality",
    passed: failed.length === 0,
    details: failed.length === 0
      ? `Passed: latency=${avgLatencyMs}ms, fill=${(fillRate * 100).toFixed(0)}%`
      : `Failed: ${failed.map(f => f.msg).join("; ")}`,
    metrics: { avg_latency_ms: avgLatencyMs, fill_rate: fillRate },
  };
}

// ── Build Evidence Packet ──────────────────────────────────────

/**
 * Build a complete evidence packet by evaluating all gates.
 * Pure function — takes all inputs, produces a deterministic result.
 */
export function buildEvidencePacket(
  strategyId: string,
  targetTier: TargetTier,
  inputs: {
    backtest_sharpe: number;
    backtest_win_rate: number;
    backtest_trade_count: number;
    walkforward_pass_rate: number;
    stress_survival_rate: number;
    paper_trade_count: number;
    paper_win_rate: number;
    paper_pnl: number;
    alignment_score: number;
    avg_slippage_bps: number;
    avg_latency_ms: number;
    fill_rate: number;
    live_sharpe?: number;
    live_win_rate?: number;
  },
): EvidencePacket {
  const reqs = TIER_REQUIREMENTS[targetTier];

  const gates: GateResult[] = [
    evaluateBacktestGate(reqs, inputs.backtest_sharpe, inputs.backtest_win_rate, inputs.backtest_trade_count),
    evaluateWalkForwardGate(reqs, inputs.walkforward_pass_rate),
    evaluateStressGate(reqs, inputs.stress_survival_rate),
    evaluateShadowGate(reqs, inputs.paper_trade_count, inputs.paper_win_rate, inputs.paper_pnl),
    evaluateAlignmentGate(reqs, inputs.alignment_score),
    evaluateSlippageGate(reqs, inputs.avg_slippage_bps),
    evaluateExecutionQualityGate(reqs, inputs.avg_latency_ms, inputs.fill_rate),
  ];

  const allPassed = gates.every(g => g.passed);
  const passedCount = gates.filter(g => g.passed).length;
  const failedGates = gates.filter(g => !g.passed).map(g => g.gate);

  const summary = allPassed
    ? `All ${gates.length} gates passed for ${targetTier} certification`
    : `${passedCount}/${gates.length} gates passed. Failed: ${failedGates.join(", ")}`;

  return {
    strategy_id: strategyId,
    target_tier: targetTier,
    gates,
    all_gates_passed: allPassed,
    summary,
    metrics: {
      backtest_sharpe: inputs.backtest_sharpe,
      backtest_win_rate: inputs.backtest_win_rate,
      live_sharpe: inputs.live_sharpe,
      live_win_rate: inputs.live_win_rate,
      alignment_score: inputs.alignment_score,
      avg_slippage_bps: inputs.avg_slippage_bps,
      paper_trade_count: inputs.paper_trade_count,
      paper_pnl: inputs.paper_pnl,
    },
  };
}

// ── Persistence ────────────────────────────────────────────────

/**
 * Initiate a certification process.
 */
export async function initiateCertification(
  strategyId: string,
  targetTier: TargetTier,
  currentTier?: string,
): Promise<number | null> {
  try {
    const rows = await db.insert(strategyCertificationsTable).values({
      strategy_id: strategyId,
      target_tier: targetTier,
      current_tier: currentTier,
      status: "initiated",
    }).returning({ id: strategyCertificationsTable.id });

    const id = rows[0]?.id ?? null;
    logger.info({ strategyId, targetTier, certificationId: id }, "Certification initiated");
    return id;
  } catch (err) {
    logger.error({ err, strategyId }, "Failed to initiate certification");
    return null;
  }
}

/**
 * Complete a certification with evidence.
 */
export async function completeCertification(
  certificationId: number,
  packet: EvidencePacket,
  approvedBy?: string,
): Promise<boolean> {
  try {
    const status = packet.all_gates_passed ? "certified" : "rejected";
    const expiresAt = packet.all_gates_passed
      ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90-day validity
      : null;

    await db.update(strategyCertificationsTable)
      .set({
        status,
        backtest_pass: packet.gates.find(g => g.gate === "backtest")?.passed ?? null,
        walkforward_pass: packet.gates.find(g => g.gate === "walkforward")?.passed ?? null,
        stress_test_pass: packet.gates.find(g => g.gate === "stress_test")?.passed ?? null,
        shadow_pass: packet.gates.find(g => g.gate === "shadow")?.passed ?? null,
        alignment_pass: packet.gates.find(g => g.gate === "alignment")?.passed ?? null,
        slippage_pass: packet.gates.find(g => g.gate === "slippage")?.passed ?? null,
        execution_quality_pass: packet.gates.find(g => g.gate === "execution_quality")?.passed ?? null,
        backtest_sharpe: packet.metrics.backtest_sharpe != null ? String(packet.metrics.backtest_sharpe) : null,
        backtest_win_rate: packet.metrics.backtest_win_rate != null ? String(packet.metrics.backtest_win_rate) : null,
        live_sharpe: packet.metrics.live_sharpe != null ? String(packet.metrics.live_sharpe) : null,
        live_win_rate: packet.metrics.live_win_rate != null ? String(packet.metrics.live_win_rate) : null,
        alignment_score: packet.metrics.alignment_score != null ? String(packet.metrics.alignment_score) : null,
        avg_slippage_bps: packet.metrics.avg_slippage_bps != null ? String(packet.metrics.avg_slippage_bps) : null,
        paper_trade_count: packet.metrics.paper_trade_count,
        paper_pnl: packet.metrics.paper_pnl != null ? String(packet.metrics.paper_pnl) : null,
        evidence_json: { gates: packet.gates, summary: packet.summary },
        approved_by: packet.all_gates_passed ? (approvedBy ?? "auto") : null,
        rejection_reason: packet.all_gates_passed ? null : packet.summary,
        completed_at: new Date(),
        expires_at: expiresAt,
      })
      .where(eq(strategyCertificationsTable.id, certificationId));

    logger.info({
      certificationId,
      strategy: packet.strategy_id,
      status,
      gatesPassed: packet.gates.filter(g => g.passed).length,
      totalGates: packet.gates.length,
    }, `Certification ${status}`);

    return true;
  } catch (err) {
    logger.error({ err, certificationId }, "Failed to complete certification");
    return false;
  }
}

/**
 * Get certification history for a strategy.
 */
export async function getCertificationHistory(
  strategyId: string,
  limit: number = 20,
): Promise<any[]> {
  return db.select()
    .from(strategyCertificationsTable)
    .where(eq(strategyCertificationsTable.strategy_id, strategyId))
    .orderBy(desc(strategyCertificationsTable.created_at))
    .limit(limit);
}

/**
 * Get the latest valid certification for a strategy.
 */
export async function getActiveCertification(strategyId: string): Promise<any | null> {
  const rows = await db.select()
    .from(strategyCertificationsTable)
    .where(and(
      eq(strategyCertificationsTable.strategy_id, strategyId),
      eq(strategyCertificationsTable.status, "certified"),
    ))
    .orderBy(desc(strategyCertificationsTable.completed_at))
    .limit(1);

  const cert = rows[0];
  if (!cert) return null;

  // Check expiry
  if (cert.expires_at && new Date(cert.expires_at) < new Date()) {
    // Mark as expired
    await db.update(strategyCertificationsTable)
      .set({ status: "expired" })
      .where(eq(strategyCertificationsTable.id, cert.id));
    return null;
  }

  return cert;
}

/**
 * Get all pending certifications (for operator review).
 */
export async function getPendingCertifications(): Promise<any[]> {
  return db.select()
    .from(strategyCertificationsTable)
    .where(eq(strategyCertificationsTable.status, "review"))
    .orderBy(desc(strategyCertificationsTable.created_at))
    .limit(50);
}
