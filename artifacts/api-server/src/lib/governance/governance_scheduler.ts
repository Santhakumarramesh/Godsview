/**
 * governance_scheduler.ts — Auto Promotion & Demotion Cron (Phase 5)
 */

import {
  PromotionEngine,
  type StrategyMetrics,
  type PromotionDecision,
  type DemotionDecision,
} from "./promotion_engine";
import {
  listStrategies,
  type StrategyEntry,
  type StrategyState,
} from "../strategy_registry";
import { publishAlert } from "../signal_stream";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "governance" });

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const INTERVAL_MS = parseInt(
  process.env.GOVERNANCE_INTERVAL_MS ?? String(DEFAULT_INTERVAL_MS), 10,
);
const HISTORY_MAX = parseInt(
  process.env.GOVERNANCE_HISTORY_MAX ?? "200", 10,
);
export interface GovernanceCycleResult {
  id: string; startedAt: string; completedAt: string | null;
  status: "running" | "completed" | "error";
  strategiesEvaluated: number; promotionEligible: number;
  demotionSignals: number; errors: number;
  evaluations: GovernanceEvaluation[];
}

export interface GovernanceEvaluation {
  strategyId: string; strategyName: string;
  registryState: StrategyState; enginerTier: string;
  promotion: PromotionDecision; demotion: DemotionDecision;
  evaluatedAt: string;
}

const REGISTRY_TO_ENGINE_TIER: Record<StrategyState, string> = {
  draft: "SEED", parsed: "SEED", backtested: "LEARNING",
  stress_tested: "PROVEN", paper_approved: "PAPER",
  live_assisted_approved: "ASSISTED", autonomous_approved: "AUTONOMOUS",
  retired: "RETIRED",
};

const _history: GovernanceCycleResult[] = [];
let _currentCycle: GovernanceCycleResult | null = null;

function recordCycle(cycle: GovernanceCycleResult): void {
  _history.unshift(cycle);
  while (_history.length > HISTORY_MAX) _history.pop();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function buildMetrics(entry: StrategyEntry): StrategyMetrics {
  const perf = entry.performance ?? {
    sharpe: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0,
    totalTrades: 0, netPnl: 0, lastUpdated: new Date(0).toISOString(),
  };
  return {
    strategyId: entry.id, name: entry.name,
    currentTier: REGISTRY_TO_ENGINE_TIER[entry.state] ?? "SEED",
    totalTrades: perf.totalTrades, winRate: perf.winRate,
    sharpeRatio: perf.sharpe, sortinoRatio: 0, calmarRatio: 0,
    profitFactor: perf.profitFactor, maxDrawdown: perf.maxDrawdown,
    avgReturn: perf.totalTrades > 0 ? perf.netPnl / perf.totalTrades : 0,
    consistency: 0, equityCurve: [],
    walkForwardPassed: undefined, outOfSampleSharpe: undefined,
    regimeStability: undefined, parameterSensitivity: undefined,
    monteCarloWorstCase: undefined, tailRisk: undefined,
    correlationWithPortfolio: undefined, consecutiveLosses: undefined,
    daysUnderwater: undefined, lastTradedAt: perf.lastUpdated,
  };
}

export class GovernanceScheduler {
  private static _instance: GovernanceScheduler | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _cycleCount = 0;
  private readonly engine = new PromotionEngine();
  static getInstance(): GovernanceScheduler {
    if (!GovernanceScheduler._instance)
      GovernanceScheduler._instance = new GovernanceScheduler();
    return GovernanceScheduler._instance;
  }

  isRunning(): boolean { return this._running; }
  getCycleCount(): number { return this._cycleCount; }
  getHistory(): GovernanceCycleResult[] { return [..._history]; }
  getCurrentCycle(): GovernanceCycleResult | null { return _currentCycle; }
  getIntervalMs(): number { return INTERVAL_MS; }
  getEngine(): PromotionEngine { return this.engine; }

  start(): void {
    if (this._running) return;
    this._running = true;
    logger.info({ intervalMs: INTERVAL_MS }, "[governance] Scheduler started");
    void this._runCycle();
    this._timer = setInterval(() => void this._runCycle(), INTERVAL_MS);
  }

  stop(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._running = false;
  }

  async forceCycle(): Promise<GovernanceCycleResult> {
    return this._runCycle();
  }
  private async _runCycle(): Promise<GovernanceCycleResult> {
    const cycle: GovernanceCycleResult = {
      id: makeId("gov"), startedAt: new Date().toISOString(),
      completedAt: null, status: "running",
      strategiesEvaluated: 0, promotionEligible: 0,
      demotionSignals: 0, errors: 0, evaluations: [],
    };
    _currentCycle = cycle;
    try {
      const strategies = listStrategies().filter((s) => s.state !== "retired");
      for (const entry of strategies) {
        try {
          const engineTier = REGISTRY_TO_ENGINE_TIER[entry.state] ?? "SEED";
          const metrics = buildMetrics(entry);
          const promotion = this.engine.evaluatePromotion(entry.id, engineTier, metrics);
          const demotion = this.engine.evaluateDemotion(entry.id, engineTier, metrics);
          cycle.evaluations.push({
            strategyId: entry.id, strategyName: entry.name,
            registryState: entry.state, enginerTier: engineTier,
            promotion, demotion, evaluatedAt: new Date().toISOString(),
          });
          cycle.strategiesEvaluated++;
          if (promotion.eligible) {
            cycle.promotionEligible++;
            publishAlert({ type: "promotion_eligible", strategyId: entry.id,
              strategyName: entry.name, fromTier: engineTier,
              toTier: promotion.targetTier, confidenceScore: promotion.confidenceScore,
              passedGates: promotion.passedGates, totalGates: promotion.totalGates,
              evaluatedAt: new Date().toISOString() });
          }
          if (demotion.demote) {
            cycle.demotionSignals++;
            publishAlert({ type: "demotion_signal", strategyId: entry.id,
              strategyName: entry.name, fromTier: engineTier,
              toTier: demotion.targetTier, severity: demotion.severity,
              urgency: demotion.urgency, signals: demotion.signals,
              evaluatedAt: new Date().toISOString() });
          }
        } catch (err: any) { cycle.errors++; }
      }
      cycle.status = "completed";
    } catch (err: any) {
      cycle.status = "error"; cycle.errors++;
    } finally {
      cycle.completedAt = new Date().toISOString();
      _currentCycle = null;
      this._cycleCount++;
      recordCycle(cycle);
    }
    return cycle;
  }
}
