/**
 * Phase 27 — Production Validation Backbone
 * Readiness Scorer
 *
 * Computes a readiness score for strategy promotion decisions.
 * Identifies promotion blockers when required thresholds are not met.
 */

import crypto from "crypto";
import {
  getSession,
  getSessionsByStrategy,
  type ValidationSession,
} from "./validation_session_manager";
import {
  getReportsByStrategy,
  type ComparisonReport,
} from "./comparison_engine";

// ── Types ────────────────────────────────────────────────────────────────

export type ReadinessLevel = "ready" | "conditional" | "not_ready" | "blocked";
export type BlockerSeverity = "warning" | "critical" | "fatal";

export interface PromotionBlocker {
  blocker_id: string;
  category: string;
  severity: BlockerSeverity;
  metric: string;
  required_value: number;
  actual_value: number;
  message: string;
}

export interface ReadinessScore {
  score_id: string;
  strategy_id: string;
  computed_at: Date;
  overall_score: number; // 0-100
  readiness_level: ReadinessLevel;
  dimensions: ReadinessDimension[];
  blockers: PromotionBlocker[];
  eligible_for_promotion: boolean;
  next_promotion_target: string;
  recommendation: string;
  evidence_summary: {
    validation_sessions_completed: number;
    comparison_reports_available: number;
    latest_alignment: string;
    total_validated_trades: number;
  };
}

export interface ReadinessDimension {
  name: string;
  score: number; // 0-100
  weight: number;
  status: "pass" | "warn" | "fail";
  details: string;
}

// ── Thresholds ───────────────────────────────────────────────────────────

export const PROMOTION_THRESHOLDS = {
  min_validation_sessions: 1,
  min_validated_trades: 10,
  min_hit_rate: 0.40,
  max_reject_rate: 0.25,
  max_avg_slippage_bps: 15,
  max_signal_to_fill_delay_ms: 5000,
  max_drawdown_pct: 15,
  min_profit_factor: 1.1,
  max_comparison_critical_deviations: 0,
  min_comparison_alignment: "acceptable" as const,
} as const;

// ── Store ────────────────────────────────────────────────────────────────

const scores = new Map<string, ReadinessScore>();

// ── Scoring Engine ───────────────────────────────────────────────────────

function scoreHitRate(hitRate: number): ReadinessDimension {
  const threshold = PROMOTION_THRESHOLDS.min_hit_rate;
  const score = Math.min(100, (hitRate / threshold) * 100);
  return {
    name: "hit_rate",
    score: Math.round(score),
    weight: 20,
    status: hitRate >= threshold ? "pass" : hitRate >= threshold * 0.8 ? "warn" : "fail",
    details: `Hit rate: ${(hitRate * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%)`,
  };
}

function scoreSlippage(avgSlippage: number): ReadinessDimension {
  const threshold = PROMOTION_THRESHOLDS.max_avg_slippage_bps;
  const score = avgSlippage <= threshold ? 100 : Math.max(0, 100 - ((avgSlippage - threshold) / threshold) * 100);
  return {
    name: "slippage",
    score: Math.round(score),
    weight: 15,
    status: avgSlippage <= threshold ? "pass" : avgSlippage <= threshold * 1.5 ? "warn" : "fail",
    details: `Avg slippage: ${avgSlippage.toFixed(1)} bps (max: ${threshold} bps)`,
  };
}

function scoreFillDelay(delayMs: number): ReadinessDimension {
  const threshold = PROMOTION_THRESHOLDS.max_signal_to_fill_delay_ms;
  const score = delayMs <= threshold ? 100 : Math.max(0, 100 - ((delayMs - threshold) / threshold) * 100);
  return {
    name: "fill_delay",
    score: Math.round(score),
    weight: 10,
    status: delayMs <= threshold ? "pass" : delayMs <= threshold * 1.5 ? "warn" : "fail",
    details: `Signal-to-fill: ${delayMs.toFixed(0)} ms (max: ${threshold} ms)`,
  };
}

function scoreRejectRate(rejectRate: number): ReadinessDimension {
  const threshold = PROMOTION_THRESHOLDS.max_reject_rate;
  const score = rejectRate <= threshold ? 100 : Math.max(0, 100 - ((rejectRate - threshold) / threshold) * 100);
  return {
    name: "reject_rate",
    score: Math.round(score),
    weight: 10,
    status: rejectRate <= threshold ? "pass" : rejectRate <= threshold * 1.5 ? "warn" : "fail",
    details: `Reject rate: ${(rejectRate * 100).toFixed(1)}% (max: ${(threshold * 100).toFixed(1)}%)`,
  };
}

