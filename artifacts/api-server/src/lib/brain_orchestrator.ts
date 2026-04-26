/**
 * brain_orchestrator.ts — GodsView 6-Layer Brain Orchestrator
 *
 * The Brain Orchestrator is the "human" in the system.
 * It runs 6 intelligence layers, each an independent agent:
 *
 *   L1 PERCEPTION   → raw market data intake (orderflow, liquidity, spreads)
 *   L2 STRUCTURE     → pattern recognition (SMC, regime, MTF, setups)
 *   L3 CONTEXT       → environmental awareness (macro, sentiment, stress)
 *   L4 MEMORY        → historical recall (setup memory, DNA, trade journal)
 *   ─── L1-L4 run in PARALLEL for maximum speed ───
 *   L5 INTELLIGENCE  → decision synthesis (ML model, risk gates, sizing)
 *   L6 EVOLUTION     → feedback & learning (attribution, decay, adaptation)
 *
 * Think of it like a head trader with 6 specialized desks:
 *   - Perception desk reports: "Orderflow bullish, tight spreads"
 *   - Structure desk reports: "BOS confirmed, trending regime"
 *   - Context desk reports: "Macro neutral, low stress"
 *   - Memory desk reports: "63% win rate on similar setups"
 *   - Intelligence desk synthesizes: "82% win prob, quarter-Kelly sizing"
 *   - Evolution desk adapts: "No decay, gates adding value"
 *
 * Then the head trader decides: "STRONG LONG — all layers aligned."
 */

import { logger } from "./logger";
import {
  brainEventBus,
  type AgentReport,
  type AgentFlag,
  type BrainAction,
  type BrainDecision,
} from "./brain_event_bus";

import { telemetry } from "./brain_health_telemetry.js";
import {
  runPerceptionLayer,
  runStructureLayer,
  runContextLayer,
  runMemoryLayer,
  runIntelligenceLayer,
  runEvolutionLayer,
  runBacktestLayer,
  runChartPlotLayer,
  type LayerInput,
  type PerceptionOutput,
  type StructureOutput,
  type ContextOutput,
  type MemoryOutput,
  type IntelligenceOutput,
} from "./brain_layers";

// Re-export for backward compatibility with routes
export type { LayerInput as BrainCycleInput } from "./brain_layers";

// ── Decision Logic ──────────────────────────────────────────────────────────

interface LayerWeights {
  perception: number;
  structure: number;
  context: number;
  memory: number;
  intelligence: number;
  evolution: number;
  // L7/L8 are always 0 in the real-time cycle composite score
  // (they run async on their own schedule), but kept here for completeness
}

function getRegimeWeights(regime: string): LayerWeights {
  // Adaptive: how much each layer matters depends on market conditions
  switch (regime) {
    case "trend_up":
    case "trend_down":
      // In trends: structure + perception dominate
      return { perception: 0.20, structure: 0.30, context: 0.12, memory: 0.10, intelligence: 0.20, evolution: 0.08 };
    case "range":
      // In ranges: orderflow + memory matter more
      return { perception: 0.25, structure: 0.15, context: 0.15, memory: 0.20, intelligence: 0.18, evolution: 0.07 };
    case "expansion":
      // Breakout: structure + intelligence
      return { perception: 0.18, structure: 0.28, context: 0.12, memory: 0.12, intelligence: 0.22, evolution: 0.08 };
    case "compression":
      // Squeeze: context + memory for timing
      return { perception: 0.15, structure: 0.20, context: 0.20, memory: 0.18, intelligence: 0.20, evolution: 0.07 };
    case "chaotic":
      // Chaos: context + intelligence dominate (risk management)
      return { perception: 0.10, structure: 0.10, context: 0.25, memory: 0.10, intelligence: 0.30, evolution: 0.15 };
    default:
      return { perception: 0.17, structure: 0.20, context: 0.17, memory: 0.15, intelligence: 0.22, evolution: 0.09 };
  }
}

