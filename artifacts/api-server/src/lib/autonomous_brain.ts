// @ts-nocheck
/**
 * autonomous_brain.ts — GodsView Autonomous Brain
 *
 * The brain runs like a senior portfolio manager who never sleeps:
 *
 *   EVERY 30s → Scan all tracked symbols (L1-L6)
 *   EVERY 5min → Rank symbols and update opportunity score
 *   EVERY 1h   → Backtest symbols where WR is declining or new data arrived
 *   EVERY 4h   → Evolve strategy parameters from backtest feedback
 *   EVERY 6h   → Retrain ML with accumulated outcomes
 *   EVERY 12h  → Build cross-symbol rulebook
 *   EVERY 24h  → Full portfolio review + tier promotion/demotion
 *
 * The brain doesn't just run on a timer — it also REACTS:
 *   - Strong signal confirmed → immediately trigger position scan
 *   - Backtest Sharpe drops → immediately evolve strategy
 *   - 5+ consecutive losses → immediately reduce Kelly size
 *   - New trade outcome → queue ML outcome recording
 *   - Regime change detected → re-rank all symbols
 *
 * Decision intelligence:
 *   The brain tracks which symbols deserve ATTENTION (high opportunity)
 *   vs which to WATCH (moderate) vs which to IGNORE (no edge).
 *   Attention is a scarce resource — the brain allocates it rationally.
 *
 * Self-awareness:
 *   The brain knows when it's performing well and when it isn't.
 *   It adjusts aggressiveness (more/fewer signals) based on its own
 *   recent P&L track record. After 5 consecutive losses, it goes
 *   into "defensive mode" — tighter filters, smaller size.
 */

import { logger } from "./logger";
import { brainEventBus } from "./brain_event_bus";
import { brainJobQueue, BrainJobs, registerJobHandler, dispatchBatch, type JobType, type BrainJob } from "./job_queue";
import { evolveStrategy, rankStrategies, strategyRegistry } from "./strategy_evolution";
import { superIntelligenceV2 } from "./super_intelligence_v2";
import { brainAlerts } from "./brain_alerts.js";
import { brainPerformance } from "./brain_performance.js";

// ── Brain Operating Modes ─────────────────────────────────────────────────

export type BrainMode = "AGGRESSIVE" | "NORMAL" | "DEFENSIVE" | "PAUSED";

// ── Brain State ────────────────────────────────────────────────────────────

export interface AutonomousBrainState {
  mode: BrainMode;
  running: boolean;
  symbols: string[];
  cycleCount: number;
  scanCount: number;
  backtestCount: number;
  evolutionCount: number;
  retrainCount: number;
  totalJobsCreated: number;
  totalJobsCompleted: number;
  lastScanAt: number;
  lastRankAt: number;
  lastBacktestAt: Record<string, number>;
  lastEvolveAt: Record<string, number>;
  lastRetrainAt: number;
  lastRulebookAt: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  recentWinRate: number;
  attentionMap: Record<string, number>;  // symbol → 0-1 attention score
  opportunityRank: string[];             // symbols sorted by opportunity
  startedAt: number;
  errors: number;
  version: string;
}

const initialState = (): AutonomousBrainState => ({
  mode: "NORMAL",
  running: false,
  symbols: [],
  cycleCount: 0,
  scanCount: 0,
  backtestCount: 0,
  evolutionCount: 0,
  retrainCount: 0,
  totalJobsCreated: 0,
  totalJobsCompleted: 0,
  lastScanAt: 0,
  lastRankAt: 0,
  lastBacktestAt: {},
  lastEvolveAt: {},
  lastRetrainAt: 0,
  lastRulebookAt: 0,
  consecutiveLosses: 0,
  consecutiveWins: 0,
  recentWinRate: 0.5,
  attentionMap: {},
  opportunityRank: [],
  startedAt: 0,
  errors: 0,
  version: "6.0",
});

// ── Timing configuration ──────────────────────────────────────────────────

