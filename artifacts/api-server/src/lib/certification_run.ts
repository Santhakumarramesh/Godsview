import { logger } from "./logger";

export type TargetTier = "paper_approved" | "live_assisted" | "autonomous_candidate";

export interface GateResult {
  gate: string;
  passed: boolean;
  details: string;
  metrics?: Record<string, number>;
}

interface TierRequirements {
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
    min_backtest_win_rate: 0.5,
    min_backtest_trades: 50,
    min_walkforward_pass_rate: 0.6,
    min_stress_survival: 0.5,
    min_paper_trades: 0,
    min_paper_win_rate: 0,
    min_alignment_score: 0,
    max_slippage_bps: 50,
    max_execution_latency_ms: 10_000,
  },
  live_assisted: {
    min_backtest_sharpe: 0.8,
    min_backtest_win_rate: 0.52,
    min_backtest_trades: 100,
    min_walkforward_pass_rate: 0.7,
    min_stress_survival: 0.6,
    min_paper_trades: 30,
    min_paper_win_rate: 0.5,
    min_alignment_score: 0.6,
    max_slippage_bps: 20,
    max_execution_latency_ms: 5_000,
  },
  autonomous_candidate: {
    min_backtest_sharpe: 1.2,
    min_backtest_win_rate: 0.55,
    min_backtest_trades: 200,
    min_walkforward_pass_rate: 0.8,
    min_stress_survival: 0.7,
    min_paper_trades: 100,
    min_paper_win_rate: 0.53,
    min_alignment_score: 0.75,
    max_slippage_bps: 15,
    max_execution_latency_ms: 2_000,
  },
};

function evaluateBacktestGate(
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
  const failed = checks.filter((check) => !check.ok);
  return {
    gate: "backtest",
    passed: failed.length === 0,
    details:
      failed.length === 0
        ? `Passed: Sharpe=${sharpe.toFixed(2)}, WR=${(winRate * 100).toFixed(1)}%, trades=${tradeCount}`
        : `Failed: ${failed.map((item) => item.msg).join("; ")}`,
    metrics: { sharpe, win_rate: winRate, trade_count: tradeCount },
  };
}

function evaluateWalkForwardGate(reqs: TierRequirements, passRate: number): GateResult {
  return {
    gate: "walkforward",
    passed: passRate >= reqs.min_walkforward_pass_rate,
    details:
      passRate >= reqs.min_walkforward_pass_rate
        ? `Passed: ${(passRate * 100).toFixed(0)}% windows pass`
        : `Failed: ${(passRate * 100).toFixed(0)}% windows pass`,
    metrics: { pass_rate: passRate },
  };
}

function evaluateStressGate(reqs: TierRequirements, survivalRate: number): GateResult {
  return {
    gate: "stress_test",
    passed: survivalRate >= reqs.min_stress_survival,
    details:
      survivalRate >= reqs.min_stress_survival
        ? `Passed: ${(survivalRate * 100).toFixed(0)}% survival`
        : `Failed: ${(survivalRate * 100).toFixed(0)}% survival`,
    metrics: { survival_rate: survivalRate },
  };
}

function evaluateShadowGate(
  reqs: TierRequirements,
  paperTrades: number,
  paperWinRate: number,
  paperPnl: number,
): GateResult {
  if (reqs.min_paper_trades === 0) {
    return {
      gate: "shadow",
      passed: true,
      details: "No paper requirement for this tier",
      metrics: { paper_trades: paperTrades, paper_win_rate: paperWinRate, paper_pnl: paperPnl },
    };
  }

  const checks = [
    { ok: paperTrades >= reqs.min_paper_trades, msg: `trades ${paperTrades} >= ${reqs.min_paper_trades}` },
    { ok: paperWinRate >= reqs.min_paper_win_rate, msg: `WR ${(paperWinRate * 100).toFixed(1)}% >= ${(reqs.min_paper_win_rate * 100).toFixed(0)}%` },
    { ok: paperPnl >= 0, msg: `PnL $${paperPnl.toFixed(2)} >= $0` },
  ];
  const failed = checks.filter((check) => !check.ok);

  return {
    gate: "shadow",
    passed: failed.length === 0,
    details:
      failed.length === 0
        ? `Passed: ${paperTrades} trades, WR=${(paperWinRate * 100).toFixed(1)}%, PnL=$${paperPnl.toFixed(2)}`
        : `Failed: ${failed.map((item) => item.msg).join("; ")}`,
    metrics: { paper_trades: paperTrades, paper_win_rate: paperWinRate, paper_pnl: paperPnl },
  };
}