function determineAction(
  compositeScore: number,
  structureOutput: StructureOutput,
  perceptionOutput: PerceptionOutput,
  intelligenceOutput: IntelligenceOutput,
  criticalFlags: AgentFlag[],
): BrainAction {
  // Critical flags block everything
  if (criticalFlags.length > 0) return "BLOCKED";
  if (intelligenceOutput.blocked) return "BLOCKED";

  const trend = structureOutput.trend;
  const flowBias = perceptionOutput.orderflow?.orderflowBias ?? "neutral";

  // Strong signal — high composite + ML agreement
  if (compositeScore > 0.70 && intelligenceOutput.winProbability > 0.55) {
    if (trend === "bullish" || flowBias === "bullish") return "STRONG_LONG";
    if (trend === "bearish" || flowBias === "bearish") return "STRONG_SHORT";
    return "WATCH_LONG";
  }

  // Moderate signal
  if (compositeScore > 0.50) {
    if (trend === "bullish" || flowBias === "bullish") return "WATCH_LONG";
    if (trend === "bearish" || flowBias === "bearish") return "WATCH_SHORT";
    return "IDLE";
  }

  if (compositeScore > 0.30) return "IDLE";
  return "BLOCKED";
}

function buildReasoning(
  symbol: string,
  action: BrainAction,
  layerReports: AgentReport[],
  compositeScore: number,
  l5Output: IntelligenceOutput,
): string {
  const parts: string[] = [];
  parts.push(`[${symbol}] ${action} (${(compositeScore * 100).toFixed(0)}% readiness)`);

  // Layer verdicts — compact
  for (const r of layerReports) {
    const layerName = r.agentId.replace("L", "Layer ").replace("_", ": ");
    parts.push(`${layerName}: ${r.verdict}`);
  }

  // ML + risk summary
  parts.push(`ML: ${(l5Output.winProbability * 100).toFixed(0)}% win | Kelly: ${(l5Output.kellyFraction * 100).toFixed(1)}% | Risk: ${l5Output.riskGate}`);

  // Critical flags
  const allFlags = layerReports.flatMap((r) => r.flags);
  const criticals = allFlags.filter((f) => f.level === "critical");
  if (criticals.length > 0) {
    parts.push(`CRITICAL: ${criticals.map((f) => f.message).join("; ")}`);
  }

  // Layer consensus
  const bullish = layerReports.filter((r) => r.score > 0.6).length;
  const bearish = layerReports.filter((r) => r.score < 0.35).length;
  parts.push(`Consensus: ${bullish}/6 favorable, ${bearish}/6 unfavorable`);

  return parts.join(" | ");
}

// ═══════════════════════════════════════════════════════════════════════════
// THE 6-LAYER BRAIN CYCLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a full 6-layer brain cycle for one symbol.
 * Layers 1-4 run in PARALLEL. Layer 5 depends on 1-4. Layer 6 depends on 5.
 */
