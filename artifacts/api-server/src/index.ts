import app from "./app";
import { logger } from "./lib/logger";
import { trainModel } from "./lib/ml_model";
import { trainEnsemble } from "./lib/super_intelligence";
import { validateEnv } from "./lib/env";
import { setupGracefulShutdown, onShutdown } from "./lib/shutdown";
import { closePool, checkDbHealth } from "@workspace/db";
import { runPreflight } from "./lib/preflight";
import { startSession, endSession } from "./lib/session_manager";
import { alpacaStream } from "./lib/alpaca_stream";
import { seedHistoricalData } from "./lib/historical_seeder";
import { seedBrainEntities } from "./lib/brain_seeder";
import { startRetrainScheduler, stopRetrainScheduler } from "./lib/retrain_scheduler";
import { startPaperValidationLoop, stopPaperValidationLoop } from "./lib/paper_validation_loop";
import { markMlBootstrapFailed, markMlBootstrapReady, markMlBootstrapRunning } from "./lib/startup_state";
import { MacroContextService } from "./lib/macro_context_service";
import { ScannerScheduler } from "./lib/scanner_scheduler";
import { stopReconciler } from "./lib/fill_reconciler";
import {
  shouldAutonomySupervisorAutoStart,
  startAutonomySupervisor,
  stopAutonomySupervisor,
} from "./lib/autonomy_supervisor";

// ── Validate environment before anything else ───────────────────
validateEnv();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run preflight checks (non-blocking — logs results)
  runPreflight()
    .then((result) => {
      if (!result.passed) {
        logger.warn({ checks: result.checks.filter(c => !c.passed) }, "Preflight checks had failures");
      }
    })
    .catch((err) => logger.error({ err }, "Preflight checks failed"));

  // Verify DB connectivity
  checkDbHealth()
    .then((h) => {
      if (h.ok) {
        logger.info({ driver: h.driver, latencyMs: h.latencyMs }, "Database health OK");
      } else {
        logger.error({ error: h.error }, "Database health check failed");
      }
    })
    .catch((err) => logger.error({ err }, "DB health check threw"));

  // Start trading session
  const systemMode = process.env.GODSVIEW_SYSTEM_MODE || "paper";
  startSession(systemMode).catch((err) => logger.error({ err }, "Failed to start trading session"));

  // ── Phase 35: Seed historical data for ML bootstrap (non-blocking) ──────────
  seedHistoricalData()
    .then((result) => {
      if (!result.skipped) {
        logger.info({ seededRows: result.seededRows, durationMs: result.durationMs }, "Historical data seeded");
      }
    })
    .catch((err) => logger.error({ err }, "Historical seeder failed"))
    .then(async () => {
      // Train ML model AFTER ensuring seed data exists (non-blocking)
      markMlBootstrapRunning();
      try {
        await trainModel();
        markMlBootstrapReady();
        logger.info("ML model trained from accuracy_results");
      } catch (err) {
        markMlBootstrapFailed(err);
        logger.error({ err }, "ML model training failed");
      }
      // ── Super Intelligence: train GBM ensemble after LR model is ready ────
      try {
        await trainEnsemble();
        logger.info("Super Intelligence ensemble trained");
      } catch (err) {
        logger.error({ err }, "Super Intelligence ensemble training failed");
      }
      // ── Phase 36: Start auto-retrain scheduler ────────────────────────────
      startRetrainScheduler().catch((err) => logger.error({ err }, "Retrain scheduler failed to start"));

      // ── Phase 15: Start paper validation loop (predicted vs realized) ─────
      if ((process.env.PAPER_VALIDATION_AUTO_START ?? "true") !== "false") {
        startPaperValidationLoop({ runImmediate: true })
          .then((result) => logger.info({ intervalMs: result.interval_ms }, "Paper validation loop started"))
          .catch((err) => logger.error({ err }, "Paper validation loop failed to start"));
      }
    });

  // ── Phase 37: Initialize Brain knowledge graph (non-blocking) ───────────────
  seedBrainEntities()
    .then((result) => {
      if (!result.skipped) {
        logger.info(
          { entitiesInserted: result.entitiesInserted, memoriesInserted: result.memoriesInserted },
          "Brain knowledge graph initialized"
        );
      }
    })
    .catch((err) => logger.error({ err }, "Brain seeder failed"));

  // Start Alpaca market data stream (non-blocking — feeds candle SSE)
  if (process.env.ALPACA_API_KEY) {
    alpacaStream.start();
    logger.info("Alpaca market data stream started");
  } else {
    logger.warn("ALPACA_API_KEY not set — market data stream disabled");
  }

  if (shouldAutonomySupervisorAutoStart()) {
    startAutonomySupervisor({ runImmediate: true })
      .then((result) => logger.info({ intervalMs: result.interval_ms }, "Autonomy supervisor started"))
      .catch((err) => logger.error({ err }, "Autonomy supervisor failed to start"));
  } else {
    logger.info("Autonomy supervisor auto-start disabled");
  }
});

// ── Graceful shutdown with connection draining ──────────────────
setupGracefulShutdown(server);

// Register cleanup: close SSE connections
onShutdown(async () => {
  logger.info("Cleaning up SSE connections...");
  try {
    const { closeAllClients } = await import("./lib/signal_stream");
    closeAllClients();
  } catch {
    // signal_stream may not be loaded
  }
});

// Register cleanup: stop Alpaca market data stream
onShutdown(async () => {
  logger.info("Stopping Alpaca market data stream...");
  alpacaStream.stop();
});

// Register cleanup: stop scanner scheduler + macro service + fill reconciler
onShutdown(async () => {
  logger.info("Stopping scanner + macro + reconciler services...");
  ScannerScheduler.getInstance().stop();
  MacroContextService.getInstance().stop();
  stopReconciler();
});

// Register cleanup: stop retrain scheduler
onShutdown(async () => {
  logger.info("Stopping retrain scheduler...");
  stopRetrainScheduler();
});

// Register cleanup: stop paper validation loop
onShutdown(async () => {
  logger.info("Stopping paper validation loop...");
  stopPaperValidationLoop();
});

// Register cleanup: stop autonomy supervisor
onShutdown(async () => {
  logger.info("Stopping autonomy supervisor...");
  stopAutonomySupervisor();
});

// Register cleanup: end trading session
onShutdown(async () => {
  logger.info("Ending trading session...");
  await endSession("server_shutdown");
});

// Register cleanup: drain database pool (must be last)
onShutdown(async () => {
  logger.info("Draining database connection pool...");
  await closePool();
});
