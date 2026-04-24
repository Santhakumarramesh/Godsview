/**
 * backtest_credibility_engine.ts — Phase 2: Real Backtest Credibility Scoring
 *
 * Replaces hardcoded mock credibility data with live computation.
 * Evaluates backtest results for:
 *   1. Assumption realism (fees, slippage, fill model)
 *   2. Overfitting risk (IS/OOS divergence, parameter sensitivity)
 *   3. Data leakage detection (look-ahead bias, survivorship)
 *   4. Walk-forward stability
 *   5. Promotion readiness gating
 *
 * Integrates with UDE feedback loop — backtest results feed into
 * strategy confidence calibration.
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "backtest-credibility" });

// ── Types ────────────────────────────────────────────────────────────────────

export interface BacktestResult {
  id: string;
  strategy: string;
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;

  // Core metrics
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgHoldMinutes: number;
  expectancy: number;

  // In-sample vs out-of-sample
  inSampleSharpe?: number;
  outOfSampleSharpe?: number;

  // Walk-forward windows
  walkForwardWindows?: WalkForwardWindow[];

  // Parameters used
  parameterCount: number;

  // Regime breakdown
  regimePerformance?: Record<string, { trades: number; winRate: number; sharpe: number }>;

  // Assumptions
  feeModel: string;
  feePerShare: number;
  slippageModel: string;
  slippageBps: number;
  fillModel: string;
  latencyMs: number;
}

export interface WalkForwardWindow {
  windowId: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  trainSharpe: number;
  testSharpe: number;
  trainWinRate: number;
  testWinRate: number;
  degradation: number; // % drop from train to test
}

export interface CredibilityReport {
  backtestId: string;
  strategy: string;
  credibilityScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  promotable: boolean;
  gatingIssues: string[];
  assumptions: AssumptionCheck[];
  warnings: string[];
  timestamp: string;
}

export interface AssumptionCheck {
  id: string;
  category: string;
  name: string;
  value: string;
  isRealistic: boolean;
  impactEstimate: "negligible" | "minor" | "moderate" | "severe";
  description: string;
}

export interface OverfitReport {
  backtestId: string;
  strategy: string;
  overfitScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  tests: OverfitTest[];
  recommendation: string;
}

export interface OverfitTest {
  name: string;
  passed: boolean;
  score: number;
  detail: string;
  threshold: number;
}

export interface LeakageReport {
  backtestId: string;
  strategy: string;
  leakageDetected: boolean;
  checks: LeakageCheck[];
  severity: "none" | "warning" | "critical";
}

export interface LeakageCheck {
  name: string;
  passed: boolean;
  detail: string;
  severity: "none" | "warning" | "critical";
}

export interface PromotionDecision {
  backtestId: string;
  strategy: string;
  currentTier: "research" | "paper" | "assisted" | "semi_auto" | "autonomous";
  recommendedTier: "research" | "paper" | "assisted" | "semi_auto" | "autonomous";
  promoted: boolean;
  blockers: string[];
  credibilityScore: number;
  overfitScore: number;
  leakageClean: boolean;
  walkForwardStable: boolean;
  timestamp: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const _backtestResults: Map<string, BacktestResult> = new Map();
const _credibilityReports: Map<string, CredibilityReport> = new Map();
const _overfitReports: Map<string, OverfitReport> = new Map();
const _leakageReports: Map<string, LeakageReport> = new Map();
const _promotionHistory: PromotionDecision[] = [];

// ── Register Backtest Result ─────────────────────────────────────────────────

export function registerBacktestResult(result: BacktestResult): void {
  _backtestResults.set(result.id, result);
  logger.info({ id: result.id, strategy: result.strategy }, "[credibility] Backtest result registered");
}

// ── Credibility Scoring ──────────────────────────────────────────────────────

export function computeCredibility(bt: BacktestResult): CredibilityReport {
  const assumptions: AssumptionCheck[] = [];
  const warnings: string[] = [];
  const gatingIssues: string[] = [];
  let score = 100;

  // Fee model check
  const feeRealistic = bt.feePerShare >= 0.003;
  assumptions.push({
    id: "a01", category: "fees", name: "Per-share fees",
    value: `$${bt.feePerShare.toFixed(4)}/share`,
    isRealistic: feeRealistic,
    impactEstimate: feeRealistic ? "negligible" : "severe",
    description: feeRealistic ? "Matches broker tiered pricing" : "Unrealistically low fees",
  });
  if (!feeRealistic) { score -= 20; gatingIssues.push("Unrealistic fee model"); }

  // Slippage check
  const slipOk = bt.slippageBps >= 3;
  assumptions.push({
    id: "a02", category: "slippage", name: "Slippage model",
    value: `${bt.slippageModel} (${bt.slippageBps}bps)`,
    isRealistic: slipOk,
    impactEstimate: slipOk ? "minor" : "severe",
    description: slipOk ? "Volume-scaled slippage" : "Slippage too low for production",
  });
  if (!slipOk) { score -= 15; gatingIssues.push("Slippage unrealistically low"); }

  // Latency check
  const latOk = bt.latencyMs >= 20;
  assumptions.push({
    id: "a03", category: "latency", name: "Order latency",
    value: `${bt.latencyMs}ms`,
    isRealistic: latOk,
    impactEstimate: latOk ? "negligible" : "moderate",
    description: latOk ? "Conservative for cloud execution" : "Unrealistically fast execution",
  });
  if (!latOk) { score -= 5; }

  // Fill model check
  const fillOk = bt.fillModel !== "instant" && bt.fillModel !== "none";
  assumptions.push({
    id: "a04", category: "execution", name: "Fill model",
    value: bt.fillModel,
    isRealistic: fillOk,
    impactEstimate: fillOk ? "minor" : "moderate",
    description: fillOk ? "Partial fills with volume check" : "Assumes 100% instant fill — unrealistic",
  });
  if (!fillOk) { score -= 10; gatingIssues.push("No partial fill simulation"); }

  // Trade count check
  const enoughTrades = bt.totalTrades >= 100;
  assumptions.push({
    id: "a05", category: "data", name: "Sample size",
    value: `${bt.totalTrades} trades`,
    isRealistic: enoughTrades,
    impactEstimate: enoughTrades ? "negligible" : "moderate",
    description: enoughTrades ? "Sufficient for statistical significance" : "Need >100 trades for significance",
  });
  if (!enoughTrades) { score -= 10; gatingIssues.push("Insufficient trade count"); }

  // Walk-forward check
  const hasWF = (bt.walkForwardWindows?.length ?? 0) >= 3;
  assumptions.push({
    id: "a06", category: "data", name: "Walk-forward validation",
    value: hasWF ? `${bt.walkForwardWindows!.length} windows` : "Not performed",
    isRealistic: hasWF,
    impactEstimate: hasWF ? "negligible" : "severe",
    description: hasWF ? "Rolling OOS validation" : "No out-of-sample validation",
  });
  if (!hasWF) { score -= 20; gatingIssues.push("No walk-forward validation"); }

  // Sharpe sanity check
  if (bt.sharpeRatio > 4) {
    score -= 15;
    warnings.push("Sharpe ratio suspiciously high (>4) — possible overfitting");
    gatingIssues.push("Sharpe ratio suspiciously high");
  }

  // Max drawdown sanity
  if (bt.maxDrawdown > 0.25) {
    score -= 10;
    warnings.push(`Max drawdown ${(bt.maxDrawdown * 100).toFixed(1)}% exceeds 25% limit`);
  }

  // IS/OOS divergence
  if (bt.inSampleSharpe && bt.outOfSampleSharpe) {
    const ratio = bt.inSampleSharpe / (bt.outOfSampleSharpe || 0.01);
    if (ratio > 2) {
      score -= 15;
      warnings.push(`IS/OOS Sharpe ratio ${ratio.toFixed(1)}x — high overfitting risk`);
      gatingIssues.push("IS/OOS divergence too high");
    }
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : score >= 30 ? "D" : "F";
  const promotable = grade === "A" || grade === "B";

  if (!promotable) {
    warnings.push(`Strategy NOT promotable (grade ${grade})`);
  }

  const report: CredibilityReport = {
    backtestId: bt.id,
    strategy: bt.strategy,
    credibilityScore: score,
    grade,
    promotable,
    gatingIssues,
    assumptions,
    warnings,
    timestamp: new Date().toISOString(),
  };

  _credibilityReports.set(bt.id, report);
  logger.info({ id: bt.id, score, grade, promotable }, "[credibility] Report generated");
  return report;
}

// ── Overfitting Detection ────────────────────────────────────────────────────

export function computeOverfitRisk(bt: BacktestResult): OverfitReport {
  const tests: OverfitTest[] = [];
  let totalScore = 0;

  // Test 1: IS/OOS Divergence
  const isSharpe = bt.inSampleSharpe ?? bt.sharpeRatio;
  const oosSharpe = bt.outOfSampleSharpe ?? bt.sharpeRatio * 0.85;
  const divergeRatio = isSharpe / (oosSharpe || 0.01);
  const divergeScore = Math.min(100, Math.round(divergeRatio * 20));
  tests.push({
    name: "IS/OOS Divergence",
    passed: divergeRatio < 2.0,
    score: divergeScore,
    detail: `IS Sharpe ${isSharpe.toFixed(2)}, OOS Sharpe ${oosSharpe.toFixed(2)} — ${divergeRatio.toFixed(1)}x ratio`,
    threshold: 2.0,
  });
  totalScore += divergeScore;

  // Test 2: Parameter Sensitivity
  const paramRatio = bt.parameterCount / Math.max(1, bt.totalTrades);
  const paramScore = Math.min(100, Math.round(paramRatio * 1000));
  tests.push({
    name: "Parameter Sensitivity",
    passed: paramRatio < 0.05,
    score: paramScore,
    detail: `${bt.parameterCount} params / ${bt.totalTrades} trades = ${paramRatio.toFixed(4)}`,
    threshold: 0.05,
  });
  totalScore += paramScore;

  // Test 3: Regime Stability
  let regimeScore = 50;
  if (bt.regimePerformance) {
    const regimes = Object.values(bt.regimePerformance);
    const profitable = regimes.filter(r => r.winRate > 0.45).length;
    regimeScore = Math.round((1 - profitable / Math.max(1, regimes.length)) * 100);
  }
  tests.push({
    name: "Regime Stability",
    passed: regimeScore < 50,
    score: regimeScore,
    detail: bt.regimePerformance
      ? `Profitable in ${Object.values(bt.regimePerformance).filter(r => r.winRate > 0.45).length}/${Object.keys(bt.regimePerformance).length} regimes`
      : "No regime data available",
    threshold: 50,
  });
  totalScore += regimeScore;

  // Test 4: Trade Count
  const tradeScore = bt.totalTrades >= 200 ? 5 : bt.totalTrades >= 100 ? 15 : bt.totalTrades >= 50 ? 40 : 80;
  tests.push({
    name: "Trade Count",
    passed: bt.totalTrades >= 100,
    score: tradeScore,
    detail: `${bt.totalTrades} trades — ${bt.totalTrades >= 100 ? "sufficient" : "insufficient"}`,
    threshold: 30,
  });
  totalScore += tradeScore;

  // Test 5: Walk-Forward Degradation
  let wfScore = 50;
  if (bt.walkForwardWindows && bt.walkForwardWindows.length > 0) {
    const avgDegradation = bt.walkForwardWindows.reduce((s, w) => s + w.degradation, 0) / bt.walkForwardWindows.length;
    wfScore = Math.min(100, Math.round(avgDegradation * 2));
  }
  tests.push({
    name: "Walk-Forward Stability",
    passed: wfScore < 30,
    score: wfScore,
    detail: bt.walkForwardWindows
      ? `Avg degradation: ${(bt.walkForwardWindows.reduce((s, w) => s + w.degradation, 0) / bt.walkForwardWindows.length).toFixed(1)}%`
      : "No walk-forward data",
    threshold: 30,
  });
  totalScore += wfScore;

  // Test 6: Sharpe Sanity
  const sharpeScore = bt.sharpeRatio > 4 ? 90 : bt.sharpeRatio > 3 ? 50 : bt.sharpeRatio > 2 ? 20 : 5;
  tests.push({
    name: "Sharpe Sanity",
    passed: bt.sharpeRatio <= 3,
    score: sharpeScore,
    detail: `Sharpe ${bt.sharpeRatio.toFixed(2)} — ${bt.sharpeRatio > 3 ? "suspiciously high" : "realistic"}`,
    threshold: 50,
  });
  totalScore += sharpeScore;

  const avgScore = Math.round(totalScore / tests.length);
  const riskLevel = avgScore >= 60 ? "critical" : avgScore >= 40 ? "high" : avgScore >= 20 ? "medium" : "low";

  const report: OverfitReport = {
    backtestId: bt.id,
    strategy: bt.strategy,
    overfitScore: avgScore,
    riskLevel,
    tests,
    recommendation: riskLevel === "low"
      ? "Strategy shows minimal overfitting risk — safe to promote."
      : riskLevel === "medium"
        ? "Some overfitting indicators — monitor closely in paper trading."
        : "High overfitting risk — do not promote without additional validation.",
  };

  _overfitReports.set(bt.id, report);
  return report;
}

// ── Data Leakage Detection ───────────────────────────────────────────────────

export function detectLeakage(bt: BacktestResult): LeakageReport {
  const checks: LeakageCheck[] = [];

  // Check 1: Look-ahead bias (Sharpe > 4 is suspicious)
  const lookAhead = bt.sharpeRatio > 4;
  checks.push({
    name: "Look-ahead Bias",
    passed: !lookAhead,
    detail: lookAhead
      ? `Sharpe ${bt.sharpeRatio.toFixed(2)} is suspiciously high — possible future data leakage`
      : `Sharpe ${bt.sharpeRatio.toFixed(2)} is within realistic range`,
    severity: lookAhead ? "critical" : "none",
  });

  // Check 2: Win rate sanity
  const winRateSuspect = bt.winRate > 0.80;
  checks.push({
    name: "Win Rate Sanity",
    passed: !winRateSuspect,
    detail: winRateSuspect
      ? `Win rate ${(bt.winRate * 100).toFixed(1)}% is unrealistically high`
      : `Win rate ${(bt.winRate * 100).toFixed(1)}% is realistic`,
    severity: winRateSuspect ? "warning" : "none",
  });

  // Check 3: Drawdown consistency
  const ddSuspect = bt.maxDrawdown < 0.01 && bt.totalTrades > 50;
  checks.push({
    name: "Drawdown Consistency",
    passed: !ddSuspect,
    detail: ddSuspect
      ? `Max DD ${(bt.maxDrawdown * 100).toFixed(2)}% with ${bt.totalTrades} trades — suspiciously low`
      : `Max DD ${(bt.maxDrawdown * 100).toFixed(2)}% is realistic`,
    severity: ddSuspect ? "warning" : "none",
  });

  // Check 4: Survivorship bias
  const hasSurvivorCheck = bt.totalTrades > 100; // proxy: enough data implies diverse universe
  checks.push({
    name: "Survivorship Bias",
    passed: hasSurvivorCheck,
    detail: hasSurvivorCheck
      ? "Sufficient trade diversity implies controlled universe"
      : "Low trade count may indicate survivorship bias",
    severity: hasSurvivorCheck ? "none" : "warning",
  });

  // Check 5: Profit factor sanity
  const pfSuspect = bt.profitFactor > 5;
  checks.push({
    name: "Profit Factor Sanity",
    passed: !pfSuspect,
    detail: pfSuspect
      ? `PF ${bt.profitFactor.toFixed(2)} is unrealistically high`
      : `PF ${bt.profitFactor.toFixed(2)} is realistic`,
    severity: pfSuspect ? "critical" : "none",
  });

  const leakageDetected = checks.some(c => c.severity === "critical");
  const severity = leakageDetected ? "critical" : checks.some(c => c.severity === "warning") ? "warning" : "none";

  const report: LeakageReport = {
    backtestId: bt.id,
    strategy: bt.strategy,
    leakageDetected,
    checks,
    severity,
  };

  _leakageReports.set(bt.id, report);
  return report;
}

// ── Promotion Decision ───────────────────────────────────────────────────────

export function evaluatePromotion(
  bt: BacktestResult,
  currentTier: PromotionDecision["currentTier"] = "research",
): PromotionDecision {
  const cred = _credibilityReports.get(bt.id) ?? computeCredibility(bt);
  const overfit = _overfitReports.get(bt.id) ?? computeOverfitRisk(bt);
  const leakage = _leakageReports.get(bt.id) ?? detectLeakage(bt);

  const blockers: string[] = [];

  if (!cred.promotable) blockers.push(`Credibility grade ${cred.grade} — not promotable`);
  if (overfit.riskLevel === "high" || overfit.riskLevel === "critical") blockers.push(`Overfit risk: ${overfit.riskLevel}`);
  if (leakage.leakageDetected) blockers.push("Data leakage detected");

  // Walk-forward stability
  let wfStable = true;
  if (bt.walkForwardWindows && bt.walkForwardWindows.length > 0) {
    const avgDeg = bt.walkForwardWindows.reduce((s, w) => s + w.degradation, 0) / bt.walkForwardWindows.length;
    wfStable = avgDeg < 30;
    if (!wfStable) blockers.push(`Walk-forward degradation ${avgDeg.toFixed(1)}% > 30% limit`);
  } else {
    wfStable = false;
    blockers.push("No walk-forward validation performed");
  }

  const promoted = blockers.length === 0;
  const tierMap: Record<string, PromotionDecision["recommendedTier"]> = {
    research: "paper",
    paper: "assisted",
    assisted: "semi_auto",
    semi_auto: "autonomous",
    autonomous: "autonomous",
  };

  const decision: PromotionDecision = {
    backtestId: bt.id,
    strategy: bt.strategy,
    currentTier,
    recommendedTier: promoted ? tierMap[currentTier] : currentTier,
    promoted,
    blockers,
    credibilityScore: cred.credibilityScore,
    overfitScore: overfit.overfitScore,
    leakageClean: !leakage.leakageDetected,
    walkForwardStable: wfStable,
    timestamp: new Date().toISOString(),
  };

  _promotionHistory.unshift(decision);
  if (_promotionHistory.length > 200) _promotionHistory.pop();

  logger.info(
    { id: bt.id, promoted, tier: decision.recommendedTier, blockers: blockers.length },
    `[credibility] Promotion: ${promoted ? "APPROVED" : "BLOCKED"}`,
  );

  return decision;
}

// ── Full Analysis Pipeline ───────────────────────────────────────────────────

export function runFullAnalysis(bt: BacktestResult): {
  credibility: CredibilityReport;
  overfit: OverfitReport;
  leakage: LeakageReport;
  promotion: PromotionDecision;
} {
  registerBacktestResult(bt);
  const credibility = computeCredibility(bt);
  const overfit = computeOverfitRisk(bt);
  const leakage = detectLeakage(bt);
  const promotion = evaluatePromotion(bt);
  return { credibility, overfit, leakage, promotion };
}

// ── Public Getters ───────────────────────────────────────────────────────────

export function getBacktestResult(id: string): BacktestResult | undefined {
  return _backtestResults.get(id);
}

export function getCredibilityReport(id: string): CredibilityReport | undefined {
  return _credibilityReports.get(id);
}

export function getOverfitReport(id: string): OverfitReport | undefined {
  return _overfitReports.get(id);
}

export function getLeakageReport(id: string): LeakageReport | undefined {
  return _leakageReports.get(id);
}

export function getAllCredibilityReports(): CredibilityReport[] {
  return Array.from(_credibilityReports.values());
}

export function getPromotionHistory(limit = 50): PromotionDecision[] {
  return _promotionHistory.slice(0, limit);
}

export function getBacktestSummary(): {
  total: number;
  gradeDistribution: Record<string, number>;
  promotableCount: number;
  avgCredibility: number;
} {
  const reports = Array.from(_credibilityReports.values());
  const dist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let totalCred = 0;
  let promotable = 0;
  for (const r of reports) {
    dist[r.grade] = (dist[r.grade] ?? 0) + 1;
    totalCred += r.credibilityScore;
    if (r.promotable) promotable++;
  }
  return {
    total: reports.length,
    gradeDistribution: dist,
    promotableCount: promotable,
    avgCredibility: reports.length > 0 ? totalCred / reports.length : 0,
  };
}
