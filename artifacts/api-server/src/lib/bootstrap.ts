/**
 * bootstrap.ts — GodsView System Bootstrap
 *
 * Instantiates and wires together the PipelineOrchestrator,
 * which connects all subsystems:
 *   Data Engine → MCP Intelligence → Risk Management → Execution → Learning Loop
 *
 * This module is imported by app.ts on startup. It exposes the orchestrator
 * singleton and wires TradingView route providers.
 *
 * IMPORTANT: This is what makes GodsView a SYSTEM, not just a collection of
 * endpoints. Without this bootstrap, modules exist in isolation.
 */
import { PipelineOrchestrator, type OrchestratorConfig } from "./integration/pipeline_orchestrator.js";
import { injectProviders } from "../routes/tradingview_mcp.js";
import { logger } from "./logger.js";

// ── Configuration ───────────────────────────────────────────────────────────

const config: OrchestratorConfig = {
  pipelineConfig: {
    webhookPassphrase: process.env.TV_WEBHOOK_SECRET || "",
    minConfirmationScore: parseFloat(process.env.MIN_CONFIRMATION_SCORE || "0.6"),
    minDataQualityScore: parseFloat(process.env.MIN_DATA_QUALITY_SCORE || "0.4"),
    maxSignalAgeSec: parseInt(process.env.MAX_SIGNAL_AGE_SEC || "300"),
    requireOrderFlowConfirmation: process.env.REQUIRE_ORDERFLOW !== "false",
    autoAdjustStops: process.env.AUTO_ADJUST_STOPS !== "false",
    riskPerTradePct: parseFloat(process.env.RISK_PER_TRADE_PCT || "1.0"),
  },
  riskLimits: {
    maxDailyLossPct: parseFloat(process.env.MAX_DAILY_LOSS_PCT || "2.0"),
    maxPositionPct: parseFloat(process.env.MAX_POSITION_PCT || "5.0"),
    maxExposurePct: parseFloat(process.env.MAX_EXPOSURE_PCT || "30.0"),
    maxDrawdownPct: parseFloat(process.env.MAX_DRAWDOWN_PCT || "10.0"),
  },
  brokerMode: (process.env.BROKER_MODE as "paper" | "live") || "paper",
  initialCapital: parseFloat(process.env.INITIAL_CAPITAL || "100000"),
};

// ── Singleton ───────────────────────────────────────────────────────────────

export const orchestrator = new PipelineOrchestrator(config);

// ── Initialization ──────────────────────────────────────────────────────────

let initialized = false;

/**
 * Boot the full GodsView pipeline.
 *
 * Called once from app.ts after express is configured.
 * Safe to call multiple times — only initializes once.
 */
export async function bootPipeline(): Promise<void> {
  if (initialized) return;

  try {
    logger.info({
      brokerMode: config.brokerMode,
      initialCapital: config.initialCapital,
      riskLimits: config.riskLimits,
    }, "GodsView pipeline bootstrap starting");

    await orchestrator.initialize();

    // Wire TradingView route to use orchestrator's providers
    // so webhook signals go through the full risk/memory/data pipeline
    try {
      const orch = orchestrator as any;
      if (orch.dataProvider || orch.memoryProvider || orch.riskProvider) {
        injectProviders({
          dataProvider: orch.dataProvider,
          memoryProvider: orch.memoryProvider,
          riskProvider: orch.riskProvider,
        });
        logger.info("TradingView webhook route wired to orchestrator providers");
      }
    } catch (err) {
      logger.warn({ err }, "Could not inject providers into TradingView route — degraded mode");
    }

    // ── Auto-start background workers ────────────────────────────────────
    // Launches the four orchestration workers so their /status, /start,
    // /stop, /run-once endpoints are always 200 (not 502) regardless of
    // whether an operator has hit /start manually. Each is best-effort:
    // a single worker failing to start does NOT block the others.
    // Disable individually via env: AUTONOMY_SUPERVISOR_AUTO_START=false, etc.
    const autoStartWorkers = process.env.AUTO_START_WORKERS !== "false";
    if (autoStartWorkers) {
      void autoStartBackgroundWorkers();
    }

    initialized = true;
    logger.info("GodsView pipeline bootstrap complete — all subsystems wired");

  } catch (err) {
    logger.error({ err }, "GodsView pipeline bootstrap FAILED — system running in degraded mode");
    // Don't crash the server — API endpoints still work for monitoring/debugging
    // but trading pipeline won't process signals safely
  }
}