function scoreDrawdown(maxDD: number): ReadinessDimension {
  const threshold = PROMOTION_THRESHOLDS.max_drawdown_pct;
  const ddPct = Math.abs(maxDD);
  const score = ddPct <= threshold ? 100 : Math.max(0, 100 - ((ddPct - threshold) / threshold) * 100);
  return {
    name: "drawdown",
    score: Math.round(score),
    weight: 20,
    status: ddPct <= threshold ? "pass" : ddPct <= threshold * 1.3 ? "warn" : "fail",
    details: `Max drawdown: ${ddPct.toFixed(2)}% (max: ${threshold}%)`,
  };
}

function scoreAlignment(reports: ComparisonReport[]): ReadinessDimension {
  if (reports.length === 0) {
    return {
      name: "alignment",
      score: 0,
      weight: 25,
      status: "fail",
      details: "No comparison reports available",
    };
  }

  const latest = reports[0];
  const alignmentScores: Record<string, number> = {
    strong: 100,
    acceptable: 70,
    degraded: 35,
    failed: 0,
  };
  const score = alignmentScores[latest.summary.overall_alignment] ?? 0;

  return {
    name: "alignment",
    score,
    weight: 25,
    status: score >= 70 ? "pass" : score >= 35 ? "warn" : "fail",
    details: `Latest alignment: ${latest.summary.overall_alignment} (${latest.summary.warnings} warnings, ${latest.summary.critical} critical)`,
  };
}

function identifyBlockers(
  sessions: ValidationSession[],
  reports: ComparisonReport[],
  totalTrades: number,
  aggregateMetrics: { hit_rate: number; avg_slippage_bps: number; signal_to_fill_delay_ms: number; reject_rate: number; max_drawdown: number }
): PromotionBlocker[] {
  const blockers: PromotionBlocker[] = [];

  const completedSessions = sessions.filter((s) => s.status === "completed");
  if (completedSessions.length < PROMOTION_THRESHOLDS.min_validation_sessions) {
    blockers.push({
      blocker_id: `pvb_${crypto.randomBytes(4).toString("hex")}`,
      category: "validation_coverage",
      severity: "fatal",
      metric: "completed_sessions",
      required_value: PROMOTION_THRESHOLDS.min_validation_sessions,
      actual_value: completedSessions.length,
      message: `Requires at least ${PROMOTION_THRESHOLDS.min_validation_sessions} completed validation session(s)`,
    });
  }

  if (totalTrades < PROMOTION_THRESHOLDS.min_validated_trades) {
    blockers.push({
      blocker_id: `pvb_${crypto.randomBytes(4).toString("hex")}`,
      category: "trade_coverage",
      severity: "fatal",
      metric: "validated_trades",
      required_value: PROMOTION_THRESHOLDS.min_validated_trades,
      actual_value: totalTrades,
      message: `Requires at least ${PROMOTION_THRESHOLDS.min_validated_trades} validated trades`,
    });
  }

  if (totalTrades > 0 && aggregateMetrics.hit_rate < PROMOTION_THRESHOLDS.min_hit_rate) {
    blockers.push({
      blocker_id: `pvb_${crypto.randomBytes(4).toString("hex")}`,
      category: "performance",
      severity: "critical",
      metric: "hit_rate",
      required_value: PROMOTION_THRESHOLDS.min_hit_rate,
      actual_value: aggregateMetrics.hit_rate,
      message: `Hit rate ${(aggregateMetrics.hit_rate * 100).toFixed(1)}% below minimum ${(PROMOTION_THRESHOLDS.min_hit_rate * 100).toFixed(1)}%`,
    });
  }

  if (aggregateMetrics.avg_slippage_bps > PROMOTION_THRESHOLDS.max_avg_slippage_bps) {
    blockers.push({
      blocker_id: `pvb_${crypto.randomBytes(4).toString("hex")}`,
      category: "execution_quality",
      severity: "critical",
      metric: "avg_slippage_bps",
      required_value: PROMOTION_THRESHOLDS.max_avg_slippage_bps,
      actual_value: aggregateMetrics.avg_slippage_bps,
      message: `Average slippage ${aggregateMetrics.avg_slippage_bps.toFixed(1)} bps exceeds max ${PROMOTION_THRESHOLDS.max_avg_slippage_bps} bps`,
    });
  }

  if (reports.length > 0) {
    const latest = reports[0];
    if (latest.summary.critical > PROMOTION_THRESHOLDS.max_comparison_critical_deviations) {
      blockers.push({
        blocker_id: `pvb_${crypto.randomBytes(4).toString("hex")}`,
        category: "alignment",
        severity: "critical",
        metric: "critical_deviations",
        required_value: PROMOTION_THRESHOLDS.max_comparison_critical_deviations,
        actual_value: latest.summary.critical,
        message: `${latest.summary.critical} critical deviation(s) in latest comparison report`,
      });
    }
  }

  return blockers;
}

// ── Main Scoring Function ────────────────────────────────────────────────