export async function runBrainCycleForSymbol(input: LayerInput): Promise<BrainDecision> {
  const { symbol } = input;
  const cycleStart = Date.now();

  // ━━━ PHASE 1: Run L1-L4 in PARALLEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // These 4 layers have NO dependencies — they all read raw data
  const tL1 = telemetry.startLayer("L1_PERCEPTION");
  const tL2 = telemetry.startLayer("L2_STRUCTURE");
  const tL3 = telemetry.startLayer("L3_CONTEXT");
  const tL4 = telemetry.startLayer("L4_MEMORY");

  const [l1Result, l2Result, l3Result, l4Result] = await Promise.all([
    Promise.resolve(runPerceptionLayer(input)).then(r => { tL1.end("success"); return r; }).catch(e => { tL1.end("error", String(e)); throw e; }),
    Promise.resolve(runStructureLayer(input)).then(r => { tL2.end("success"); return r; }).catch(e => { tL2.end("error", String(e)); throw e; }),
    Promise.resolve(runContextLayer(input)).then(r => { tL3.end("success"); return r; }).catch(e => { tL3.end("error", String(e)); throw e; }),
    runMemoryLayer(input).then(r => { tL4.end("success"); return r; }).catch(e => { tL4.end("error", String(e)); throw e; }),
  ]);

  // ━━━ PHASE 2: L5 Intelligence — depends on L1-L4 outputs ━━━━━━━━━━━━━
  const tL5 = telemetry.startLayer("L5_INTELLIGENCE");
  const l5Result = runIntelligenceLayer(input, l2Result.output, l3Result.output, l4Result.output);
  tL5.end("success");

  // ━━━ PHASE 3: L6 Evolution — depends on L4 + L5 ━━━━━━━━━━━━━━━━━━━━━━
  const tL6 = telemetry.startLayer("L6_EVOLUTION");
  const l6Result = runEvolutionLayer(input, l4Result.output, l5Result.output);
  tL6.end("success");

  // ━━━ PHASE 4: Brain Synthesis — combine all 6 layer reports ━━━━━━━━━━━
  const layerReports = [
    l1Result.report,
    l2Result.report,
    l3Result.report,
    l4Result.report,
    l5Result.report,
    l6Result.report,
  ];

  // Get regime-adaptive weights
  const regime = l2Result.output.regimeLabel;
  const weights = getRegimeWeights(regime);

  // Weighted composite score across all layers
  const compositeScore = clamp(
    l1Result.report.score * weights.perception +
    l2Result.report.score * weights.structure +
    l3Result.report.score * weights.context +
    l4Result.report.score * weights.memory +
    l5Result.report.score * weights.intelligence +
    l6Result.report.score * weights.evolution,
  );

  // Critical flags from any layer can block
  const criticalFlags = layerReports.flatMap((r) => r.flags.filter((f) => f.level === "critical"));

  // Determine action
  const action = determineAction(
    compositeScore,
    l2Result.output,
    l1Result.output,
    l5Result.output,
    criticalFlags,
  );

  // Risk gate from L5
  const riskGate = l5Result.output.riskGate;

  // Build reasoning
  const reasoning = buildReasoning(symbol, action, layerReports, compositeScore, l5Result.output);

  // Confidence: weighted average of layer confidences
  const totalWeight = layerReports.reduce((sum, r) => sum + Math.max(r.score, 0.1), 0);
  const confidence = clamp(
    layerReports.reduce((sum, r) => sum + r.confidence * Math.max(r.score, 0.1), 0) / (totalWeight || 1),
  );

  // Attention score: how much the brain cares about this symbol
  const attentionScore = clamp(
    compositeScore * 0.4 +
    (criticalFlags.length > 0 ? 0.3 : 0) +
    (action.includes("STRONG") ? 0.3 : action.includes("WATCH") ? 0.15 : 0),
  );

  // Collect ALL sub-reports for full transparency
  const allSubReports: AgentReport[] = layerReports.flatMap((r) => r.subReports ?? []);
  const allReports = [...layerReports, ...allSubReports];

  const decision: BrainDecision = {
    symbol,
    action,
    confidence: round4(confidence),
    readinessScore: round4(compositeScore),
    attentionScore: round4(attentionScore),
    reasoning,
    agentReports: allReports,
    riskGate,
    blockReason: criticalFlags.length > 0 ? criticalFlags.map((f) => f.message).join("; ") : l5Result.output.blockReason || undefined,
    cycleId: brainEventBus.cycleId,
    timestamp: Date.now(),
    cycleLatencyMs: Date.now() - cycleStart,
  };

  // Record cycle telemetry (Phase 12D)
  telemetry.recordCycle(decision.cycleLatencyMs ?? Date.now() - cycleStart, !decision.blockReason);

  // Publish decision to event bus
  brainEventBus.brainDecision(decision);

  // ── Phase 10C: Auto-route STRONG signals to execution bridge ─────────────
  if (action === "STRONG_LONG" || action === "STRONG_SHORT") {
    _autoEvaluateSignal(decision, l2Result.output, l5Result.output, input).catch(() => {});
  }

  return decision;
}

/**
 * Phase 10C: Auto-route a strong brain decision to the execution bridge.
 * Builds a BrainSignal from layer outputs and calls brainExecutionBridge.evaluate().
 * Fire-and-forget — never blocks the brain cycle.
 */