/**
 * Best-effort auto-start of the orchestration workers.
 * Each worker is started in its own try/catch so one failure cannot block the others.
 * The handlers behind /api/brain/{autonomy,strategy}/* and /api/backtest/continuous/*
 * return 502 when their in-process singleton is null; auto-starting keeps the singletons
 * alive across container lifecycles so probes always return 200.
 */
async function autoStartBackgroundWorkers(): Promise<void> {
  const startTimeout = 30_000;
  const startWith = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("startup_timeout")), startTimeout)),
      ]);
      logger.info({ worker: name, result: result ? "started" : "noop" }, "Background worker auto-started");
    } catch (err) {
      logger.warn({ worker: name, err: String(err) }, "Background worker auto-start failed (non-fatal)");
    }
  };

  // Defer requires so a missing module on disk doesn't blow up bootstrap
  try {
    if (process.env.AUTONOMY_SUPERVISOR_AUTO_START !== "false") {
      const { startAutonomySupervisor } = await import("./autonomy_supervisor.js");
      await startWith("autonomy_supervisor", () => startAutonomySupervisor({ runImmediate: false }));
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Could not load autonomy_supervisor module");
  }
  try {
    if (process.env.STRATEGY_ALLOCATOR_AUTO_START !== "false") {
      const { startStrategyAllocator } = await import("./strategy_allocator.js");
      // runImmediate:false → don't run a heavy first cycle inline at boot.
      // The interval-based scheduler still starts; first cycle fires on its
      // normal cadence (default 8min) instead of blocking the event loop now.
      await startWith("strategy_allocator", () => startStrategyAllocator({ runImmediate: false }));
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Could not load strategy_allocator module");
  }
  try {
    if (process.env.STRATEGY_GOVERNOR_AUTO_START !== "false") {
      const { startStrategyGovernor } = await import("./strategy_governor.js");
      await startWith("strategy_governor", () => startStrategyGovernor({ runImmediate: false }));
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Could not load strategy_governor module");
  }
  // Strategy evolution is heavier (auto_start_continuous_backtest=true does
  // a full 30/60/90/180/365 day sweep on first cycle). Default OFF; opt in
  // via STRATEGY_EVOLUTION_AUTO_START=true if you want it active from boot.
  if (process.env.STRATEGY_EVOLUTION_AUTO_START === "true") {
    try {
      const { startStrategyEvolutionScheduler } = await import("./strategy_evolution_scheduler.js");
      await startWith("strategy_evolution", () => startStrategyEvolutionScheduler());
    } catch (err) {
      logger.warn({ err: String(err) }, "Could not load strategy_evolution_scheduler module");
    }
  }
}

/**
 * Graceful shutdown
 */
export async function shutdownPipeline(): Promise<void> {
  if (!initialized) return;
  try {
    await (orchestrator as any).shutdown?.();
    initialized = false;
    logger.info("GodsView pipeline shutdown complete");
  } catch (err) {
    logger.error({ err }, "Error during pipeline shutdown");
  }
}

/**
 * Get pipeline status for health checks
 */
export function getPipelineStatus(): any {
  try {
    return (orchestrator as any).getStatus?.() ?? {
      initialized,
      brokerMode: config.brokerMode,
      riskLimits: config.riskLimits,
    };
  } catch {
    return { initialized, error: "Could not retrieve status" };
  }
}
