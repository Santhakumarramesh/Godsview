/**
 * Phase 27 — Production Validation Backbone
 * Comparison Engine
 *
 * Compares backtest expectations vs paper results vs live-shadow outcomes.
 * Produces structured comparison reports with deviation analysis.
 */

import crypto from "crypto";

// ── Types ────────────────────────────────────────────────────────────────

export interface PerformanceSnapshot {
  source: "backtest" | "paper" | "live_shadow";
  strategy_id: string;
  period: { start: string; end: string };
  trade_count: number;
  hit_rate: number;
  sharpe_ratio: number;
  profit_factor: number;
  max_drawdown_pct: number;
  avg_slippage_bps: number;
  total_pnl: number;
  win_rate: number;
  avg_trade_duration_ms: number;
  signal_to_fill_delay_ms: number;
  reject_rate: number;
  pnl_by_regime?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface DeviationResult {
  metric: string;
  backtest_value: number | null;
  paper_value: number | null;
  live_shadow_value: number | null;
  backtest_to_paper_deviation_pct: number | null;
  backtest_to_live_deviation_pct: number | null;
  paper_to_live_deviation_pct: number | null;
  severity: "ok" | "warning" | "critical";
  note: string;
}

export interface ComparisonReport {
  report_id: string;
  strategy_id: string;
  created_at: Date;
  snapshots: {
    backtest?: PerformanceSnapshot;
    paper?: PerformanceSnapshot;
    live_shadow?: PerformanceSnapshot;
  };
  deviations: DeviationResult[];
  summary: {
    total_deviations: number;
    warnings: number;
    critical: number;
    overall_alignment: "strong" | "acceptable" | "degraded" | "failed";
    recommendation: string;
  };
}

// ── Thresholds ───────────────────────────────────────────────────────────

const DEVIATION_THRESHOLDS: Record<string, { warning: number; critical: number }> = {
  hit_rate:               { warning: 0.10, critical: 0.20 },
  sharpe_ratio:           { warning: 0.25, critical: 0.50 },
  profit_factor:          { warning: 0.20, critical: 0.40 },
  max_drawdown_pct:       { warning: 0.25, critical: 0.50 },
  avg_slippage_bps:       { warning: 0.30, critical: 0.60 },
  total_pnl:              { warning: 0.20, critical: 0.40 },
  signal_to_fill_delay_ms:{ warning: 0.30, critical: 0.60 },
  reject_rate:            { warning: 0.15, critical: 0.30 },
};

// ── Store ────────────────────────────────────────────────────────────────

const reports = new Map<string, ComparisonReport>();

// ── Engine ───────────────────────────────────────────────────────────────

function computeDeviation(
  base: number | null,
  target: number | null
): number | null {
  if (base === null || target === null) return null;
  if (base === 0) return target === 0 ? 0 : 1;
  return Math.abs((target - base) / base);
}

function classifySeverity(
  metric: string,
  deviation: number | null
): "ok" | "warning" | "critical" {
  if (deviation === null) return "ok";
  const thresholds = DEVIATION_THRESHOLDS[metric];
  if (!thresholds) return deviation > 0.3 ? "warning" : "ok";
  if (deviation >= thresholds.critical) return "critical";
  if (deviation >= thresholds.warning) return "warning";
  return "ok";
}

function analyzeMetric(
  metric: string,
  backtest: PerformanceSnapshot | undefined,
  paper: PerformanceSnapshot | undefined,
  live: PerformanceSnapshot | undefined
): DeviationResult {
  const bVal = backtest ? (backtest as Record<string, unknown>)[metric] as number ?? null : null;
  const pVal = paper ? (paper as Record<string, unknown>)[metric] as number ?? null : null;
  const lVal = live ? (live as Record<string, unknown>)[metric] as number ?? null : null;

  const btpDev = computeDeviation(bVal, pVal);
  const btlDev = computeDeviation(bVal, lVal);
  const ptlDev = computeDeviation(pVal, lVal);

  // Worst deviation determines severity
  const maxDev = Math.max(
    ...[btpDev, btlDev, ptlDev].filter((d): d is number => d !== null)
  );
  const severity = isNaN(maxDev) ? "ok" : classifySeverity(metric, maxDev);

  let note = "";
  if (severity === "critical") {
    note = `${metric} shows critical divergence — investigate before promotion`;
  } else if (severity === "warning") {
    note = `${metric} has moderate deviation — monitor closely`;
  }

  return {
    metric,
    backtest_value: bVal,
    paper_value: pVal,
    live_shadow_value: lVal,
    backtest_to_paper_deviation_pct: btpDev !== null ? Math.round(btpDev * 10000) / 100 : null,
    backtest_to_live_deviation_pct: btlDev !== null ? Math.round(btlDev * 10000) / 100 : null,
    paper_to_live_deviation_pct: ptlDev !== null ? Math.round(ptlDev * 10000) / 100 : null,
    severity,
    note,
  };
}

export function generateComparisonReport(
  strategy_id: string,
  snapshots: {
    backtest?: PerformanceSnapshot;
    paper?: PerformanceSnapshot;
    live_shadow?: PerformanceSnapshot;
  }
): ComparisonReport {
  const metrics = [
    "hit_rate",
    "sharpe_ratio",
    "profit_factor",
    "max_drawdown_pct",
    "avg_slippage_bps",
    "total_pnl",
    "signal_to_fill_delay_ms",
    "reject_rate",
  ];

  const deviations = metrics.map((m) =>
    analyzeMetric(m, snapshots.backtest, snapshots.paper, snapshots.live_shadow)
  );

  const warnings = deviations.filter((d) => d.severity === "warning").length;
  const critical = deviations.filter((d) => d.severity === "critical").length;

  let overall_alignment: ComparisonReport["summary"]["overall_alignment"];
  let recommendation: string;

  if (critical >= 3) {
    overall_alignment = "failed";
    recommendation = "Strategy shows significant divergence. Do not promote. Investigate root causes.";
  } else if (critical >= 1) {
    overall_alignment = "degraded";
    recommendation = "Critical deviations detected. Resolve before considering promotion.";
  } else if (warnings >= 3) {
    overall_alignment = "acceptable";
    recommendation = "Multiple warnings present. Promotion possible with restrictions and monitoring.";
  } else {
    overall_alignment = "strong";
    recommendation = "Metrics align well across sources. Strategy is eligible for promotion.";
  }

  const report: ComparisonReport = {
    report_id: `pvr_${crypto.randomBytes(8).toString("hex")}`,
    strategy_id,
    created_at: new Date(),
    snapshots,
    deviations,
    summary: {
      total_deviations: deviations.length,
      warnings,
      critical,
      overall_alignment,
      recommendation,
    },
  };

  reports.set(report.report_id, report);
  return report;
}

// ── Queries ──────────────────────────────────────────────────────────────

export function getReport(report_id: string): ComparisonReport | undefined {
  return reports.get(report_id);
}

export function getReportsByStrategy(strategy_id: string): ComparisonReport[] {
  return Array.from(reports.values())
    .filter((r) => r.strategy_id === strategy_id)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function getAllReports(limit = 50): ComparisonReport[] {
  return Array.from(reports.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit);
}

// ── Testing ──────────────────────────────────────────────────────────────

export function _clearReports(): void {
  reports.clear();
}
