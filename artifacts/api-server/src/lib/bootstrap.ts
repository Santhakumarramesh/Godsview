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

    initialized = true;
    logger.info("GodsView pipeline bootstrap complete — all subsystems wired");

  } catch (err) {
    logger.error({ err }, "GodsView pipeline bootstrap FAILED — system running in degraded mode");
    // Don't crash the server — API endpoints still work for monitoring/debugging
    // but trading pipeline won't process signals safely
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