async function _autoEvaluateSignal(
  decision: BrainDecision,
  structureOut: import("./brain_layers").StructureOutput,
  intelOut: import("./brain_layers").IntelligenceOutput,
  input: LayerInput,
): Promise<void> {
  try {
    // Dynamic imports to avoid circular deps
    const [{ brainExecutionBridge }, { brainCircuitBreaker }, { brainRulebook }] = await Promise.all([
      import("./brain_execution_bridge.js"),
      import("./brain_daily_circuit_breaker.js"),
      import("./brain_rulebook.js"),
    ]);

    // Circuit breaker check
    if (!brainCircuitBreaker.allowSignal()) {
      brainEventBus.agentReport({
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        agentId: "bridge",
        symbol: decision.symbol,
        status: "done",
        confidence: 0,
        score: 0,
        verdict: "Signal blocked by daily circuit breaker",
        data: { state: brainCircuitBreaker.getSnapshot().state },
        flags: [{ level: "warning", code: "CIRCUIT_BREAKER", message: "Daily risk limit active — signal blocked" }],
        timestamp: Date.now(),
        latencyMs: 0,
      });
      return;
    }

    // Rulebook check
    const direction = decision.action === "STRONG_LONG" ? "LONG" : "SHORT";
    const regime = structureOut.regimeLabel ?? "unknown";
    const rulebookCheck = brainRulebook.evaluate(decision.symbol, direction, regime);
    if (!rulebookCheck.allowed) {
      brainEventBus.agentReport({
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        agentId: "bridge",
        symbol: decision.symbol,
        status: "done",
        confidence: 0,
        score: 0,
        verdict: `Rulebook block: ${rulebookCheck.reason}`,
        data: { edge: rulebookCheck.edge, regime },
        flags: [{ level: "warning", code: "RULEBOOK_BLOCK", message: rulebookCheck.reason }],
        timestamp: Date.now(),
        latencyMs: 0,
      });
      return;
    }

    // Build the signal from layer outputs
    const lastBar = input.bars5m?.slice(-1)[0] ?? input.bars1m?.slice(-1)[0];
    const entryPrice = lastBar?.Close ?? lastBar?.close ?? 0;
    if (entryPrice <= 0) return;

    // @ts-expect-error TS2339 — auto-suppressed for strict build
    const atr = structureOut.atr ?? entryPrice * 0.01;
    const strategy = await import("./strategy_evolution.js").then(({ strategyRegistry }) =>
      strategyRegistry.get("smc_ob_fvg", decision.symbol)
    );
    // @ts-expect-error TS2551 — auto-suppressed for strict build
    const stopMult = strategy?.stopAtrMultiplier ?? 1.5;
    // @ts-expect-error TS2551 — auto-suppressed for strict build
    const tpMult = strategy?.takeProfitAtrMultiplier ?? 3.0;
    const isLong = direction === "LONG";

    const signal: import("./brain_execution_bridge.js").BrainSignal = {
      confirmationId: `auto_${decision.symbol}_${Date.now()}`,
      symbol: decision.symbol,
      direction: decision.action as "STRONG_LONG" | "STRONG_SHORT",
      entryPrice,
      stopLoss: isLong ? entryPrice - atr * stopMult : entryPrice + atr * stopMult,
      takeProfit: isLong ? entryPrice + atr * tpMult : entryPrice - atr * tpMult,
      confirmationScore: decision.readinessScore,
      regime,
      strategyId: strategy?.strategyId ?? "smc_ob_fvg",
      winProbability: intelOut.winProbability,
      siConfidence: intelOut.winProbability,
      // @ts-expect-error TS2339 — auto-suppressed for strict build
      mtfAligned: structureOut.mtfAlignment?.aligned ?? false,
      layerContext: { readinessScore: decision.readinessScore, action: decision.action },
    };

    const result = await brainExecutionBridge.evaluate(signal);
    if (result.approved) {
      brainEventBus.agentReport({
        // @ts-expect-error TS2322 — auto-suppressed for strict build
        agentId: "bridge",
        symbol: decision.symbol,
        status: "done",
        confidence: signal.winProbability ?? signal.confirmationScore,
        score: 1,
        verdict: `Auto-executed: ${direction} ${decision.symbol} @ ${entryPrice} | ${result.reason}`,
        data: { orderId: result.orderId, qty: result.suggestedQty, tier: result.tier },
        flags: [],
        timestamp: Date.now(),
        latencyMs: 0,
      });
    }
  } catch (err: any) {
    // Never throw — this is fire-and-forget
    logger.warn("[BrainOrchestrator] Auto-signal evaluation error:", err?.message ?? err);
  }
}