export function computeReadinessScore(strategy_id: string): ReadinessScore {
  const strategySessions = getSessionsByStrategy(strategy_id);
  const comparisonReports = getReportsByStrategy(strategy_id);

  // Aggregate metrics across completed sessions
  const completedSessions = strategySessions.filter((s) => s.status === "completed");
  let totalTrades = 0;
  let totalWins = 0;
  let totalSlippage = 0;
  let totalDelay = 0;
  let totalRejects = 0;
  let totalSignals = 0;
  let maxDD = 0;

  for (const s of completedSessions) {
    totalTrades += s.metrics.total_trades;
    totalWins += s.metrics.winning_trades;
    totalSlippage += s.metrics.avg_slippage_bps * s.metrics.total_trades;
    totalDelay += s.metrics.signal_to_fill_delay_ms * s.metrics.total_trades;
    totalRejects += s.metrics.rejected_signals;
    totalSignals += s.metrics.total_signals;
    if (Math.abs(s.metrics.max_intraday_drawdown) > Math.abs(maxDD)) {
      maxDD = s.metrics.max_intraday_drawdown;
    }
  }

  const aggregateMetrics = {
    hit_rate: totalTrades > 0 ? totalWins / totalTrades : 0,
    avg_slippage_bps: totalTrades > 0 ? totalSlippage / totalTrades : 0,
    signal_to_fill_delay_ms: totalTrades > 0 ? totalDelay / totalTrades : 0,
    reject_rate: totalSignals > 0 ? totalRejects / totalSignals : 0,
    max_drawdown: maxDD,
  };

  // Score dimensions
  const dimensions: ReadinessDimension[] = [
    scoreHitRate(aggregateMetrics.hit_rate),
    scoreSlippage(aggregateMetrics.avg_slippage_bps),
    scoreFillDelay(aggregateMetrics.signal_to_fill_delay_ms),
    scoreRejectRate(aggregateMetrics.reject_rate),
    scoreDrawdown(aggregateMetrics.max_drawdown),
    scoreAlignment(comparisonReports),
  ];

  // Weighted average score
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
  const overall_score = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight
  );

  // Identify blockers
  const blockers = identifyBlockers(
    strategySessions,
    comparisonReports,
    totalTrades,
    aggregateMetrics
  );

  const hasFatal = blockers.some((b) => b.severity === "fatal");
  const hasCritical = blockers.some((b) => b.severity === "critical");
  const hasFail = dimensions.some((d) => d.status === "fail");

  let readiness_level: ReadinessLevel;
  let eligible_for_promotion: boolean;
  let recommendation: string;

  if (hasFatal) {
    readiness_level = "blocked";
    eligible_for_promotion = false;
    recommendation = "Fatal blockers must be resolved before promotion is possible.";
  } else if (hasCritical || hasFail) {
    readiness_level = "not_ready";
    eligible_for_promotion = false;
    recommendation = "Critical issues detected. Address blockers and re-validate.";
  } else if (overall_score >= 70) {
    readiness_level = "ready";
    eligible_for_promotion = true;
    recommendation = "Strategy meets all promotion criteria. Eligible for next lifecycle stage.";
  } else {
    readiness_level = "conditional";
    eligible_for_promotion = false;
    recommendation = "Overall score below threshold. Additional validation recommended.";
  }

  const score: ReadinessScore = {
    score_id: `pvs_${crypto.randomBytes(8).toString("hex")}`,
    strategy_id,
    computed_at: new Date(),
    overall_score,
    readiness_level,
    dimensions,
    blockers,
    eligible_for_promotion,
    next_promotion_target: "paper_approved",
    recommendation,
    evidence_summary: {
      validation_sessions_completed: completedSessions.length,
      comparison_reports_available: comparisonReports.length,
      latest_alignment:
        comparisonReports.length > 0
          ? comparisonReports[0].summary.overall_alignment
          : "none",
      total_validated_trades: totalTrades,
    },
  };

  scores.set(score.score_id, score);
  return score;
}

// ── Queries ──────────────────────────────────────────────────────────────

export function getReadinessScore(score_id: string): ReadinessScore | undefined {
  return scores.get(score_id);
}

export function getLatestScoreByStrategy(strategy_id: string): ReadinessScore | undefined {
  return Array.from(scores.values())
    .filter((s) => s.strategy_id === strategy_id)
    .sort((a, b) => b.computed_at.getTime() - a.computed_at.getTime())[0];
}

export function getAllScores(limit = 50): ReadinessScore[] {
  return Array.from(scores.values())
    .sort((a, b) => b.computed_at.getTime() - a.computed_at.getTime())
    .slice(0, limit);
}

// ── Testing ──────────────────────────────────────────────────────────────

export function _clearScores(): void {
  scores.clear();
}