interface BrainTimers {
  scanIntervalMs: number;       // L1-L6 real-time scan
  rankIntervalMs: number;       // Symbol ranking
  backtestIntervalMs: number;   // L7 backtest per symbol
  evolveIntervalMs: number;     // Strategy evolution
  retrainIntervalMs: number;    // ML retraining
  rulebookIntervalMs: number;   // Cross-symbol rulebook
  jobDispatchIntervalMs: number; // How often to drain the job queue
}

const DEFAULT_TIMERS: BrainTimers = {
  scanIntervalMs: 30_000,
  rankIntervalMs: 5 * 60_000,
  backtestIntervalMs: 60 * 60_000,
  evolveIntervalMs: 4 * 60 * 60_000,
  retrainIntervalMs: 6 * 60 * 60_000,
  rulebookIntervalMs: 12 * 60 * 60_000,
  jobDispatchIntervalMs: 5_000,
};

// ── The Autonomous Brain ──────────────────────────────────────────────────

class AutonomousBrain {
  private state: AutonomousBrainState = initialState();
  private timers: BrainTimers = { ...DEFAULT_TIMERS };
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;

  // Injected dependencies (set by start())
  private inputFn: ((symbol: string) => Promise<any>) | null = null;
  private runCycleFn: ((inputs: any[]) => Promise<any>) | null = null;
  private runBacktestFn: ((input: any, bars?: number) => Promise<any>) | null = null;