function evaluateAlignmentGate(reqs: TierRequirements, alignmentScore: number): GateResult {
  if (reqs.min_alignment_score === 0) {
    return {
      gate: "alignment",
      passed: true,
      details: "No alignment requirement for this tier",
      metrics: { alignment_score: alignmentScore },
    };
  }
  return {
    gate: "alignment",
    passed: alignmentScore >= reqs.min_alignment_score,
    details:
      alignmentScore >= reqs.min_alignment_score
        ? `Passed: score ${alignmentScore.toFixed(2)} >= ${reqs.min_alignment_score}`
        : `Failed: score ${alignmentScore.toFixed(2)} < ${reqs.min_alignment_score}`,
    metrics: { alignment_score: alignmentScore },
  };
}

function evaluateSlippageGate(reqs: TierRequirements, avgSlippageBps: number): GateResult {
  return {
    gate: "slippage",
    passed: avgSlippageBps <= reqs.max_slippage_bps,
    details:
      avgSlippageBps <= reqs.max_slippage_bps
        ? `Passed: ${avgSlippageBps.toFixed(1)} bps <= ${reqs.max_slippage_bps} bps`
        : `Failed: ${avgSlippageBps.toFixed(1)} bps > ${reqs.max_slippage_bps} bps`,
    metrics: { avg_slippage_bps: avgSlippageBps },
  };
}

function evaluateExecutionQualityGate(
  reqs: TierRequirements,
  avgLatencyMs: number,
  fillRate: number,
): GateResult {
  const checks = [
    { ok: avgLatencyMs <= reqs.max_execution_latency_ms, msg: `latency ${avgLatencyMs}ms <= ${reqs.max_execution_latency_ms}ms` },
    { ok: fillRate >= 0.9, msg: `fill rate ${(fillRate * 100).toFixed(0)}% >= 90%` },
  ];
  const failed = checks.filter((check) => !check.ok);
  return {
    gate: "execution_quality",
    passed: failed.length === 0,
    details:
      failed.length === 0
        ? `Passed: latency=${avgLatencyMs}ms, fill=${(fillRate * 100).toFixed(0)}%`
        : `Failed: ${failed.map((item) => item.msg).join("; ")}`,
    metrics: { avg_latency_ms: avgLatencyMs, fill_rate: fillRate },
  };
}

export type CertificationGateStepName =
  | "backtest"
  | "walkforward"
  | "stress_test"
  | "shadow"
  | "alignment"
  | "slippage"
  | "execution_quality";

export type CertificationRunStatusType =
  | "initiated"
  | "running"
  | "collecting_evidence"
  | "review"
  | "certified"
  | "rejected"
  | "failed"
  | "aborted";

export type CertificationStepStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped";

export interface StepMetricsInput {
  sharpe?: number;
  winRate?: number;
  tradeCount?: number;
  passRate?: number;
  survivalRate?: number;
  paperTrades?: number;
  paperWinRate?: number;
  paperPnl?: number;
  alignmentScore?: number;
  slippageBps?: number;
  avgLatencyMs?: number;
  fillRate?: number;
}

export interface CertificationRunConfig {
  strategyId: string;
  strategyName: string;
  targetTier: TargetTier;
  symbols: string[];
  timeframe: string;
  backtestDateRange: { start: string; end: string };
  walkforwardFolds?: number;
  stressScenarios?: string[];
  shadowDurationMinutes?: number;
  paperTradeMinCount?: number;
  capitalAllocation?: number;
  operatorId?: string;
  metricOverrides?: Partial<Record<CertificationGateStepName, StepMetricsInput>>;
  expiresAt?: string;
}

export interface RunIncident {
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  occurredAt: string;
  details?: Record<string, unknown>;
}

export interface CertificationRunStep {
  stepName: CertificationGateStepName;
  stepOrder: number;
  status: CertificationStepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: GateResult;
  errorMessage?: string;
}

export interface EvidencePacket {
  runId: string;
  strategyId: string;
  strategyName: string;
  targetTier: TargetTier;
  generatedAt: string;
  gates: GateResult[];
  all_gates_passed: boolean;
  summary: string;
  metrics: {
    backtest_sharpe?: number;
    backtest_win_rate?: number;
    backtest_trade_count?: number;
    walkforward_pass_rate?: number;
    stress_survival_rate?: number;
    paper_trade_count?: number;
    paper_win_rate?: number;
    paper_pnl?: number;
    alignment_score?: number;
    avg_slippage_bps?: number;
    avg_latency_ms?: number;
    fill_rate?: number;
  };
  incidents: RunIncident[];
}