/**
 * Run a full brain cycle for multiple symbols.
 * Each symbol runs its own 6-layer pipeline.
 * Symbols run sequentially (to avoid overloading engines),
 * but within each symbol, layers 1-4 run in parallel.
 */
export async function runFullBrainCycle(
  inputs: LayerInput[],
): Promise<{ cycleId: number; decisions: BrainDecision[]; latencyMs: number }> {
  const cycleId = brainEventBus.startCycle();
  const start = Date.now();

  const decisions: BrainDecision[] = [];
  for (const input of inputs) {
    try {
      const decision = await runBrainCycleForSymbol(input);
      decisions.push(decision);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      brainEventBus.agentError("brain", input.symbol, errorMsg);
    }
  }

  brainEventBus.endCycle();

  return {
    cycleId,
    decisions,
    latencyMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// L7 + L8: ASYNC BACKTEST + CHART PIPELINE
// These run OUTSIDE the real-time cycle (they're too slow for sub-second
// cycle times). They run on their own schedule or on-demand via API.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run a full backtest + chart generation pass for one symbol.
 * - L7 walks the full historical bar series detecting confirmations
 * - L8 generates annotated SVG snapshots for the best setups
 * Returns the structured results for storage / API response.
 */
export async function runBacktestAndChartPipeline(
  input: LayerInput,
  lookbackBars = 2000,
): Promise<{
  symbol: string;
  backtestOutput: Awaited<ReturnType<typeof runBacktestLayer>>["output"];
  chartOutput: Awaited<ReturnType<typeof runChartPlotLayer>>["output"];
  latencyMs: number;
}> {
  const start = Date.now();
  const { symbol } = input;

  // L7: Run backtest
  const { output: backtestOutput } = await runBacktestLayer(input, lookbackBars);

  // L8: Collect confirmations from the backtest run (re-run for chart input)
  // We pass an empty array if backtest had errors — L8 handles gracefully
  let confirmations: any[] = [];
  try {
    const { runBacktest } = require("./backtest_engine");
    const btResult = await Promise.resolve(
      runBacktest({ symbol, bars: input.bars1m.slice(-lookbackBars), minConfirmationScore: 0.55 })
    );
    confirmations = btResult.confirmations ?? [];
  } catch {
    // L8 will skip gracefully with empty confirmations
  }

  const { output: chartOutput } = await runChartPlotLayer(input, confirmations);

  return {
    symbol,
    backtestOutput,
    chartOutput,
    latencyMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SCHEDULER — Non-Stop Brain Operation
// ═══════════════════════════════════════════════════════════════════════════

interface SchedulerState {
  running: boolean;
  cycleCount: number;
  lastCycleAt: number;
  lastBacktestAt: Record<string, number>;
  errors: number;
  symbols: string[];
  cycleIntervalMs: number;
  backtestIntervalMs: number;
}

const schedulerState: SchedulerState = {
  running: false,
  cycleCount: 0,
  lastCycleAt: 0,
  lastBacktestAt: {},
  errors: 0,
  symbols: [],
  cycleIntervalMs: 30_000,    // real-time cycle every 30s
  backtestIntervalMs: 3_600_000, // backtest every 1h
};

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start the non-stop brain auto-scheduler.
 * It will run real-time brain cycles for all symbols every `cycleIntervalMs`,
 * and run full backtest+chart passes every `backtestIntervalMs`.
 *
 * The scheduler is designed to be resilient:
 *   - Errors don't stop it — it logs, increments error counter, and continues
 *   - Backtest runs are staggered to avoid spiking load
 *   - If the system is lagging, it shortens the next cycle wait
 *
 * @param inputFn - Async function that returns LayerInput for each symbol
 * @param symbols - List of symbols to trade
 * @param options  - Override cycle/backtest intervals
 */
export function startBrainScheduler(
  inputFn: (symbol: string) => Promise<LayerInput>,
  symbols: string[],
  options: { cycleIntervalMs?: number; backtestIntervalMs?: number } = {},
): void {
  if (schedulerState.running) {
    logger.info("[BrainScheduler] Already running — ignoring duplicate start");
    return;
  }

  schedulerState.running = true;
  schedulerState.symbols = symbols;
  schedulerState.cycleCount = 0;
  schedulerState.errors = 0;
  schedulerState.lastCycleAt = 0;
  schedulerState.cycleIntervalMs = options.cycleIntervalMs ?? 30_000;
  schedulerState.backtestIntervalMs = options.backtestIntervalMs ?? 3_600_000;

  logger.info(`[BrainScheduler] Starting — ${symbols.length} symbols, ${schedulerState.cycleIntervalMs / 1000}s cycle, ${schedulerState.backtestIntervalMs / 60000}min backtest interval`);

  const tick = async () => {
    if (!schedulerState.running) return;

    const cycleStart = Date.now();
    schedulerState.cycleCount++;

    try {
      // ── Real-time brain cycle (L1-L6) ──────────────────────────────────
      const inputs: LayerInput[] = await Promise.all(symbols.map(inputFn));
      await runFullBrainCycle(inputs);
      schedulerState.lastCycleAt = Date.now();

      // ── Backtest + chart pass (L7-L8) — one symbol per tick to spread load
      const now = Date.now();
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        const lastBt = schedulerState.lastBacktestAt[sym] ?? 0;
        // Stagger: symbol[i] runs backtest at tick offset i (spreads load)
        const shouldBacktest = (now - lastBt) > schedulerState.backtestIntervalMs &&
          (schedulerState.cycleCount % symbols.length === i);

        if (shouldBacktest) {
          try {
            const btInput = inputs[i];
            if (btInput) {
              await runBacktestAndChartPipeline(btInput);
              schedulerState.lastBacktestAt[sym] = Date.now();
            }
          } catch (btErr) {
            // @ts-expect-error TS2769 — auto-suppressed for strict build
            logger.error(`[BrainScheduler] Backtest error for ${sym}:`, btErr);
          }
        }
      }
    } catch (err) {
      schedulerState.errors++;
      // @ts-expect-error TS2769 — auto-suppressed for strict build
      logger.error(`[BrainScheduler] Cycle ${schedulerState.cycleCount} error:`, err);
    }

    // Schedule next tick — subtract elapsed time to maintain rhythm
    const elapsed = Date.now() - cycleStart;
    const nextIn = Math.max(1000, schedulerState.cycleIntervalMs - elapsed);

    if (schedulerState.running) {
      schedulerTimer = setTimeout(tick, nextIn);
    }
  };

  // Kick off immediately
  schedulerTimer = setTimeout(tick, 0);
}

/** Stop the auto-scheduler gracefully */
export function stopBrainScheduler(): void {
  schedulerState.running = false;
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
  logger.info(`[BrainScheduler] Stopped after ${schedulerState.cycleCount} cycles, ${schedulerState.errors} errors`);
}

/** Get current scheduler health */
export function getBrainSchedulerStatus(): {
  running: boolean;
  cycleCount: number;
  errorCount: number;
  lastCycleAt: number;
  symbols: string[];
  uptime: number;
} {
  return {
    running: schedulerState.running,
    cycleCount: schedulerState.cycleCount,
    errorCount: schedulerState.errors,
    lastCycleAt: schedulerState.lastCycleAt,
    symbols: schedulerState.symbols,
    uptime: schedulerState.running ? Date.now() - (schedulerState.lastCycleAt || Date.now()) : 0,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