  get status(): AutonomousBrainState {
    return { ...this.state };
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  start(
    symbols: string[],
    inputFn: (symbol: string) => Promise<any>,
    runCycleFn: (inputs: any[]) => Promise<any>,
    runBacktestFn: (input: any, bars?: number) => Promise<any>,
    overrideTimers?: Partial<BrainTimers>,
  ): void {
    if (this.state.running) {
      logger.info("[AutonomousBrain] Already running");
      return;
    }

    this.state = { ...initialState(), running: true, symbols, startedAt: Date.now() };
    this.timers = { ...DEFAULT_TIMERS, ...overrideTimers };
    this.inputFn = inputFn;
    this.runCycleFn = runCycleFn;
    this.runBacktestFn = runBacktestFn;

    this._registerJobHandlers();
    this._scheduleScan();
    this._scheduleDispatch();
    this._scheduleAttentionBacktest();

    // Boot all Phase 8 subsystems automatically
    this._autoBootSubsystems(symbols);

    // Seed the queue with initial work
    this._seedInitialJobs();

    logger.info(`[AutonomousBrain] Started — ${symbols.length} symbols, mode: ${this.state.mode}`);
    brainEventBus.agentReport({
      agentId: "brain",
      symbol: "SYSTEM",
      status: "done",
      confidence: 1,
      score: 1,
      verdict: `Autonomous Brain started v${this.state.version} — ${symbols.length} symbols, ${this.state.mode} mode`,
      data: { mode: this.state.mode, symbols, timers: this.timers },
      flags: [],
      timestamp: Date.now(),
      latencyMs: 0,
    });
  }

  // ── Phase 9: Auto-boot all subsystems ─────────────────────────────────────

  private _autoBootSubsystems(symbols: string[]): void {
    // Use dynamic imports to avoid circular deps at module load time
    Promise.all([
      import("./brain_watchdog.js"),
      import("./brain_stream_bridge.js"),
      import("./correlation_engine.js"),
      import("./brain_pnl_tracker.js"),
    ]).then(([{ brainWatchdog }, { brainStreamBridge }, { correlationEngine }, { brainPnLTracker }]) => {
      // Start watchdog
      if (!brainWatchdog.isRunning?.()) {
        brainWatchdog.start();
        logger.info("[AutonomousBrain] Watchdog auto-started");
      }

      // Start stream bridge (stock WebSocket)
      if (!brainStreamBridge.isConnected?.()) {
        brainStreamBridge.start();
        // Subscribe to all tracked symbols
        for (const sym of symbols) {
          brainStreamBridge.subscribeSymbol(sym);
        }
        logger.info(`[AutonomousBrain] StreamBridge auto-started — ${symbols.length} symbols`);
      }

      // Start correlation engine feeds
      logger.info("[AutonomousBrain] CorrelationEngine ready");

      // Start P&L tracker
      if (!brainPnLTracker.isRunning?.()) {
        brainPnLTracker.start();
        logger.info("[AutonomousBrain] P&L Tracker auto-started");
      }

      // Warm-load performance engine for all symbols
      for (const sym of symbols) {
        brainPerformance.warmLoad(sym).catch((e) => logger.debug({ err: e, symbol: sym }, "[Brain] warmLoad failed"));
      }

      logger.info("[AutonomousBrain] All Phase 8 subsystems booted");
    }).catch((err) => {
      logger.warn("[AutonomousBrain] Subsystem auto-boot warning:", err?.message ?? err);
    });
  }

  // ── Phase 9: Continuous attention-based backtest loop (every 15 min) ──────

  private _attentionBacktestTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ATTENTION_BACKTEST_INTERVAL_MS = 15 * 60_000; // 15 minutes

  private _scheduleAttentionBacktest(): void {
    if (!this.state.running) return;

    const tick = async () => {
      if (!this.state.running) return;
      try {
        await this._runAttentionBacktest();
      } catch (err) {
        logger.error("[AutonomousBrain] Attention backtest tick error:", err);
      }
      if (this.state.running) {
        this._attentionBacktestTimer = setTimeout(tick, this.ATTENTION_BACKTEST_INTERVAL_MS);
      }
    };

    // First run after 2 minutes to let initial scans settle
    this._attentionBacktestTimer = setTimeout(tick, 2 * 60_000);
  }

  private async _runAttentionBacktest(): Promise<void> {
    // Identify high-attention symbols (score ≥ 0.65) or degrading strategies
    const candidates = this.state.symbols.filter((sym) => {
      const attention = this.state.attentionMap[sym] ?? 0.5;
      const strategy = strategyRegistry.get("smc_ob_fvg", sym);
      const isDegrading = strategy?.tier === "DEGRADING" || strategy?.tier === "SEED" || strategy?.tier === "LEARNING";
      const isHighAttention = attention >= 0.65;
      const notRecentlyTested = (Date.now() - (this.state.lastBacktestAt[sym] ?? 0)) > 15 * 60_000;
      return (isHighAttention || isDegrading) && notRecentlyTested;
    });

    if (candidates.length === 0) return;

    // Limit to top 3 to avoid overwhelming the job queue
    const topCandidates = candidates
      .sort((a, b) => (this.state.attentionMap[b] ?? 0.5) - (this.state.attentionMap[a] ?? 0.5))
      .slice(0, 3);

    for (const sym of topCandidates) {
      BrainJobs.backtest(sym, 1000, "attention-based 15min backtest", 2);
      this.state.totalJobsCreated++;
      this.state.lastBacktestAt[sym] = Date.now();
    }

    if (topCandidates.length > 0) {
      logger.info(`[AutonomousBrain] Attention backtest queued: ${topCandidates.join(", ")}`);
    }
  }

  stop(): void {
    this.state.running = false;
    if (this.scanTimer) { clearTimeout(this.scanTimer); this.scanTimer = null; }
    if (this.dispatchTimer) { clearTimeout(this.dispatchTimer); this.dispatchTimer = null; }
    if (this._attentionBacktestTimer) { clearTimeout(this._attentionBacktestTimer); this._attentionBacktestTimer = null; }

    // Signal subsystems to stop
    Promise.all([
      import("./brain_watchdog.js"),
      import("./brain_stream_bridge.js"),
      import("./brain_pnl_tracker.js"),
    ]).then(([{ brainWatchdog }, { brainStreamBridge }, { brainPnLTracker }]) => {
      brainWatchdog.stop?.();
      brainStreamBridge.stop?.();
      brainPnLTracker.stop?.();
    }).catch((e) => logger.warn({ err: e }, "[Brain] subsystem stop failed"));

    brainAlerts.custom("BRAIN_STOPPED", "warning", "Autonomous Brain Stopped",
      `Brain stopped after ${this.state.cycleCount} cycles, ${this.state.totalJobsCompleted} jobs`
    ).catch((e) => logger.debug({ err: e }, "[Brain] stop alert failed"));

    logger.info(`[AutonomousBrain] Stopped. Cycles: ${this.state.cycleCount}, Jobs: ${this.state.totalJobsCompleted}`);
  }

  // ── Job Registration ───────────────────────────────────────────────────────

  private _registerJobHandlers(): void {
    // SCAN_SYMBOL → run L1-L6 cycle
    registerJobHandler("SCAN_SYMBOL", async (job) => {
      if (!this.inputFn || !this.runCycleFn) return { skipped: true };
      const symbol = job.payload.symbol as string;
      const input = await this.inputFn(symbol);
      const result = await this.runCycleFn([input]);
      this.state.scanCount++;
      return { symbol, decisions: result?.decisions?.length ?? 0, cycleId: result?.cycleId };
    });

    // BACKTEST → run L7+L8
    registerJobHandler("BACKTEST", async (job) => {
      if (!this.inputFn || !this.runBacktestFn) return { skipped: true };
      const symbol = job.payload.symbol as string;
      const bars = (job.payload as any).lookbackBars ?? 2000;
      const input = await this.inputFn(symbol);
      const result = await this.runBacktestFn(input, bars);
      this.state.backtestCount++;
      this.state.lastBacktestAt[symbol] = Date.now();

      // Record backtest metrics for strategy evolution
      if (result?.backtestOutput) {
        BrainJobs.evolveStrategy(symbol, "smc_ob_fvg", result.backtestOutput);
      }

      return { symbol, ...result?.backtestOutput };
    });

    // EVOLVE_STRATEGY → strategy evolution engine
    registerJobHandler("EVOLVE_STRATEGY", async (job) => {
      const { symbol, strategy, backtestMetrics } = job.payload as any;
      const result = evolveStrategy({
        symbol,
        strategyId: strategy ?? "smc_ob_fvg",
        metrics: {
          winRate: backtestMetrics?.winRate ?? 0.5,
          sharpeRatio: backtestMetrics?.sharpeRatio ?? 0,
          sortinoRatio: backtestMetrics?.sortinoRatio ?? 0,
          calmarRatio: backtestMetrics?.calmarRatio ?? 0,
          profitFactor: backtestMetrics?.profitFactor ?? 1,
          expectancy: backtestMetrics?.expectancy ?? 0,
          maxDrawdownR: backtestMetrics?.maxDrawdownR ?? 0,
          totalTrades: backtestMetrics?.totalTrades ?? 0,
          avgMFE: backtestMetrics?.avgMFE ?? 0,
          avgMAE: backtestMetrics?.avgMAE ?? 0,
          mtfAlignedWR: backtestMetrics?.mtfAlignedWR ?? 0.5,
          mtfDivergentWR: backtestMetrics?.mtfDivergentWR ?? 0.5,
          winRateByRegime: backtestMetrics?.winRateByRegime ?? {},
          tradesByRegime: backtestMetrics?.tradesByRegime ?? {},
        },
      });
      this.state.evolutionCount++;
      this.state.lastEvolveAt[symbol] = Date.now();

      // If tier changed → fire alerts
      if (result.newTier === "SUSPENDED") {
        brainAlerts.strategySuspended(symbol, strategy ?? "smc_ob_fvg").catch((e) => logger.debug({ err: e }, "[Brain] strategySuspended alert failed"));
      } else if (result.newTier === "ELITE") {
        brainAlerts.newEliteStrategy(symbol, strategy ?? "smc_ob_fvg").catch((e) => logger.debug({ err: e }, "[Brain] newElite alert failed"));
      } else if (result.newTier === "DEGRADING") {
        brainAlerts.custom(
          "STRATEGY_SUSPENDED", "warning",
          `Strategy Degrading — ${symbol}`,
          `${strategy} on ${symbol} degraded to ${result.newTier} after ${result.changes.length} param changes`
        ).catch((e) => logger.debug({ err: e }, "[Brain] strategy degraded alert failed"));
      }

      if (result.newTier === "DEGRADING" || result.newTier === "SUSPENDED") {
        brainEventBus.agentReport({
          agentId: "L6_evolution",
          symbol,
          status: "done",
          confidence: 0.9,
          score: 0.2,
          verdict: `Strategy ${strategy} on ${symbol} tier: ${result.newTier}`,
          data: { tier: result.newTier, changes: result.changes.length },
          flags: [{ level: "warning", code: "STRATEGY_TIER_CHANGE", message: `${symbol} ${strategy} degraded to ${result.newTier}` }],
          timestamp: Date.now(),
          latencyMs: 0,
        });
      }

      return {
        symbol,
        strategyId: strategy,
        version: result.version,
        tier: result.newTier,
        changes: result.changes.length,
        summary: result.summary,
      };
    });

    // RETRAIN_ML → super intelligence v2 retrain
    registerJobHandler("RETRAIN_ML", async (job) => {
      const symbol = job.payload.symbol as string | undefined;
      let count = 0;
      if (symbol) {
        const r = superIntelligenceV2.retrain(symbol);
        count = 1;
        this.state.retrainCount++;

        // Phase 9: detect SI drift (accuracy < 50% or brier > 0.30)
        if (r.accuracy < 0.50 || r.brier > 0.30) {
          brainAlerts.siDrift(symbol, r.accuracy, r.brier).catch((e) => logger.debug({ err: e }, "[Brain] siDrift alert failed"));
        }

        // Alert on retrain completion
        brainAlerts.custom(
          "RETRAIN_COMPLETE", "info",
          `SI Retrained — ${symbol}`,
          `v${r.version} | Accuracy: ${(r.accuracy * 100).toFixed(1)}% | Brier: ${r.brier.toFixed(3)}`
        ).catch((e) => logger.debug({ err: e }, "[Brain] retrain alert failed"));

        return { symbol, version: r.version, accuracy: r.accuracy, brier: r.brier };
      } else {
        count = superIntelligenceV2.triggerGlobalEvolution();
        this.state.retrainCount++;
        return { globalRetrain: true, symbolCount: count };
      }
    });

    // RANK_SYMBOLS → update attention map
    registerJobHandler("RANK_SYMBOLS", async (job) => {
      const symbols = (job.payload as any).symbols as string[];
      const rankings = rankStrategies(symbols);
      for (const r of rankings) {
        this.state.attentionMap[r.symbol] = r.compositeScore;
      }
      this.state.opportunityRank = rankings.map((r) => r.symbol);
      this.state.lastRankAt = Date.now();
      return { ranked: rankings.length, topSymbol: rankings[0]?.symbol };
    });

    // BUILD_RULEBOOK → cross-symbol rule synthesis
    registerJobHandler("BUILD_RULEBOOK", async (job) => {
      const symbols = (job.payload as any).symbols as string[];
      const allStrategies = strategyRegistry.getAll();
      const rules: string[] = [];
      for (const s of allStrategies) {
        if (s.blacklistedRegimes.length > 0) {
          rules.push(`${s.symbol}/${s.strategyId}: Avoid regimes ${s.blacklistedRegimes.join(", ")}`);
        }
        if (s.requireMTFAlignment) {
          rules.push(`${s.symbol}/${s.strategyId}: MTF alignment required (empirically proven)`);
        }
        if (s.tier === "ELITE") {
          rules.push(`${s.symbol}/${s.strategyId}: ELITE — ${(s.winRate * 100).toFixed(0)}% WR, Sharpe ${s.sharpeRatio.toFixed(2)}`);
        }
      }
      this.state.lastRulebookAt = Date.now();
      return { symbolCount: symbols.length, ruleCount: rules.length, rules: rules.slice(0, 20) };
    });

    // ANALYZE_REGIME → cross-symbol regime study
    registerJobHandler("ANALYZE_REGIME", async (job) => {
      const { symbols, depth } = job.payload as any;
      // Placeholder — future: cross-symbol regime correlation
      return { symbols: symbols.length, depth, analysisComplete: true };
    });

    // MONITOR_POSITION → check if position should be exited
    registerJobHandler("MONITOR_POSITION", async (job) => {
      if (!this.inputFn) return { skipped: true };
      const { symbol, direction, entryPrice, stopLoss, takeProfit } = job.payload as any;
      const input = await this.inputFn(symbol);
      const lastPrice = input?.bars1m?.slice(-1)[0]?.Close ?? entryPrice;
      const hitTP = direction === "long" ? lastPrice >= takeProfit : lastPrice <= takeProfit;
      const hitSL = direction === "long" ? lastPrice <= stopLoss : lastPrice >= stopLoss;
      const action = hitTP ? "TP_HIT" : hitSL ? "SL_HIT" : "HOLD";
      if (action !== "HOLD") {
        const won = action === "TP_HIT";
        this._recordPositionOutcome(symbol, direction, entryPrice, lastPrice, won);
      }
      return { symbol, action, lastPrice, hitTP, hitSL };
    });

    // CHART_SNAPSHOT → generate charts (delegates to L8)
    registerJobHandler("CHART_SNAPSHOT", async (job) => {
      // Lightweight — just signals L8 to run; actual chart generation happens in orchestrator
      return { symbol: job.payload.symbol, queued: true };
    });
  }

  // ── Outcome Recording ──────────────────────────────────────────────────────

  recordTradeOutcome(
    symbol: string,
    direction: "long" | "short",
    won: boolean,
    achievedR: number,
    regime: string,
    predictedWinProb: number,
    features: Record<string, unknown> = {},
  ): void {
    superIntelligenceV2.recordOutcome({
      id: `outcome_${Date.now()}`,
      symbol,
      strategyId: "smc_ob_fvg",
      direction,
      regime,
      features: features as any,
      predictedWinProb,
      actualWon: won,
      achievedR,
      timestamp: new Date().toISOString(),
    });

    // Update streak tracking
    if (won) {
      this.state.consecutiveWins++;
      this.state.consecutiveLosses = 0;
    } else {
      this.state.consecutiveLosses++;
      this.state.consecutiveWins = 0;
    }

    // React to losing streak
    if (this.state.consecutiveLosses >= 5 && this.state.mode !== "DEFENSIVE") {
      this.state.mode = "DEFENSIVE";
      logger.info("[AutonomousBrain] Entering DEFENSIVE mode after 5 consecutive losses");

      // Phase 9: fire alert for consecutive losses + defensive mode
      brainAlerts.consecutiveLosses(symbol, this.state.consecutiveLosses).catch((e) => logger.debug({ err: e }, "[Brain] loss alert failed"));
      brainAlerts.defensiveMode(this.state.consecutiveLosses).catch((e) => logger.debug({ err: e }, "[Brain] defensive alert failed"));

      brainEventBus.agentReport({
        agentId: "brain",
        symbol: "SYSTEM",
        status: "done",
        confidence: 0.8,
        score: 0.2,
        verdict: "Brain entering DEFENSIVE mode — 5 consecutive losses detected",
        data: { consecutiveLosses: this.state.consecutiveLosses, mode: "DEFENSIVE" },
        flags: [{ level: "critical", code: "DEFENSIVE_MODE", message: "5 consecutive losses — position sizes halved" }],
        timestamp: Date.now(),
        latencyMs: 0,
      });
      // Immediately evolve all strategies to reduce size
      for (const sym of this.state.symbols) {
        BrainJobs.evolveStrategy(sym, "smc_ob_fvg", { consecutiveLosses: 5 }, "Defensive mode activation");
      }
    }

    // Recover from defensive mode after winning streak
    if (this.state.consecutiveWins >= 8 && this.state.mode === "DEFENSIVE") {
      this.state.mode = "NORMAL";
      logger.info("[AutonomousBrain] Recovering to NORMAL mode after 8 consecutive wins");
    }

    // Trigger ML retrain when enough new outcomes
    const totalOutcomes = superIntelligenceV2.getStatus(symbol)[0]?.outcomes ?? 0;
    if (totalOutcomes > 0 && totalOutcomes % 50 === 0) {
      BrainJobs.retrainML(`${totalOutcomes} outcomes accumulated on ${symbol}`, 50, symbol);
    }
  }

  private _recordPositionOutcome(
    symbol: string,
    direction: "long" | "short",
    entryPrice: number,
    exitPrice: number,
    won: boolean,
  ): void {
    const achievedR = won
      ? Math.abs(exitPrice - entryPrice) / Math.abs(entryPrice * 0.01)
      : -Math.abs(exitPrice - entryPrice) / Math.abs(entryPrice * 0.01);
    this.recordTradeOutcome(symbol, direction, won, achievedR, "unknown", 0.5);
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  private _seedInitialJobs(): void {
    const symbols = this.state.symbols;
    if (symbols.length === 0) return;

    // Rank symbols immediately
    BrainJobs.rankSymbols(symbols);
    this.state.totalJobsCreated++;

    // Queue initial scans
    for (const sym of symbols) {
      BrainJobs.scanSymbol(sym, "initial startup scan", 2);
      this.state.totalJobsCreated++;
    }

    // Queue one backtest per symbol at startup (staggered)
    symbols.forEach((sym, i) => {
      setTimeout(() => {
        if (this.state.running) {
          BrainJobs.backtest(sym, 2000, "startup backtest", 3);
          this.state.totalJobsCreated++;
        }
      }, i * 10_000); // 10s between each to avoid spike
    });
  }

  private _scheduleScan(): void {
    if (!this.state.running) return;

    const tick = async () => {
      if (!this.state.running) return;

      try {
        await this._runScanTick();
      } catch (err) {
        this.state.errors++;
        logger.error("[AutonomousBrain] Scan tick error:", err);
      }

      if (this.state.running) {
        this.scanTimer = setTimeout(tick, this.timers.scanIntervalMs);
      }
    };

    this.scanTimer = setTimeout(tick, this.timers.scanIntervalMs);
  }

  private _scheduleDispatch(): void {
    if (!this.state.running) return;

    const tick = async () => {
      if (!this.state.running) return;

      try {
        const ran = await dispatchBatch("autonomous_brain", undefined, 3);
        if (ran > 0) this.state.totalJobsCompleted += ran;
      } catch (err) {
        this.state.errors++;
      }

      if (this.state.running) {
        this.dispatchTimer = setTimeout(tick, this.timers.jobDispatchIntervalMs);
      }
    };

    this.dispatchTimer = setTimeout(tick, this.timers.jobDispatchIntervalMs);
  }

  private async _runScanTick(): Promise<void> {
    const now = Date.now();
    this.state.cycleCount++;

    const { symbols } = this.state;
    if (symbols.length === 0) return;

    // ── 1. Scan symbols (queue if overdue) ──────────────────────────────────
    if (now - this.state.lastScanAt >= this.timers.scanIntervalMs) {
      // Prioritize top-attention symbols
      const toScan = this._getAttentionSortedSymbols();
      for (const sym of toScan) {
        const reason = this._getScanReason(sym);
        BrainJobs.scanSymbol(sym, reason, this._getScanPriority(sym));
        this.state.totalJobsCreated++;
      }
      this.state.lastScanAt = now;
    }

    // ── 2. Rank symbols (every 5 min) ────────────────────────────────────────
    if (now - this.state.lastRankAt >= this.timers.rankIntervalMs) {
      BrainJobs.rankSymbols(symbols);
      this.state.totalJobsCreated++;
    }

    // ── 3. Backtest (stagger — one symbol per opportunity) ───────────────────
    for (const sym of symbols) {
      const lastBt = this.state.lastBacktestAt[sym] ?? 0;
      if (now - lastBt >= this.timers.backtestIntervalMs) {
        // Only backtest if strategy needs it (SEED or degrading)
        const strategy = strategyRegistry.get("smc_ob_fvg", sym);
        const needsBacktest = !strategy || strategy.tier === "SEED" || strategy.tier === "LEARNING" || strategy.tier === "DEGRADING";
        if (needsBacktest) {
          BrainJobs.backtest(sym, 2000, "scheduled backtest", 3);
          this.state.totalJobsCreated++;
          this.state.lastBacktestAt[sym] = now; // prevents re-queue in same tick
        }
      }
    }

    // ── 4. Retrain ML ────────────────────────────────────────────────────────
    if (now - this.state.lastRetrainAt >= this.timers.retrainIntervalMs) {
      BrainJobs.retrainML("scheduled periodic retrain", 0);
      this.state.totalJobsCreated++;
      this.state.lastRetrainAt = now;
    }

    // ── 5. Build rulebook ────────────────────────────────────────────────────
    if (now - this.state.lastRulebookAt >= this.timers.rulebookIntervalMs) {
      BrainJobs.buildRulebook(symbols, 20, "periodic rulebook synthesis");
      this.state.totalJobsCreated++;
      this.state.lastRulebookAt = now;
    }
  }

  // ── Attention Management ───────────────────────────────────────────────────

  private _getAttentionSortedSymbols(): string[] {
    const { symbols, attentionMap } = this.state;
    return [...symbols].sort((a, b) => (attentionMap[b] ?? 0.5) - (attentionMap[a] ?? 0.5));
  }

  private _getScanPriority(symbol: string): 0 | 1 | 2 | 3 | 4 {
    const attention = this.state.attentionMap[symbol] ?? 0.5;
    if (attention >= 0.85) return 1; // HIGH
    if (attention >= 0.60) return 2; // NORMAL
    return 3; // LOW
  }

  private _getScanReason(symbol: string): string {
    const strategy = strategyRegistry.get("smc_ob_fvg", symbol);
    if (!strategy) return "initial scan — no strategy yet";
    const tier = strategy.tier;
    if (tier === "ELITE") return `ELITE strategy active — ${(strategy.winRate * 100).toFixed(0)}% WR`;
    if (tier === "DEGRADING") return `Strategy degrading — monitor closely`;
    if (tier === "SUSPENDED") return `Strategy suspended — observation only`;
    return `${tier} strategy — routine scan`;
  }

  // ── React API ─────────────────────────────────────────────────────────────

  /** React to a confirmed signal from L5 — boost attention + queue priority scan */
  onSignalConfirmed(symbol: string, direction: "long" | "short", score: number): void {
    this.state.attentionMap[symbol] = Math.min(1, (this.state.attentionMap[symbol] ?? 0.5) + 0.3);
    // Immediate high-priority scan
    BrainJobs.scanSymbol(symbol, `Signal confirmed: ${direction} score ${(score * 100).toFixed(0)}%`, 1);
    this.state.totalJobsCreated++;
  }

  /** React to regime change — re-rank and re-scan affected symbols */
  onRegimeChange(symbol: string, newRegime: string, oldRegime: string): void {
    logger.info(`[AutonomousBrain] Regime change: ${symbol} ${oldRegime} → ${newRegime}`);
    BrainJobs.scanSymbol(symbol, `Regime change: ${oldRegime}→${newRegime}`, 1);
    BrainJobs.rankSymbols(this.state.symbols);
    this.state.totalJobsCreated += 2;
  }

  /** Manually add a symbol to track */
  addSymbol(symbol: string): void {
    if (!this.state.symbols.includes(symbol)) {
      this.state.symbols.push(symbol);
      this.state.attentionMap[symbol] = 0.5;
      BrainJobs.backtest(symbol, 2000, "new symbol added", 2);
      BrainJobs.scanSymbol(symbol, "new symbol initial scan", 2);
      this.state.totalJobsCreated += 2;
    }
  }

  setMode(mode: BrainMode): void {
    this.state.mode = mode;
    logger.info(`[AutonomousBrain] Mode set to ${mode}`);
  }

  getFullStatus(): {
    brain: AutonomousBrainState;
    queue: ReturnType<typeof brainJobQueue.getStats>;
    strategies: ReturnType<typeof strategyRegistry.getSummary>;
    superIntel: ReturnType<typeof superIntelligenceV2.getStatus>;
    running: boolean;
    uptime: number;
  } {
    return {
      brain: { ...this.state },
      queue: brainJobQueue.getStats(),
      strategies: strategyRegistry.getSummary(),
      superIntel: superIntelligenceV2.getStatus(),
      running: this.state.running,
      uptime: this.state.running ? Date.now() - this.state.startedAt : 0,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

export const autonomousBrain = new AutonomousBrain();