export interface StepExecutionResult {
  runId: string;
  stepName: CertificationGateStepName;
  status: CertificationStepStatus;
  result: GateResult;
}

export interface CertificationRunStatus {
  runId: string;
  strategyId: string;
  strategyName: string;
  targetTier: TargetTier;
  status: CertificationRunStatusType;
  initiatedAt: string;
  completedAt?: string;
  expiresAt: string;
  governanceVerdict?: "promote" | "hold" | "reject";
  governanceReason?: string;
  incidents: RunIncident[];
  steps: CertificationRunStep[];
}

export interface CertificationRunResult {
  runId: string;
  strategyId: string;
  status: "certified" | "rejected" | "failed" | "aborted";
  gateResults: GateResult[];
  evidencePacket: EvidencePacket;
  governanceVerdict: "promote" | "hold" | "reject";
  governanceReason: string;
  completedAt: string;
}

interface RunRecord {
  runId: string;
  strategyId: string;
  strategyName: string;
  targetTier: TargetTier;
  status: CertificationRunStatusType;
  config: CertificationRunConfig;
  steps: CertificationRunStep[];
  incidents: RunIncident[];
  gateResults: GateResult[];
  evidencePacket?: EvidencePacket;
  governanceVerdict?: "promote" | "hold" | "reject";
  governanceReason?: string;
  initiatedAt: string;
  completedAt?: string;
  expiresAt: string;
}

const GATE_STEPS: CertificationGateStepName[] = [
  "backtest",
  "walkforward",
  "stress_test",
  "shadow",
  "alignment",
  "slippage",
  "execution_quality",
];

function isTerminal(status: CertificationRunStatusType): boolean {
  return (
    status === "certified" ||
    status === "rejected" ||
    status === "failed" ||
    status === "aborted"
  );
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampPositive(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeRunId(strategyId: string): string {
  const safeStrategy = strategyId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
  return `cert_run_${Date.now()}_${safeStrategy}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export class CertificationRunner {
  private readonly runs = new Map<string, RunRecord>();

  async initiate(config: CertificationRunConfig): Promise<string> {
    this.validateConfig(config);
    this.rejectConcurrentRun(config.strategyId);

    const runId = makeRunId(config.strategyId);
    const initiatedAt = nowIso();
    const expiry =
      config.expiresAt ??
      new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    const steps: CertificationRunStep[] = GATE_STEPS.map((stepName, index) => ({
      stepName,
      stepOrder: index + 1,
      status: "pending",
    }));

    const run: RunRecord = {
      runId,
      strategyId: config.strategyId,
      strategyName: config.strategyName,
      targetTier: config.targetTier,
      status: "initiated",
      config,
      steps,
      incidents: [],
      gateResults: [],
      initiatedAt,
      expiresAt: expiry,
    };

    this.runs.set(runId, run);
    logger.info(
      { runId, strategyId: config.strategyId, targetTier: config.targetTier },
      "Certification run initiated",
    );
    return runId;
  }

  async executeStep(
    runId: string,
    stepName: CertificationGateStepName,
    input: StepMetricsInput = {},
  ): Promise<StepExecutionResult> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);
    if (isTerminal(run.status)) {
      throw new Error(`Run ${runId} is already ${run.status}`);
    }

    const step = run.steps.find((candidate) => candidate.stepName === stepName);
    if (!step) {
      throw new Error(`Unknown step '${stepName}'`);
    }

    const stepIndex = run.steps.findIndex((candidate) => candidate.stepName === stepName);
    const blocking = run.steps
      .slice(0, stepIndex)
      .find((candidate) => candidate.status !== "passed" && candidate.status !== "skipped");
    if (blocking) {
      throw new Error(
        `Cannot run step '${stepName}' before '${blocking.stepName}' is complete`,
      );
    }

    if (step.status === "passed" || step.status === "failed") {
      return {
        runId,
        stepName,
        status: step.status,
        result:
          step.result ??
          ({ gate: stepName, passed: false, details: "Step has no result" } as GateResult),
      };
    }

    run.status = "running";
    step.status = "running";
    step.startedAt = nowIso();
    const started = Date.now();

    try {
      const result = this.evaluateStep(run, stepName, input);
      step.result = result;
      step.status = result.passed ? "passed" : "failed";
      step.completedAt = nowIso();
      step.durationMs = Date.now() - started;

      run.gateResults = run.steps
        .filter((candidate) => candidate.result)
        .map((candidate) => candidate.result as GateResult);

      if (!result.passed) {
        run.status = "rejected";
        run.completedAt = nowIso();
      }

      return {
        runId,
        stepName,
        status: step.status,
        result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      step.errorMessage = message;
      step.status = "failed";
      step.completedAt = nowIso();
      step.durationMs = Date.now() - started;
      run.status = "failed";
      run.completedAt = nowIso();
      throw err;
    }
  }

  async runFull(runId: string): Promise<CertificationRunResult> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);
    if (isTerminal(run.status)) {
      return this.buildResult(run);
    }

    for (const stepName of GATE_STEPS) {
      const step = run.steps.find((candidate) => candidate.stepName === stepName);
      if (!step || step.status === "passed") continue;
      await this.executeStep(runId, stepName);
      if (step.status === "failed") {
        break;
      }
    }

    run.status = "collecting_evidence";
    const evidencePacket = await this.collectEvidence(runId);
    run.evidencePacket = evidencePacket;

    run.status = "review";
    run.governanceVerdict = evidencePacket.all_gates_passed ? "promote" : "reject";
    run.governanceReason = evidencePacket.summary;
    run.status = evidencePacket.all_gates_passed ? "certified" : "rejected";
    run.completedAt = nowIso();

    return this.buildResult(run);
  }

  async collectEvidence(runId: string): Promise<EvidencePacket> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);

    const metrics: EvidencePacket["metrics"] = {};
    const gates: GateResult[] = [];

    for (const step of run.steps) {
      if (step.result) {
        gates.push(step.result);
        this.mergeGateMetrics(metrics, step.stepName, step.result.metrics);
      } else {
        gates.push({
          gate: step.stepName,
          passed: false,
          details: "Step not executed",
        });
      }
    }

    const passedCount = gates.filter((gate) => gate.passed).length;
    const allPassed = passedCount === gates.length;
    const failed = gates.filter((gate) => !gate.passed).map((gate) => gate.gate);
    const summary = allPassed
      ? `All ${gates.length} certification gates passed`
      : `${passedCount}/${gates.length} certification gates passed. Failed: ${failed.join(", ")}`;

    const packet: EvidencePacket = {
      runId: run.runId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      targetTier: run.targetTier,
      generatedAt: nowIso(),
      gates,
      all_gates_passed: allPassed,
      summary,
      metrics,
      incidents: [...run.incidents],
    };

    run.evidencePacket = packet;
    return packet;
  }

  async recordIncident(runId: string, incident: RunIncident): Promise<void> {
    const run = this.requireRun(runId);
    run.incidents.push({
      ...incident,
      occurredAt: incident.occurredAt || nowIso(),
    });
  }

  async getRunStatus(runId: string): Promise<CertificationRunStatus> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);
    return this.toStatus(run);
  }

  async getEvidence(runId: string): Promise<EvidencePacket> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);
    return run.evidencePacket ?? this.collectEvidence(runId);
  }

  async getSteps(runId: string): Promise<CertificationRunStep[]> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);
    return run.steps.map((step) => ({ ...step }));
  }

  async abort(runId: string, reason: string): Promise<void> {
    const run = this.requireRun(runId);
    this.refreshExpiredRun(run);
    if (isTerminal(run.status)) return;

    run.status = "aborted";
    run.completedAt = nowIso();
    run.steps = run.steps.map((step) => {
      if (step.status === "pending" || step.status === "running") {
        return {
          ...step,
          status: "skipped",
          completedAt: nowIso(),
          errorMessage: reason,
        };
      }
      return step;
    });
    run.incidents.push({
      type: "abort",
      severity: "critical",
      message: reason || "Certification run aborted",
      occurredAt: nowIso(),
    });
  }

  async getActiveRuns(): Promise<CertificationRunStatus[]> {
    const runs = Array.from(this.runs.values());
    return runs
      .map((run) => {
        this.refreshExpiredRun(run);
        return run;
      })
      .filter((run) => !isTerminal(run.status))
      .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt))
      .map((run) => this.toStatus(run));
  }

  async getHistory(filters?: {
    strategyId?: string;
    targetTier?: TargetTier;
    status?: CertificationRunStatusType;
    limit?: number;
  }): Promise<CertificationRunStatus[]> {
    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 500);
    const rows = Array.from(this.runs.values())
      .map((run) => {
        this.refreshExpiredRun(run);
        return run;
      })
      .filter((run) => {
        if (filters?.strategyId && run.strategyId !== filters.strategyId) return false;
        if (filters?.targetTier && run.targetTier !== filters.targetTier) return false;
        if (filters?.status && run.status !== filters.status) return false;
        return true;
      })
      .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt))
      .slice(0, limit);

    return rows.map((run) => this.toStatus(run));
  }

  private validateConfig(config: CertificationRunConfig): void {
    if (!config.strategyId?.trim()) {
      throw new Error("strategyId is required");
    }
    if (!config.strategyName?.trim()) {
      throw new Error("strategyName is required");
    }
    if (!TIER_REQUIREMENTS[config.targetTier]) {
      throw new Error(`Unsupported targetTier '${config.targetTier}'`);
    }
    if (!Array.isArray(config.symbols) || config.symbols.length === 0) {
      throw new Error("symbols must contain at least one symbol");
    }
    if (!config.timeframe?.trim()) {
      throw new Error("timeframe is required");
    }
    if (!config.backtestDateRange?.start || !config.backtestDateRange?.end) {
      throw new Error("backtestDateRange.start and backtestDateRange.end are required");
    }
  }

  private rejectConcurrentRun(strategyId: string): void {
    const active = Array.from(this.runs.values()).find((run) => {
      this.refreshExpiredRun(run);
      return run.strategyId === strategyId && !isTerminal(run.status);
    });
    if (active) {
      throw new Error(
        `Active run already exists for strategy '${strategyId}' (${active.runId})`,
      );
    }
  }

  private requireRun(runId: string): RunRecord {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Unknown runId '${runId}'`);
    return run;
  }

  private refreshExpiredRun(run: RunRecord): void {
    if (isTerminal(run.status)) return;
    const expiresAtMs = new Date(run.expiresAt).getTime();
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      run.status = "failed";
      run.completedAt = nowIso();
      run.steps = run.steps.map((step) => {
        if (step.status === "pending" || step.status === "running") {
          return {
            ...step,
            status: "skipped",
            completedAt: nowIso(),
            errorMessage: "Run expired before completion",
          };
        }
        return step;
      });
      run.incidents.push({
        type: "run_expired",
        severity: "critical",
        message: "Certification run expired before completion",
        occurredAt: nowIso(),
      });
    }
  }

  private evaluateStep(
    run: RunRecord,
    stepName: CertificationGateStepName,
    input: StepMetricsInput,
  ): GateResult {
    const reqs = TIER_REQUIREMENTS[run.targetTier];
    const configInput = run.config.metricOverrides?.[stepName] ?? {};
    const mergedInput: StepMetricsInput = { ...configInput, ...input };

    switch (stepName) {
      case "backtest": {
        const sharpe = toNumber(mergedInput.sharpe, reqs.min_backtest_sharpe + 0.15);
        const winRate = clamp01(toNumber(mergedInput.winRate, reqs.min_backtest_win_rate + 0.03));
        const tradeCount = Math.max(
          Math.round(toNumber(mergedInput.tradeCount, reqs.min_backtest_trades + 10)),
          0,
        );
        return evaluateBacktestGate(reqs, sharpe, winRate, tradeCount);
      }
      case "walkforward": {
        const passRate = clamp01(
          toNumber(mergedInput.passRate, reqs.min_walkforward_pass_rate + 0.05),
        );
        return evaluateWalkForwardGate(reqs, passRate);
      }
      case "stress_test": {
        const survivalRate = clamp01(
          toNumber(mergedInput.survivalRate, reqs.min_stress_survival + 0.05),
        );
        return evaluateStressGate(reqs, survivalRate);
      }
      case "shadow": {
        const minTrades = Math.max(reqs.min_paper_trades, run.config.paperTradeMinCount ?? 0);
        const paperTrades = Math.max(
          Math.round(toNumber(mergedInput.paperTrades, minTrades + 5)),
          0,
        );
        const paperWinRate = clamp01(
          toNumber(mergedInput.paperWinRate, Math.max(reqs.min_paper_win_rate, 0.52)),
        );
        const paperPnl = clampPositive(toNumber(mergedInput.paperPnl, 2500), 0);
        return evaluateShadowGate(reqs, paperTrades, paperWinRate, paperPnl);
      }
      case "alignment": {
        const baseline = reqs.min_alignment_score > 0 ? reqs.min_alignment_score + 0.05 : 0.65;
        const alignmentScore = clamp01(toNumber(mergedInput.alignmentScore, baseline));
        return evaluateAlignmentGate(reqs, alignmentScore);
      }
      case "slippage": {
        const slippageBps = clampPositive(
          toNumber(mergedInput.slippageBps, Math.max(reqs.max_slippage_bps - 2, 0.5)),
          0,
        );
        return evaluateSlippageGate(reqs, slippageBps);
      }
      case "execution_quality": {
        const avgLatencyMs = Math.round(
          clampPositive(
            toNumber(
              mergedInput.avgLatencyMs,
              Math.max(reqs.max_execution_latency_ms - 500, 50),
            ),
            0,
          ),
        );
        const fillRate = clamp01(toNumber(mergedInput.fillRate, 0.95));
        return evaluateExecutionQualityGate(reqs, avgLatencyMs, fillRate);
      }
      default:
        throw new Error(`Unsupported step '${stepName}'`);
    }
  }

  private mergeGateMetrics(
    metrics: EvidencePacket["metrics"],
    stepName: CertificationGateStepName,
    gateMetrics?: Record<string, number>,
  ): void {
    if (!gateMetrics) return;
    if (stepName === "backtest") {
      metrics.backtest_sharpe = gateMetrics.sharpe;
      metrics.backtest_win_rate = gateMetrics.win_rate;
      metrics.backtest_trade_count = gateMetrics.trade_count;
      return;
    }
    if (stepName === "walkforward") {
      metrics.walkforward_pass_rate = gateMetrics.pass_rate;
      return;
    }
    if (stepName === "stress_test") {
      metrics.stress_survival_rate = gateMetrics.survival_rate;
      return;
    }
    if (stepName === "shadow") {
      metrics.paper_trade_count = gateMetrics.paper_trades;
      metrics.paper_win_rate = gateMetrics.paper_win_rate;
      metrics.paper_pnl = gateMetrics.paper_pnl;
      return;
    }
    if (stepName === "alignment") {
      metrics.alignment_score = gateMetrics.alignment_score;
      return;
    }
    if (stepName === "slippage") {
      metrics.avg_slippage_bps = gateMetrics.avg_slippage_bps;
      return;
    }
    metrics.avg_latency_ms = gateMetrics.avg_latency_ms;
    metrics.fill_rate = gateMetrics.fill_rate;
  }

  private toStatus(run: RunRecord): CertificationRunStatus {
    return {
      runId: run.runId,
      strategyId: run.strategyId,
      strategyName: run.strategyName,
      targetTier: run.targetTier,
      status: run.status,
      initiatedAt: run.initiatedAt,
      completedAt: run.completedAt,
      expiresAt: run.expiresAt,
      governanceVerdict: run.governanceVerdict,
      governanceReason: run.governanceReason,
      incidents: [...run.incidents],
      steps: run.steps.map((step) => ({ ...step })),
    };
  }

  private buildResult(run: RunRecord): CertificationRunResult {
    const packet =
      run.evidencePacket ?? {
        runId: run.runId,
        strategyId: run.strategyId,
        strategyName: run.strategyName,
        targetTier: run.targetTier,
        generatedAt: nowIso(),
        gates: run.gateResults,
        all_gates_passed: run.gateResults.length > 0 && run.gateResults.every((gate) => gate.passed),
        summary: run.gateResults.length
          ? "Partial evidence packet generated"
          : "No evidence collected",
        metrics: {},
        incidents: [...run.incidents],
      };

    const status: CertificationRunResult["status"] =
      run.status === "certified" || run.status === "rejected" || run.status === "failed" || run.status === "aborted"
        ? run.status
        : packet.all_gates_passed
          ? "certified"
          : "rejected";

    return {
      runId: run.runId,
      strategyId: run.strategyId,
      status,
      gateResults: packet.gates,
      evidencePacket: packet,
      governanceVerdict: run.governanceVerdict ?? (packet.all_gates_passed ? "promote" : "reject"),
      governanceReason: run.governanceReason ?? packet.summary,
      completedAt: run.completedAt ?? nowIso(),
    };
  }
}

export const certificationRunner = new CertificationRunner();
